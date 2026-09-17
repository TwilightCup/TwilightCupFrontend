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
  stallSeekMs: 2000,
  maxFrameErrorUs: 40_000,
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
}
export interface CatchupPlan { mode: CatchupMode; t: number | null; rate: number }
export function planCatchup(i: CatchupInput): CatchupPlan {
  const target = Math.min(i.authority, i.safeTo);
  const wait: CatchupPlan = { mode: "wait", t: i.current, rate: 0 };
  if (!Number.isFinite(target) || target < i.from || !i.supply ||
      (i.current != null && target < i.current)) return wait;
  if (i.current == null || i.current < i.from || target - i.current >= CATCHUP.hardUs || i.recovering) {
    return { mode: "seek", t: target, rate: 0 };
  }
  if (i.rate === 0) return wait; // authority freeze is not permission to catch up
  const error = target - i.current;
  const soft = error >= CATCHUP.softEnterUs || (i.mode === "soft" && error > CATCHUP.softExitUs);
  const base = Math.max(0, Math.min(CATCHUP.maxRate, i.rate));
  const rate = soft ? Math.min(CATCHUP.maxRate, base + Math.max(0.01, Math.min(0.08, error / 10_000_000))) : base;
  return { mode: soft ? "soft" : "normal", rate,
    t: Math.min(target, i.current + Math.max(0, Math.min(100, i.elapsedMs)) * 1000 * rate) };
}

/** Recovery requires consecutive successful candidate checks, not elapsed wall time alone. */
export function recoveryGate(stableMs: number, available: boolean, elapsedMs: number) {
  const next = available ? stableMs + Math.max(0, Math.min(100, elapsedMs)) : 0;
  return { stableMs: next, ready: next >= CATCHUP.recoveryMs };
}

/** 30s safety plus segment cadence at startup; 1.2s covers 1.08x extrapolation and frame error. */
export function publisherTarget(from: number, slowTo: number, floor: number | null, startup = true): number | null {
  const target = slowTo - CATCHUP.backUs - (startup ? 3_000_000 : 1_200_000);
  return target >= from && target >= (floor ?? -Infinity) ? target : null;
}
