/** Absolute UTC epoch mapping. Monotonic values never leave this document. */
export class ServerClock {
  private anchor: { epochMs: number; monoMs: number; receivedMs: number } | null = null;
  observe(epochMs: number, monoMs = performance.now()): boolean {
    if (!Number.isSafeInteger(epochMs) || epochMs <= 0) return false;
    const a = this.anchor;
    if (a && monoMs - a.receivedMs <= 30_000) {
      const projected = a.epochMs + monoMs - a.monoMs;
      const error = epochMs - projected;
      // One-way samples include transport delay. Never let one bad sample step the clock.
      if (Math.abs(error) > 5000) return false;
      const limit = Math.max(0, monoMs - a.monoMs) * 0.05;
      epochMs = projected + Math.max(-limit, Math.min(limit, error));
    }
    this.anchor = { epochMs, monoMs, receivedMs: monoMs };
    return true;
  }
  read(monoMs = performance.now(), wallMs = Date.now()): { epochMs: number; source: 'server-estimate' | 'local-fallback' } {
    const a = this.anchor;
    return a && monoMs - a.receivedMs <= 30_000
      ? { epochMs: a.epochMs + Math.max(0, monoMs - a.monoMs), source: 'server-estimate' }
      : { epochMs: wallMs, source: 'local-fallback' };
  }
  clear(): void { this.anchor = null; }
}

// Receive-time history must stay ordered across local NTP steps. This is a local
// epoch estimate, not a claim of server/encoder calibration.
let localAnchor: { epoch: number; mono: number } | null = null;
export function stableEpochNow(): number {
  const mono = performance.now();
  localAnchor ??= { epoch: Date.now(), mono };
  return localAnchor.epoch + mono - localAnchor.mono;
}
