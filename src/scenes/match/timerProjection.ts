import type { LiveTime } from "@/stores/director";

/** Compatibility inference: the protocol has no explicit pause/rate field.
 * Require growth within the same segment; a first/repeated/reset sample is held.
 */
export function timerIsAdvancing(previous: LiveTime | null, current: LiveTime): boolean {
  return previous != null && current.receivedAt > previous.receivedAt &&
    current.receivedAt - previous.receivedAt <= 3000 &&
    current.levelIndex === previous.levelIndex &&
    current.totalMs > previous.totalMs && current.segmentMs > previous.segmentMs;
}

/** Project only continuous timer values at committed video time, never wall now.
 * Without new reports, at most 1.5 seconds are simulated. Discrete state stays held.
 */
export function projectTimer(sample: LiveTime | null, timeMs: number | null, running: boolean) {
  if (timeMs == null || !sample || sample.receivedAt > timeMs) {
    return { main: null, seg: null };
  }
  const dt = running ? Math.min(1500, Math.max(0, timeMs - sample.receivedAt)) : 0;
  return { main: sample.totalMs + dt, seg: sample.segmentMs + dt };
}
