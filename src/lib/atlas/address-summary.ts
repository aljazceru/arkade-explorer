import type { VirtualCoin } from "@arkade-os/sdk";
import { atlasVtxoState, type AtlasVtxoContext, type AtlasVtxoState } from "@/lib/atlas/vtxo-state";
import { isTerminalState } from "@/lib/atlas/address-cluster";

/**
 * Address-level facts derived from the full VTXO set: unspent breakdown,
 * received total, per-state counts and the nearest expiry. Pure — the page
 * feeds it `atlasVtxoState` context and it returns display-ready numbers.
 */

export type UnspentBucket =
    | "healthy" // settled or preconfirmed, outside the exit window
    | "exitWindow" // renew — inside the exit window
    | "expired" // past batch expiry, recoverable
    | "swept" // operator swept; recoverable
    | "unknown"; // no usable expiry evidence — never counted as safe

export interface AddressSummary {
    totalVtxos: number;
    /** Sum of sat value across every VTXO (received). */
    receivedSats: number;
    /** Sum across unspent (non-terminal) VTXOs. */
    unspentSats: number;
    /** Count of unspent (non-terminal) VTXOs. */
    unspentCount: number;
    spentCount: number;
    /** VTXOs whose unilateral exit was broadcast on-chain — funds left the batch. */
    unrolledCount: number;
    unrolledSats: number;
    /** Breakdown of the unspent set by urgency bucket. */
    buckets: Record<UnspentBucket, { count: number; sats: number }>;
    /** Count of VTXOs per Atlas state (all VTXOs). */
    stateCounts: Record<AtlasVtxoState, number>;
    /** Earliest batch expiry among live VTXOs, unix ms, or null. */
    nearestExpiryMs: number | null;
    /** VTXOs needing action: in the exit window or expired. */
    needsAction: { count: number; sats: number; nearestExpiryMs: number | null };
}

const STATES: AtlasVtxoState[] = [
    "renew",
    "expired",
    "unknown",
    "preconfirmed",
    "settled",
    "swept",
    "unfinalized",
    "spent",
    "spent-in-batch",
    "unrolled",
];

function emptyBuckets(): Record<UnspentBucket, { count: number; sats: number }> {
    return {
        healthy: { count: 0, sats: 0 },
        exitWindow: { count: 0, sats: 0 },
        expired: { count: 0, sats: 0 },
        swept: { count: 0, sats: 0 },
        unknown: { count: 0, sats: 0 },
    };
}

function bucketFor(state: AtlasVtxoState): UnspentBucket | null {
    switch (state) {
        case "settled":
        case "preconfirmed":
            return "healthy";
        case "renew":
            return "exitWindow";
        case "expired":
            return "expired";
        case "swept":
            return "swept";
        case "unknown":
            return "unknown";
        default:
            // spent / spent-in-batch / unfinalized / unrolled are not "unspent balance"
            return null;
    }
}

/**
 * Summarise a full VTXO set for the address facts panel.
 * `ctx` is the same context `atlasVtxoState` needs (now, exit delay, tip,
 * pending outpoints).
 */
export function summarizeAddress(vtxos: VirtualCoin[], ctx: AtlasVtxoContext): AddressSummary {
    const stateCounts = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<
        AtlasVtxoState,
        number
    >;
    const buckets = emptyBuckets();
    let receivedSats = 0;
    let unspentSats = 0;
    let unspentCount = 0;
    let spentCount = 0;
    let unrolledCount = 0;
    let unrolledSats = 0;
    let nearestExpiryMs: number | null = null;
    let needsCount = 0;
    let needsSats = 0;
    let needsNearest: number | null = null;

    for (const vtxo of vtxos) {
        const sats = Number(vtxo.value) || 0;
        receivedSats += sats;
        const view = atlasVtxoState(vtxo, ctx);
        stateCounts[view.state] += 1;

        // Unrolled exits already moved funds on-chain: disclosed separately,
        // not counted as spent or unspent batch balance.
        if (view.state === "unrolled") {
            unrolledCount += 1;
            unrolledSats += sats;
            continue;
        }
        if (isTerminalState(view.state) || view.state === "unfinalized") {
            spentCount += 1;
            continue;
        }

        unspentCount += 1;
        unspentSats += sats;
        const bucket = bucketFor(view.state);
        if (bucket) {
            buckets[bucket].count += 1;
            buckets[bucket].sats += sats;
        }
        // Nearest expiry across live VTXOs with known expiry.
        if (view.remaining) {
            const expMs = view.remaining.expiresAtMs;
            if (nearestExpiryMs === null || expMs < nearestExpiryMs) nearestExpiryMs = expMs;
        }

        if (view.state === "renew" || view.state === "expired") {
            needsCount += 1;
            needsSats += sats;
            if (view.remaining) {
                const expMs = view.remaining.expiresAtMs;
                if (needsNearest === null || expMs < needsNearest) needsNearest = expMs;
            }
        }
    }

    return {
        totalVtxos: vtxos.length,
        receivedSats,
        unspentSats,
        unspentCount,
        spentCount,
        unrolledCount,
        unrolledSats,
        buckets,
        stateCounts,
        nearestExpiryMs,
        needsAction: { count: needsCount, sats: needsSats, nearestExpiryMs: needsNearest },
    };
}

/** Rank used to sort the VTXO table: needs-action first, then by expiry. */
export function urgencyRank(state: AtlasVtxoState): number {
    switch (state) {
        case "expired":
            return 0;
        case "renew":
            return 1;
        case "unknown":
            return 2;
        case "preconfirmed":
            return 3;
        case "settled":
            return 4;
        case "swept":
            return 5;
        case "unfinalized":
            return 6;
        case "spent":
            return 7;
        case "spent-in-batch":
            return 8;
        case "unrolled":
            return 9;
    }
}
