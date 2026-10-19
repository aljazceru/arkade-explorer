import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    fetchBarkdNextRoundAt,
    fetchBarkdTipHeight,
    fetchBarkdVtxos,
    loadBarkdConnection,
    saveBarkdConnection,
} from "@/lib/barkd";
import type { BarkdConnection, BarkdVtxo } from "@/lib/barkd";

const BARKD_QUERY_PREFIX = ["barkd"] as const;
const QUERY_STALE_TIME_MS = 30_000;
const QUERY_REFETCH_INTERVAL_MS = 60_000;
let currentConnection: BarkdConnection | null = loadBarkdConnection();
const connectionListeners = new Set<() => void>();

function subscribeToConnection(listener: () => void): () => void {
    connectionListeners.add(listener);
    return () => {
        connectionListeners.delete(listener);
    };
}

function getConnectionSnapshot(): BarkdConnection | null {
    return currentConnection;
}

function updateConnection(connection: BarkdConnection | null): void {
    currentConnection = connection;
    for (const listener of connectionListeners) listener();
}

export function useBarkd(): {
    connection: BarkdConnection | null;
    connected: boolean;
    connect(c: BarkdConnection): void;
    disconnect(): void;
    vtxos: BarkdVtxo[] | null;
    tipHeight: number | null;
    nextRoundAt: string | null;
    isLoading: boolean;
    error: Error | null;
} {
    const queryClient = useQueryClient();
    const connection = useSyncExternalStore(
        subscribeToConnection,
        getConnectionSnapshot,
        getConnectionSnapshot,
    );
    const connected = connection !== null;
    const baseUrl = connection?.baseUrl ?? "";

    const vtxosQuery = useQuery({
        queryKey: ["barkd", "vtxos", baseUrl],
        queryFn: () => fetchBarkdVtxos(connection!),
        enabled: connected,
        staleTime: QUERY_STALE_TIME_MS,
        refetchInterval: QUERY_REFETCH_INTERVAL_MS,
    });
    const tipHeightQuery = useQuery({
        queryKey: ["barkd", "tip-height", baseUrl],
        queryFn: () => fetchBarkdTipHeight(connection!),
        enabled: connected,
        staleTime: QUERY_STALE_TIME_MS,
        refetchInterval: QUERY_REFETCH_INTERVAL_MS,
    });
    const nextRoundQuery = useQuery({
        queryKey: ["barkd", "next-round", baseUrl],
        queryFn: () => fetchBarkdNextRoundAt(connection!),
        enabled: connected,
        staleTime: QUERY_STALE_TIME_MS,
        refetchInterval: QUERY_REFETCH_INTERVAL_MS,
    });

    function connect(nextConnection: BarkdConnection): void {
        saveBarkdConnection(nextConnection);
        updateConnection(nextConnection);
        void queryClient.invalidateQueries({ queryKey: BARKD_QUERY_PREFIX });
    }

    function disconnect(): void {
        saveBarkdConnection(null);
        updateConnection(null);
        queryClient.removeQueries({ queryKey: BARKD_QUERY_PREFIX });
    }

    const error = vtxosQuery.error ?? tipHeightQuery.error ?? nextRoundQuery.error;

    return {
        connection,
        connected,
        connect,
        disconnect,
        vtxos: vtxosQuery.data ?? null,
        tipHeight: tipHeightQuery.data ?? null,
        nextRoundAt: nextRoundQuery.data ?? null,
        isLoading:
            connected &&
            (vtxosQuery.isLoading || tipHeightQuery.isLoading || nextRoundQuery.isLoading),
        error: error instanceof Error ? error : null,
    };
}
