import type { VirtualCoin } from "@arkade-os/sdk";

/**
 * What the "expiry" slot of a VTXO should convey.
 * - `settled`: consumed by an on-chain commitment round (`settledBy`).
 * - `spent`: spent off-chain (no settle commitment).
 * - `active`: still live; the batch-expiry countdown applies.
 */
export type ExpiryKind = "settled" | "spent" | "active";

type ExpiryKindInput = Pick<VirtualCoin, "isSpent" | "spentBy" | "settledBy">;

/**
 * Decide what a VTXO's expiry slot should show.
 *
 * `settled` takes precedence over `spent`: a forfeited VTXO is both spent and
 * settled, but the meaningful terminal state is that it settled into a
 * commitment. The batch-expiry countdown is only relevant while `active`.
 */
export function deriveExpiryKind(vtxo: ExpiryKindInput): ExpiryKind {
    if (vtxo.settledBy && vtxo.settledBy !== "") return "settled";
    const spent = vtxo.isSpent === true || !!vtxo.spentBy;
    if (spent) return "spent";
    return "active";
}

/**
 * Label for a terminal expiry kind, or `null` for `active` (the caller should
 * render the live batch-expiry countdown instead). A VTXO consumed by a
 * commitment is "Spent in batch": "Settled" names an unspent VTXO finalized in
 * a batch (the indexer's `settled` state). `"unrolled"` only appears in
 * tx-level aggregates (`TxAggregate.aggregateKind`), never from
 * `deriveExpiryKind`.
 */
