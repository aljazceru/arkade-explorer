import { ChainTxType, type ChainTx } from "@arkade-os/sdk";

/** Role of one transaction in a VTXO's ancestry (indexer `getVtxoChain`). */
export type ChainHopKind = "ark" | "checkpoint" | "tree" | "commitment" | "unknown";

export interface ChainHop {
    txid: string;
    kind: ChainHopKind;
    /** Batch expiry in unix seconds, when the indexer reports it. */
    expiresAt: number | null;
    /** Txids (or outpoints) this hop spends. */
    spends: string[];
}

export type ChainEntry =
    | ({ type: "hop" } & ChainHop)
    | { type: "gap"; count: number; counts: Record<ChainHopKind, number> };

export interface ChainSummary {
    length: number;
    counts: Record<ChainHopKind, number>;
    /**
     * Off-chain transactions a holder would broadcast to exit unilaterally:
     * every hop except the commitments, which are already on-chain.
     * `null` when the chain contains hops of unknown type: the SDK skips
     * UNSPECIFIED entries during unroll, so the true broadcast count is
     * unknowable — report unknown rather than a fake lower bound.
     */
    exitDepth: number | null;
    /** Commitment txids the VTXO is anchored to, in chain order, unique. */
    anchors: string[];
    hops: ChainHop[];
}

const KIND_BY_TYPE: Record<string, ChainHopKind> = {
    [ChainTxType.ARK]: "ark",
    [ChainTxType.CHECKPOINT]: "checkpoint",
    [ChainTxType.TREE]: "tree",
    [ChainTxType.COMMITMENT]: "commitment",
    ark: "ark",
    checkpoint: "checkpoint",
    tree: "tree",
    commitment: "commitment",
};

function emptyCounts(): Record<ChainHopKind, number> {
    return { ark: 0, checkpoint: 0, tree: 0, commitment: 0, unknown: 0 };
}

function toUnixSeconds(raw: string | number | null | undefined): number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n > 1e12 ? Math.floor(n / 1000) : n;
}

/** Normalise the indexer chain, preserving its order (the VTXO's own tx first). */
export function normalizeChain(chain: ChainTx[]): ChainHop[] {
    return chain.map((tx) => ({
        txid: tx.txid,
        kind: KIND_BY_TYPE[String(tx.type)] ?? "unknown",
        expiresAt: toUnixSeconds(tx.expiresAt),
        spends: tx.spends ?? [],
    }));
}

export function summarizeChain(chain: ChainTx[]): ChainSummary {
    const hops = normalizeChain(chain);
    const counts = emptyCounts();
    const anchors: string[] = [];
    for (const hop of hops) {
        counts[hop.kind]++;
        if (hop.kind === "commitment" && !anchors.includes(hop.txid)) anchors.push(hop.txid);
    }
    return {
        length: hops.length,
        counts,
        // The SDK's Unroll.Session skips COMMITMENT *and* UNSPECIFIED hops; an
        // unknown-typed hop makes the real broadcast count unknowable.
        exitDepth: counts.unknown > 0 ? null : hops.length - counts.commitment,
        anchors,
        hops,
    };
}

/**
 * Keep the first `head` and last `tail` hops and fold the middle into one gap
 * entry carrying per-kind counts, so a 600-hop ancestry renders in constant space.
 */
export function compressHops(hops: ChainHop[], head = 12, tail = 6): ChainEntry[] {
    if (hops.length <= head + tail + 1) return hops.map((hop) => ({ type: "hop", ...hop }));
    const middle = hops.slice(head, hops.length - tail);
    const counts = emptyCounts();
    for (const hop of middle) counts[hop.kind]++;
    return [
        ...hops.slice(0, head).map((hop) => ({ type: "hop" as const, ...hop })),
        { type: "gap", count: middle.length, counts },
        ...hops.slice(hops.length - tail).map((hop) => ({ type: "hop" as const, ...hop })),
    ];
}
