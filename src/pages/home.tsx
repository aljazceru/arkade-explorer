import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageTransition } from "@/components/shared/page-transition";
import { fetchAllPages } from "@/lib/api/fetchAllPages";
import { ARK_URL, indexerClient } from "@/lib/api/indexer";
import { loadObservation, type ArkadeObservation } from "@/lib/observation";
import { useArkActivity } from "@/hooks/use-ark-activity";
import { useBarkd } from "@/hooks/use-barkd";
import { useWatchlist } from "@/hooks/use-watchlist";
import { useLiveSecond } from "@/hooks/use-live-second";
import { useRecentBlocks } from "@/hooks/use-recent-blocks";
import { useNow } from "@/hooks/use-expiry";
import {
    AVG_BLOCK_SECONDS,
    parseRelativeTimelock,
    timelockToSecondsAndBlocks,
} from "@/lib/vtxo-display";
import { useServerInfo } from "@/providers/server-info-provider";
import {
    buildBarkdRecords,
    buildOverviewRecords,
    buildWatchlistRecords,
    recordDedupeKey,
    formatSnapshotLabel,
    type NetworkScope,
    type OverviewRecord,
} from "@/lib/overview-records";
import { buildArkLayerInput } from "@/lib/atlas/ark-layer-data";
import { ArkLayerCanvas } from "@/components/atlas/overview/ark-layer";
import { ActivityTable } from "@/components/atlas/overview/activity-table";
import { RecordInspector } from "@/components/atlas/overview/record-inspector";
import { ExitOutlook } from "@/components/atlas/overview/exit-outlook";
import { OperatorsPanel } from "@/components/atlas/overview/operators-panel";
import { LatestList } from "@/components/atlas/overview/latest-list";
import { AboutData } from "@/components/atlas/overview/about-data";
import { Panel } from "@/components/atlas/panel";
import type { ChainBlock } from "@/hooks/use-recent-blocks";

const MEMPOOL_BASE = "https://mempool.space/api";

/** Synthetic inspector record for a Bitcoin block clicked on the rail. */
function blockRecord(block: ChainBlock, snapshotFetchedAt: string): OverviewRecord {
    const time = new Date(block.time * 1000).toISOString();
    return {
        id: `block:${block.height}`,
        txid: block.hash,
        network: "arkade",
        kind: "onchain",
        entity: "block",
        typeLabel: "Bitcoin block",
        label: `Block ${block.height.toLocaleString("en-US")}`,
        amountSat: null,
        amountLabel: "Not applicable",
        status: "confirmed",
        statusLabel: `block ${block.height.toLocaleString("en-US")}`,
        needsReview: false,
        leftSeconds: null,
        exitSeconds: null,
        createdAtSeconds: block.time,
        expiresAtSeconds: null,
        recordedAt: time,
        snapshotFetchedAt,
        sourceLabel: "mempool.space · live",
        commitmentTxids: [],
        blockHeight: block.height,
    };
}

