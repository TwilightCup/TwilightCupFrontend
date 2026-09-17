/**
 * 单一对齐权威 `alignEngine`（模块级单例）——四路渲染（舞台 A/B + 控制台 A/B）共用
 * 同一个虚拟时间 T 与同一份解码帧，保证导播在控制台所见与舞台像素一致（§1.2）。
 *
 * - 每条**唯一**流一个 FrameLockStream（Harvester→demux→SEI→WebCodecs→FrameQueue）。
 * - rAF 驱动：RateController 推进 T（§1.1），逐流 advance(T) 淘汰旧帧、nearest(T) 上屏，
 *   画到该侧**所有**已注册展示 canvas（舞台 canvas + 控制台 canvas 同帧同 T）。
 * - `modeOf(side)`='off' 时外层 SeiStream 回退 MSE StreamFrame；该侧其余展示不阻塞。
 */
import { reactive, ref, type Ref } from "vue";
import { ExternalClock, type FrameAlignAnchor } from "./externalClock";
import type { FrameEntry } from "./frameQueue";
import { RateController } from "./rateControl";
import { FrameLockStream } from "./frameLock";
import { createFrameSource } from "./transport";
import { logAuth } from "./debugLog";
import { emptyHealth, type StreamHealth } from "./types";

export type Side = "A" | "B";

/** 拉流失败 → 可读文案（fetch 对 ERR_CONNECTION_REFUSED 等一律抛 TypeError "Failed to fetch"，
 * 据此给通用"连不上服务器"，命中具体信号再细分） */
export function friendlyStreamError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/CORS|is not allowed|Access control|No 'Access-Control-Allow-Origin'/i.test(m)) {
    return "跨域被拦（CORS）：检查流服务器 hlsAllowOrigins";
  }
  if (/404|Not Found/i.test(m)) return "流地址不存在（404）";
  if (/abort/i.test(m)) return "拉流被中断";
  if (/Failed to fetch|NetworkError|ECONN|connection/i.test(m)) {
    return "无法连接到流服务器（地址写错 / 服务未启动 / 连接被拒）";
  }
  return `拉流失败：${m}`;
}

export class AlignEngine {
  private streams = new Map<Side, FrameLockStream>();
  private canvases = new Map<Side, HTMLCanvasElement[]>();
  private cfg = new RateController();
  private raf = 0;
  private last = 0;
  private running = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  /** 隐藏兜底时钟：页面 hidden 时 rAF 全面暂停（OBS 浏览器源不在前台/最小化），
   *  权威页会停发 frame_align → 所有跟随页冻结。退 setInterval 保底推进 + 广播。 */
  private hiddenTimer: ReturnType<typeof setInterval> | null = null;
  private external = new ExternalClock();
  private requiredSides = new Set<Side>();
  private sourceUrls = new Map<Side, string>();
  private streamGenerations = new Map<Side, number>();
  readonly enabled = ref(false);
  readonly sync = reactive({ state: "waiting" as "waiting" | "playing" | "frozen" | "stale",
    targetUs: null as number | null, pairErrorUs: null as number | null,
    presentedRt: { A: null, B: null } as Record<Side, number | null>,
    targetErrorUs: { A: null, B: null } as Record<Side, number | null> });

  /** 本实例是否是对齐权威（舞台渲染页）：true 时不用外部 T，自己跑速率控制并发广播 */
  private isAuthority = false;

  /** 虚拟对齐时间戳 T（epoch 微秒）；未就绪 null */
  readonly tUs: Ref<number | null> = ref(null);
  /** 各侧解码能力（响应式，供 UI 切 SeiStream/回退 MSE） */
  readonly modes = reactive<Record<Side, "aligned" | "off">>({ A: "off", B: "off" });
  /** 各侧最近拉流错误（可读文案；有内容后清空）。供导播界面直接提示，不必翻 console */
  readonly streamError = reactive<Record<Side, string | null>>({ A: null, B: null });
  /** 各侧连通性/健康指标（对齐 SEIInjector 冒烟工具；~2.5Hz 刷新） */
  readonly health = reactive<Record<Side, StreamHealth>>({ A: emptyHealth(), B: emptyHealth() });
  /** 各侧是否已真正上屏过一帧（攒够缓冲的判据；供 A/B 画面提示"攒缓冲中/已就绪"） */
  readonly presented = reactive<Record<Side, boolean>>({ A: false, B: false });
  /** 全局播放诊断：当前 T 播放倍速（×>1 → 在追/快进）与 T 落后最慢前沿的秒数（追 Xs） */
  readonly playback = reactive({ speed: 1, behindS: 0 });
  /** 主循环（rAF）是否正常推进——死循环 = 画面卡住、队列不清理（追在涨但画面停） */
  readonly loopAlive = ref(true);
  readonly loopErr = ref<string | null>(null);
  private lastTickTime = performance.now();

  get ready(): boolean {
    return this.cfg.ready;
  }

  /** 标记本实例为对齐权威（舞台渲染页，自己推进 T 并广播）——便观众页不要覆盖自身的时钟 */
  setAuthority(v: boolean): void {
    this.isAuthority = v;
  }

