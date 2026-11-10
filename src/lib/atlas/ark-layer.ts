/**
 * Layout math for the Atlas "Ark layer" canvas: one shared time axis, a
 * Bitcoin block rail positioned by block *time*, commitments anchored to
 * their blocks, Arkade virtual events and Second server-wallet transactions.
 * Pure functions only — the React component renders what this returns.
 */

export interface ArkBlock {
    height: number;
    time: number;
    hash?: string;
    txCount?: number;
    size?: number;
}

export interface ArkCommitment {
    txid: string;
    /** Block height the commitment confirmed in; null while unconfirmed/indexing. */
    blockHeight: number | null;
    /** Known block time (unix s) for that height, when the indexer reported it. */
    blockTimeSeconds: number | null;
    /** True when the commitment has no on-chain block yet ("awaiting block"). */
    awaitingBlock: boolean;
    /** Session end / creation time used when no anchor time is known. */
    createdAtSeconds: number | null;
    amountSat: number | null;
    vtxoCount: number | null;
    recordId: string;
}
export type ArkEventKind = "virtual" | "batch" | "transaction";

/** Visual state of a virtual event: drives the ring around the node. */
export type ArkEventState = "settled" | "expired" | "unknown" | "healthy" | "spent";

export interface ArkEvent {
    /** Group key: one node per Arkade transaction (several VTXOs can share a txid). */
    id: string;
    txid: string;
    kind: ArkEventKind;
    /** Event time: earliest known creation/record time of the group. */
    time: number;
    amountSat: number | null;
    /** What amountSat counts (e.g. "VTXO value", "New VTXO outputs"). */
    amountLabel?: string;
    /** Representative record for the inspector, plus every record in the group. */
    recordId: string;
    recordIds: string[];
    /** First known commitment anchor, when both ends are in play. */
    commitmentId: string | null;
    vtxoCount: number;
    /** Worst-case status label across the group, for tooltips. */
    statusLabel: string;
    needsReview: boolean;
    /** Ring state derived from member record statuses. */
    state: ArkEventState;
    live: boolean;
    /** Provenance: "operator indexer · live", "arkade archive", etc. */
    sourceLabel?: string;
}

export interface ArkSecondTx {
    id: string;
    txid: string;
    time: number;
    amountSat: number | null;
    blockHeight: number | null;
    direction: "to_server" | "from_server" | "other";
    recordId: string;
    statusLabel: string;
}

export interface ArkHourlyBucket {
    /** Hour start, unix seconds (UTC). */
    hourStart: number;
    virtualTxCount: number;
}

export interface ArkLayerInput {
    nowSec: number;
    windowSec: number;
    /** Pan offset in seconds: the window's right edge sits at nowSec - panSec. */
    panSec?: number;
    lane?: "all" | "arkade" | "second";
    blocks?: ArkBlock[];
    commitments?: ArkCommitment[];
    events?: ArkEvent[];
    secondTxs?: ArkSecondTx[];
    hourly?: ArkHourlyBucket[];
    /** True when trend data exists but no bucket had a parseable timezone. */
    hourlyUnavailable?: boolean;
    /** Next Second round (unix s) for the ghost marker. */
    nextRoundAt?: number | null;
}

export interface ArkLayerOptions {
    windowSec: number;
    panSec: number;
    lane: "all" | "arkade" | "second";
    width: number;
    gutter: number;
    padRight: number;
    laneArkY: number;
    laneCommitY: number;
    laneSecY: number;
    railY: number;
    height: number;
    nowSec: number;
}

export const ARK_LAYER_DEFAULTS: ArkLayerOptions = {
    width: 1240,
    gutter: 150,
    padRight: 18,
    laneArkY: 106,
    laneCommitY: 198,
    laneSecY: 284,
    railY: 356,
    height: 410,
    windowSec: 24 * 3600,
    panSec: 0,
    lane: "all",
    nowSec: 0,
};

