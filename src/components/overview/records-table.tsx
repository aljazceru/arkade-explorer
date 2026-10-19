import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { ArkadeObservation, ArkadeVtxoRow, BarkObservation } from "@/lib/observation";
import type { VirtualCoin } from "@arkade-os/sdk";
import type { BarkdVtxo } from "@/lib/barkd";
import { AVG_BLOCK_SECONDS, deriveExpiryUrgency, remainingLifetime } from "@/lib/vtxo-display";
import { formatDuration, formatSats, truncateId } from "@/lib/observation";

type ArkadeCommitment = Record<string, unknown>;

export type NetworkScope = "all" | "arkade" | "second";
export type RecordKind = "virtual" | "commitment" | "onchain";
export type RecordStatus =
    "urgent" | "expired" | "unknown" | "settled" | "healthy" | "confirmed" | "observed" | "locked";

export type OverviewRecord = {
    id: string;
    txid: string;
    network: "arkade" | "second";
    kind: RecordKind;
    typeLabel: string;
    label: string;
    amountSat: number | null;
    status: RecordStatus;
    statusLabel: string;
    needsReview: boolean;
    leftSeconds: number | null;
    exitSeconds: number | null;
    createdAtSeconds: number | null;
    expiresAtSeconds: number | null;
    recordedAt: string | number | null;
    snapshotFetchedAt: string;
    sourceLabel: string;
    commitmentTxids: string[];
    blockHeight: number | null;
    policyType?: string | null;
    exitDeltaBlocks?: number | null;
    exitDepth?: number | null;
    chainAnchor?: string | null;
    liveSource?: boolean;
};

function toFiniteNumber(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function toUnixSeconds(value: string | number | null | undefined): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? (value > 1e12 ? value / 1000 : value) : null;
    }
    if (!value) return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric / 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed / 1000;
}

export function formatSnapshotLabel(
    fetchedAt: string | null | undefined,
    now = Date.now(),
): string {
    if (!fetchedAt) return "Snapshot time unavailable";
    const timestamp = Date.parse(fetchedAt);
    if (!Number.isFinite(timestamp)) return "Snapshot time unavailable";
    const date = new Date(timestamp);
    const time = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
    const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    let age: string;
    if (elapsedSeconds < 60) {
        age = "under 1m old";
    } else if (elapsedSeconds < 3600) {
        const minutes = Math.floor(elapsedSeconds / 60);
        age = `${minutes}m old`;
    } else if (elapsedSeconds < 86400) {
        const hours = Math.floor(elapsedSeconds / 3600);
        age = `${hours}h old`;
    } else {
        const days = Math.floor(elapsedSeconds / 86400);
        age = `${days}d old`;
    }
    return `Snapshot ${time} · ${age}`;
}

export function formatRecordTime(value: string | number | null | undefined): string {
    const seconds = toUnixSeconds(value);
    if (seconds === null) return "Not available in this snapshot";
    return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
    }).format(new Date(seconds * 1000));
}

