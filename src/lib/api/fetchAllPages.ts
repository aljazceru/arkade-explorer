import type { PaginationOptions, PageResponse } from "@arkade-os/sdk";
import { PAGINATION } from "@/lib/constants";

/**
 * Whether the indexer has another page after `page`.
 *
 * The Arkade indexer paginates 1-based: `current` is the page just returned
 * (a request for index 0 is served as page 1), `total` is the number of pages,
 * and the last page reports `next === current`. An empty result reports
 * `{ current: 1, next: 0, total: 0 }`.
 */
export function hasMorePages(page: PageResponse | undefined): boolean {
    if (!page) return false;
    const { next, current, total } = page;
    if (next <= current) return false;
    if (total > 0 && current >= total) return false;
    return true;
}

/**
 * Drain every page of a paginated indexer call and merge `mergeKey` arrays.
 *
 * Termination follows the server's page metadata only. Item counts are not a
 * signal: the indexer caps `page.size` (100), so a short page does not mean
 * the last page when a larger size was requested.
 */
export async function fetchAllPages<T extends Record<string, unknown>>(
    fn: (opts: PaginationOptions) => Promise<T & { page?: PageResponse }>,
    mergeKey: keyof T & string,
    pageSize: number = PAGINATION.DEFAULT_PAGE_SIZE,
): Promise<T> {
    let pageIndex = 0;
    let result: T | undefined;
    // Requested indices and server-reported pages: never ask for a page twice.
    const seen = new Set<number>();

    while (true) {
        seen.add(pageIndex);
        const response = await fn({ pageIndex, pageSize });
        if (response.page) seen.add(response.page.current);

        if (!result) {
            result = response;
        } else {
            const existing = result[mergeKey];
            const incoming = response[mergeKey];
            if (Array.isArray(existing) && Array.isArray(incoming)) {
                (result as Record<string, unknown>)[mergeKey] = [...existing, ...incoming];
            }
        }

        const items = response[mergeKey];
        if (Array.isArray(items) && items.length === 0) break;
        if (!hasMorePages(response.page)) break;
        const next = response.page!.next;
        if (seen.has(next)) break;

        pageIndex = next;
    }

    return result!;
}