export interface ArkRailItem {
    height: number;
    /** Position on the shared time axis. */
    time: number;
    /** X coordinate on the plot, assigned after rail sort. */
    x: number;
    /** True when `time` is an observed block timestamp; false when estimated. */
    known: boolean;
    txCount?: number;
    size?: number;
    /** First commitment txid anchored at this height, when any. */
    commitTxid?: string;
    /** First Second tx anchored at this height, when any. */
    secondTxid?: string;
    /**
     * True when no sampled block covers this height — `time` is interpolated
     * from neighbouring block times × median interval, not observed.
     */
    estimated?: boolean;
}

export interface PlacedArkEvent {
    id: string;
    txid: string;
    kind: ArkEventKind;
    x: number;
    y: number;
    radius: number;
    amountSat: number | null;
    /** What amountSat counts (e.g. "VTXO value", "New VTXO outputs"). */
    amountLabel?: string;
    recordId: string;
    recordIds: string[];
    commitmentId: string | null;
    statusLabel: string;
    needsReview: boolean;
    state: ArkEventState;
    live: boolean;
    /** Provenance label from the primary record. */
    sourceLabel?: string;
    /** Event time (unix s) for tooltips. */
    time: number;
    vtxoCount: number;
    /** Relationship keys for hover highlighting. */
    rels: string[];
}

export interface PlacedArkCommitment {
    txid: string;
    x: number;
    y: number;
    /** True while the commitment has no block yet: hollow diamond + right stub. */
    awaitingBlock: boolean;
    amountSat: number | null;
    vtxoCount: number | null;
    recordId: string;
    /** Anchor time used for placement (block time or creation fallback). */
    time: number;
    /**
     * True when `time` came from interpolating an unsampled block height —
     * an estimate, not an observed block timestamp.
     */
    anchorEstimated: boolean;
    rels: string[];
}

export interface PlacedSecondTx {
    id: string;
    txid: string;
    x: number;
    y: number;
    blockHeight: number | null;
    direction: "to_server" | "from_server" | "other";
    amountSat: number | null;
    recordId: string;
    statusLabel: string;
    /** Event time (unix s) for tooltips. */
    time: number;
    rels: string[];
}

export interface PlacedStub {
    /** Commitment anchor time, seconds. */
    anchorTime: number;
    inWindow: boolean;
    /** -1 anchor is left of the event, +1 right. */
    dir: -1 | 1;
    /** Whole days between event and anchor (rounded up, min 1). */
    days: number;
    rels: string[];
    /** Assigned label row: 0 above the Arkade lane, 1 in the gap above commitments. */
    row: 0 | 1;
    /** Label x in canvas units. */
    x: number;
    text: string;
}

export interface ArkAxisTick {
    x: number;
    /** Seconds timestamp of the tick. */
    time: number;
    label: string;
}

export interface ArkLayerLayout {
    width: number;
    height: number;
    gutter: number;
    plotLeft: number;
    plotRight: number;
    plotWidth: number;
    /** Seconds per canvas unit — used to translate drag pixels into pan seconds. */
    unitW: number;
    laneArkY: number;
    laneCommitY: number;
    laneSecY: number;
    railY: number;
    /** Window edges on the time axis. */
    tStart: number;
    tEnd: number;
    nowX: number;
    nextRound: { x: number; time: number } | null;
    ticks: ArkAxisTick[];
    rail: ArkRailItem[];
    events: PlacedArkEvent[];
    commitments: PlacedArkCommitment[];
    secondTxs: PlacedSecondTx[];
    stubs: PlacedStub[];
    /** SVG path `d` for the hourly step-area band, or null when empty. */
    hourlyPath: string | null;
    /** True when trend data exists but no bucket had a parseable timezone. */
    hourlyUnavailable: boolean;
    counts: { rail: number; arkEvents: number; secondTxs: number };
    /** "2026-10-19 → 2026-10-20 · N rail ticks · M ark txs · K second txs" */
    coverage: string;
}

const DAY = 86400;
const HOUR = 3600;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Node radius: sqrt-scaled by amount against the window's largest event. */
export function arkNodeRadius(amountSat: number | null, maxAmount: number): number {
    if (amountSat === null || amountSat <= 0 || maxAmount <= 0) return 3.5;
    return clamp(3.5 + 7 * Math.sqrt(amountSat / maxAmount), 3.5, 10.5);
}

