import type { AuthorityAssignment, AuthorityRole } from "./authorityRole";
import type { Side } from "./useFrameAlign";
export interface LeaseSample {
  capability: boolean;
  media_ready: boolean;
  decode_ready: boolean;
  progress_t_us: number;
  active_sides: Side[];
  waiting_sides: Side[];
  state: "running" | "media_wait" | "paused" | "relinquish";
}
/** Status sequence is connection-owned and never resets on authority epoch changes. */
export class FrameLeaseClient {
  supported = false;
  required = false;
  private sequence = 0;
  private epoch = -1;
  private confirmed = -1;
  private declined = -1;
  private floor = 0;
  private floorKnown = false;
  private deadline = Infinity;
  private lastAt = -Infinity;
  private signature = "";
  reset(): void {
    this.supported = this.required = false; this.sequence = 0; this.epoch = this.confirmed = this.declined = -1;
    this.floor = 0; this.floorKnown = false; this.deadline = Infinity; this.lastAt = -Infinity; this.signature = "";
  }
  observe(p: AuthorityAssignment, role: AuthorityRole, now: number): void {
    if (typeof p.lease_required === "boolean") { this.supported = true; this.required = p.lease_required; }
    if (this.epoch !== role.epoch) {
      this.epoch = role.epoch; this.confirmed = this.declined = -1; this.signature = "";
      this.floor = p.t_floor_us ?? 0; this.floorKnown = p.t_floor_us !== undefined;
      this.deadline = now + (p.takeover_timeout_ms ?? 3000) - 250;
    } else if (p.t_floor_us !== undefined) {
      this.floorKnown = true;
      if (p.t_floor_us != null && p.t_floor_us > this.floor) { this.floor = p.t_floor_us; this.confirmed = -1; }
    }
  }
  deliveryFailed(): void { this.confirmed = -1; this.lastAt = -Infinity; this.signature = ""; }
  canPublish(role: AuthorityRole): boolean { return role.publisher && (!this.required || this.confirmed === role.epoch); }
  report(role: AuthorityRole, account: string, match: string, sample: LeaseSample,
    visibility: "visible" | "hidden", now: number) {
    if (!this.supported || !role.connectionId || role.epoch < 0) return null;
    const ready = sample.capability && sample.media_ready && sample.decode_ready && sample.state === "running" && sample.active_sides.length > 0;
    const confirm = this.floorKnown && role.publisher && this.required && this.confirmed !== role.epoch && ready && sample.progress_t_us >= this.floor;
    if (role.publisher && this.required && this.confirmed !== role.epoch && !confirm && now >= this.deadline) this.declined = role.epoch;
    const state = this.declined === role.epoch ? "relinquish" : sample.state;
    const signature = JSON.stringify([role.epoch, visibility, sample.capability, sample.media_ready,
      sample.decode_ready, state, sample.active_sides, sample.waiting_sides, confirm]);
    if (signature === this.signature && now - this.lastAt < 1000) return null;
    this.signature = signature; this.lastAt = now;
    if (confirm && state !== "relinquish") this.confirmed = role.epoch;
    return { connection_id: role.connectionId, account_id: account, match_id: match,
      authority_epoch: role.epoch, seq: ++this.sequence, ...sample, state, visibility };
  }
}
