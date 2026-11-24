/** The current WS protocol has no persisted message id and uses a separately
 * generated timestamp. Match overlap one-to-one, allowing up to 1s timestamp drift.
 * Distinct persisted ids and repeated live messages are never collapsed together.
 */
export function mergeMessageHistory<T extends { id: string; ts: string }>(
  current: T[], history: T[], key: (row: T) => string,
): T[] {
  const result = [...new Map(history.map(row => [row.id, row])).values()];
  const ids = new Set(result.map(row => row.id));
  const currentIds = new Set(current.map(row => row.id));
  const matched = new Set(result.flatMap((row, i) => currentIds.has(row.id) ? [i] : []));
  for (const row of current) {
    if (ids.has(row.id)) continue;
    const index = row.id.startsWith("live-") ? result.findIndex((old, i) =>
      !matched.has(i) && !old.id.startsWith("live-") && key(old) === key(row) &&
      Math.abs(Date.parse(old.ts) - Date.parse(row.ts)) <= 1000) : -1;
    if (index >= 0) {
      const saved = result[index]!;
      result[index] = { ...saved, ...row, id: saved.id, ts: saved.ts };
      matched.add(index);
    } else { result.push(row); ids.add(row.id); }
  }
  return result.sort((a, b) => (Date.parse(a.ts) || 0) - (Date.parse(b.ts) || 0));
}