/** Minimum horizontal gap before Arkade-lane nodes stack, by window size. */
export function arkMinGapPx(windowSec: number): number {
    if (windowSec <= 6 * HOUR) return 30;
    if (windowSec <= DAY) return 22;
    return 14;
}

/** Relationship keys shared by a record, its tx and its commitment anchor. */
export function recordRels(recordId: string, txid: string, commitmentId?: string | null): string[] {
    const rels = [`rec:${recordId}`, `tx:${txid}`];
    if (commitmentId) rels.push(`cm:${commitmentId}`);
    return rels;
}

function medianBlockInterval(blocks: ArkBlock[]): number | null {
    const times = blocks.map((block) => block.time).sort((a, b) => a - b);
    if (times.length < 2) return null;
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
    intervals.sort((a, b) => a - b);
    return intervals[Math.floor(intervals.length / 2)] ?? null;
}

/**
 * Estimate a block's time from its height: nearest sampled block plus
 * height delta × median interval. Null when nothing anchors the estimate.
 */
export function timeForHeight(
    height: number,
    sampled: ReadonlyArray<{ height: number; time: number }>,
    medianInterval: number | null,
): number | null {
    for (const block of sampled) {
        if (block.height === height) return block.time;
    }
    if (sampled.length === 0 || medianInterval === null) return null;
    let nearest = sampled[0];
    let distance = Math.abs(nearest.height - height);
    for (const block of sampled) {
        const d = Math.abs(block.height - height);
        if (d < distance) {
            distance = d;
            nearest = block;
        }
    }
    return nearest.time + (height - nearest.height) * medianInterval;
}

/** "anchored <9d" / "anchored 12d" — the commitment anchor's age vs the window edge. */
export function formatStubAnchor(anchorTime: number, edgeTime: number, inWindow: boolean): string {
    const days = Math.max(1, Math.round(Math.abs(anchorTime - edgeTime) / DAY));
    if (inWindow) return "in win";
    const prefix = anchorTime < edgeTime ? "<" : ">";
    return `anchored ${prefix}${days}d`;
}

function formatAxisLabel(time: number, windowSec: number): string {
    const date = new Date(time * 1000);
    if (windowSec <= DAY) {
        return new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "UTC",
        }).format(date);
    }
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Axis tick count per window, mirroring the prototype (12 / 24 / 28). */
function axisTickCount(windowSec: number): number {
    if (windowSec <= 6 * HOUR) return 12;
    if (windowSec <= DAY) return 24;
    return 28;
}

/**
 * Stack one lane's items left-to-right: an item closer than `minGap` to the
 * previous x moves down one row (capped), else returns to the lane baseline.
 * `lastX` deliberately persists across resets, as in the prototype.
 */
export function stackLane<T extends { x: number }>(
    items: T[],
    laneY: number,
    minGap: number,
    maxStack: number,
    step: number,
): Array<T & { y: number; stack: number }> {
    const sorted = [...items].sort((a, b) => a.x - b.x);
    let lastX = -Infinity;
    let stack = 0;
    return sorted.map((item) => {
        if (item.x - lastX < minGap) {
            stack = Math.min(stack + 1, maxStack);
        } else {
            stack = 0;
        }
        lastX = item.x;
        return { ...item, y: laneY + stack * step, stack };
    });
}

/**
 * Place stub labels in two fixed rows (above the Arkade lane, above the
 * commitment lane), de-colliding by x within a row. Labels that fit neither
 * row are dropped — the stub arrow and tooltip still carry the meaning.
 */
export function placeStubLabels(
    stubs: Array<{ x: number; anchorTime: number; inWindow: boolean; dir: -1 | 1; rels: string[] }>,
    edgeTime: number,
): PlacedStub[] {
    const sorted = [...stubs].sort((a, b) => a.x - b.x);
    const rowX: [number[], number[]] = [[], []];
    const placed: PlacedStub[] = [];
    for (const stub of sorted) {
        const days = Math.max(1, Math.round(Math.abs(stub.anchorTime - edgeTime) / DAY));
        const text = formatStubAnchor(stub.anchorTime, edgeTime, stub.inWindow);
        const fits = (row: 0 | 1) => !rowX[row].some((px) => Math.abs(px - stub.x) < 34);
        let row: 0 | 1 = 0;
        if (!fits(0)) row = 1;
        if (!fits(row)) continue;
        rowX[row].push(stub.x);
        placed.push({
            anchorTime: stub.anchorTime,
            inWindow: stub.inWindow,
            dir: stub.dir,
            days,
            rels: stub.rels,
            row,
            x: stub.x,
            text,
        });
    }
    return placed;
}

