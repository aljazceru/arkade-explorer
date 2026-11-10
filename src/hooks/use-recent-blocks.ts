import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ESPLORA } from "@/lib/live-second";

/** A Bitcoin block as the rail needs it. Times are unix seconds. */
export interface ChainBlock {
    height: number;
    hash: string;
    time: number;
    txCount: number;
    size: number;
}

export interface RecentBlocks {
    /** Newest first, unique by height. */
    blocks: ChainBlock[];
    tipHeight: number | null;
    isLoading: boolean;
    error: Error | null;
    updatedAt: number;
}

const PAGE = 10; // Esplora `/blocks[/:start]` returns 10 blocks per page.

interface EsploraBlock {
    id: string;
    height: number;
    timestamp: number;
    tx_count: number;
    size: number;
}

async function fetchBlockPage(start: number | null, signal: AbortSignal): Promise<ChainBlock[]> {
    const url = start === null ? `${ESPLORA}/blocks` : `${ESPLORA}/blocks/${start}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Esplora blocks HTTP ${response.status}`);
    const body = (await response.json()) as EsploraBlock[];
    return body.map((block) => ({
        height: block.height,
        hash: block.id,
        time: block.timestamp,
        txCount: block.tx_count,
        size: block.size,
    }));
}

/**
 * The latest `count` Bitcoin blocks from the configured Esplora. The tip page
 * refreshes every minute; older pages are fetched once per 10-block anchor and
 * kept, since confirmed history below the tip page does not change.
 */
export function useRecentBlocks(count = 150): RecentBlocks {
    const tipQuery = useQuery({
        queryKey: ["chain", "blocks", "tip", ESPLORA],
        queryFn: ({ signal }) => fetchBlockPage(null, signal),
        staleTime: 30_000,
        refetchInterval: 60_000,
    });

    const tipPage = tipQuery.data;
    const oldestTipHeight = tipPage?.length ? tipPage[tipPage.length - 1].height : null;
    const pages = Math.max(0, Math.ceil(count / PAGE) - 1);

    const historyQuery = useQuery({
        queryKey: ["chain", "blocks", "history", ESPLORA, oldestTipHeight, pages],
        queryFn: async ({ signal }) => {
            const starts = Array.from(
                { length: pages },
                (_, i) => (oldestTipHeight as number) - 1 - i * PAGE,
            ).filter((start) => start >= 0);
            const results = await Promise.all(starts.map((s) => fetchBlockPage(s, signal)));
            return results.flat();
        },
        enabled: oldestTipHeight !== null && pages > 0,
        staleTime: Infinity,
    });

    const blocks = useMemo(() => {
        const byHeight = new Map<number, ChainBlock>();
        for (const block of historyQuery.data ?? []) byHeight.set(block.height, block);
        for (const block of tipPage ?? []) byHeight.set(block.height, block);
        return [...byHeight.values()].sort((a, b) => b.height - a.height).slice(0, count);
    }, [historyQuery.data, tipPage, count]);

    const error = (tipQuery.error ?? historyQuery.error) as Error | null;
    return {
        blocks,
        tipHeight: blocks[0]?.height ?? null,
        isLoading: tipQuery.isLoading || (pages > 0 && historyQuery.isLoading),
        error,
        updatedAt: tipQuery.dataUpdatedAt,
    };
}
