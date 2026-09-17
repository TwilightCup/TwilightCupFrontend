/** Signal loss is an ingest/coverage decision, never a decoder readiness flag.
 * Time arguments are local monotonic milliseconds. Only the elected publisher
 * owns this state machine; followers consume its membership in clock anchors. */
export type SignalSide = "A" | "B";
export const SIGNAL = { staleMs: 6000, waitMs: 10000, joinMs: 250, retryMs: 5000 } as const;
export class SignalRecovery {
  private excluded = new Set<SignalSide>();
  private since: number | null = null;
  reset(waiting: SignalSide[] = []): void { this.excluded = new Set(waiting); this.since = null; }
  update(now: number, required: SignalSide[], lost: SignalSide[], recovered: SignalSide[]) {
    for (const side of [...this.excluded]) if (!required.includes(side)) this.excluded.delete(side);
    for (const side of recovered) if (!lost.includes(side)) this.excluded.delete(side);
    if (required.length && required.every(s => lost.includes(s))) {
      for (const side of required) this.excluded.add(side);
    }
    const blocking = lost.filter(s => !this.excluded.has(s));
    if (blocking.length) {
      this.since ??= now;
      if (now - this.since >= SIGNAL.waitMs) for (const side of blocking) this.excluded.add(side);
    } else this.since = null;
    const active = required.filter(s => !this.excluded.has(s));
    return { active, hold: lost.some(s => active.includes(s)), waiting: required.filter(s => this.excluded.has(s)) };
  }
}
