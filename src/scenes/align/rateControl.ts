/** Shared presentation policy. Role election belongs exclusively to the backend.
 * All positions/errors are SEI epoch microseconds; elapsedMs is local monotonic time.
 */
export const CATCHUP = {
  backUs: 30_000_000,
  softEnterUs: 500_000,
  softExitUs: 100_000,
  hardUs: 5_000_000,
  maxRate: 1.08,
  recoveryMs: 250,
  transientMissMs: 100,
  publisherReserveUs: 4_000_000,
  stallSeekMs: 2000,
  maxFrameErrorUs: 3_000_000,
} as const;
export type CatchupMode = "normal" | "soft" | "seek" | "wait";
export interface CatchupInput {
  current: number | null;
  authority: number;
  from: number;
  safeTo: number;
  elapsedMs: number;
  rate: number;
  supply: boolean;
  recovering?: boolean;
  mode?: CatchupMode;
  publisher?: boolean;
}
export interface CatchupPlan { mode: CatchupMode; t: number | null; rate: number }
export function planCatchup(i: CatchupInput): CatchupPlan {
  const target = Math.min(i.authority, i.safeTo);
  const wait: CatchupPlan = { mode: "wait", t: i.current, rate: 0 };
  if (!Number.isFinite(target) || target < i.from || !i.supply ||
      (i.current != null && target < i.current)) return wait;
  const reserve = i.publisher ? CATCHUP.publisherReserveUs : 0;
  if (i.current == null || i.current < i.from || (!i.publisher && target - i.current >= CATCHUP.hardUs) || i.recovering) {
    // Recovery must also leave cadence headroom; seeking to the ceiling would
    // immediately recreate the stop/start cycle on the next segment boundary.
    const seekTo = i.publisher && i.current != null ? Math.max(i.current, i.from, target - reserve) : target;
    return { mode: "seek", t: seekTo, rate: 0 };
  }
  if (i.rate === 0) return wait; // authority freeze is not permission to catch up
  // Complete HLS segments advance in steps. The publisher must not consume its
  // cadence buffer by chasing each step; followers still chase the continuous master.
  const error = target - i.current - reserve;
  const soft = error >= CATCHUP.softEnterUs || (i.mode === "soft" && error > CATCHUP.softExitUs);
  const base = Math.max(0, Math.min(CATCHUP.maxRate, i.rate));
  const rate = soft ? Math.min(CATCHUP.maxRate, base + Math.max(0.01, Math.min(0.08, error / 10_000_000))) : base;
  return { mode: soft ? "soft" : "normal", rate,
    t: Math.min(target, i.current + Math.max(0, Math.min(100, i.elapsedMs)) * 1000 * rate) };
}

/** Recovery requires consecutive successful candidate checks, not elapsed wall time alone. */
export function recoveryGate(stableMs: number, available: boolean, elapsedMs: number, missingMs = Infinity) {
  const next = available ? stableMs + Math.max(0, Math.min(100, elapsedMs)) : 0;
  return { stableMs: next, ready: available && (missingMs < CATCHUP.transientMissMs || next >= CATCHUP.recoveryMs) };
}

/** 30s safety plus segment cadence at startup; 1.2s covers 1.08x extrapolation and frame error. */
export function publisherTarget(from: number, slowTo: number, floor: number | null, startup = true): number | null {
  const safeTo = slowTo - CATCHUP.backUs - 1_200_000;
  // A replacement with no local presentation must honor the old publisher's
  // floor even when that leaves less than the preferred cold-start reserve.
  // Waiting for another 3.8s of media can exceed the 3s takeover deadline.
  const target = Math.max(slowTo - CATCHUP.backUs - (startup ? 5_000_000 : 1_200_000), floor ?? -Infinity);
  return target >= from && target <= safeTo ? target : null;
}
