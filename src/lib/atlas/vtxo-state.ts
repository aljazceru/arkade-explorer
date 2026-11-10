import {
    deriveExpiryKind,
    deriveExpiryUrgency,
    remainingLifetime,
    type ExpiryUrgency,
    type RelativeTimelock,
    type RemainingLifetime,
} from "@/lib/vtxo-display";
import { deriveVtxoStatus } from "@/lib/vtxo-status";
import type { AtlasTone } from "@/lib/atlas/tones";

/**
 * One display state per VTXO. Atlas rings, tags and canvases read this instead
 * of combining the spend, recoverable and urgency layers ad hoc.
 */
export type AtlasVtxoState =
    | "renew"
    | "expired"
    | "unknown"
    | "preconfirmed"
    | "settled"
    | "swept"
    | "unfinalized"
    | "spent"
    | "spent-in-batch"
    | "unrolled";

export interface AtlasVtxoInput {
    txid?: string;
    vout?: number;
    isSpent?: boolean;
    spentBy?: string;
    settledBy?: string;
    isSwept?: boolean;
    isUnrolled?: boolean;
    isPreconfirmed?: boolean;
    createdAt?: Date;
    expiresAt?: Date | string | number;
    expiresAtHeight?: number;
}

export interface AtlasVtxoContext {
    nowMs: number;
    /** Operator's unilateral exit delay; null means the exit window is unknown. */
    exitDelay: RelativeTimelock | null;
    tipHeight?: number | null;
    /** Outpoints whose spend is submitted but not finalized (`pendingOnly` scripts query). */
    pendingOutpoints?: ReadonlySet<string>;
}

export interface AtlasVtxoView {
    state: AtlasVtxoState;
    /** Remaining batch lifetime; only for unspent, unswept VTXOs. */
    remaining: RemainingLifetime | null;
    urgency: ExpiryUrgency | null;
    /** Share of the VTXO's lifetime still ahead (0..1) when creation and expiry are known. */
    lifetimeLeft: number | null;
}

const TERMINAL: Omit<AtlasVtxoView, "state"> = {
    remaining: null,
    urgency: null,
    lifetimeLeft: null,
};

/**
 * Precedence: consumed by a commitment, then spent off-chain (unfinalized when
 * pending), then unrolled (exit already broadcast on-chain), then swept, then
 * the expiry urgency of a live VTXO. A live VTXO is only "preconfirmed" or
 * "settled" when its urgency is known to be ok: missing expiry evidence or an
 * unknown exit delay is "unknown", never safe.
 */
export function atlasVtxoState(vtxo: AtlasVtxoInput, ctx: AtlasVtxoContext): AtlasVtxoView {
    const kind = deriveExpiryKind(vtxo);
    if (kind === "settled") return { state: "spent-in-batch", ...TERMINAL };
    if (kind === "spent") {
        const status = deriveVtxoStatus(vtxo, ctx.pendingOutpoints);
        return { state: status === "unfinalized" ? "unfinalized" : "spent", ...TERMINAL };
    }
    // Unrolled: the unilateral exit was broadcast; the output now lives on-chain
    // and is no longer an off-chain spendable/recoverable VTXO.
    if (vtxo.isUnrolled === true) return { state: "unrolled", ...TERMINAL };
    if (vtxo.isSwept) {
        return { state: "swept", ...TERMINAL };
    }

    const remaining = remainingLifetime(vtxo, ctx.nowMs, ctx.tipHeight);
    const urgency = deriveExpiryUrgency(remaining, ctx.exitDelay);
    let lifetimeLeft: number | null = null;
    if (remaining && vtxo.createdAt instanceof Date && !isNaN(vtxo.createdAt.getTime())) {
        const total = (remaining.expiresAtMs - vtxo.createdAt.getTime()) / 1000;
        if (total > 0) lifetimeLeft = Math.min(1, Math.max(0, remaining.seconds / total));
    }

    const live = { remaining, urgency, lifetimeLeft };
    switch (urgency) {
        case "expired":
            return { state: "expired", ...live };
        case "urgent":
            return { state: "renew", ...live };
        case "unknown":
            return { state: "unknown", ...live };
        default: {
            const preconfirmed = vtxo.isPreconfirmed === true;
            return { state: preconfirmed ? "preconfirmed" : "settled", ...live };
        }
    }
}

export interface AtlasStateMeta {
    label: string;
    tone: AtlasTone;
    /** Dashed outline: evidence is missing rather than bad. */
    dashed?: boolean;
    description: string;
}

export const ATLAS_STATE_META: Record<AtlasVtxoState, AtlasStateMeta> = {
    renew: {
        label: "Renew",
        tone: "alert",
        description: "Inside the exit window: renew it into a new batch or exit on-chain now.",
    },
    expired: {
        label: "Expired",
        tone: "alert",
        description:
            "Past its batch expiry: unilateral recovery is no longer available; recovery requires operator cooperation.",
    },
    unknown: {
        label: "Expiry unknown",
        tone: "warning",
        dashed: true,
        description: "No expiry evidence or no exit window from the operator. Unknown is not safe.",
    },
    preconfirmed: {
        label: "Preconfirmed",
        tone: "virt",
        description: "Cosigned off-chain by the operator, not yet settled into a batch.",
    },
    settled: {
        label: "Settled",
        tone: "ok",
        description:
            "Unspent and finalized in a batch anchored on Bitcoin, outside the exit window.",
    },
    swept: {
        label: "Swept",
        tone: "warning",
        description:
            "The operator swept its expired batch; recovery requires operator cooperation — there is no unilateral exit path.",
    },
    unfinalized: {
        label: "Unfinalized spend",
        tone: "warning",
        description: "Spent in a submitted transaction that is not finalized yet.",
    },
    spent: {
        label: "Spent",
        tone: "faint",
        description: "Spent off-chain by a later Arkade transaction.",
    },
    "spent-in-batch": {
        label: "Spent in batch",
        tone: "faint",
        description: "Used as an input to a commitment (refresh or offboard).",
    },
    unrolled: {
        label: "Exit started",
        tone: "chain",
        description:
            "Unilateral exit broadcast: the VTXO is no longer spendable off-chain, but broadcast does not prove the on-chain claim completed — a stalled exit may require additional on-chain claims.",
    },
};