  setExternalTUs(us: number | null, meta: Partial<FrameAlignAnchor> = {}): boolean {
    if (us == null || this.isAuthority) return false;
    return this.external.accept({ ...meta, t_us: us }, performance.now());
  }
  selectAuthority(src: string): void { this.external.selectSource(src); }
  setRequiredSides(sides: Side[]): void {
    this.requiredSides = new Set(sides);
    this.enabled.value = sides.length > 0;
  }

  /* ---- 流管理（每侧唯一流，引用计数：舞台/控制台共同引用，计数归零才停） ---- */
  private refs = new Map<Side, Set<symbol>>();
  startStream(side: Side, url: string, kind: "hls" | "annexb" = "hls"): () => void {
    if (this.sourceUrls.get(side) !== url && this.streams.has(side)) {
      this.streams.get(side)!.stop();
      this.streams.delete(side);
      this.cfg = new RateController();
    }
    this.enabled.value = true;
    if (!this.streams.has(side)) {
      const generation = (this.streamGenerations.get(side) ?? 0) + 1;
      this.streamGenerations.set(side, generation);
      this.sourceUrls.set(side, url);
      const source = createFrameSource(kind, { url });
      const s = new FrameLockStream(source, {
        onError: (e) => {
          if (this.streamGenerations.get(side) !== generation) return;
          console.warn(`[align ${side}]`, e);
          // 仅"尚无内容"时的拉流失败值得提示"拉不到"；已有内容后的偶发报错不盖画面
          if (!s.hasContent) this.streamError[side] = friendlyStreamError(e);
        },
        onModeChange: (m) => {
          if (this.streamGenerations.get(side) !== generation) return;
          this.modes[side] = m;
          if (this.streamError[side]) this.streamError[side] = null;
        },
      });
      this.streams.set(side, s);
      this.modes[side] = s.mode;
      this.resetPresented(side);
      s.start();
    }
    const token = Symbol(side);
    const refs = this.refs.get(side) ?? new Set<symbol>();
    refs.add(token);
    this.refs.set(side, refs);
    return () => this.stopStream(side, token);
  }
  private stopStream(side: Side, token: symbol): void {
    const refs = this.refs.get(side);
    if (!refs?.delete(token)) return; // old session/component cannot release a new lease
    if (refs.size === 0) {
      this.refs.delete(side);
      this.streams.get(side)?.stop();
      this.streams.delete(side);
      this.sourceUrls.delete(side);
      this.streamGenerations.set(side, (this.streamGenerations.get(side) ?? 0) + 1);
      this.modes[side] = "off";
      this.presented[side] = false;
      this.sync.presentedRt[side] = null;
    }
  }
  restartStream(side: Side): void {
    const url = this.sourceUrls.get(side);
    if (!url) return;
    this.streams.get(side)?.stop();
    this.streams.delete(side);
    this.cfg = new RateController(); // explicit operator recovery, not automatic timeline jump
    const release = this.startStream(side, url);
    release();
  }
  resetSession(): void {
    for (const stream of this.streams.values()) stream.stop();
    this.streams.clear(); this.refs.clear(); this.sourceUrls.clear();
    this.external = new ExternalClock(); this.cfg = new RateController();
    this.tUs.value = null; this.sync.state = "waiting";
    this.modes.A = this.modes.B = "off";
    this.presented.A = this.presented.B = false;
    this.sync.presentedRt.A = this.sync.presentedRt.B = null;
  }

