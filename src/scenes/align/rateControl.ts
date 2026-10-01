/** Publisher presentation policy. Role election belongs exclusively to the backend.
 * All positions/errors are SEI epoch microseconds; elapsedMs is local monotonic time.
 */
export const CATCHUP = {
  softEnterUs: 500_000,
  softExitUs: 100_000,
  maxRate: 1.08,
  recoveryMs: 250,
  transientMissMs: 100,
  publisherReserveUs: 4_000_000,
  stallSeekMs: 2000,
  retryMs: 5000,
  localRecoveryMs: 5000,
  maxFrameErrorUs: 3_000_000,
} as const;
export type CatchupMode = "normal" | "soft" | "seek" | "wait";
export interface CatchupInput {
  current: number | null;
  authority: number;
  from: number;
  safeTo: number;
  elapsedMs: number;
  recovering?: boolean;
  mode?: CatchupMode;
  reserveUs?: number;
}
export interface CatchupPlan { mode: CatchupMode; t: number | null; rate: number }
export function planCatchup(i: CatchupInput): CatchupPlan {
  const target = Math.min(i.authority, i.safeTo);
  const wait: CatchupPlan = { mode: "wait", t: i.current, rate: 0 };
  if (!Number.isFinite(target) || target < i.from ||
      (i.current != null && target < i.current)) return wait;
  const reserve = i.reserveUs ?? CATCHUP.publisherReserveUs;
  if (i.current == null || i.current < i.from || i.recovering) {
    // Recovery must also leave cadence headroom; seeking to the ceiling would
    // immediately recreate the stop/start cycle on the next segment boundary.
    const seekTo = i.current != null ? Math.max(i.current, i.from, target - reserve) : target;
    return { mode: "seek", t: seekTo, rate: 0 };
  }
  // Complete HLS segments advance in steps. The publisher must not consume its
  // cadence buffer by chasing each step.
  const error = target - i.current - reserve;
  const soft = error >= CATCHUP.softEnterUs || (i.mode === "soft" && error > CATCHUP.softExitUs);
  const rate = soft ? Math.min(CATCHUP.maxRate, 1 + Math.max(0.01, Math.min(0.08, error / 10_000_000))) : 1;
  return { mode: soft ? "soft" : "normal", rate,
    t: Math.min(target, i.current + Math.max(0, Math.min(100, i.elapsedMs)) * 1000 * rate) };
}

/** Recovery requires consecutive successful candidate checks, not elapsed wall time alone. */
export function recoveryGate(stableMs: number, available: boolean, elapsedMs: number, missingMs = Infinity) {
  const next = available ? stableMs + Math.max(0, Math.min(100, elapsedMs)) : 0;
  return { stableMs: next, ready: available && (missingMs < CATCHUP.transientMissMs || next >= CATCHUP.recoveryMs) };
}

/** Configured extra delay behind the slowest continuous media frontier.
 * A takeover retains its monotonic floor when the requested delay is not attainable yet.
 */
export function publisherTarget(from: number, slowTo: number, floor: number | null, deltaSeconds = 15, startup = true): number | null {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || deltaSeconds > 86400) return null;
  // Segment delivery is stepped. The running ceiling includes cadence headroom
  // inside the configured delay; planCatchup leaves that headroom unconsumed.
  const headroom = startup ? 0 : Math.min(CATCHUP.publisherReserveUs, deltaSeconds * 1_000_000);
  const target = Math.max(slowTo - deltaSeconds * 1_000_000 + headroom, floor ?? -Infinity);
  return Number.isFinite(target) && target >= from && target <= slowTo ? target : null;
}
