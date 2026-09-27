import { RoundVerdict, type RoundRecord } from "@/api/types";
import { PresentationHistory } from "./presentationHistory";
export type Wins = { winsA: number; winsB: number };

/** REST restores past verdicts; newer WS cumulative scores remain authoritative. */
export class ScoreHistory {
  private rounds: { at: number; side: "A" | "B" }[] = [];
  private live = new PresentationHistory<{ at: number; score: Wins }>();
  private latest: { at: number; score: Wins } | null = null;
  private restoredAt = -Infinity;

  restore(records: RoundRecord[], fallbackAt: number, requestedAt = fallbackAt): Wins {
    this.restoredAt = requestedAt;
    this.rounds = records.filter(r => r.counted && !r.superseded_by).flatMap(r => {
      const side = r.verdict === RoundVerdict.A_WIN || r.verdict === RoundVerdict.B_DISCONNECT_LOSS ? "A"
        : r.verdict === RoundVerdict.B_WIN || r.verdict === RoundVerdict.A_DISCONNECT_LOSS ? "B" : null;
      if (!side) return [];
      // Server emits timezone-aware UTC. Unknown legacy timestamps must not leak
      // a future score into delayed playback via local timezone interpretation.
      const parsed = r.ended_at && /(?:Z|[+-]\d{2}:\d{2})$/i.test(r.ended_at) ? Date.parse(r.ended_at) : NaN;
      return [{ at: Number.isFinite(parsed) ? parsed : fallbackAt, side }];
    });
    return this.latest && this.latest.at >= requestedAt ? this.latest.score : this.at(Infinity);
  }
  add(at: number, score: Wins): void {
    this.latest = { at, score: { ...score } };
    this.live.add(at, this.latest);
  }
  at(at: number): Wins {
    const live = this.live.at(at);
    if (live && live.at >= this.restoredAt) return live.score;
    const score = { winsA: 0, winsB: 0 };
    for (const round of this.rounds) if (round.at <= at) {
      if (round.side === "A") score.winsA++; else score.winsB++;
    }
    return score;
  }
  clear(): void { this.rounds = []; this.live.clear(); this.latest = null; this.restoredAt = -Infinity; }
}
