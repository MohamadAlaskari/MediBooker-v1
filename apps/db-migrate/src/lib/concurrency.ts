/**
 * Runs `work` for every item with at most `limit` calls in flight (MIGRATION_CONCURRENCY) and
 * returns the results in the order of the items. `work` reports failures in its result: one
 * failing practice must not stop the others (ADR 0005 §6.2).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const queue = items.map((item, index) => ({ item, index }));
  const worker = async (): Promise<void> => {
    for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
      results[entry.index] = await work(entry.item);
    }
  };
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
