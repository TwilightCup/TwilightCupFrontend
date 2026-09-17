/** Server election, never a browser race. Reset fencing only on a new authenticated socket. */
export interface AuthorityAssignment {
  connection_id?: string;
  src?: string | null;
  lease_required?: boolean;
  lease_timeout_ms?: number;
  takeover_timeout_ms?: number;
  t_floor_us?: number | null;
  epoch?: number;
  role?: string;
}
export class AuthorityRole {
  connectionId: string | null = null;
  src: string | null = null;
  epoch = -1;
  role: "publisher" | "follower" = "follower";
  sequence = 0;
  get publisher(): boolean { return !!this.connectionId && this.role === "publisher" && this.src === this.connectionId; }
  connect(id: string): void { this.disconnect(); this.connectionId = id; }
  disconnect(): void { this.connectionId = null; this.src = null; this.epoch = -1; this.role = "follower"; this.sequence = 0; }
  assign(p: AuthorityAssignment): boolean {
    if (!this.connectionId || p.connection_id !== this.connectionId ||
      (p.src !== null && (typeof p.src !== "string" || !p.src)) ||
      !Number.isSafeInteger(p.epoch) || p.epoch! < this.epoch ||
      (p.lease_required != null && typeof p.lease_required !== "boolean") ||
      (p.t_floor_us != null && (!Number.isSafeInteger(p.t_floor_us) || p.t_floor_us < 0)) ||
      (p.takeover_timeout_ms != null && (!Number.isSafeInteger(p.takeover_timeout_ms) || p.takeover_timeout_ms <= 0)) ||
      (p.role !== "publisher" && p.role !== "follower") ||
      (p.role === "publisher" && p.src !== this.connectionId)) return false;
    if (p.epoch === this.epoch && (p.src !== this.src || p.role !== this.role)) return false;
    if (p.epoch !== this.epoch) this.sequence = 0;
    this.src = p.src; this.epoch = p.epoch!; this.role = p.role;
    return true;
  }
}
