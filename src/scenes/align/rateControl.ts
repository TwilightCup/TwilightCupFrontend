/**
 * 虚拟对齐时间戳 T 的控制引擎——实现 docs/frame-align-implementation.md §1.1 规格
 * （与需求方确认）：
 *
 *   1. 缓冲 10 分钟（由调用方 FrameQueue 维护，本引擎不管）。
 *   2. T ≤ S_慢 − 30s（S_慢 = 各侧最新可用帧 realtime_us 的最小值）：T 默认按 1x 随真实
 *      时间推进，但永不超过 required = S_慢 − 30s → 呈现内容至少比最慢侧前沿旧 30s。
 *   3. 2 倍速追回：drift = required − T 累积满 30s 时，T 转 2 倍速推进净 +15s（或提前
 *      触到 required），随后回 1x、drift 归零。T 只前向单调（不回放不反复）。
 *
 * 纯函数/可单测：所有时间都用微秒；elapsed 由调用方以 rAF 传入真实流逝。
 */
export interface RateConfig {
  /** T 落后最慢侧前沿的最小秒数（µs） */
  backUs: number;
  /** drift 触发 2 倍速追回的阈值（µs） */
  thresholdUs: number;
  /** 2 倍速追回的净量（µs）：2x 播 catchRealMs 真实秒钟净追回 catchUs */
  catchUs: number;
}

export const DEFAULT_RATE: RateConfig = {
  backUs: 30_000_000,
  thresholdUs: 30_000_000,
  catchUs: 15_000_000,
};

/** 2 倍速阶段：以 2x 推进，直到累计真实计数(catchRealMs)达到 catchUs 对应量或 T 到 required。 */
export class RateController {
  private cfg: RateConfig;
  /** 虚拟对齐时间戳 T（epoch 微秒）；未就绪为 null */
  tUs: number | null = null;
  /** 当前推进倍速 */
  speed: 1 | 2 = 1;
  /** 2 倍速剩余真实毫秒（推进 catchUs 所需） */
  private burstLeftMs = 0;

  constructor(cfg: Partial<RateConfig> = {}) {
    this.cfg = { ...DEFAULT_RATE, ...cfg };
  }

  get ready(): boolean {
    return this.tUs !== null;
  }

  /**
   * 每帧推进。newestPerSideUs：各侧缓冲内最新可用帧 realtime_us（µs）。
   * elapsedMs：本帧距上帧真实流逝（ms，rAF 差分）。
   *
   * 返回虚拟对齐时间戳 T（µs）。首次会以其就绪（所有侧已有前沿）设 T = required。
   */
  step(elapsedMs: number, newestPerSideUs: number[]): number {
    if (newestPerSideUs.length === 0) return this.tUs ?? 0;
    const sSlow = Math.min(...newestPerSideUs);
    const required = sSlow - this.cfg.backUs;
    const elapsedUs = elapsedMs * 1000;

    if (this.tUs === null) {
      // 初始化：T = required（= S_慢 − 30s），让呈现从可垫稳的时刻起步
      this.tUs = required;
      this.speed = 1;
      return this.tUs;
    }

    if (this.speed === 1) {
      // 1x 推进，但永不超过 required
      this.tUs = Math.min(this.tUs + elapsedUs, required);
      const drift = required - this.tUs;
      if (drift >= this.cfg.thresholdUs) {
        this.speed = 2;
        // 2x 相对 1x 净多走 1x；要净追回 catchUs，需真实推进 catchUs/1000/1 ms
        this.burstLeftMs = this.cfg.catchUs / 1000; // 2x 播 catchRealMs 秒净追 catchUs
      }
      return this.tUs;
    }

    // 2x 推进：每真实毫秒走 2x，但封顶 at required（追上即收）
    this.tUs = Math.min(this.tUs + elapsedUs * 2, required);
    this.burstLeftMs -= elapsedMs;
    if (this.burstLeftMs <= 0 || this.tUs >= required) {
      this.speed = 1;
      this.burstLeftMs = 0;
    }
    return this.tUs;
  }
}