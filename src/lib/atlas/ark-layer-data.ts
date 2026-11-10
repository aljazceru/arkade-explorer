import type { ArkadeObservation } from "@/lib/observation";
import type { SecondServerTx } from "@/lib/live-second";
import {
    recordTimeSeconds,
    toUnixSeconds,
    type OverviewRecord,
    type RecordStatus,
} from "@/lib/overview-records";
import type { ChainBlock } from "@/hooks/use-recent-blocks";
import type {
    ArkBlock,
    ArkCommitment,
    ArkEvent,
    ArkEventKind,
    ArkEventState,
    ArkHourlyBucket,
    ArkLayerInput,
    ArkSecondTx,
} from "@/lib/atlas/ark-layer";

/**
 * Records + snapshots → `ArkLayerInput`. Pure and deterministic so the canvas
 * layout stays a function of data, not of React state.
 *
 * Conventions preserved from the overview:
 * - one node per Arkade transaction: snapshot `arkade-vtxo:*` rows and live
 *   `ark-stream-virtual:*` rows are grouped by txid;
 * - commitments merge snapshot `arkade.commitments` / synthetic
 *   `arkade-commitment:*` rows / stream `ark-stream-commitment:*` rows by txid;
 * - the Second lane reads ONLY `second-live:` records (live Esplora server txs)
 *   — the `bark.json` snapshot stays out of the canvas, as before;
 * - hourly density comes from `arkade.trends` displayDate buckets.
 */

const DAY_SECONDS = 86_400;

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

/**
 * "2026-10-19T14:00:00Z" (explicit timezone) → hour start unix seconds.
 * The archive `displayDate` field carries NO timezone marker ("YYYY-MM-DD HH:MM").
 * We MUST NOT fabricate a timezone — a bucket labelled UTC that is actually
 * local time would silently misplace density by hours. Return null for any
 * string without an explicit offset so the lane renders "unavailable".
 */
function trendHourStart(displayDate: unknown): number | null {
    if (typeof displayDate !== "string") return null;
    // Require explicit timezone: trailing Z, ±HH:MM, or ±HHMM.
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(displayDate.trim())) return null;
    const ms = Date.parse(displayDate);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Kind shown on a node. `entity === "transaction"` stream rows are live
 * notifications (a tx happened), not spendable coins — they never map to a
 * payment/onboard/offboard semantic kind. Snapshot `txType` is an archive
 * category, not a protocol flag, so we surface it only as the coarse "virtual"
 * label and let the inspector carry the archive tag.
 */
function eventKind(record: OverviewRecord): ArkEventKind {
    if (record.kind === "commitment") return "batch";
    if (record.entity === "transaction") return "transaction";
    // VTXO entities are individual virtual outputs — the coarse "virtual" kind
    // is honest; archive typeLabel categories are not protocol flags.
    return "virtual";
}

/** Worst-case review flag wins; state follows the most severe member status. */
const STATE_RANK: Record<RecordStatus, number> = {
    expired: 7,
    urgent: 6,
    unknown: 5,
    swept: 4, // operator recovery required — severe but not expiry
    spent: 3,
    unrolled: 1, // terminal: exit started on-chain
    healthy: 1,
    confirmed: 0,
    observed: 0,
    locked: 0,
};

function statusToState(status: RecordStatus): ArkEventState {
    switch (status) {
        case "expired":
        case "urgent":
            return "expired";
        case "unknown":
        case "swept":
            return "unknown"; // swept needs review — warning ring, not settled
        case "spent":
            return "spent"; // consumed — distinct from settled (exit in progress)
        case "unrolled":
            return "spent"; // exit started on-chain — not a normal settled state
        default:
            return "healthy";
    }
}

