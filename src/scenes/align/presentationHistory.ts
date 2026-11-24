/** Immutable receive-time snapshots. Missing history is unknown, never the next snapshot.
 * Source event timestamps require a backend contract; receive time is a conservative
 * compatibility fallback only when the browser wall clock agrees with the SEI clock.
 */
export class PresentationHistory<T> {
  private entries: { at: number; value: T }[] = [];
  constructor(private spanMs = 660_000, private maxEntries = 20_000) {}
  add(at: number, value: T): void {
    if (!Number.isFinite(at)) return;
    const last = this.entries.at(-1);
    at = Math.max(at, last?.at ?? at);
    if (last?.at === at) last.value = value;
    else this.entries.push({ at, value });
    // Retain a baseline preceding the window; count limit remains a hard safety bound.
    while (this.entries.length > 1 && (this.entries[1]!.at < at - this.spanMs || this.entries.length > this.maxEntries)) {
      this.entries.shift();
    }
  }
  at(timeMs: number): T | null {
    let lo = 0, hi = this.entries.length - 1, index = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.entries[mid]!.at <= timeMs) { index = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return index < 0 ? null : this.entries[index]!.value;
  }
  clear(): void { this.entries = []; }
}
