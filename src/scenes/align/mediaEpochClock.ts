/** Map container presentation time (microseconds) onto the last usable UTC epoch.
 * Never infer cadence from network arrival, encoder seq, or unspecified SEI PTS units.
 * B frames may move backwards in decode order. clock_ntp is diagnostic, not a gate.
 */
export class MediaEpochClock {
  private offset: number | null = null;
  private high = 0;
  private anomalyAt: number | null = null;
  status: 'source' | 'holdover' | 'slewing' | 'unverified' = 'source';
  correctionUs = 0;
  reset(): void { this.offset = null; this.high = 0; this.anomalyAt = null; this.correctionUs = 0; this.status = 'source'; }
  map(epochUs: number, mediaUs: number | null): number | null {
    const valid = Number.isSafeInteger(epochUs) && epochUs > 0;
    if (mediaUs == null || !Number.isFinite(mediaUs)) {
      this.status = 'unverified'; return valid ? epochUs : null;
    }
    if (this.offset == null) {
      if (!valid) return null;
      this.offset = epochUs - mediaUs; this.high = mediaUs;
    }
    if (Math.abs(mediaUs - this.high) > 5_000_000) {
      // A media discontinuity cannot safely carry an old mapping across a gap.
      this.reset(); this.status = 'unverified';
      if (!valid) return null;
      this.offset = epochUs - mediaUs; this.high = mediaUs;
      return epochUs;
    }
    const elapsed = Math.max(0, mediaUs - this.high);
    this.high = Math.max(this.high, mediaUs);
    const predicted = mediaUs + this.offset;
    const error = valid ? epochUs - predicted : Infinity;
    if (Math.abs(error) > 500_000) this.anomalyAt ??= this.high;
    else this.anomalyAt = null;
    const age = this.anomalyAt == null ? 0 : this.high - this.anomalyAt;
    if (!valid || (this.anomalyAt != null && age < 3_000_000) || (Math.abs(error) > 5_000_000 && age < 10_000_000)) {
      this.status = 'holdover';
      if (!valid && age >= 10_000_000) { this.status = 'unverified'; return null; }
    } else if (Math.abs(error) > 5_000_000) {
      // Persistent out-of-budget changes are visible, not silently hidden forever.
      this.offset = epochUs - mediaUs; this.status = 'unverified'; this.anomalyAt = null;
    } else {
      const correction = Math.max(-elapsed * 0.05, Math.min(elapsed * 0.05, error));
      this.offset += correction;
      this.status = Math.abs(error) > 1000 ? 'slewing' : 'source';
    }
    const result = Math.round(mediaUs + this.offset);
    this.correctionUs = valid ? result - epochUs : 0;
    return result;
  }
}