function mergeGroupStatus(records: OverviewRecord[]): {
    statusLabel: string;
    needsReview: boolean;
    live: boolean;
    state: ArkEventState;
} {
    const needsReview = records.some((record) => record.needsReview);
    const live = records.some((record) => record.liveSource === true);
    const worst = records.reduce((acc, record) =>
        STATE_RANK[record.status] > STATE_RANK[acc.status] ? record : acc,
    );
    const statusLabel = needsReview
        ? (records.find((record) => record.needsReview)?.statusLabel ?? "Needs review")
        : (records.find(
              (record) =>
                  record.status === "urgent" ||
                  record.status === "expired" ||
                  record.status === "swept",
          )?.statusLabel ??
          records[0]?.statusLabel ??
          "");
    return { statusLabel, needsReview, live, state: statusToState(worst.status) };
}

export interface ArkLayerDataOptions {
    /** Right-edge anchor for "now"; defaults to Date.now()/1000. */
    nowSec?: number;
    windowSec?: number;
    panSec?: number;
    lane?: "all" | "arkade" | "second";
    nextRoundAt?: number | null;
}

/**
 * Build the canvas input. `records` is the merged activity list Home already
 * computes (live stream + snapshot backfill + Second live). Snapshot-only
 * extras (commitment on-chain fields, hourly trends) come from `arkade`.
 */
