import type { RoundRecord } from "@/api/types";

/** Logs can omit rematch IDs; round numbers still include those rematches. */
export async function loadScoreRounds(matchId: string, ids: string[], fetchRound: (roundNo: number) => Promise<RoundRecord>): Promise<RoundRecord[]> {
  const pending = new Set(ids);
  const records: RoundRecord[] = [];
  const seen = new Set<string>();
  const accept = (record: RoundRecord, number: number) => {
    if (record.match_id !== matchId || record.round_no !== number || seen.has(record.id)) {
      throw new Error("Invalid score round history");
    }
    records.push(record); seen.add(record.id); pending.delete(record.id);
    if (record.superseded_by && !seen.has(record.superseded_by)) pending.add(record.superseded_by);
  };
  const initial = await Promise.all(ids.map((_, index) => fetchRound(index + 1)));
  initial.forEach((record, index) => accept(record, index + 1));
  // Follow gaps and trailing rematches. A missing round rejects the whole
  // restore, preserving live totals rather than presenting a partial score.
  while (pending.size) {
    const number = records.length + 1;
    accept(await fetchRound(number), number);
  }
  return records;
}
