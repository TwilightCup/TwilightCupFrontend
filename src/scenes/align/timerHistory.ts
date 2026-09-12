/**
 * 实时计时样本历史——支撑叠加层"锚定虚拟时间 T"（§1.3）：主计时/分段不再按实时 now 外推，
 * 而是显示 wallMs 那一刻的读数。因为 live_time 每秒一条，且只前向外推，要回看 T（比现在
 * 落后 30s+）必须缓存最近样本窗并在其中插值/外推。
 *
 * - 纯类，可单测；wallMs 为 epoch 毫秒（由 T_wall_ms = T/1000 提供）。
 */
export interface TimerSample {
  receivedAt: number; // 报告真实时刻（epoch ms）
  totalMs: number;
  segmentMs: number;
}

export class TimerHistory {
  private samples: TimerSample[] = [];
  /** 保留窗（ms）：覆盖 T 的最大落后 + 余量（默认 70s，比 10min 缓冲所需小得多） */
  constructor(private windowMs = 70_000) {}

  /** 增量喂最新样本（同 receivedAt 去重；窗口外旧样本裁剪） */
  add(s: TimerSample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && s.receivedAt <= last.receivedAt) {
      // 覆盖/去重（EPS：同戳更新）
      if (s.receivedAt === last.receivedAt) this.samples[this.samples.length - 1] = s;
      return;
    }
    this.samples.push(s);
    const minAt = s.receivedAt - this.windowMs;
    while (this.samples.length && this.samples[0]!.receivedAt < minAt) this.samples.shift();
  }

  get last(): TimerSample | null {
    return this.samples[this.samples.length - 1] ?? null;
  }

  /** wallMs 时刻该侧计时读数；无样本 null。 */
  valueAt(wallMs: number): TimerSample | null {
    const n = this.samples.length;
    if (n === 0) return null;
    // 找最后一个 receivedAt <= wallMs 的样本（作为外推/插值锚）
    let lo = 0, hi = n - 1, anchor = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid]!.receivedAt <= wallMs) { anchor = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    const base = this.samples[anchor]!;
    // wallMs 早于最早样本：落在样本窗之外（异常超前请求）→ 回退最早样本读数
    const dt = Math.max(0, wallMs - base.receivedAt);
    return { receivedAt: wallMs, totalMs: base.totalMs + dt, segmentMs: base.segmentMs + dt };
  }

  /** wallMs 时刻的主计时毫秒值（段/总复用同一插值锚）；无样本 null */
  totalMsAt(wallMs: number): number | null {
    return this.valueAt(wallMs)?.totalMs ?? null;
  }
  segmentMsAt(wallMs: number): number | null {
    return this.valueAt(wallMs)?.segmentMs ?? null;
  }

  clear(): void {
    this.samples = [];
  }
}