export function HomePage() {
    const { items: watchlist } = useWatchlist();
    const scripts = useMemo(() => watchlist.map((item) => item.script), [watchlist]);
    const scriptsKey = scripts.join();
    const arkadeSnapshotQuery = useQuery({
        queryKey: ["observation", "arkade", ARK_URL],
        queryFn: async () => {
            const snapshot = await loadObservation<ArkadeObservation>("arkade");
            if (
                snapshot.source?.info?.replace(/\/+$/, "") !==
                `${ARK_URL.replace(/\/+$/, "")}/v1/info`
            ) {
                throw new Error(
                    "Arkade history snapshot does not identify the configured operator.",
                );
            }
            return snapshot;
        },
        staleTime: 60_000,
        refetchInterval: 60_000,
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
        nextRoundAt: barkdNextRoundAt,
        updatedAt: barkdUpdatedAt,
        isLoading: barkdLoading,
        error: barkdError,
    } = useBarkd();
    const activity = useArkActivity();
    const liveSecond = useLiveSecond();
    // 600 blocks ≈ 4 days of rail history; the 7d window interpolates older heights.
    const recentBlocks = useRecentBlocks(600);
    const [scope, setScope] = useState<NetworkScope>("all");
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const nowMs = useNow(30_000);
    const nowSec = Math.floor(nowMs / 1000);

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

    // Personal coin sources (watchlist live records + barkd records).
    const yourCoinsLoading = watchlistQuery.isLoading || (barkdConnected && barkdLoading);
    const yourCoinsError =
        (watchlistQuery.error instanceof Error ? watchlistQuery.error : null) ??
        (barkdConnected && barkdError instanceof Error ? barkdError : null);

    // Activity sources: operator stream, observation snapshot backfill, and
    // Second live server transactions. Watchlist/barkd coins are excluded here.
    const activityArkadeConfigured =
        arkadeSnapshotQuery.data != null || activity.listening || activity.connected;
    const activityArkadeLoading = arkadeSnapshotQuery.isLoading || serverInfoLoading;
    const activityArkadeError =
        (arkadeSnapshotQuery.error instanceof Error ? arkadeSnapshotQuery.error : null) ??
        serverInfoError;
    const activitySecondConfigured = liveSecond.serverAddress !== null;
    const activitySecondLoading = liveSecond.isLoading;
    const activitySecondError = liveSecond.error;

    const { activityRecords, yourRecords } = useMemo(() => {
        const watchlistRecords = buildWatchlistRecords(
            watchlistQuery.data?.vtxos ?? [],
            exitSeconds,
            chainTipQuery.data ?? null,
            nowMs,
            watchlistQuery.dataUpdatedAt,
        );
        const barkdRecords =
            barkdConnected && barkdVtxos
                ? buildBarkdRecords(
                      barkdVtxos,
                      barkdTipHeight,
                      secondExitSeconds,
                      nowMs,
                      barkdUpdatedAt,
                  )
                : [];
        const snapshot = arkadeSnapshotQuery.data;
        const snapshotRecords =
            snapshot && !arkadeSnapshotQuery.isError
                ? buildOverviewRecords(
                      snapshot,
                      null,
                      exitSeconds,
                      nowMs,
                      recentBlocks.tipHeight,
                  ).filter((record) => record.network === "arkade")
                : [];
        const secondLiveRecords: OverviewRecord[] = (liveSecond.serverTxs ?? []).map(
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
                    entity: "transaction",
                    typeLabel: "On-chain · live",
                    label,
                    amountSat: tx.totalSats,
                    amountLabel: "Transaction outputs (includes change)",
                    status: confirmed ? "confirmed" : "observed",
                    statusLabel: confirmed ? "Confirmed" : "Observed",
                    needsReview: false,
                    leftSeconds: null,
                    exitSeconds: null,
                    createdAtSeconds: tx.blockTimeSeconds,
                    expiresAtSeconds: null,
                    recordedAt: tx.blockTimeSeconds,
                    snapshotFetchedAt: new Date(liveSecond.updatedAt).toISOString(),
                    sourceLabel: "Second server wallet · Esplora query",
                    commitmentTxids: [],
                    blockHeight: tx.blockHeight,
                    liveSource: true,
                };
            },
        );
        // A stream notification cannot downgrade independently observed confirmation.
        const merged = new Map(activity.records.map((record) => [recordDedupeKey(record), record]));
        for (const record of snapshotRecords) {
            const key = recordDedupeKey(record);
            const previous = merged.get(key);
            if (!previous || (record.blockHeight != null && previous.blockHeight == null)) {
                merged.set(key, record);
            }
        }
        const activityRecords = [...merged.values(), ...secondLiveRecords];
        return {
            activityRecords,
            yourRecords: [...watchlistRecords, ...barkdRecords],
        };
    }, [
        activity.records,
        arkadeSnapshotQuery.data,
        arkadeSnapshotQuery.isError,
        barkdConnected,
        barkdTipHeight,
        barkdVtxos,
        barkdUpdatedAt,
        chainTipQuery.data,
        exitSeconds,
        liveSecond.serverTxs,
        liveSecond.updatedAt,
        secondExitSeconds,
        watchlistQuery.data?.vtxos,
        watchlistQuery.dataUpdatedAt,
        nowMs,
        recentBlocks.tipHeight,
    ]);

    // Prefer the current server's advertised interval to an older snapshot.
    const barkSnapshotForRound = useQuery({
        queryKey: ["observation", "bark"],
        queryFn: () => loadObservation<{ info?: { round_interval_secs?: unknown } }>("bark"),
        staleTime: 15 * 60_000,
    });
    const roundInterval = useMemo(() => {
        const live = liveSecond.info?.roundIntervalSeconds;
        if (typeof live === "number" && Number.isFinite(live) && live > 0) return live;
        const barkSecs = barkSnapshotForRound.data?.info?.round_interval_secs;
        const asNumber = typeof barkSecs === "string" ? Number(barkSecs) : barkSecs;
        if (typeof asNumber === "number" && Number.isFinite(asNumber) && asNumber > 0) {
            return asNumber;
        }
        return null;
    }, [barkSnapshotForRound.data, liveSecond.info]);

    // Next Second round: barkd's advertised time wins, then live gRPC.
    const nextRoundUnix = useMemo(() => {
        const barkNext = barkdNextRoundAt ? Date.parse(barkdNextRoundAt) / 1000 : null;
        if (barkNext !== null && Number.isFinite(barkNext)) return barkNext;
        return liveSecond.nextRoundAt;
    }, [barkdNextRoundAt, liveSecond.nextRoundAt]);

    const meanBlockSec = useMemo(() => {
        const blocks = recentBlocks.blocks;
        if (blocks.length < 2) return null;
        const times = blocks.map((b) => b.time).sort((a, b) => a - b);
        return (times[times.length - 1] - times[0]) / (times.length - 1);
    }, [recentBlocks.blocks]);

    const arkLayerInput = useMemo(
        () =>
            buildArkLayerInput(
                activityRecords,
                arkadeSnapshotQuery.data ?? null,
                recentBlocks.blocks,
                liveSecond.serverTxs,
                {
                    nowSec,
                    windowSec: 24 * 3600,
                    nextRoundAt: nextRoundUnix,
                },
            ),
        [
            activityRecords,
            arkadeSnapshotQuery.data,
            recentBlocks.blocks,
            liveSecond.serverTxs,
            nowSec,
            nextRoundUnix,
        ],
    );

    // ---- inspector resolution ----------------------------------------------
    const blockById = useMemo(() => {
        const map = new Map<string, OverviewRecord>();
        const fetchedAt = new Date(recentBlocks.updatedAt).toISOString();
        for (const block of recentBlocks.blocks) {
            map.set(`block:${block.height}`, blockRecord(block, fetchedAt));
        }
        return map;
    }, [recentBlocks.blocks, recentBlocks.updatedAt]);

    const selectedRecord = useMemo(() => {
        if (!selectedId) return null;
        if (selectedId.startsWith("block:")) return blockById.get(selectedId) ?? null;
        return (
            [...activityRecords, ...yourRecords].find((record) => record.id === selectedId) ?? null
        );
    }, [selectedId, activityRecords, yourRecords, blockById]);

    const serverInfoStatus = serverInfoError
        ? "error"
        : serverInfoLoading
          ? "loading"
          : serverInfo
            ? "live"
            : "error";

    const snapshotTime = Date.parse(arkadeSnapshotQuery.data?.fetched_at ?? "");
    const historyStale = !Number.isFinite(snapshotTime) || nowMs - snapshotTime > 3_600_000;
    const coverageNote = [
        arkadeSnapshotQuery.data
            ? `Arkade history: ${formatSnapshotLabel(arkadeSnapshotQuery.data.fetched_at, nowMs)}.`
            : "Arkade history unavailable.",
        historyStale
            ? "History is missing or stale; old Arkade events fall outside recent time windows. An empty lane does not mean no activity."
            : "History is a sampled archive, not a complete transaction index.",
        activity.lastEventAt
            ? `Stream last received ${new Date(activity.lastEventAt).toISOString()}.`
            : "The Arkade stream only adds events received while this browser is listening.",
        "Second shows server-wallet Bitcoin transactions, not all Second payments.",
    ].join(" ");

    return (
        <PageTransition>
            <div className="space-y-6">
                <h1 className="sr-only">ark.observer</h1>

                <ArkLayerCanvas
                    input={arkLayerInput}
                    nextRoundAt={nextRoundUnix}
                    roundIntervalSec={roundInterval}
                    coverageNote={coverageNote}
                    onInspect={setSelectedId}
                />

                <section
                    aria-label="Overview panels"
                    className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]"
                >
                    <ExitOutlook
                        records={activityRecords}
                        yourRecords={yourRecords}
                        watchlistCount={watchlist.length}
                        barkdConnected={barkdConnected}
                        loading={yourCoinsLoading}
                        error={yourCoinsError}
                        arkExitSeconds={exitSeconds}
                        secondExitSeconds={secondExitSeconds}
                        nowSec={nowSec}
                        onInspect={setSelectedId}
                    />
                    <OperatorsPanel meanBlockSec={meanBlockSec} />
                    <LatestList records={activityRecords} onInspect={setSelectedId} />
                </section>

                <section aria-label="Activity" className="space-y-4">
                    <Panel
                        title="Activity"
                        subtitle="Sampled transactions and outputs · not network-wide totals"
                    >
                        <div className="p-4">
                            <ActivityTable
                                records={activityRecords}
                                scope={scope}
                                onScopeChange={setScope}
                                selectedId={selectedId}
                                onSelect={setSelectedId}
                                arkadeConfigured={activityArkadeConfigured}
                                arkadeLoading={activityArkadeLoading}
                                arkadeError={activityArkadeError}
                                secondConfigured={activitySecondConfigured}
                                secondLoading={activitySecondLoading}
                                secondError={activitySecondError}
                            />
                        </div>
                    </Panel>
                    {/* Inspector opens as a drawer over the table on selection. */}
                    <RecordInspector record={selectedRecord} onClose={() => setSelectedId(null)} />
                </section>

                <AboutData
                    arkadeConfigured={scripts.length > 0}
                    arkadeLoading={activityArkadeLoading}
                    arkadeError={activityArkadeError}
                    secondLoading={activitySecondLoading}
                    secondError={activitySecondError}
                    serverInfoStatus={serverInfoStatus}
                    serverInfoError={serverInfoError}
                    snapshotFetchedAt={arkadeSnapshotQuery.data?.fetched_at ?? null}
                />
            </div>
        </PageTransition>
    );
}
