import { useQuery } from "@tanstack/react-query";
import { indexerClient, normalizeAssetMetadata } from "@/lib/api/indexer";
import type { AssetDetails } from "@/lib/api/indexer";

/** Cache indexer asset details briefly; supply is not immutable metadata. */
export function useAssetDetails(assetId: string | undefined) {
    const { data, isLoading, error } = useQuery({
        queryKey: ["asset-details", assetId],
        queryFn: async () => {
            if (!assetId) throw new Error("No assetId");

            // Keep SDK bigint supply exact through rendering.
            const raw = await indexerClient.getAssetDetails(assetId);
            const details: AssetDetails = {
                ...raw,
                supply: String(raw.supply),
                metadata: normalizeAssetMetadata(raw.metadata),
            };
            return details;
        },
        enabled: !!assetId,
        staleTime: 60_000,
        refetchInterval: 60_000,
        retry: 1,
    });

    return {
        assetDetails: data ?? null,
        isLoading,
        error: error as Error | null,
    };
}
