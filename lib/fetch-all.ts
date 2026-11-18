// The database returns at most 1000 rows per request, whatever .limit() asks for.
// fetchAll reads a query page by page (1000 at a time) until it has every row.
// Give the query a stable .order(...) so pages don't overlap or skip rows.

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

const PAGE = 1000;

/** Every row of `make(from, to)` (which must apply .range(from, to)), up to `max` rows. */
export async function fetchAll<T>(make: (from: number, to: number) => Page<T>, max = 100_000): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < max; start += PAGE) {
    const { data, error } = await make(start, start + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}