/** Height labels on the block rail: greedily spaced, never crowding the now edge. */
export function placeRailLabels(
    items: Array<{ x: number; height: number }>,
    plotRight: number,
    labelWidth: number,
): Map<number, number> {
    const placed = new Map<number, number>();
    let lastLabelX = -Infinity;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const isLast = i === items.length - 1;
        const fits =
            item.x - lastLabelX >= labelWidth ||
            (isLast && item.x - lastLabelX >= labelWidth * 0.55);
        if (item.x < plotRight - 24 && fits) {
            placed.set(item.height, item.x);
            lastLabelX = item.x;
        }
    }
    return placed;
}

/** Step-area path for the hourly band; gaps between active hours stay gaps. */
export function hourlyAreaPath(
    buckets: ArkHourlyBucket[],
    xOf: (time: number) => number,
    bandBase: number,
    bandHeight: number,
    plotLeft: number,
    plotRight: number,
): string | null {
    const active = buckets.filter((bucket) => bucket.virtualTxCount > 0);
    if (active.length === 0) return null;
    const maxCount = Math.max(...active.map((bucket) => bucket.virtualTxCount), 1);
    let d = "";
    let open = false;
    let pendingX = 0;
    let lastStart = -Infinity;
    for (const bucket of buckets) {
        const x0 = Math.max(xOf(bucket.hourStart), plotLeft);
        const x1 = Math.min(xOf(bucket.hourStart + HOUR), plotRight);
        if (x1 <= x0) continue;
        const contiguous = open && bucket.hourStart - lastStart <= HOUR + 1;
        if (bucket.virtualTxCount <= 0 || !contiguous) {
            if (open) {
                d += ` L${pendingX.toFixed(1)} ${bandBase} Z`;
                open = false;
            }
        }
        if (bucket.virtualTxCount <= 0) continue;
        const yTop = bandBase - (bucket.virtualTxCount / maxCount) * bandHeight;
        if (!open) {
            d += `M${x0.toFixed(1)} ${bandBase} L${x0.toFixed(1)} ${yTop.toFixed(1)}`;
            open = true;
        } else {
            d += ` L${x0.toFixed(1)} ${yTop.toFixed(1)}`;
        }
        d += ` L${x1.toFixed(1)} ${yTop.toFixed(1)}`;
        pendingX = x1;
        lastStart = bucket.hourStart;
    }
    if (open) d += ` L${pendingX.toFixed(1)} ${bandBase} Z`;
    return d === "" ? null : d;
}

/**
 * Resolve the next-round display time. `NextRoundTime` is the server's
 * authoritative scheduled start; a past value means the announced round has
 * already started (or was skipped) — it is NOT rolled forward with an assumed
 * interval, because servers can delay or skip rounds (the interval is config,
 * not a cron guarantee). Returns the value only while it is still in the
 * future; null otherwise so callers render "schedule stale" instead of a
 * fabricated time.
 */
export function nextRoundTime(
    nextRoundAt: number | null | undefined,
    nowSec: number,
): number | null {
    if (nextRoundAt === null || nextRoundAt === undefined || !Number.isFinite(nextRoundAt)) {
        return null;
    }
    // Past or present: the announced round is already underway/over. Rolling
    // it forward by the interval invents precision the server never gave.
    if (nextRoundAt <= nowSec) return null;
    return nextRoundAt;
}

/**
 * Compute the full canvas layout. Deterministic: same input, same output.
 */
