/**
 * 虚拟对齐时间戳 T 的控制引擎——实现 docs/frame-align-implementation.md §1.1 规格
 * （与需求方确认）：
 *
 *   1. 缓冲 10 分钟（由调用方 FrameQueue 维护，本引擎不管）。
 *   2. T ≤ S_慢 − 30s（S_慢 = 各侧最新可用帧 realtime_us 的最小值）：T 永不超过 required，
 *      呈现内容至少比最慢侧前沿旧 30s。
 *   3. 渐进追赶：drift = required − T 时按比例温和加速（封顶 capSpeed），不骤停后硬跳——
 *      网络抖动恢复时平滑提速，T 只前向单调（不回放不反复）。
 *
 * 纯函数/可单测：所有时间都用微秒；elapsed 由调用方以 rAF 传入真实流逝。
 */
export interface RateConfig {
  /** T 落后最慢侧前沿的秒数（µs） */
  backUs: number;
  /** 温和追赶的封顶倍速 */
  capSpeed: number;
  /** 追赶时间常数（µs）：drift 达该量时速度逼近 capSpeed */
  horizonUs: number;
  /** 脱离自愈阈值（µs）：drift 超此量（远超缓冲深度，如 >60s）→ 重锚 T=前沿−backUs */
  resyncThresholdUs: number;
}

export const DEFAULT_RATE: RateConfig = {
  backUs: 30_000_000, // 30s
  capSpeed: 1.35,
  horizonUs: 25_000_000,
  resyncThresholdUs: 60_000_000, // 60s：远大于设计 30s，仅 T 脱离(>缓冲深度)时触发
};

export class RateController {
  private cfg: RateConfig;
  /** 虚拟对齐时间戳 T（epoch 微秒）；未就绪为 null */
  tUs: number | null = null;
  /** 当前推进倍速（渐进式，1 → 上限 约 1.35） */
  speed = 1;

  constructor(cfg: Partial<RateConfig> = {}) {
    this.cfg = { ...DEFAULT_RATE, ...cfg };
  }

  get ready(): boolean {
    return this.tUs !== null;
  }

  /** 呈现滞后（µs）= 最慢前沿 − 30s 的"30s" */
  get backUs(): number {
    return this.cfg.backUs;
  }

  /**
   * 每帧推进。newestPerSideUs：各侧缓冲内最新可用帧 realtime_us（µs）。
   * elapsedMs：本帧距上帧真实流逝（ms，rAF 差分）。
   *
   * 渐进追赶：基础 1×，按"落后 required 的比例"温和加速（封顶 capSpeed），
   * 避免骤停后突然 2× 崩跳——网络抖动恢复时平滑提速，而不是硬跳。
   * T 只前向单调、且永不超过 required（= 最慢前沿 − 30s）。
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

    const drift = Math.max(0, required - this.tUs);
    // 脱离自愈：T 落后远超缓冲深度（如 10min 原始环容不下 T 时刻）→ 重锚到 前沿−backUs，
    // 让 T 回到原始环可解区间，否则解码器找不到 T 附近关键帧 → 队列恒空 → 永远没画面
    if (drift > this.cfg.resyncThresholdUs) {
      this.tUs = required;
      this.speed = 1;
      return this.tUs;
    }
    // 落后越多加速越多：落后 horizonUs 时达到 [1+1]=2→封顶 capSpeed
    const want = 1 + drift / this.cfg.horizonUs;
    this.speed = Math.min(this.cfg.capSpeed, want);
    // 渐进追 + 封顶 at required（超过 required 会被截到 required）
    this.tUs = Math.min(this.tUs + elapsedUs * this.speed, required);
    return this.tUs;
  }
}