  modeOf(side: Side): "aligned" | "off" {
    return this.streams.get(side)?.mode ?? "off";
  }
  /** 重挂流时还原"未上屏"状态（下轮攒够缓冲再提） */
  private resetPresented(side: Side): void {
    this.presented[side] = false;
    this.sync.presentedRt[side] = null;
    this.sync.targetErrorUs[side] = null;
  }
  frontierOf(side: Side): number | null {
    return this.streams.get(side)?.frontier() ?? null;
  }
  /** 已注册展示 canvas 数（供监控统计） */
  registerCanvas(side: Side, canvas: HTMLCanvasElement): () => void {
    const arr = this.canvases.get(side) ?? [];
    arr.push(canvas);
    this.canvases.set(side, arr);
    return () => this.unregisterCanvas(side, canvas);
  }
  private unregisterCanvas(side: Side, canvas: HTMLCanvasElement): void {
    const arr = this.canvases.get(side);
    if (!arr) return;
    const i = arr.indexOf(canvas);
    if (i >= 0) arr.splice(i, 1);
    if (arr.length === 0) this.canvases.delete(side);
  }
  /* ---- 主循环 ---- */
  private refreshHealth(): void {
    for (const side of ["A", "B"] as Side[]) {
      const s = this.streams.get(side);
      this.health[side] = s ? s.stats() : emptyHealth();
    }
    // 主循环存活看门狗：2s 无 tick → 判定循环卡死（画面会卡住但拉流/统计还在走）
    if (performance.now() - this.lastTickTime > 2000) {
      this.loopAlive.value = false;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.refreshHealth();
    this.healthTimer = setInterval(() => this.refreshHealth(), 400);
    const loop = (now: number) => {
      if (!this.running) return;
      // 主循环无论单帧是否抛错都继续（此前一旦某帧绘制异常就会掐断 rAF → 画面永久卡死）
      try {
        this.tickLoop(now);
      } catch (e) {
        console.error("[align loop]", e);
        this.loopErr.value = e instanceof Error ? e.message : String(e);
      }
      this.loopAlive.value = true;
      this.lastTickTime = now;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    // 隐藏兜底：1Hz 检查就绪状态；elapsed 有上限，避免后台恢复时跳跃。
    this.hiddenTimer = setInterval(() => {
      if (this.running && document.hidden) this.tickLoop(performance.now());
    }, 1000);
  }

  private tickLoop(now: number): void {
    const elapsed = Math.max(0, Math.min(now - this.last, 100));
    this.last = now;
    const sides = this.requiredSides.size ? [...this.requiredSides] : [...this.streams.keys()];
    const streams = sides.map(side => this.streams.get(side));
    const coverage = streams.map(stream => stream?.coverage() ?? null);
    const freeze = (state: "waiting" | "frozen" | "stale") => {
      this.sync.state = state;
      this.playback.speed = 0;
      for (const side of sides) this.presented[side] = false;
    };
    if (!sides.length || coverage.some(c => !c)) { freeze("waiting"); return; }
    const frontiers = coverage.map(c => c!.to);
    const slow = Math.min(...frontiers);
    const required = slow - this.cfg.backUs;
    const earliest = Math.max(...coverage.map(c => c!.from));
    if (earliest > required) { freeze("waiting"); return; }
    const previous = this.cfg.checkpoint();
    const external = this.isAuthority ? null : this.external.read(now);
    if (external?.stale) { freeze("stale"); return; }
    const T = external ? external.t : this.cfg.step(elapsed, frontiers);
    this.sync.targetUs = T;
    if (T < earliest || T > required || (this.tUs.value != null && T < this.tUs.value)) {
      this.cfg.restore(previous); freeze("frozen"); return;
    }
    const frames: FrameEntry[] = [];
    for (const stream of streams) {
      stream!.advance(T);
      const frame = stream!.queue.nearest(T, 40_000);
      if (frame) frames.push(frame);
    }
    const pairError = frames.length ? Math.max(...frames.map(f => f.rtUs)) - Math.min(...frames.map(f => f.rtUs)) : null;
    if (frames.length !== sides.length || (pairError ?? Infinity) > 40_000) {
      this.cfg.restore(previous); freeze("frozen"); return;
    }
    // Stage all draws before touching any visible canvas. A missing/closed frame cannot
    // advance one side alone. JS canvas commits run in the same task, before browser paint.
    const prepared: { canvas: HTMLCanvasElement; buffer: HTMLCanvasElement }[] = [];
    try {
      for (let i = 0; i < sides.length; i++) {
        for (const canvas of this.canvases.get(sides[i]!) ?? []) {
          const buffer = this.drawBuffer(canvas, frames[i]!.handle as globalThis.VideoFrame);
          prepared.push({ canvas, buffer });
        }
      }
    } catch {
      this.cfg.restore(previous); freeze("frozen"); return;
    }
    for (const { canvas, buffer } of prepared) {
      if (canvas.width !== buffer.width) canvas.width = buffer.width;
      if (canvas.height !== buffer.height) canvas.height = buffer.height;
      canvas.getContext("2d")!.drawImage(buffer, 0, 0);
    }
    this.tUs.value = T; // committed presentation time; overlays must never use targetUs
    this.sync.state = "playing";
    this.sync.pairErrorUs = pairError;
    this.playback.speed = external ? external.rate : this.cfg.speed;
    this.playback.behindS = (required - T) / 1e6;
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i]!;
      this.sync.presentedRt[side] = frames[i]!.rtUs;
      this.sync.targetErrorUs[side] = frames[i]!.rtUs - T;
      this.presented[side] = true;
      this.streamError[side] = null;
    }
    logAuth("present", `T=${T} pairErrorUs=${pairError} A=${this.sync.presentedRt.A} B=${this.sync.presentedRt.B}`);
  }
  private buffers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  private drawBuffer(canvas: HTMLCanvasElement, frame: globalThis.VideoFrame): HTMLCanvasElement {
    let buffer = this.buffers.get(canvas);
    if (!buffer) { buffer = document.createElement("canvas"); this.buffers.set(canvas, buffer); }
    if (!frame.displayWidth || !frame.displayHeight || !canvas.getContext("2d")) throw new Error("Invalid presentation surface");
    if (buffer.width !== frame.displayWidth) buffer.width = frame.displayWidth;
    if (buffer.height !== frame.displayHeight) buffer.height = frame.displayHeight;
    const ctx = buffer.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(frame, 0, 0);
    return buffer;
  }
  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    if (this.hiddenTimer) clearInterval(this.hiddenTimer);
    this.hiddenTimer = null;
  }


}

/** 共享单例：舞台与控制台都引用它，读同一 T、同一帧。 */
export const alignEngine = new AlignEngine();