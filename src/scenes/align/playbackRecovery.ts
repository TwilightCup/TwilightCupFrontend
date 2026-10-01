/** Recover a stuck pair after its local decoder grace period; never react to real signal loss. */
export class PlaybackRecovery {
  private frames: (number | null)[] = [null, null];
  private progressed = [0, 0];
  private lastAttempt = -Infinity;
  check(now: number, frames: (number | null)[], eligible: boolean, localRecoveryPending = false): boolean {
    for (let i = 0; i < 2; i++) {
      if (!eligible || frames[i] == null || frames[i] !== this.frames[i]) this.progressed[i] = now;
    }
    this.frames = [...frames];
    if (!eligible || localRecoveryPending || frames.some(f => f == null) ||
        now - Math.min(...this.progressed) < 4000 || now - this.lastAttempt < 30000) return false;
    this.lastAttempt = now;
    this.progressed = [now, now];
    return true;
  }
}
