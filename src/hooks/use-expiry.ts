import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerInfo } from "@/providers/server-info-provider";
import { parseRelativeTimelock, type RelativeTimelock } from "@/lib/vtxo-display";

/** Current time in ms, re-rendering every `intervalMs` so countdowns stay live. */
export function useNow(intervalMs = 30_000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

/** `unilateralExitDelay` and `boardingExitDelay` from `/v1/info`, parsed as relative timelocks. */
export function useExitDelays(): {
    unilateralExitDelay: RelativeTimelock | null;
    boardingExitDelay: RelativeTimelock | null;
} {
    const { serverInfo } = useServerInfo();
    return useMemo(() => {
        const parse = (v: unknown): RelativeTimelock | null => {
            if (v === undefined || v === null || v === "") return null;
            try {
                return parseRelativeTimelock(v as bigint);
            } catch {
                return null;
            }
        };
        return {
            unilateralExitDelay: parse(serverInfo?.unilateralExitDelay),
            boardingExitDelay: parse(serverInfo?.boardingExitDelay),
        };
    }, [serverInfo]);
}

const MEMPOOL_BASE: Record<string, string> = {
    bitcoin: "https://mempool.space/api",
    mainnet: "https://mempool.space/api",
    testnet: "https://mempool.space/testnet/api",
    signet: "https://mempool.space/signet/api",
    mutinynet: "https://mutinynet.com/api",
};

/**
 * Current chain tip height. Only needed for VTXOs whose expiry is expressed as a
 * block height (regtest-like deployments); mainnet arkd reports timestamps.
 */
export function useChainTip(enabled: boolean): number | null {
    const { serverInfo } = useServerInfo();
    const base = serverInfo?.network ? MEMPOOL_BASE[serverInfo.network] : undefined;
    const { data } = useQuery({
        queryKey: ["chain-tip", base],
        queryFn: async () => {
            const res = await fetch(`${base}/blocks/tip/height`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return Number(await res.text());
        },
        enabled: enabled && !!base,
        staleTime: 60_000,
        refetchInterval: 120_000,
    });
    return data ?? null;
}