export function buildArkLayerInput(
    records: OverviewRecord[],
    arkade: ArkadeObservation | null,
    blocks: ChainBlock[] | undefined,
    liveSecondTxs: SecondServerTx[] | null | undefined,
    options: ArkLayerDataOptions = {},
): ArkLayerInput {
    const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);

    // ---- Arkade virtual events: group records by txid ----------------------
    // A txid can mix VTXO-output rows (entity "vtxo", one per outpoint) with
    // transaction-notification rows (entity "transaction", the stream's coarse
    // "a tx happened" signal). Summing amountSat across both would double
    // count: the notification amount is itself a sum of the same outputs.
    // Amount is therefore only summed over `entity === "vtxo"` members, and
    // the event records how many real coins vs notifications it represents.
    const arkadeRecords = records.filter(
        (record) => record.network === "arkade" && record.kind === "virtual",
    );
    const groups = new Map<string, OverviewRecord[]>();
    for (const record of arkadeRecords) {
        const list = groups.get(record.txid);
        if (list) list.push(record);
        else groups.set(record.txid, [record]);
    }
    const events: ArkEvent[] = [];
    for (const [txid, members] of groups) {
        const timed = members
            .map((record) => ({ record, t: recordTimeSeconds(record) }))
            .filter((entry): entry is { record: OverviewRecord; t: number } => entry.t !== null)
            .sort((a, b) => a.t - b.t || a.record.id.localeCompare(b.record.id));
        const primary = timed[0]?.record ?? members[0];
        const time = timed[0]?.t ?? null;
        if (time === null) continue; // no honest position — the table still lists it

        // Only actual VTXO entities carry per-output value; transaction
        // notifications' amounts are derived sums and would double count.
        const vtxoMembers = members.filter((record) => record.entity === "vtxo");
        const coinMembers = vtxoMembers.length > 0 ? vtxoMembers : members;
        const amountSat = coinMembers.reduce<number | null>((sum, record) => {
            if (record.amountSat === null) return sum;
            return (sum ?? 0) + record.amountSat;
        }, null);

        const commitmentId = members.find((record) => record.commitmentTxids.length > 0)
            ?.commitmentTxids[0];
        const merged = mergeGroupStatus(members);
        events.push({
            id: txid,
            txid,
            kind: eventKind(primary),
            time,
            amountSat,
            amountLabel: primary.amountLabel,
            recordId: primary.id,
            recordIds: members.map((record) => record.id),
            commitmentId: commitmentId ?? null,
            vtxoCount: coinMembers.length,
            statusLabel: merged.statusLabel,
            needsReview: merged.needsReview,
            state: merged.state,
            live: merged.live,
            sourceLabel: primary.sourceLabel,
        });
    }

    // ---- Commitments: snapshot + stream + synthetic rows, merged by txid --
    const commitmentMap = new Map<string, ArkCommitment>();
    const ensureCommitment = (txid: string): ArkCommitment => {
        const existing = commitmentMap.get(txid);
        if (existing) return existing;
        const created: ArkCommitment = {
            txid,
            blockHeight: null,
            blockTimeSeconds: null,
            awaitingBlock: true,
            createdAtSeconds: null,
            amountSat: null,
            vtxoCount: null,
            recordId: `arkade-commitment:${txid}`,
        };
        commitmentMap.set(txid, created);
        return created;
    };

    if (arkade) {
        for (const [txid, value] of Object.entries(arkade.commitments ?? {})) {
            const raw = asRecord(value);
            const onchain = asRecord(raw._onchain);
            const batches = asRecord(raw.batches);
            const batchList = Object.values(batches);
            const batchVtxos = batchList.reduce<number>((sum, batch) => {
                const n = finiteNumber(asRecord(batch).totalOutputVtxos);
                return sum + (n ?? 0);
            }, 0);
            const inputVtxos = finiteNumber(raw.totalInputVtxos);
            const outputVtxos = finiteNumber(raw.totalOutputVtxos);
            const vtxoCount =
                batchVtxos > 0
                    ? batchVtxos
                    : (inputVtxos ?? 0) + (outputVtxos ?? 0) > 0
                      ? (inputVtxos ?? 0) + (outputVtxos ?? 0)
                      : null;
            commitmentMap.set(txid, {
                txid,
                blockHeight: finiteNumber(onchain.block_height),
                blockTimeSeconds: toUnixSeconds(
                    (onchain.block_time as string | number | undefined) ?? null,
                ),
                awaitingBlock: finiteNumber(onchain.block_height) === null,
                createdAtSeconds:
                    toUnixSeconds(
                        (onchain.block_time as string | number | undefined) ??
                            (raw.startedAt as string | number | undefined) ??
                            null,
                    ) ?? toUnixSeconds(raw.endedAt as string | number | undefined),
                amountSat: finiteNumber(raw.totalOutputAmount),
                vtxoCount,
                recordId: `arkade-commitment:${txid}`,
            });
        }
    }

    for (const record of records) {
        if (record.network !== "arkade" || record.kind !== "commitment") continue;
        const cm = ensureCommitment(record.txid);
        // Record fields fill gaps; snapshot values win where both exist.
        if (cm.amountSat === null) cm.amountSat = record.amountSat;
        // blockHeight is now exclusively the confirmed chain block; a null
        // here means "no observed confirmation", never "expiry height".
        if (cm.blockHeight === null) cm.blockHeight = record.blockHeight;
        if (cm.blockTimeSeconds === null) {
            // Only trust the record's time as a block time when a block exists;
            // otherwise it's the record's own event/creation time.
            cm.blockTimeSeconds = record.blockHeight !== null ? recordTimeSeconds(record) : null;
        }
        if (cm.createdAtSeconds === null) cm.createdAtSeconds = recordTimeSeconds(record);
        cm.awaitingBlock = cm.blockHeight === null;
        if (!arkade?.commitments?.[record.txid]) cm.recordId = record.id;
    }

    // ---- Second lane: live Esplora server txs only --------------------------
    // `liveSecondTxs` is the gRPC-web feed (direction + block fields intact);
    // `second-live:` records cover any tx the feed missed.
    const secondTxs: ArkSecondTx[] = [];
    const seenSecond = new Set<string>();
    for (const tx of liveSecondTxs ?? []) {
        // Unconfirmed mempool txs have no block_time and no first-seen
        // timestamp in the feed. Plotting them at `nowSec` would make the
        // marker slide left every render as "now" advances — a fabricated
        // position. They stay in the records/table with unknown time instead.
        if (tx.blockTimeSeconds === null) continue;
        seenSecond.add(tx.txid);
        secondTxs.push({
            id: `second-live:${tx.txid}`,
            txid: tx.txid,
            time: tx.blockTimeSeconds,
            amountSat: tx.totalSats,
            blockHeight: tx.blockHeight,
            direction: tx.direction,
            recordId: `second-live:${tx.txid}`,
            statusLabel: "Confirmed",
        });
    }
    for (const record of records) {
        if (!record.id.startsWith("second-live:") || seenSecond.has(record.txid)) continue;
        // Unconfirmed records (blockHeight null) have no honest time either.
        if (record.blockHeight === null) continue;
        const time = recordTimeSeconds(record);
        if (time === null) continue;
        secondTxs.push({
            id: record.id,
            txid: record.txid,
            time,
            amountSat: record.amountSat,
            blockHeight: record.blockHeight,
            direction: "other",
            recordId: record.id,
            statusLabel: record.statusLabel,
        });
    }

    // ---- Hourly density band -------------------------------------------------
    // `displayDate` carries no timezone marker. We MUST NOT fabricate one —
    // a bucket labelled UTC that is actually local time would silently
    // misplace density by hours. Only buckets with an explicit timezone are
    // plotted; timezone-less strings yield `hourlyUnavailable` so the lane
    // can say "unavailable" instead of drawing a wrong band.
    const trends = arkade?.trends ?? [];
    const hourly: ArkHourlyBucket[] = [];
    for (const trend of trends) {
        const hourStart = trendHourStart(asRecord(trend).displayDate);
        const count = finiteNumber(asRecord(trend).virtualTxCount);
        if (hourStart === null || count === null) continue;
        hourly.push({ hourStart, virtualTxCount: count });
    }
    hourly.sort((a, b) => a.hourStart - b.hourStart);
    // Trends exist with valid counts but none had a parseable timezone →
    // the archive uses timezone-less displayDate. Missing counts are a
    // different problem (empty data, not unavailable timezone).
    const hourlyUnavailable =
        trends.length > 0 &&
        hourly.length === 0 &&
        trends.some((t) => finiteNumber(asRecord(t).virtualTxCount) !== null);

    const arkBlocks: ArkBlock[] = (blocks ?? []).map((block) => ({
        height: block.height,
        time: block.time,
        hash: block.hash,
        txCount: block.txCount,
        size: block.size,
    }));

    return {
        nowSec,
        windowSec: options.windowSec ?? 24 * 3600,
        panSec: options.panSec ?? 0,
        lane: options.lane ?? "all",
        blocks: arkBlocks,
        commitments: [...commitmentMap.values()],
        events,
        secondTxs,
        hourly,
        hourlyUnavailable,
        nextRoundAt: options.nextRoundAt ?? null,
    };
}

/** Median VTXO lifetime across snapshot batches, in seconds — the "life basis". */
export function medianBatchLifetimeSeconds(arkade: ArkadeObservation | null): {
    seconds: number | null;
    sampleCount: number;
} {
    if (!arkade) return { seconds: null, sampleCount: 0 };
    const spans: number[] = [];
    for (const value of Object.values(arkade.commitments ?? {})) {
        const raw = asRecord(value);
        const endedAt = toUnixSeconds(raw.endedAt as string | number | undefined);
        if (endedAt === null) continue;
        const batches = asRecord(raw.batches);
        for (const batch of Object.values(batches)) {
            const expiresAt = toUnixSeconds(
                asRecord(batch).expiresAt as string | number | undefined,
            );
            if (expiresAt !== null && expiresAt > endedAt) spans.push(expiresAt - endedAt);
        }
    }
    if (spans.length === 0) return { seconds: null, sampleCount: 0 };
    spans.sort((a, b) => a - b);
    return { seconds: spans[Math.floor(spans.length / 2)], sampleCount: spans.length };
}

export { DAY_SECONDS as ARK_LAYER_DAY_SECONDS };
