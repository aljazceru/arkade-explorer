import type { ChainTx } from "@arkade-os/sdk";
import { useQuery } from "@tanstack/react-query";
import { fetchAllPages } from "@/lib/api/fetchAllPages";
import { indexerClient } from "@/lib/api/indexer";
import { summarizeChain, type ChainSummary } from "@/lib/atlas/chain";
import { PAGINATION } from "@/lib/constants";

export interface VtxoChainQuery {
    summary: ChainSummary | null;
    isLoading: boolean;
    error: Error | null;
}

/**
 * Ancestry of one VTXO back to its on-chain commitment(s), from the operator
 * indexer: the unroll path a holder would broadcast to exit. One call per
 * outpoint (paged); pass `null` to skip.
 */
export function useVtxoChain(outpoint: { txid: string; vout: number } | null): VtxoChainQuery {
    const query = useQuery({
        queryKey: ["vtxo-chain", outpoint?.txid ?? null, outpoint?.vout ?? null],
        queryFn: async () => {
            const result = await fetchAllPages<{ chain: ChainTx[] }>(
                (opts) =>
                    indexerClient
                        .getVtxoChain(outpoint!, opts)
                        .then(({ chain, page }) => ({ chain, page })),
                "chain",
                PAGINATION.MAX_PAGE_SIZE,
            );
            return summarizeChain(result.chain);
        },
        enabled: outpoint !== null,
        staleTime: 60_000,
        retry: 1,
    });
    return {
        summary: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error : null,
    };
}
