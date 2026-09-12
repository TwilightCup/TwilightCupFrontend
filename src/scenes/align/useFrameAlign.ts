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

export type Side = "A" | "B";

class AlignEngine {
  private streams = new Map<Side, FrameLockStream>();
  private canvases = new Map<Side, HTMLCanvasElement[]>();
  private cfg = new RateController();
  private raf = 0;
  private last = 0;
  private running = false;
  /** 跨文档一致性：被权威页（舞台）经 WS director_cmd(frame_align) 广播的外部 T（µs）。
   *   setExternalTUs 置位后本实例以外部 T 为准（观众页不跑自己的速率控制，取同帧<→像素一致）。 */
  private externalTUs: number | null = null;

  /** 虚拟对齐时间戳 T（epoch 微秒）；未就绪 null */
  readonly tUs: Ref<number | null> = ref(null);
  /** 各侧解码能力（响应式，供 UI 切 SeiStream/回退 MSE） */
  readonly modes = reactive<Record<Side, "aligned" | "off">>({ A: "off", B: "off" });

  get ready(): boolean {
    return this.cfg.ready;
  }

  setExternalTUs(us: number | null): void {
    this.externalTUs = us;
    if (us != null) this.tUs.value = us;
  }
  /* ---- 流管理（每侧唯一流，引用计数：舞台/控制台共同引用，计数归零才停） ---- */
  private refs = new Map<Side, number>();
  startStream(side: Side, url: string, kind: "hls" | "annexb" = "hls"): void {
    if (!this.streams.has(side)) {
      const source = createFrameSource(kind, { url });
      const s = new FrameLockStream(source, {
        onError: (e) => console.warn(`[align ${side}]`, e),
        onModeChange: (m) => { this.modes[side] = m; },
      });
      this.streams.set(side, s);
      this.modes[side] = s.mode;
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
    } else {
      this.refs.set(side, c);
    }
  }
  modeOf(side: Side): "aligned" | "off" {
    return this.streams.get(side)?.mode ?? "off";
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
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
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
      // T：外部权威（观众页）优先；否则本实例速率控制（被广播的作者页）
      let T: number | null = this.externalTUs;
      if (T == null && frontiers.length > 0) {
        T = this.cfg.step(elapsed, frontiers);
      }
      if (T != null) {
        this.tUs.value = T;
        // 逐流 advance + 上屏到所有注册 canvas
        for (const [side, s] of this.streams) {
          s.advance(T);
          const frame = s.nearest(T);
          if (frame == null) continue;
          const cvs = this.canvases.get(side);
          if (!cvs) continue;
          for (const cv of cvs) this.drawFrame(cv, frame as CanvasImageSource);
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
  }

  private drawFrame(canvas: HTMLCanvasElement, frame: CanvasImageSource): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 全幅贴合（外层裁切 4:3/16:9 由 SeiStream 容器负责）
    const w = canvas.width || (frame as { displayWidth?: number }).displayWidth ||
      (frame as unknown as { codedWidth?: number }).codedWidth || 1920;
    const h = canvas.height || (frame as { displayHeight?: number }).displayHeight ||
      (frame as unknown as { codedHeight?: number }).codedHeight || 1080;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(frame, 0, 0, w, h);
  }
}

/** 共享单例：舞台与控制台都引用它，读同一 T、同一帧。 */
export const alignEngine = new AlignEngine();