export function getArkadeRecordStatus(
    row: ArkadeVtxoRow,
    exitSeconds: number | null,
): { status: RecordStatus; statusLabel: string; needsReview: boolean; leftSeconds: number | null } {
    const leftSeconds = toFiniteNumber(row.left_seconds);
    const expired = row.expired === true || (leftSeconds !== null && leftSeconds <= 0);
    const expiryUnknown = leftSeconds === null;
    const terminal = row.isSpent === true || Boolean(row.spentBy) || Boolean(row.settledBy);
    const urgent =
        !terminal &&
        !expired &&
        leftSeconds !== null &&
        (row.urgent === true || (exitSeconds !== null && leftSeconds <= exitSeconds));
    const needsReview = row.urgent === true || urgent || expired || expiryUnknown;

    if (terminal) return { status: "settled", statusLabel: "Settled", needsReview, leftSeconds };
    if (expired) return { status: "expired", statusLabel: "Expired", needsReview, leftSeconds };
    if (expiryUnknown)
        return { status: "unknown", statusLabel: "Expiry unknown", needsReview, leftSeconds };
    const exitWindowUnknown = leftSeconds !== null && exitSeconds === null && row.urgent !== true;
    if (exitWindowUnknown) {
        return {
            status: "unknown",
            statusLabel: "Exit window unavailable",
            needsReview,
            leftSeconds,
        };
    }
    if (urgent) {
        return {
            status: "urgent",
            statusLabel: `${formatDuration(leftSeconds)} left`,
            needsReview,
            leftSeconds,
        };
    }
    return {
        status: "healthy",
        statusLabel: `${formatDuration(leftSeconds)} left`,
        needsReview,
        leftSeconds,
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function buildOverviewRecords(
    arkade: ArkadeObservation | null,
    bark: BarkObservation | null,
    exitSeconds: number | null,
): OverviewRecord[] {
    const records: OverviewRecord[] = [];
    const commitmentIds = new Set<string>();

    if (arkade) {
        for (const row of arkade.vtxos ?? []) {
            if (row.txType === "commitment") {
                commitmentIds.add(row.txid);
                continue;
            }
            const status = getArkadeRecordStatus(row, exitSeconds);
            records.push({
                id: `arkade-vtxo:${row.txid}:${row.vout}`,
                txid: row.txid,
                network: "arkade",
                kind: "virtual",
                typeLabel: "Virtual",
                label: `${row.txType ? `${row.txType[0].toUpperCase()}${row.txType.slice(1)}` : "Virtual"} output #${row.vout}`,
                amountSat: toFiniteNumber(row.amount_sat),
                status: status.status,
                statusLabel: status.statusLabel,
                needsReview: status.needsReview,
                leftSeconds: status.leftSeconds,
                exitSeconds,
                createdAtSeconds: toUnixSeconds(row.createdAt),
                expiresAtSeconds: toUnixSeconds(row.expiresAt) ?? toUnixSeconds(row.expiresAt_unix),
                recordedAt: row.createdAt ?? null,
                snapshotFetchedAt: arkade.fetched_at,
                sourceLabel: "Arkade VTXO snapshot",
                commitmentTxids: row.commitmentTxids ?? [],
                blockHeight: null,
            });
        }

        for (const [txid, value] of Object.entries(arkade.commitments ?? {})) {
            commitmentIds.add(txid);
            const commitment: ArkadeCommitment = asRecord(value);
            const onchain = asRecord(commitment._onchain);
            const status: RecordStatus =
                toFiniteNumber(onchain.block_height) !== null ? "confirmed" : "observed";
            records.push({
                id: `arkade-commitment:${txid}`,
                txid,
                network: "arkade",
                kind: "commitment",
                typeLabel: "Commitment",
                label: "Arkade commitment",
                amountSat:
                    toFiniteNumber(onchain.total_sats) ??
                    toFiniteNumber(commitment.totalOutputAmount),
                status,
                statusLabel: status === "confirmed" ? "Confirmed" : "Observed",
                needsReview: false,
                leftSeconds: null,
                exitSeconds,
                createdAtSeconds: toUnixSeconds(
                    (onchain.block_time as string | number | undefined) ??
                        (commitment.startedAt as string | number | undefined),
                ),
                expiresAtSeconds: null,
                recordedAt:
                    (onchain.block_time as string | number | undefined) ??
                    (commitment.startedAt as string | number | undefined) ??
                    null,
                snapshotFetchedAt: arkade.fetched_at,
                sourceLabel: "Arkade commitment index",
                commitmentTxids: [],
                blockHeight: toFiniteNumber(onchain.block_height),
            });
        }

        for (const row of arkade.vtxos ?? []) {
            if (
                row.txType !== "commitment" ||
                records.some((record) => record.id === `arkade-commitment:${row.txid}`)
            ) {
                continue;
            }
            const status = getArkadeRecordStatus(row, exitSeconds);
            records.push({
                id: `arkade-commitment:${row.txid}`,
                txid: row.txid,
                network: "arkade",
                kind: "commitment",
                typeLabel: "Commitment",
                label: "Arkade commitment",
                amountSat: toFiniteNumber(row.amount_sat),
                status: status.status,
                statusLabel: status.statusLabel,
                needsReview: status.needsReview,
                leftSeconds: status.leftSeconds,
                exitSeconds,
                createdAtSeconds: toUnixSeconds(row.createdAt),
                expiresAtSeconds: toUnixSeconds(row.expiresAt) ?? toUnixSeconds(row.expiresAt_unix),
                recordedAt: row.createdAt ?? null,
                snapshotFetchedAt: arkade.fetched_at,
                sourceLabel: "Arkade VTXO snapshot",
                commitmentTxids: row.commitmentTxids ?? [],
                blockHeight: null,
            });
        }

        for (const row of arkade.vtxos ?? []) {
            for (const txid of row.commitmentTxids ?? []) commitmentIds.add(txid);
        }
        for (const txid of commitmentIds) {
            if (records.some((record) => record.id === `arkade-commitment:${txid}`)) continue;
            records.push({
                id: `arkade-commitment:${txid}`,
                txid,
                network: "arkade",
                kind: "commitment",
                typeLabel: "Commitment",
                label: "Arkade commitment reference",
                amountSat: null,
                status: "observed",
                statusLabel: "Observed",
                needsReview: false,
                leftSeconds: null,
                exitSeconds,
                createdAtSeconds: null,
                expiresAtSeconds: null,
                recordedAt: null,
                snapshotFetchedAt: arkade.fetched_at,
                sourceLabel: "Arkade VTXO commitment reference",
                commitmentTxids: [],
                blockHeight: null,
            });
        }
    }

    if (bark) {
        for (const row of bark.recent_server_txs ?? []) {
            const direction = row.direction?.replace(/_/g, " ") ?? "server activity";
            const label =
                row.direction === "to_server"
                    ? "To Second server"
                    : row.direction === "from_server"
                      ? "From Second server"
                      : `Second server · ${direction}`;
            const confirmed = row.block_height !== undefined && row.block_height !== null;
            records.push({
                id: `second-onchain:${row.txid}`,
                txid: row.txid,
                network: "second",
                kind: "onchain",
                typeLabel: "On-chain",
                label,
                amountSat: toFiniteNumber(row.total_sats),
                status: confirmed ? "confirmed" : "observed",
                statusLabel: confirmed ? "Confirmed" : "Observed",
                needsReview: false,
                leftSeconds: null,
                exitSeconds: null,
                createdAtSeconds: toUnixSeconds(row.block_time_rome),
                expiresAtSeconds: null,
                recordedAt: row.block_time_rome ?? null,
                snapshotFetchedAt: bark.fetched_at,
                sourceLabel: "Second server address on-chain activity",
                commitmentTxids: [],
                blockHeight: row.block_height ?? null,
            });
        }
    }

    return records;
}
export function buildWatchlistRecords(
    vtxos: VirtualCoin[],
    exitSeconds: number | null,
    tipHeight: number | null,
    now = Date.now(),
): OverviewRecord[] {
    const exitDelay =
        exitSeconds === null ? null : { type: "seconds" as const, value: exitSeconds };
    return vtxos.map((vtxo) => {
        const outpoint = vtxo as VirtualCoin & {
            outpoint?: { txid: string; vout: number };
        };
        const txid = outpoint.outpoint?.txid ?? vtxo.txid;
        const vout = outpoint.outpoint?.vout ?? vtxo.vout;
        const remaining = remainingLifetime(vtxo, now, tipHeight);
        const terminal =
            vtxo.isSpent === true ||
            Boolean(vtxo.spentBy) ||
            Boolean(vtxo.settledBy) ||
            vtxo.virtualStatus?.state === "spent";
        const urgency = deriveExpiryUrgency(remaining, exitDelay);
        const status: RecordStatus = terminal
            ? "settled"
            : urgency === "expired"
              ? "expired"
              : urgency === "urgent"
                ? "urgent"
                : urgency === "ok"
                  ? "healthy"
                  : "unknown";
        const leftSeconds = remaining?.seconds ?? null;
        const statusLabel = terminal
            ? "Settled"
            : status === "expired"
              ? "Expired"
              : status === "urgent" || status === "healthy"
                ? `${formatDuration(leftSeconds ?? 0)} left`
                : remaining
                  ? "Exit window unavailable"
                  : "Expiry unknown";
        const createdAt = vtxo.createdAt instanceof Date ? vtxo.createdAt : null;

        return {
            id: `arkade-live:${txid}:${vout}`,
            txid,
            network: "arkade",
            kind: "virtual",
            typeLabel: "Virtual · live",
            label: `Watched VTXO ${vout}`,
            amountSat: vtxo.value,
            status,
            statusLabel,
            needsReview: !terminal && status !== "healthy",
            leftSeconds,
            exitSeconds,
            createdAtSeconds: createdAt ? createdAt.getTime() / 1000 : null,
            expiresAtSeconds: remaining ? remaining.expiresAtMs / 1000 : null,
            recordedAt: createdAt?.toISOString() ?? null,
            snapshotFetchedAt: new Date(now).toISOString(),
            sourceLabel: "operator indexer · live",
            commitmentTxids: vtxo.commitmentTxIds ?? [],
            blockHeight: vtxo.expiresAtHeight ?? null,
            liveSource: true,
        };
    });
}

export function buildBarkdRecords(
    vtxos: BarkdVtxo[],
    tipHeight: number | null,
    exitSeconds: number | null,
    now = Date.now(),
): OverviewRecord[] {
    return vtxos.map((vtxo) => {
        const separator = vtxo.id.indexOf(":");
        const txid = vtxo.id.slice(0, separator);
        const vout = vtxo.id.slice(separator + 1);
        let status: RecordStatus;
        let statusLabel: string;
        let needsReview: boolean;
        let leftSeconds: number | null;

        if (vtxo.state.type === "spent" || vtxo.state.type === "exited") {
            status = "settled";
            statusLabel = vtxo.state.type === "exited" ? "Exited on-chain" : "Settled";
            needsReview = false;
            leftSeconds = null;
        } else if (vtxo.state.type === "locked") {
            status = "locked";
            statusLabel = "Locked in round";
            needsReview = false;
            leftSeconds = null;
        } else {
            const blocksLeft = vtxo.expiryHeight - (tipHeight ?? Number.NaN);
            const secondsLeft = blocksLeft * AVG_BLOCK_SECONDS;
            leftSeconds = tipHeight === null ? null : secondsLeft;

            if (tipHeight === null) {
                status = "unknown";
                statusLabel = "Expiry unknown";
                needsReview = true;
            } else if (blocksLeft <= 0) {
                status = "expired";
                statusLabel = "Expired";
                needsReview = true;
            } else if (exitSeconds !== null && secondsLeft <= exitSeconds) {
                status = "urgent";
                statusLabel = `${formatDuration(secondsLeft)} left`;
                needsReview = true;
            } else {
                status = "healthy";
                statusLabel = `${formatDuration(secondsLeft)} left`;
                needsReview = false;
            }
        }
        return {
            id: `second-barkd:${vtxo.id}`,
            txid,
            network: "second",
            kind: "virtual",
            typeLabel: "Virtual · your wallet",
            label: `Wallet VTXO ${vout}`,
            amountSat: vtxo.amountSat,
            status,
            statusLabel,
            needsReview,
            leftSeconds,
            exitSeconds,
            createdAtSeconds: null,
            expiresAtSeconds: null,
            recordedAt: null,
            snapshotFetchedAt: new Date(now).toISOString(),
            sourceLabel: "barkd · live",
            commitmentTxids: [],
            blockHeight: vtxo.expiryHeight,
            chainAnchor: vtxo.chainAnchor,
            policyType: vtxo.policyType,
            exitDeltaBlocks: vtxo.exitDelta,
            exitDepth: vtxo.exitDepth,
            liveSource: true,
        };
    });
}

export function RecordStatusBadge({ record }: { record: OverviewRecord }) {
    const classes =
        record.status === "urgent"
            ? "border-warning/40 bg-warning/10 text-warning"
            : record.status === "expired"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : record.status === "confirmed"
                ? "border-success/40 bg-success/10 text-success"
                : record.status === "unknown"
                  ? "border-dashed border-warning/50 bg-warning/5 text-warning"
                  : "border-border bg-secondary text-muted-foreground";
    return (
        <span
            className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}
        >
            {record.statusLabel}
        </span>
    );
}

export function RecordsTable({
    records,
    scope,
    selectedId,
    onSelect,
    arkadeConfigured,
    arkadeLoading,
    arkadeError,
    secondConfigured,
    secondLoading,
    secondError,
}: {
    records: OverviewRecord[];
    scope: NetworkScope;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    arkadeConfigured: boolean;
    arkadeLoading: boolean;
    arkadeError: Error | null;
    secondConfigured: boolean;
    secondLoading: boolean;
    secondError: Error | null;
}) {
    const [layer, setLayer] = useState<"all" | "virtual" | "onchain">("all");
    const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
    const [search, setSearch] = useState("");
    const [sortDirection, setSortDirection] = useState<"ascending" | "descending" | null>(null);

    const inScope = useMemo(
        () => records.filter((record) => scope === "all" || record.network === scope),
        [records, scope],
    );
    const counts = useMemo(
        () => ({
            all: inScope.length,
            virtual: inScope.filter((record) => record.kind === "virtual").length,
            onchain: inScope.filter((record) => record.kind !== "virtual").length,
            review: inScope.filter((record) => record.needsReview).length,
        }),
        [inScope],
    );
    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = inScope.filter((record) => {
            if (layer === "virtual" && record.kind !== "virtual") return false;
            if (layer === "onchain" && record.kind === "virtual") return false;
            if (needsReviewOnly && !record.needsReview) return false;
            if (!query) return true;
            return [record.label, record.txid, record.network, record.statusLabel]
                .join(" ")
                .toLowerCase()
                .includes(query);
        });
        if (sortDirection) {
            filtered.sort((a, b) => {
                if (a.amountSat === null) return b.amountSat === null ? 0 : 1;
                if (b.amountSat === null) return -1;
                const result = a.amountSat - b.amountSat;
                return sortDirection === "ascending" ? result : -result;
            });
        }
        return filtered;
    }, [inScope, layer, needsReviewOnly, search, sortDirection]);

    useEffect(() => {
        if (selectedId && !visible.some((record) => record.id === selectedId)) onSelect(null);
    }, [onSelect, selectedId, visible]);

    const rawCount = inScope.length;
    const sourceFreshness = useMemo(() => {
        const labels = new Set(inScope.map((record) => record.sourceLabel));
        if (scope === "arkade" || scope === "all") {
            if (arkadeError) {
                labels.delete("operator indexer · live");
                labels.add("operator indexer · unavailable");
            } else if (!labels.has("operator indexer · live")) {
                labels.add(
                    !arkadeConfigured
                        ? "watchlist · not configured"
                        : arkadeLoading
                          ? "operator indexer · loading"
                          : "operator indexer · live",
                );
            }
        }
        if (scope === "second" || scope === "all") {
            if (secondError) {
                labels.add("Second live source · unavailable");
            } else if (!labels.has("mempool · live") && !labels.has("barkd · live")) {
                labels.add(
                    secondConfigured
                        ? secondLoading
                            ? "Second live source · loading"
                            : "Second live source · live"
                        : "Second on-chain source · not configured",
                );
            }
        }
        return [...labels].join(" · ");
    }, [
        arkadeConfigured,
        arkadeError,
        arkadeLoading,
        inScope,
        scope,
        secondConfigured,
        secondError,
        secondLoading,
    ]);
    let emptyTitle = "No matching transactions";
    let emptyMessage = "Try another search or clear the filters.";
    if (rawCount === 0) {
        const relevantSources =
            scope === "arkade"
                ? [
                      {
                          configured: arkadeConfigured,
                          loading: arkadeLoading,
                          error: arkadeError,
                          label: "Arkade",
                      },
                  ]
                : scope === "second"
                  ? [
                        {
                            configured: secondConfigured,
                            loading: secondLoading,
                            error: secondError,
                            label: "Second",
                        },
                    ]
                  : [
                        {
                            configured: arkadeConfigured,
                            loading: arkadeLoading,
                            error: arkadeError,
                            label: "Arkade",
                        },
                        {
                            configured: secondConfigured,
                            loading: secondLoading,
                            error: secondError,
                            label: "Second",
                        },
                    ];
        const configuredSources = relevantSources.filter((source) => source.configured);
        const failedSources = relevantSources.filter((source) => source.configured && source.error);
        if (configuredSources.length === 0) {
            emptyTitle = "No live sources configured";
            emptyMessage =
                scope === "second"
                    ? "Second on-chain source not configured."
                    : "Add scripts to your watchlist or connect barkd — the operator publishes no global listing.";
        } else if (failedSources.length > 0) {
            emptyTitle = `${failedSources.map((source) => source.label).join(" and ")} live source unavailable`;
            emptyMessage = failedSources
                .map((source) => source.error?.message || `${source.label} source unavailable`)
                .join(" · ");
        } else if (relevantSources.some((source) => source.configured && source.loading)) {
            emptyTitle = "Loading live records";
            emptyMessage =
                "Records from the configured live sources will appear when they respond.";
        } else if (scope === "arkade") {
            emptyTitle = "No watched VTXOs";
            emptyMessage = "The operator indexer returned no VTXOs for your watchlist scripts.";
        } else if (scope === "second") {
            emptyTitle = "No live Second records";
            emptyMessage = "No on-chain server transactions or wallet VTXOs were returned.";
        } else {
            emptyTitle = "No live records";
            emptyMessage =
                "Configured live sources returned no watched VTXOs or on-chain transactions.";
        }
    }

    return (
        <section
            className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
            aria-labelledby="records-heading"
        >
            <h2 id="records-heading" className="sr-only">
                Live transactions
            </h2>
            <div className="flex flex-col gap-3 border-b border-border p-4 xl:flex-row xl:items-center xl:justify-between">
                <div
                    className="flex flex-wrap items-center gap-2"
                    role="group"
                    aria-label="Transaction type"
                >
                    {(
                        [
                            ["all", "All", counts.all],
                            ["virtual", "Virtual", counts.virtual],
                            ["onchain", "On-chain", counts.onchain],
                        ] as const
                    ).map(([value, label, count]) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={layer === value}
                            onClick={() => setLayer(value)}
                            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${layer === value ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                        >
                            {label}{" "}
                            <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-xs tabular-nums">
                                {count}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        aria-pressed={needsReviewOnly}
                        onClick={() => setNeedsReviewOnly((value) => !value)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${needsReviewOnly ? "border-warning/40 bg-warning/10 text-warning" : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                    >
                        Needs review <span className="ml-1 tabular-nums">{counts.review}</span>
                    </button>
                    <label className="relative min-w-[12rem] flex-1 xl:flex-none">
                        <span className="sr-only">
                            Search label, transaction ID, network, or status
                        </span>
                        <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search transactions"
                            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
                        />
                    </label>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-border bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                            <th scope="col" className="px-4 py-3 font-medium">
                                Transaction
                            </th>
                            <th scope="col" className="px-4 py-3 font-medium">
                                Network
                            </th>
                            <th scope="col" className="px-4 py-3 font-medium">
                                Type
                            </th>
                            <th
                                scope="col"
                                aria-sort={sortDirection ?? "none"}
                                className="px-4 py-3 text-right font-medium"
                            >
                                <button
                                    type="button"
                                    aria-label="Sort by amount"
                                    onClick={() =>
                                        setSortDirection((value) =>
                                            value === "ascending" ? "descending" : "ascending",
                                        )
                                    }
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                >
                                    Amount{" "}
                                    <span aria-hidden="true">
                                        {sortDirection === "ascending"
                                            ? "↑"
                                            : sortDirection === "descending"
                                              ? "↓"
                                              : "↕"}
                                    </span>
                                </button>
                            </th>
                            <th scope="col" className="px-4 py-3 font-medium">
                                Status
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {visible.map((record) => (
                            <tr
                                key={record.id}
                                role="button"
                                aria-pressed={record.id === selectedId}
                                data-record-id={record.id}
                                tabIndex={0}
                                onClick={(event) => {
                                    event.currentTarget.focus();
                                    onSelect(record.id);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        onSelect(record.id);
                                    }
                                }}
                                className={`cursor-pointer outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50 ${record.id === selectedId ? "border-l-2 border-primary bg-accent/10" : ""}`}
                            >
                                <td className="max-w-[20rem] px-4 py-3">
                                    <div className="min-w-0">
                                        <span className="block truncate font-medium text-foreground">
                                            {record.label}
                                        </span>
                                        <p className="truncate font-mono text-xs text-muted-foreground">
                                            {truncateId(record.txid)}
                                        </p>
                                    </div>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                    <span
                                        className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground"
                                        aria-hidden="true"
                                    >
                                        {record.network === "arkade" ? "A" : "S"}
                                    </span>
                                    {record.network === "arkade" ? "Arkade" : "Second"}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                    {record.typeLabel}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                    {record.amountSat === null ? (
                                        <span className="text-muted-foreground">—</span>
                                    ) : (
                                        <>
                                            <span className="text-foreground">
                                                {formatSats(record.amountSat).replace(/ sats$/, "")}
                                            </span>
                                            <span className="ml-1 text-muted-foreground">sats</span>
                                        </>
                                    )}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3">
                                    <RecordStatusBadge record={record} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {visible.length === 0 && (
                <div className="px-6 py-12 text-center">
                    <h3 className="text-base font-semibold text-foreground">{emptyTitle}</h3>
                    <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                        {emptyMessage}
                    </p>
                    {(search || needsReviewOnly || layer !== "all") && rawCount > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearch("");
                                setNeedsReviewOnly(false);
                                setLayer("all");
                            }}
                            className="mt-4 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            )}
            <div className="flex flex-col gap-1 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>{sourceFreshness || "No live records"}</span>
            </div>
        </section>
    );
}
