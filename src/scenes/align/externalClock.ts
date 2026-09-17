/** Compatible WS clock anchor. performance time is local; remote wall clocks are never
 * subtracted from Date.now(). Without server timing metadata, receive time is the anchor
 * (network latency remains an explicit cross-document limitation).
 */
export interface FrameAlignAnchor {
  t_us: number;
  src?: string;
  epoch?: number;
  seq?: number;
  rate?: number;
  paused?: boolean;
  frozen?: boolean;
  match_id?: string;
  account_id?: string;
  scene?: string;
  source_id?: string;
  /** Internal: legacy handshake snapshots have unknown age. */
  replay?: boolean;
  effective_at_ms?: number;
  server_now_ms?: number;
}

export class ExternalClock {
  private anchor: { t: number; at: number; rate: number; received: number; staleReplay: boolean } | null = null;
  private epoch: number | null = null;
  private seq: number | null = null;
  private scope: { scene?: string; source_id?: string } | null = null;
  revision = 0;
  private source: string | null = null;
  private allowedSource: string | null = null;
  private lastInput = -Infinity;
  private lastOutput = -Infinity;
  private seenSources = new Set<string>();
  get attached(): boolean { return this.anchor !== null; }

  selectSource(src: string): void { this.allowedSource = src; }
  accept(p: FrameAlignAnchor, now: number): boolean {
    if (!Number.isSafeInteger(p.t_us) || p.t_us <= 0 || p.t_us < this.lastInput) return false;
    if (p.epoch != null && (!Number.isSafeInteger(p.epoch) || p.epoch < 0)) return false;
    if (p.seq != null && (!Number.isSafeInteger(p.seq) || p.seq < 0)) return false;
    if (p.rate != null && (!Number.isFinite(p.rate) || p.rate < 0 || p.rate > 1.08)) return false;
    if (this.epoch != null && (p.epoch == null || p.epoch < this.epoch)) return false;
    const src = p.src ?? this.allowedSource;
    const changed = src != null && this.source != null && src !== this.source;
    if (src && this.allowedSource && src !== this.allowedSource) return false;
    const newerEpoch = p.epoch != null && (this.epoch == null || p.epoch > this.epoch);
    if (changed && (src !== this.allowedSource || (this.seenSources.has(src!) && !newerEpoch))) return false;
    if (!newerEpoch && this.seq != null && (p.seq == null || p.seq <= this.seq)) return false;
    if (!newerEpoch && this.scope &&
        (p.scene !== this.scope.scene || p.source_id !== this.scope.source_id)) return false;
    // Validate before mutating authority state.
    const age = p.server_now_ms != null && p.effective_at_ms != null
      ? Math.max(0, Math.min(5000, p.server_now_ms - p.effective_at_ms)) : 0;
    if (!Number.isFinite(age)) return false;
    if (newerEpoch || changed) this.revision++;
    this.scope = { scene: p.scene, source_id: p.source_id };
    if (src) { this.source = src; this.seenSources.add(src); }
    this.epoch = p.epoch ?? this.epoch;
    this.seq = p.seq ?? null;
    const rate = p.paused || p.frozen ? 0 : p.rate ?? (p.t_us === this.lastInput ? 0 : 1);
    this.anchor = { t: p.t_us, at: now - age, rate, received: now - age,
      staleReplay: !!p.replay && (p.epoch == null || p.seq == null || p.server_now_ms == null || p.effective_at_ms == null) };
    this.lastInput = p.t_us;
    return true;
  }
  read(now: number): { t: number; rate: number; stale: boolean } | null {
    if (!this.anchor) return null;
    const a = this.anchor;
    const stale = a.staleReplay || now - a.received > 1500;
    // Bound speculative travel when the authority disappears, then freeze permanently.
    const elapsed = a.staleReplay ? 0 : Math.max(0, Math.min(now - a.at, 1000));
    this.lastOutput = Math.max(this.lastOutput, a.t + elapsed * 1000 * a.rate);
    return { t: this.lastOutput, rate: stale ? 0 : a.rate, stale };
  }
}
