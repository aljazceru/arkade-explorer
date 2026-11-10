import type { ArkadeObservation, ArkadeVtxoRow, BarkObservation } from "@/lib/observation";
import type { VirtualCoin } from "@arkade-os/sdk";
import type { BarkdVtxo } from "@/lib/barkd";
import { AVG_BLOCK_SECONDS, EXPIRY_MIN_PLAUSIBLE_MS } from "@/lib/vtxo-display";
import { formatDuration } from "@/lib/observation";
import { atlasVtxoState, ATLAS_STATE_META, type AtlasVtxoState } from "@/lib/atlas/vtxo-state";

/**
 * Pure record model behind the overview: the row type, the snapshot/live
 * builders and the status rules. Extracted from the old records-table
 * component so canvas, table and inspector all read the same records.
 */

type ArkadeCommitment = Record<string, unknown>;

export type NetworkScope = "all" | "arkade" | "second";
export type RecordKind = "virtual" | "commitment" | "onchain";
export type RecordStatus =
    | "urgent"
    | "expired"
    | "unknown"
    | "spent"
    | "healthy"
    | "confirmed"
    | "observed"
    | "locked"
    | "unrolled"
    | "swept";

export type OverviewRecord = {
    id: string;
    txid: string;
    network: "arkade" | "second";
    kind: RecordKind;
    typeLabel: string;
    /** Distinguishes an actual coin from a transaction notification or block. */
    entity: "vtxo" | "transaction" | "block";
    label: string;
    amountSat: number | null;
    /** The accounting scope of amountSat; never imply payment volume from output sums. */
    amountLabel: string;
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
    expiryHeight?: number | null;
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
        timeZone: "UTC",
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
    return `Snapshot ${time} UTC · ${age}`;
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

/** The wire expiry follows the SDK's timestamp-versus-height convention. */
function snapshotExpiry(row: ArkadeVtxoRow): { seconds: number | null; height: number | null } {
    const raw = toUnixSeconds(row.expiresAt) ?? toUnixSeconds(row.expiresAt_unix);
    const seconds = raw !== null && raw * 1000 >= EXPIRY_MIN_PLAUSIBLE_MS ? raw : null;
    const height =
        seconds === null
            ? (row.expiresAtHeight ??
              (raw !== null && Number.isInteger(raw) && raw > 0 ? raw : null))
            : null;
    return { seconds, height };
}

export function getArkadeRecordStatus(
    row: ArkadeVtxoRow,
    exitSeconds: number | null,
    now = Date.now(),
    snapshotFetchedAt?: string,
    tipHeight: number | null = null,
): { status: RecordStatus; statusLabel: string; needsReview: boolean; leftSeconds: number | null } {
    const expiry = snapshotExpiry(row);
    const sampledAt = toUnixSeconds(snapshotFetchedAt);
    const sampledLeft = toFiniteNumber(row.left_seconds);
    // A stored countdown is only meaningful relative to its observation time.
    const leftSeconds =
        expiry.seconds !== null
            ? expiry.seconds - now / 1000
            : expiry.height !== null
              ? tipHeight === null
                  ? null
                  : (expiry.height - tipHeight) * AVG_BLOCK_SECONDS
              : sampledAt !== null && sampledLeft !== null
                ? sampledAt + sampledLeft - now / 1000
                : null;
    const terminal = row.isSpent === true || Boolean(row.spentBy) || Boolean(row.settledBy);
    if (terminal) {
        return {
            status: "spent",
            statusLabel: row.settledBy ? "Spent in batch" : "Spent",
            needsReview: false,
            leftSeconds,
        };
    }
    if (row.isUnrolled) {
        return {
            status: "unrolled",
            statusLabel: "Exit started",
            needsReview: false,
            leftSeconds: null,
        };
    }
    if (row.isSwept) {
        return {
            status: "swept",
            statusLabel: "Swept · operator recovery required",
            needsReview: true,
            leftSeconds: null,
        };
    }
    if (leftSeconds !== null && leftSeconds <= 0) {
        return { status: "expired", statusLabel: "Expired", needsReview: true, leftSeconds };
    }
    if (leftSeconds === null) {
        return { status: "unknown", statusLabel: "Expiry unknown", needsReview: true, leftSeconds };
    }
    if (exitSeconds === null || !Number.isFinite(exitSeconds) || exitSeconds < 0) {
        return {
            status: "unknown",
            statusLabel: "Exit margin unavailable",
            needsReview: true,
            leftSeconds,
        };
    }
    const urgent = leftSeconds <= exitSeconds;
    return {
        status: urgent ? "urgent" : "healthy",
        statusLabel: `${expiry.height !== null ? "≈" : ""}${formatDuration(leftSeconds)} left`,
        needsReview: urgent,
        leftSeconds,
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const VIRTUAL_KIND_LABELS: Record<string, string> = {
    refresh: "Refresh",
    virtual: "Virtual",
    onboard: "Onboard",
    offboard: "Offboard",
};

function virtualKindLabel(txType: string | undefined): string {
    if (txType && txType in VIRTUAL_KIND_LABELS) return VIRTUAL_KIND_LABELS[txType];
    if (txType) return `${txType[0].toUpperCase()}${txType.slice(1)}`;
    return "Virtual";
}

/** One row per outpoint; the indexer can repeat an outpoint, and spent state is monotonic. */
function uniqueVtxoRows(rows: ArkadeVtxoRow[]): ArkadeVtxoRow[] {
    const byOutpoint = new Map<string, ArkadeVtxoRow>();
    for (const row of rows) {
        const key = `${row.txid}:${row.vout}`;
        const existing = byOutpoint.get(key);
        // Spent state only moves forward, so a spent duplicate supersedes an unspent one.
        const rowSpent = row.isSpent === true || Boolean(row.spentBy) || Boolean(row.settledBy);
        const existingSpent =
            existing !== undefined &&
            (existing.isSpent === true || Boolean(existing.spentBy) || Boolean(existing.settledBy));
        if (!existing || (rowSpent && !existingSpent)) byOutpoint.set(key, row);
    }
    return [...byOutpoint.values()];
}

export function buildOverviewRecords(
    arkade: ArkadeObservation | null,
    bark: BarkObservation | null,
    exitSeconds: number | null,
    now = Date.now(),
    tipHeight: number | null = null,
): OverviewRecord[] {
    const records: OverviewRecord[] = [];
    const commitmentIds = new Set<string>();

    if (arkade) {
        for (const row of uniqueVtxoRows(arkade.vtxos ?? [])) {
            if (row.error || !Number.isInteger(row.vout) || row.vout < 0) continue;
            const status = getArkadeRecordStatus(
                row,
                exitSeconds,
                now,
                arkade.fetched_at,
                tipHeight,
            );
            const expiry = snapshotExpiry(row);
            records.push({
                id: `arkade-vtxo:${row.txid}:${row.vout}`,
                txid: row.txid,
                network: "arkade",
                kind: "virtual",
                entity: "vtxo",
                typeLabel: "Virtual",
                label: `${virtualKindLabel(row.txType)} output #${row.vout}`,
                amountSat: toFiniteNumber(row.amount_sat),
                amountLabel: "VTXO value",
                status: status.status,
                statusLabel: status.statusLabel,
                needsReview: status.needsReview,
                leftSeconds: status.leftSeconds,
                exitSeconds,
                createdAtSeconds: toUnixSeconds(row.createdAt),
                expiresAtSeconds: expiry.seconds,
                recordedAt: row.createdAt ?? null,
                snapshotFetchedAt: arkade.fetched_at,
                sourceLabel: "Arkade VTXO snapshot",
                commitmentTxids: row.commitmentTxids ?? [],
                blockHeight: null,
                expiryHeight: expiry.height,
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
                entity: "transaction",
                typeLabel: "Batch (on-chain)",
                label: "Batch commitment",
                amountSat: toFiniteNumber(commitment.totalOutputAmount),
                amountLabel: "Registered batch receiver value",
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
            for (const txid of row.commitmentTxids ?? []) commitmentIds.add(txid);
        }
        for (const txid of commitmentIds) {
            if (records.some((record) => record.id === `arkade-commitment:${txid}`)) continue;
            records.push({
                id: `arkade-commitment:${txid}`,
                txid,
                network: "arkade",
                kind: "commitment",
                typeLabel: "Batch (on-chain)",
                entity: "transaction",
                label: "Batch commitment",
                amountSat: null,
                amountLabel: "Registered batch receiver value",
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
        // Archive discoveries remain visible even when indexer enrichment fails.
        // They carry no invented amount, coin state, expiry or confirmation.
        const representedTxids = new Set(records.map((record) => record.txid));
        for (const activity of arkade.recent_activity ?? []) {
            if (representedTxids.has(activity.txid)) continue;
            representedTxids.add(activity.txid);
            const commitment = activity.txType === "commitment";
            records.push({
                id: `arkade-archive:${activity.txid}`,
                txid: activity.txid,
                network: "arkade",
                kind: commitment ? "commitment" : "virtual",
                entity: "transaction",
                typeLabel: commitment ? "Commitment" : "Virtual",
                label: `${virtualKindLabel(activity.txType)} transaction`,
                amountSat: null,
                amountLabel: "Not available",
                status: "observed",
                statusLabel: "Archive observation",
                needsReview: false,
                leftSeconds: null,
                exitSeconds: null,
                createdAtSeconds: toUnixSeconds(activity.createdAt),
                expiresAtSeconds: null,
                recordedAt: activity.createdAt,
                snapshotFetchedAt: arkade.fetched_at,
                sourceLabel: "Arkade activity archive · not indexer-verified",
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
                entity: "transaction",
                typeLabel: "On-chain",
                label,
                amountSat: toFiniteNumber(row.total_sats),
                amountLabel: "Transaction outputs (includes change)",
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

const WATCHLIST_RECORD_STATE: Record<AtlasVtxoState, RecordStatus> = {
    renew: "urgent",
    expired: "expired",
    unknown: "unknown",
    preconfirmed: "healthy",
    settled: "healthy",
    swept: "swept",
    unfinalized: "unknown",
    spent: "spent",
    "spent-in-batch": "spent",
    unrolled: "unrolled",
};

export function buildWatchlistRecords(
    vtxos: VirtualCoin[],
    exitSeconds: number | null,
    tipHeight: number | null,
    now = Date.now(),
    observedAt = now,
): OverviewRecord[] {
    const exitDelay =
        exitSeconds === null ? null : { type: "seconds" as const, value: exitSeconds };
    return vtxos.map((vtxo) => {
        const { txid, vout } = vtxo;
        const view = atlasVtxoState(vtxo, { nowMs: now, exitDelay, tipHeight });
        const remaining = view.remaining;
        const status = WATCHLIST_RECORD_STATE[view.state];
        const leftSeconds = remaining?.seconds ?? null;
        const statusLabel =
            remaining && (status === "urgent" || status === "healthy")
                ? `${remaining.source === "height" ? "≈" : ""}${formatDuration(remaining.seconds)} left`
                : ATLAS_STATE_META[view.state].label;
        const createdAt = vtxo.createdAt instanceof Date ? vtxo.createdAt : null;

        return {
            id: `arkade-live:${txid}:${vout}`,
            txid,
            network: "arkade",
            kind: "virtual",
            entity: "vtxo",
            typeLabel: "Virtual · live",
            label: `Watched VTXO ${vout}`,
            amountSat: vtxo.value,
            amountLabel: "VTXO value",
            status,
            statusLabel,
            needsReview:
                status === "urgent" ||
                status === "expired" ||
                status === "unknown" ||
                status === "swept",
            leftSeconds,
            exitSeconds,
            createdAtSeconds: createdAt ? createdAt.getTime() / 1000 : null,
            expiresAtSeconds: remaining?.source === "time" ? remaining.expiresAtMs / 1000 : null,
            recordedAt: createdAt?.toISOString() ?? null,
            snapshotFetchedAt: new Date(observedAt).toISOString(),
            sourceLabel: "operator indexer · live",
            commitmentTxids: vtxo.commitmentTxIds ?? [],
            blockHeight: null,
            expiryHeight:
                vtxo.expiresAtHeight ??
                (remaining?.source === "height" && tipHeight !== null
                    ? tipHeight + remaining.blocks
                    : null),
            liveSource: true,
        };
    });
}

export function buildBarkdRecords(
    vtxos: BarkdVtxo[],
    tipHeight: number | null,
    exitSeconds: number | null,
    now = Date.now(),
    observedAt = now,
): OverviewRecord[] {
    return vtxos.map((vtxo) => {
        const separator = vtxo.id.indexOf(":");
        const txid = vtxo.id.slice(0, separator);
        const vout = vtxo.id.slice(separator + 1);
        const coinExitSeconds =
            Number.isFinite(vtxo.exitDelta) && vtxo.exitDelta >= 0
                ? vtxo.exitDelta * AVG_BLOCK_SECONDS
                : exitSeconds;
        let status: RecordStatus;
        let statusLabel: string;
        let needsReview: boolean;
        let leftSeconds: number | null;

        if (vtxo.state.type === "spent" || vtxo.state.type === "exited") {
            status = "spent";
            statusLabel = vtxo.state.type === "exited" ? "Exited on-chain" : "Spent";
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
            } else if (coinExitSeconds !== null && secondsLeft <= coinExitSeconds) {
                status = "urgent";
                statusLabel = `≈${formatDuration(secondsLeft)} left`;
                needsReview = true;
            } else if (coinExitSeconds === null || !Number.isFinite(coinExitSeconds)) {
                status = "unknown";
                statusLabel = "Exit margin unavailable";
                needsReview = true;
            } else {
                status = vtxo.state.type === "locked" ? "locked" : "healthy";
                statusLabel = `≈${formatDuration(secondsLeft)} left`;
                needsReview = false;
            }
            if (vtxo.state.type === "locked") statusLabel = `Locked · ${statusLabel}`;
        }
        return {
            id: `second-barkd:${vtxo.id}`,
            txid,
            network: "second",
            kind: "virtual",
            entity: "vtxo",
            typeLabel: "Virtual · your wallet",
            label: `Wallet VTXO ${vout}`,
            amountSat: vtxo.amountSat,
            amountLabel: "VTXO value",
            status,
            statusLabel,
            needsReview,
            leftSeconds,
            exitSeconds: coinExitSeconds,
            createdAtSeconds: null,
            expiresAtSeconds: null,
            recordedAt: null,
            snapshotFetchedAt: new Date(observedAt).toISOString(),
            sourceLabel: "barkd · live",
            commitmentTxids: [],
            blockHeight: null,
            expiryHeight: vtxo.expiryHeight,
            chainAnchor: vtxo.chainAnchor,
            policyType: vtxo.policyType,
            exitDeltaBlocks: vtxo.exitDelta,
            exitDepth: vtxo.exitDepth,
            liveSource: true,
        };
    });
}

/**
 * The dedupe key Home uses to decide whether the live stream already covers a
 * snapshot row: `<txid>:<vout-or-x>`. Virtual stream ids end in `:x` while
 * snapshot VTXO ids end in `:<vout>`, so only commitment rows can collide.
 */
export function recordDedupeKey(record: Pick<OverviewRecord, "txid" | "id">): string {
    return `${record.txid}:${record.id.match(/:(\d+)$/)?.[1] ?? "x"}`;
}

/** Seconds-precision timestamp of a record's event time (created or recorded). */
export function recordTimeSeconds(record: OverviewRecord): number | null {
    if (record.createdAtSeconds !== null) return record.createdAtSeconds;
    return toUnixSeconds(record.recordedAt);
}

/**
 * Integer sats with en-US grouping for SVG labels — never "4993.7 k".
 * Returns "—" for unknown amounts.
 */
export function formatSatsInt(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return `${Math.round(value).toLocaleString("en-US")} sats`;
}
