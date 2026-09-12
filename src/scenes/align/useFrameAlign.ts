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
import { RateController } from "./rateControl";
import { FrameLockStream } from "./frameLock";
import { createFrameSource } from "./transport";
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

class AlignEngine {
  private streams = new Map<Side, FrameLockStream>();
  private canvases = new Map<Side, HTMLCanvasElement[]>();
  private cfg = new RateController();
  private raf = 0;
  private last = 0;
  private running = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  /** 跨文档一致性：被权威页（舞台）经 WS director_cmd(frame_align)/state_sync 广播的外部 T（µs）。
   *   观众页（控制台）置位后以外部 T 为准；权威页（舞台）自己推进 RateController 并广播。 */
  private externalTUs: number | null = null;
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

  get ready(): boolean {
    return this.cfg.ready;
  }

  /** 标记本实例为对齐权威（舞台渲染页，自己推进 T 并广播）——便观众页不要覆盖自身的时钟 */
  setAuthority(v: boolean): void {
    this.isAuthority = v;
  }

  setExternalTUs(us: number | null): void {
    this.externalTUs = us;
    if (!this.isAuthority && us != null) this.tUs.value = us;
  }
  /* ---- 流管理（每侧唯一流，引用计数：舞台/控制台共同引用，计数归零才停） ---- */
  private refs = new Map<Side, number>();
  startStream(side: Side, url: string, kind: "hls" | "annexb" = "hls"): void {
    if (!this.streams.has(side)) {
      const source = createFrameSource(kind, { url });
      const s = new FrameLockStream(source, {
        onError: (e) => {
          console.warn(`[align ${side}]`, e);
          // 仅"尚无内容"时的拉流失败值得提示"拉不到"；已有内容后的偶发报错不盖画面
          if (!s.hasContent) this.streamError[side] = friendlyStreamError(e);
        },
        onModeChange: (m) => {
          this.modes[side] = m;
          if (this.streamError[side]) this.streamError[side] = null;
        },
      });
      this.streams.set(side, s);
      this.modes[side] = s.mode;
      this.resetPresented(side);
      s.start();
    }
    this.refs.set(side, (this.refs.get(side) ?? 0) + 1);
  }
  stopStream(side: Side): void {
    const c = (this.refs.get(side) ?? 0) - 1;
    if (c <= 0) {
      this.refs.delete(side);
      this.streams.get(side)?.stop();
      this.streams.delete(side);
      this.modes[side] = "off";
      this.presented[side] = false;
    } else {
      this.refs.set(side, c);
    }
  }
  modeOf(side: Side): "aligned" | "off" {
    return this.streams.get(side)?.mode ?? "off";
  }
  /** 重挂流时还原"未上屏"状态（下轮攒够缓冲再提） */
  private resetPresented(side: Side): void {
    this.presented[side] = false;
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
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.refreshHealth();
    this.healthTimer = setInterval(() => this.refreshHealth(), 400);
    const loop = (now: number) => {
      if (!this.running) return;
      const elapsed = Math.max(now - this.last, 0);
      this.last = now;
      // 各侧前沿（µs）
      const frontiers: number[] = [];
      for (const [, s] of this.streams) {
        const f = s.frontier();
        if (f != null) frontiers.push(f);
      }
      // T：权威页自己跑速率控制（并发广播）；观众页用外部权威 T（当有）
      let T: number | null = null;
      if (this.isAuthority || this.externalTUs == null) {
        if (frontiers.length > 0) T = this.cfg.step(elapsed, frontiers);
      } else {
        T = this.externalTUs;
      }
      if (T != null) {
        this.tUs.value = T;
        // 逐流 advance + 上屏到所有注册 canvas
        for (const [side, s] of this.streams) {
          // 只要有内容就视为"已在拉"→ 清掉"拉不到流"提示（恢复后自动收敛）
          if (s.hasContent && this.streamError[side]) this.streamError[side] = null;
          s.advance(T);
          const frame = s.nearest(T);
          const cvs = this.canvases.get(side);
          if (frame != null && cvs) {
            for (const cv of cvs) this.drawFrame(cv, frame as CanvasImageSource);
            this.presented[side] = true;
          }
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  private drawFrame(canvas: HTMLCanvasElement, frame: CanvasImageSource): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 全幅贴合（外层裁切 4:3/16:9 由 SeiStream 容器负责）。
    // 优先取帧固有尺寸（新 canvas 默认 300×150 是假的，不能用它当画布分辨率）。
    const frm = frame as { displayWidth?: number; displayHeight?: number; codedWidth?: number; codedHeight?: number };
    const w = frm.displayWidth || frm.codedWidth || canvas.width || 1920;
    const h = frm.displayHeight || frm.codedHeight || canvas.height || 1080;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(frame, 0, 0, w, h);
  }
}

/** 共享单例：舞台与控制台都引用它，读同一 T、同一帧。 */
export const alignEngine = new AlignEngine();