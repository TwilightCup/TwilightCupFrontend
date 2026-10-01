/** One reset per latency excursion; all cooldowns use the monotonic clock. */
export class AutoCatchup {
  private armed = true;
  private lastAttempt = -Infinity;

  constructor(readonly deltaSeconds = 15) {}

  get targetSeconds(): number { return this.deltaSeconds + 5; }

  check(tUs: number, slowFrontierMs: number, monoMs: number, eligible: boolean): boolean {
    if (!eligible || !Number.isFinite(tUs) || !Number.isFinite(slowFrontierMs)) return false;
    const delayMs = slowFrontierMs - tUs / 1000;
    if (delayMs <= (this.deltaSeconds + 7) * 1000) this.armed = true;
    if (!this.armed || delayMs <= (this.deltaSeconds + 15) * 1000 || monoMs - this.lastAttempt < 15_000) return false;
    this.armed = false;
    this.lastAttempt = monoMs;
    return true;
  }
}
