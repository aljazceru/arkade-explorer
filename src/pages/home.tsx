import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageTransition } from "@/components/shared/page-transition";
import { OverviewStats } from "@/components/overview/overview-stats";
import { RecordDetail } from "@/components/overview/record-detail";
import {
    buildBarkdRecords,
    buildOverviewRecords,
    buildWatchlistRecords,
    formatSnapshotLabel,
    RecordsTable,
    type NetworkScope,
    type OverviewRecord,
} from "@/components/overview/records-table";
import { BarkdConnect } from "@/components/overview/barkd-connect";
import { fetchAllPages } from "@/lib/api/fetchAllPages";
import { indexerClient } from "@/lib/api/indexer";
import { loadObservation, type ArkadeObservation } from "@/lib/observation";
import { SourcesSection } from "@/components/overview/sources-section";
import { useArkActivity } from "@/hooks/use-ark-activity";
import { useBarkd } from "@/hooks/use-barkd";
import { useWatchlist } from "@/hooks/use-watchlist";
import { useLiveSecond } from "@/hooks/use-live-second";
import {
    AVG_BLOCK_SECONDS,
    parseRelativeTimelock,
    timelockToSecondsAndBlocks,
} from "@/lib/vtxo-display";
import { useServerInfo } from "@/providers/server-info-provider";

const MEMPOOL_BASE = "https://mempool.space/api";