export function expiryKindLabel(kind: ExpiryKind | "unrolled"): string | null {
    switch (kind) {
        case "settled":
            return "Spent in batch";
        case "spent":
            return "Spent";
        case "unrolled":
            return "Exit started";
        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// Expiry monitoring (ark.observer additions)
// ---------------------------------------------------------------------------

/** Average Bitcoin block interval used to convert between blocks and wall-clock time. */
export const AVG_BLOCK_SECONDS = 600;

/**
 * arkd `/v1/info` + SDK `delayToTimelock` wire convention for relative
 * timelocks: values below 512 are a block count, values at or above 512 are
 * seconds. This is NOT BIP68 itself — BIP68 encodes the type in nSequence
 * bit 22 and permits block counts >= 512; the 512 split is how arkd chooses
 * between the two BIP68 encodings on the wire.
 * Verified against `@arkade-os/sdk` `delayToTimelock`/`timelockToSequence`
 * and live `/v1/info` (605184 s and 7776256 s, both exact multiples of 512).
 */
export const TIMELOCK_SECONDS_THRESHOLD = 512n;

/**
 * The SDK's `parseWireExpiry` uses this floor to distinguish raw indexer
 * timestamps from block heights after converting seconds to milliseconds.
 */
export const EXPIRY_MIN_PLAUSIBLE_MS = Date.UTC(2025, 0, 1);

export type RelativeTimelock = { type: "blocks" | "seconds"; value: number };

/**
 * Interpret a relative timelock value (e.g. `unilateralExitDelay`) from `/v1/info`.
 * Zero is valid: SDK `delayToTimelock(0n)` yields `{type:"blocks", value:0}` and
 * `bip68.encode({blocks:0})` → nSequence 0 (BIP68 permits a zero relative
 * locktime = no delay). Only negative values are malformed.
 */
export function parseRelativeTimelock(raw: bigint | number | string): RelativeTimelock {
    const v = BigInt(raw);
    if (v < 0n) throw new Error(`negative timelock: ${v}`);
    return v < TIMELOCK_SECONDS_THRESHOLD
        ? { type: "blocks", value: Number(v) }
        : { type: "seconds", value: Number(v) };
}

/** A relative timelock expressed as both seconds and (estimated) blocks. */
export function timelockToSecondsAndBlocks(t: RelativeTimelock): {
    seconds: number;
    blocks: number;
} {
    if (t.type === "blocks") return { seconds: t.value * AVG_BLOCK_SECONDS, blocks: t.value };
    return { seconds: t.value, blocks: Math.ceil(t.value / AVG_BLOCK_SECONDS) };
}

type ExpiryInput = ExpiryKindInput & {
    /** Canonical wall-clock expiry; JSON round-trips may hand back a string/number. */
    expiresAt?: Date | string | number;
    expiresAtHeight?: number;
    isUnrolled?: boolean;
};

/**
 * Time left until the VTXO's batch expires.
 * - `seconds`: estimated wall-clock seconds left (negative once expired).
 * - `blocks`: blocks left (exact for height-based expiry, estimated otherwise).
 * - `source`: whether the server expressed expiry as a timestamp or a height.
 * Returns `null` when the VTXO carries no expiry, or when expiry is height-based
 * and no chain tip is known.
 */
export type RemainingLifetime = {
    seconds: number;
    blocks: number;
    source: "time" | "height";
    expiresAtMs: number;
};

export function remainingLifetime(
    vtxo: ExpiryInput,
    nowMs: number,
    tipHeight?: number | null,
): RemainingLifetime | null {
    if (vtxo.expiresAtHeight !== undefined && vtxo.expiresAtHeight !== null) {
        if (tipHeight === undefined || tipHeight === null) return null;
        const blocks = vtxo.expiresAtHeight - tipHeight;
        const seconds = blocks * AVG_BLOCK_SECONDS;
        return { seconds, blocks, source: "height", expiresAtMs: nowMs + seconds * 1000 };
    }
    const expiresAtRaw = vtxo.expiresAt;
    let expiresAtMs: number | null = null;
    if (expiresAtRaw instanceof Date) {
        const ms = expiresAtRaw.getTime();
        if (!isNaN(ms)) expiresAtMs = ms;
    } else if (typeof expiresAtRaw === "number") {
        // Wire sends unix seconds; ms-scale values pass through.
        expiresAtMs = expiresAtRaw > 1e12 ? expiresAtRaw : expiresAtRaw * 1000;
    } else if (typeof expiresAtRaw === "string" && expiresAtRaw !== "") {
        expiresAtMs = /^\d+$/.test(expiresAtRaw)
            ? Number(expiresAtRaw) * 1000
            : new Date(expiresAtRaw).getTime();
        if (isNaN(expiresAtMs)) expiresAtMs = null;
    }
    if (expiresAtMs === null) return null;
    const seconds = Math.floor((expiresAtMs - nowMs) / 1000);
    const blocks =
        seconds > 0
            ? Math.ceil(seconds / AVG_BLOCK_SECONDS)
            : Math.floor(seconds / AVG_BLOCK_SECONDS);
    return { seconds, blocks, source: "time", expiresAtMs };
}

/**
 * Urgency of an active VTXO.
 * - `expired`: the batch expiry has passed; the operator may sweep it.
 * - `urgent`: remaining lifetime is at or below the unilateral exit delay.
 *   This is a heuristic, not a guarantee: the exit delay is the CSV wait on the
 *   exit path, and a real unilateral exit also needs one confirmation per
 *   exit-depth hop plus fees — deep VTXOs can need materially longer. Treat
 *   `urgent` as "renew or exit soon", never as a hard deadline.
 * - `ok`: more lifetime left than the exit delay.
 * - `unknown`: no expiry information, or no exit delay known yet.
 */
export type ExpiryUrgency = "expired" | "urgent" | "ok" | "unknown";

export function deriveExpiryUrgency(
    remaining: RemainingLifetime | null,
    unilateralExitDelay: RelativeTimelock | null,
): ExpiryUrgency {
    if (!remaining) return "unknown";
    if (remaining.seconds <= 0) return "expired";
    if (!unilateralExitDelay) return "unknown";
    const delay = timelockToSecondsAndBlocks(unilateralExitDelay);
    if (unilateralExitDelay.type === "blocks" && remaining.source === "height") {
        return remaining.blocks <= delay.blocks ? "urgent" : "ok";
    }
    return remaining.seconds <= delay.seconds ? "urgent" : "ok";
}

/** Compact duration like "6d 23h", "4h 12m", "9m". Negative/zero → "0m". */
export function formatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/** Human description of a relative timelock, e.g. "605184 s (~7d 0h, ~1009 blocks)". */
export function describeTimelock(t: RelativeTimelock): string {
    const { seconds, blocks } = timelockToSecondsAndBlocks(t);
    if (t.type === "blocks") return `${t.value} blocks (~${formatDuration(seconds)})`;
    return `${t.value} s (~${formatDuration(seconds)}, ~${blocks.toLocaleString("en-US")} blocks)`;
}
