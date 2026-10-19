import { useQuery } from "@tanstack/react-query";
import {
    fetchNextRoundAt,
    fetchSecondInfo,
    fetchServerTxs,
    SERVER_GRPC,
    SERVER_P2TR,
} from "@/lib/live-second";
import type { SecondInfo, SecondServerTx } from "@/lib/live-second";

const QUERY_STALE_TIME_MS = 30_000;
const QUERY_REFETCH_INTERVAL_MS = 60_000;

export function useLiveSecond(): {
    info: SecondInfo | null;
    nextRoundAt: number | null;
    serverAddress: string | null;
    serverTxs: SecondServerTx[] | null;
    isLoading: boolean;
    error: Error | null;
} {
    const infoQuery = useQuery({
        queryKey: ["second-live", "info", SERVER_GRPC, SERVER_P2TR],
        queryFn: ({ signal }) => fetchSecondInfo(signal),
        staleTime: QUERY_STALE_TIME_MS,
        refetchInterval: QUERY_REFETCH_INTERVAL_MS,
    });
    const nextRoundQuery = useQuery({
        queryKey: ["second-live", "next-round", SERVER_GRPC, SERVER_P2TR],
        queryFn: ({ signal }) => fetchNextRoundAt(signal),
        staleTime: QUERY_STALE_TIME_MS,
        refetchInterval: QUERY_REFETCH_INTERVAL_MS,
    });
    const serverTxsQuery = useQuery({
        queryKey: ["second-live", "server-txs", SERVER_GRPC, SERVER_P2TR],
        queryFn: ({ signal }) => fetchServerTxs(signal),
        enabled: SERVER_P2TR !== "",
        staleTime: QUERY_STALE_TIME_MS,
        refetchInterval: QUERY_REFETCH_INTERVAL_MS,
    });

    return {
        info: infoQuery.data ?? null,
        nextRoundAt: nextRoundQuery.data ?? null,
        serverAddress: SERVER_P2TR || null,
        serverTxs: serverTxsQuery.data ?? null,
        isLoading:
            infoQuery.isLoading ||
            nextRoundQuery.isLoading ||
            (SERVER_P2TR !== "" && serverTxsQuery.isLoading),
        error: infoQuery.error ?? nextRoundQuery.error ?? serverTxsQuery.error,
    };
}