export function HomePage() {
    const { items: watchlist } = useWatchlist();
    const scripts = useMemo(() => watchlist.map((item) => item.script), [watchlist]);
    const scriptsKey = scripts.join();
    const arkadeSnapshotQuery = useQuery({
        queryKey: ["observation", "arkade"],
        queryFn: () => loadObservation<ArkadeObservation>("arkade"),
        staleTime: 15 * 60_000,
    });
    const watchlistQuery = useQuery({
        queryKey: ["live-vtxos", scriptsKey],
        queryFn: () =>
            fetchAllPages(
                (opts) =>
                    indexerClient.getVtxos({
                        scripts,
                        spendableOnly: false,
                        ...opts,
                    }),
                "vtxos",
            ),
        enabled: scripts.length > 0,
        staleTime: 30_000,
        refetchInterval: 60_000,
    });
    const chainTipQuery = useQuery({
        queryKey: ["chain-tip"],
        queryFn: async ({ signal }) => {
            const response = await fetch(`${MEMPOOL_BASE}/blocks/tip/height`, { signal });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const height = Number(await response.text());
            if (!Number.isFinite(height)) throw new Error("Invalid Bitcoin chain tip height.");
            return height;
        },
        enabled: scripts.length > 0,
        staleTime: 60_000,
        refetchInterval: 60_000,
    });
    const { serverInfo, isLoading: serverInfoLoading, error: serverInfoError } = useServerInfo();
    const {
        connected: barkdConnected,
        vtxos: barkdVtxos,
        tipHeight: barkdTipHeight,
        isLoading: barkdLoading,
        error: barkdError,
    } = useBarkd();
    const activity = useArkActivity();
    const liveSecond = useLiveSecond();
    const [scope, setScope] = useState<NetworkScope>("all");
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const exitSeconds = useMemo(() => {
        if (serverInfoError) return null;
        const raw = serverInfo?.unilateralExitDelay;
        if (raw === undefined || raw === null) return null;
        try {
            return timelockToSecondsAndBlocks(parseRelativeTimelock(raw)).seconds;
        } catch {
            return null;
        }
    }, [serverInfo, serverInfoError]);
    const secondExitSeconds = useMemo(() => {
        const exitDelta = liveSecond.info?.exitDeltaBlocks;
        return typeof exitDelta === "number" && Number.isFinite(exitDelta)
            ? exitDelta * AVG_BLOCK_SECONDS
            : null;
    }, [liveSecond.info]);
    const arkadeConfigured = scripts.length > 0 || activity.listening;
    const arkadeIndexerError = watchlistQuery.error instanceof Error ? watchlistQuery.error : null;
    const arkadeIndexerLoading = scripts.length > 0 && watchlistQuery.isLoading;
    const arkadeError = arkadeIndexerError ?? serverInfoError;
    const arkadeLoading = arkadeIndexerLoading || serverInfoLoading;
    const secondConfigured = barkdConnected || liveSecond.serverAddress !== null;
    const secondLoading =
        (barkdConnected && barkdLoading) ||
        (liveSecond.serverAddress !== null && liveSecond.isLoading);
    const secondError =
        (barkdConnected ? barkdError : null) ??
        (liveSecond.serverAddress !== null && liveSecond.error instanceof Error
            ? liveSecond.error
            : null);
    const records = useMemo(() => {
        const watchlistRecords = buildWatchlistRecords(
            watchlistQuery.data?.vtxos ?? [],
            exitSeconds,
            chainTipQuery.data ?? null,
        );
        const barkdRecords =
            barkdConnected && barkdVtxos
                ? buildBarkdRecords(barkdVtxos, barkdTipHeight, secondExitSeconds)
                : [];
        const snapshot = arkadeSnapshotQuery.data;
        const snapshotRecords =
            snapshot && !arkadeSnapshotQuery.isError
                ? buildOverviewRecords(snapshot, null, exitSeconds).filter(
                      (record) => record.network === "arkade",
                  )
                : [];
        const secondRecords: OverviewRecord[] = (liveSecond.serverTxs ?? []).map(
            (tx): OverviewRecord => {
                const confirmed = tx.blockHeight !== null;
                const label =
                    tx.direction === "to_server"
                        ? "To Second server"
                        : tx.direction === "from_server"
                          ? "From Second server"
                          : "Second server";
                return {
                    id: `second-live:${tx.txid}`,
                    txid: tx.txid,
                    network: "second",
                    kind: "onchain",
                    typeLabel: "On-chain · live",
                    label,
                    amountSat: tx.totalSats,
                    status: confirmed ? "confirmed" : "observed",
                    statusLabel: confirmed ? "Confirmed" : "Observed",
                    needsReview: false,
                    leftSeconds: null,
                    exitSeconds: null,
                    createdAtSeconds: tx.blockTimeSeconds,
                    expiresAtSeconds: null,
                    recordedAt: tx.blockTimeSeconds,
                    snapshotFetchedAt: new Date().toISOString(),
                    sourceLabel: "mempool · live",
                    commitmentTxids: [],
                    blockHeight: tx.blockHeight,
                    liveSource: true,
                };
            },
        );
        // Live sources win; the observation snapshot backfills Arkade rows between
        // operator events, deduplicated by txid-outpoint.
        const live = [...activity.records, ...watchlistRecords, ...barkdRecords];
        const liveKeys = new Set(
            live.map((record) => `${record.txid}:${record.id.match(/:(\d+)$/)?.[1] ?? "x"}`),
        );
        const backfill = snapshotRecords.filter(
            (record) => !liveKeys.has(`${record.txid}:${record.id.match(/:(\d+)$/)?.[1] ?? "x"}`),
        );
        return [...live, ...backfill, ...secondRecords];
    }, [
        activity.records,
        arkadeSnapshotQuery.data,
        arkadeSnapshotQuery.isError,
        barkdConnected,
        barkdTipHeight,
        barkdVtxos,
        chainTipQuery.data,
        exitSeconds,
        liveSecond.serverTxs,
        secondExitSeconds,
        watchlistQuery.data?.vtxos,
    ]);
    const selectedRecord = selectedId
        ? (records.find((record) => record.id === selectedId) ?? null)
        : null;
    const freshness = [
        ...new Set(
            [
                scripts.length === 0
                    ? "Arkade watchlist not configured"
                    : arkadeIndexerError
                      ? "operator indexer · unavailable"
                      : arkadeIndexerLoading
                        ? "operator indexer · loading"
                        : "operator indexer · live",
                activity.connected && activity.listening
                    ? "operator stream · live"
                    : !activity.connected
                      ? "operator stream · reconnecting"
                      : null,
                serverInfoError
                    ? "Arkade /v1/info · unavailable"
                    : serverInfoLoading
                      ? "Arkade /v1/info · loading"
                      : serverInfo
                        ? "Arkade /v1/info · live"
                        : "Arkade /v1/info · unavailable",
                scripts.length > 0
                    ? chainTipQuery.error
                        ? "chain tip · unavailable"
                        : chainTipQuery.isLoading
                          ? "chain tip · loading"
                          : "mempool · live"
                    : null,
                liveSecond.serverAddress !== null
                    ? liveSecond.error
                        ? "mempool · unavailable"
                        : liveSecond.isLoading
                          ? "mempool · loading"
                          : "mempool · live"
                    : "Second on-chain source not configured",
                arkadeSnapshotQuery.data
                    ? `Arkade ${formatSnapshotLabel(arkadeSnapshotQuery.data.fetched_at)}`
                    : null,
                barkdConnected
                    ? barkdError
                        ? "barkd · unavailable"
                        : barkdLoading
                          ? "barkd · loading"
                          : "barkd · live"
                    : null,
            ].filter((source): source is string => source !== null),
        ),
    ].join(" · ");
    const serverInfoStatus = serverInfoError
        ? "error"
        : serverInfoLoading
          ? "loading"
          : serverInfo
            ? "live"
            : "error";

    return (
        <PageTransition>
            <div className="space-y-6">
                <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                            Overview
                        </h1>
                        <p
                            className="mt-2 text-sm text-muted-foreground"
                            aria-label="Live data freshness"
                        >
                            {freshness}
                        </p>
                    </div>
                    <div
                        className="inline-flex w-fit rounded-lg border border-border bg-card p-1"
                        role="group"
                        aria-label="Network scope"
                    >
                        {(
                            [
                                ["all", "All networks"],
                                ["arkade", "Arkade"],
                                ["second", "Second"],
                            ] as const
                        ).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={scope === value}
                                onClick={() => setScope(value)}
                                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${scope === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </header>

                <OverviewStats
                    records={records}
                    scope={scope}
                    arkadeConfigured={arkadeConfigured}
                    arkadeLoading={arkadeLoading}
                    arkadeError={arkadeError}
                    secondConfigured={secondConfigured}
                    secondLoading={secondLoading}
                    secondError={secondError}
                />

                <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(20rem,0.42fr)]">
                    <RecordsTable
                        records={records}
                        scope={scope}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        arkadeConfigured={arkadeConfigured}
                        arkadeLoading={arkadeIndexerLoading}
                        arkadeError={arkadeIndexerError}
                        secondConfigured={secondConfigured}
                        secondLoading={secondLoading}
                        secondError={secondError}
                    />
                    <RecordDetail record={selectedRecord} onClose={() => setSelectedId(null)} />
                </div>
                <BarkdConnect />

                <SourcesSection
                    arkadeConfigured={arkadeConfigured}
                    arkadeLoading={arkadeIndexerLoading}
                    arkadeError={arkadeIndexerError}
                    secondConfigured={secondConfigured}
                    secondLoading={secondLoading}
                    secondError={secondError}
                    serverInfoStatus={serverInfoStatus}
                    serverInfoError={serverInfoError}
                />
            </div>
        </PageTransition>
    );
}
