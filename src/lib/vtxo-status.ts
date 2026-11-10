import { remainingLifetime } from "@/lib/vtxo-display";

/** Spend status of a VTXO as the UI reports it. */
export type SpentStatus = "spendable" | "spent" | "unfinalized";

/**
 * Derive spent/unspent status from VTXO fields.
 * Swept VTXOs can still be spent or unspent independently.
 *
 * When `pendingOutpoints` is provided, a spent VTXO whose outpoint is in that set
 * (the indexer's `pendingOnly` view) is reported as `unfinalized` — its spend was
 * submitted but not finalized. The check is gated on the VTXO actually being spent,
 * so an unspent/preconfirmed VTXO in the set is never mislabeled.
 */
export function deriveVtxoStatus(
    vtxo: {
        txid?: string;
        vout?: number;
        isSpent?: boolean;
        spentBy?: string;
    },
    pendingOutpoints?: ReadonlySet<string>,
): SpentStatus {
    const spent = vtxo.isSpent === true || !!vtxo.spentBy;
    if (!spent) return "spendable";
    if (
        pendingOutpoints &&
        vtxo.txid !== undefined &&
        vtxo.vout !== undefined &&
        pendingOutpoints.has(`${vtxo.txid}:${vtxo.vout}`)
    ) {
        return "unfinalized";
    }
    return "spent";
}

/**
 * Whether this VTXO can be recovered into a fresh batch — mirrors the SDK's
 * `canRecoverOnchain`: not spent, not unrolled, and either swept or past its
 * batch expiry.
 *
 * Consumed VTXOs and outputs whose unilateral exit has started are not
 * recoverable through the operator. Height-based expiry needs `tipHeight`;
 * without it, only an explicit swept flag establishes recoverability.
 * `nowMs`/`tipHeight` default to the wall clock / unknown tip.
 */
export function isRecoverable(
    vtxo: {
        isSpent?: boolean;
        spentBy?: string;
        settledBy?: string;
        isSwept?: boolean;
        isUnrolled?: boolean;
        expiresAt?: Date | string | number;
        expiresAtHeight?: number;
    },
    nowMs: number = Date.now(),
    tipHeight?: number | null,
): boolean {
    const spent = vtxo.isSpent === true || !!vtxo.spentBy || !!vtxo.settledBy;
    if (spent || vtxo.isUnrolled === true) return false;
    if (vtxo.isSwept === true) return true;
    const remaining = remainingLifetime(vtxo, nowMs, tipHeight);
    return remaining !== null && remaining.expiresAtMs <= nowMs;
}