export function computeArkLayer(
    input: ArkLayerInput,
    options: Partial<ArkLayerOptions> = {},
): ArkLayerLayout {
    const opts: ArkLayerOptions = { ...ARK_LAYER_DEFAULTS, ...options, nowSec: input.nowSec };
    const win = input.windowSec > 0 ? input.windowSec : opts.windowSec;
    const pan = input.panSec ?? opts.panSec;
    const lane = input.lane ?? opts.lane;
    const plotLeft = opts.gutter + 12;
    const plotRight = opts.width - opts.padRight;
    const plotWidth = plotRight - plotLeft;

    const tEnd = input.nowSec - pan;
    const tStart = tEnd - win;
    const unitW = plotWidth / win;
    const xOf = (time: number) => plotLeft + ((time - tStart) / win) * plotWidth;

    const showArkade = lane !== "second";
    const showSecond = lane !== "arkade";

    const sampledBlocks = (input.blocks ?? []).filter(
        (block) => Number.isFinite(block.height) && Number.isFinite(block.time),
    );
    const medianInterval = medianBlockInterval(sampledBlocks);

    // Commitment anchor times: known block time first, height estimate second.
    const commitmentAnchorTimes = new Map<string, number>();
    for (const commitment of input.commitments ?? []) {
        let at: number | null = commitment.blockTimeSeconds;
        if (at === null && commitment.blockHeight !== null) {
            at = timeForHeight(commitment.blockHeight, sampledBlocks, medianInterval);
        }
        if (at !== null) commitmentAnchorTimes.set(commitment.txid, at);
    }

    const timeForBlockHeight = (height: number): number | null =>
        timeForHeight(height, sampledBlocks, medianInterval);

    // ---- rail items -------------------------------------------------------
    const inWindow = (time: number | null): time is number =>
        time !== null && time >= tStart && time <= tEnd;

    const railByHeight = new Map<number, ArkRailItem>();
    if (showArkade || showSecond) {
        for (const block of sampledBlocks) {
            if (!inWindow(block.time)) continue;
            railByHeight.set(block.height, {
                height: block.height,
                time: block.time,
                x: 0,
                known: true,
                txCount: block.txCount,
                size: block.size,
            });
        }
        for (const commitment of input.commitments ?? []) {
            if (!showArkade || commitment.blockHeight === null) continue;
            const at = commitmentAnchorTimes.get(commitment.txid);
            if (!inWindow(at ?? null)) continue;
            const existing = railByHeight.get(commitment.blockHeight);
            if (existing) {
                existing.commitTxid = existing.commitTxid ?? commitment.txid;
            } else {
                railByHeight.set(commitment.blockHeight, {
                    height: commitment.blockHeight,
                    time: at ?? 0,
                    x: 0,
                    known: sampledBlocks.some((b) => b.height === commitment.blockHeight),
                    estimated: true,
                    commitTxid: commitment.txid,
                });
            }
        }
        for (const tx of input.secondTxs ?? []) {
            if (!showSecond || tx.blockHeight === null) continue;
            const bt = timeForBlockHeight(tx.blockHeight);
            const t = bt ?? null;
            if (!inWindow(t)) continue;
            const existing = railByHeight.get(tx.blockHeight);
            if (existing) {
                existing.secondTxid = existing.secondTxid ?? tx.txid;
                // An observed block time beats an interpolated estimate.
                if (!existing.known && sampledBlocks.some((b) => b.height === tx.blockHeight)) {
                    existing.time = t;
                    existing.known = true;
                }
            } else {
                railByHeight.set(tx.blockHeight, {
                    height: tx.blockHeight,
                    time: t,
                    x: 0,
                    known: sampledBlocks.some((b) => b.height === tx.blockHeight),
                    estimated: !sampledBlocks.some((b) => b.height === tx.blockHeight),
                    secondTxid: tx.txid,
                });
            }
        }
    }
    // Interpolated heights for Second txs whose block is outside the sample but
    // whose own block time is known (mempool txs report block_time).
    for (const tx of input.secondTxs ?? []) {
        if (!showSecond || tx.blockHeight === null) continue;
        if (railByHeight.has(tx.blockHeight)) continue;
        if (!inWindow(tx.time)) continue;
        railByHeight.set(tx.blockHeight, {
            height: tx.blockHeight,
            time: tx.time,
            x: 0,
            known: false,
            estimated: true,
            secondTxid: tx.txid,
        });
    }
    const rail = [...railByHeight.values()].sort((a, b) => a.time - b.time);
    for (const item of rail) item.x = xOf(item.time);

    // ---- Arkade virtual events ---------------------------------------------
    const maxAmount = Math.max(1, ...(input.events ?? []).map((event) => event.amountSat ?? 0));
    const placedEvents: PlacedArkEvent[] = [];
    if (showArkade) {
        const minGap = arkMinGapPx(win);
        const candidates = (input.events ?? [])
            .filter((event) => inWindow(event.time))
            .map((event) => ({
                ...event,
                x: xOf(event.time),
                radius: arkNodeRadius(event.amountSat, maxAmount),
            }));
        const stacked = stackLane(candidates, opts.laneArkY, minGap, 3, 15);
        for (const item of stacked) {
            placedEvents.push({
                id: item.id,
                txid: item.txid,
                kind: item.kind,
                x: item.x,
                y: item.y,
                radius: item.radius,
                amountSat: item.amountSat,
                amountLabel: item.amountLabel,
                recordId: item.recordId,
                recordIds: item.recordIds,
                commitmentId: item.commitmentId,
                statusLabel: item.statusLabel,
                needsReview: item.needsReview,
                state: item.state,
                live: item.live,
                sourceLabel: item.sourceLabel,
                time: item.time,
                vtxoCount: item.vtxoCount,
                rels: [
                    ...item.recordIds.map((id) => `rec:${id}`),
                    `tx:${item.txid}`,
                    ...(item.commitmentId ? [`cm:${item.commitmentId}`] : []),
                ],
            });
        }
    }

    // ---- Commitments ---------------------------------------------------------
    const placedCommitments: PlacedArkCommitment[] = [];
    const commitmentX = new Map<string, { x: number; y: number }>();
    if (showArkade) {
        for (const commitment of input.commitments ?? []) {
            // Anchor position: the block's time on the shared axis. Unconfirmed
            // commitments ("awaiting block") sit at their creation time instead.
            let anchorTime: number | null = null;
            let anchorEstimated = false;
            if (!commitment.awaitingBlock && commitment.blockHeight !== null) {
                anchorTime = commitmentAnchorTimes.get(commitment.txid) ?? null;
                // The anchor is an estimate only when no observed block time or
                // height match backed it — i.e. it came from interpolation.
                anchorEstimated =
                    commitment.blockTimeSeconds === null &&
                    anchorTime !== null &&
                    !sampledBlocks.some((b) => b.height === commitment.blockHeight);
            }
            if (anchorTime === null) anchorTime = commitment.createdAtSeconds;
            if (!inWindow(anchorTime)) continue;
            const x = xOf(anchorTime);
            placedCommitments.push({
                txid: commitment.txid,
                x,
                y: opts.laneCommitY,
                awaitingBlock: commitment.awaitingBlock || commitment.blockHeight === null,
                amountSat: commitment.amountSat,
                vtxoCount: commitment.vtxoCount,
                recordId: commitment.recordId,
                time: anchorTime,
                anchorEstimated,
                rels: [`cm:${commitment.txid}`, `rec:${commitment.recordId}`],
            });
            commitmentX.set(commitment.txid, { x, y: opts.laneCommitY });
        }
    }

    // ---- Threads and stubs ----------------------------------------------------
    const stubCandidates: Array<{
        x: number;
        anchorTime: number;
        inWindow: boolean;
        dir: -1 | 1;
        rels: string[];
    }> = [];
    const plotLeftEdge = plotLeft;
    const plotRightEdge = plotRight;
    for (const event of placedEvents) {
        if (!event.commitmentId) continue;
        const cp = commitmentX.get(event.commitmentId);
        if (cp) continue; // full thread drawn in the component from positions
        const commitment = (input.commitments ?? []).find((c) => c.txid === event.commitmentId);
        if (!commitment) continue;
        const anchorTime =
            commitmentAnchorTimes.get(commitment.txid) ??
            (commitment.blockHeight !== null ? timeForBlockHeight(commitment.blockHeight) : null) ??
            commitment.createdAtSeconds;
        if (anchorTime === null) continue;
        const ax = xOf(anchorTime);
        const inWin = ax >= plotLeftEdge && ax <= plotRightEdge;
        const dir: -1 | 1 = !inWin ? (ax < plotLeftEdge ? -1 : 1) : ax < event.x ? -1 : 1;
        stubCandidates.push({
            // Label sits at the stub's midpoint: node edge → +30 px stub.
            x: event.x + dir * (event.radius + 4 + 15),
            anchorTime,
            inWindow: inWin,
            dir,
            rels: event.rels,
        });
    }
    const stubs = placeStubLabels(stubCandidates, tEnd);

    // ---- Second lane ------------------------------------------------------------
    const placedSecond: PlacedSecondTx[] = [];
    if (showSecond) {
        const candidates = (input.secondTxs ?? [])
            .filter((tx) => inWindow(tx.time))
            .map((tx) => {
                const bt = tx.blockHeight !== null ? timeForBlockHeight(tx.blockHeight) : null;
                return {
                    id: tx.id,
                    txid: tx.txid,
                    x: xOf(bt ?? tx.time),
                    y: opts.laneSecY,
                    blockHeight: tx.blockHeight,
                    direction: tx.direction,
                    amountSat: tx.amountSat,
                    recordId: tx.recordId,
                    statusLabel: tx.statusLabel,
                    time: tx.time,
                    rels: [`rec:${tx.recordId}`, `tx:${tx.txid}`],
                };
            });
        placedSecond.push(...stackLane(candidates, opts.laneSecY, 24, 2, 14));
    }

    // ---- Axis ticks ---------------------------------------------------------------
    const tickTotal = axisTickCount(win);
    const ticks: ArkAxisTick[] = [];
    for (let i = 0; i <= tickTotal; i++) {
        const t = tStart + (win * i) / tickTotal;
        const x = xOf(t);
        if (x < plotLeft - 2 || x > plotRight + 2) continue;
        ticks.push({ x, time: t, label: formatAxisLabel(t, win) });
    }

    // ---- Hourly band -----------------------------------------------------------------
    const bandBase = opts.laneArkY + 58;
    const bandHeight = 22;
    const hourlyPath = showArkade
        ? hourlyAreaPath(input.hourly ?? [], xOf, bandBase, bandHeight, plotLeft, plotRight)
        : null;

    // ---- Now edge + next-round ghost ---------------------------------------------------
    const nowX = xOf(input.nowSec);
    const nextRoundAt = nextRoundTime(input.nextRoundAt, input.nowSec);
    const nextRound =
        nextRoundAt !== null && nextRoundAt > tStart && nextRoundAt < tEnd && showSecond
            ? { x: xOf(nextRoundAt), time: nextRoundAt }
            : null;

    // ---- Coverage meta ------------------------------------------------------------------
    // Counts describe only what is visible in this window — never claim these
    // are network-wide totals. "rail ticks" is the sampled block count.
    const fmtDay = (t: number) => {
        const d = new Date(t * 1000);
        return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    };
    const coverage = `${fmtDay(tStart)} → ${fmtDay(tEnd)} · ${rail.length} sampled blocks · ${placedEvents.length} Arkade txs · ${placedCommitments.length} commitments · ${placedSecond.length} Second txs`;

    return {
        width: opts.width,
        height: opts.height,
        gutter: opts.gutter,
        plotLeft,
        plotRight,
        plotWidth,
        unitW,
        laneArkY: opts.laneArkY,
        laneCommitY: opts.laneCommitY,
        laneSecY: opts.laneSecY,
        railY: opts.railY,
        tStart,
        tEnd,
        nowX,
        nextRound,
        ticks,
        rail,
        events: placedEvents,
        commitments: placedCommitments,
        secondTxs: placedSecond,
        stubs,
        hourlyPath,
        hourlyUnavailable: input.hourlyUnavailable ?? false,
        counts: {
            rail: rail.length,
            arkEvents: placedEvents.length,
            secondTxs: placedSecond.length,
        },
        coverage,
    };
}
