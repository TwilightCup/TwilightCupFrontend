/** One reset per latency excursion; all cooldowns use the monotonic clock. */
export class AutoCatchup {
  private armed = true;
  private lastAttempt = -Infinity;

  hold(): void { this.armed = false; }

  check(tUs: number, wallMs: number, monoMs: number, eligible: boolean): boolean {
    if (!eligible || !Number.isFinite(tUs) || !Number.isFinite(wallMs)) return false;
    const delayMs = wallMs - tUs / 1000;
    if (delayMs <= 12_000) this.armed = true;
    if (!this.armed || delayMs < 15_000 || monoMs - this.lastAttempt < 15_000) return false;
    this.armed = false;
    this.lastAttempt = monoMs;
    return true;
  }
}
