import { describe, it, expect } from "vitest";
import { ChainTxType, type ChainTx } from "@arkade-os/sdk";
import { compressHops, summarizeChain } from "@/lib/atlas/chain";

function tx(txid: string, type: ChainTxType): ChainTx {
    return { txid, type, expiresAt: "1796488587", spends: [] };
}

// Shape of a real arkade.computer chain: ark/checkpoint hops back to one tree leaf and its batch.
const chain: ChainTx[] = [
    ...Array.from({ length: 17 }, (_, i) => [
        tx(`ark${i}`, ChainTxType.ARK),
        tx(`cp${i}`, ChainTxType.CHECKPOINT),
    ]).flat(),
    tx("leaf", ChainTxType.TREE),
    tx("batch", ChainTxType.COMMITMENT),
];

describe("summarizeChain", () => {
    it("counts hops by kind and excludes on-chain commitments from the exit depth", () => {
        const summary = summarizeChain(chain);
        expect(summary.length).toBe(36);
        expect(summary.counts).toMatchObject({ ark: 17, checkpoint: 17, tree: 1, commitment: 1 });
        expect(summary.exitDepth).toBe(35);
        expect(summary.anchors).toEqual(["batch"]);
    });

    it("lists each anchor commitment once, in chain order", () => {
        const summary = summarizeChain([
            tx("a", ChainTxType.ARK),
            tx("c1", ChainTxType.COMMITMENT),
            tx("c2", ChainTxType.COMMITMENT),
            tx("c1", ChainTxType.COMMITMENT),
        ]);
        expect(summary.anchors).toEqual(["c1", "c2"]);
    });

    it("reports exit depth as unknown when a hop type is unspecified", () => {
        // The SDK unroll skips UNSPECIFIED hops, so the real broadcast count
        // cannot be derived — exitDepth must be null, not a lower bound.
        const summary = summarizeChain([
            tx("a", ChainTxType.ARK),
            tx("mystery", ChainTxType.UNSPECIFIED),
            tx("batch", ChainTxType.COMMITMENT),
        ]);
        expect(summary.counts.unknown).toBe(1);
        expect(summary.exitDepth).toBeNull();
    });

    it("reads expiry as unix seconds", () => {
        expect(summarizeChain(chain).hops[0].expiresAt).toBe(1796488587);
    });
});

describe("compressHops", () => {
    it("keeps short chains whole", () => {
        const hops = summarizeChain(chain.slice(0, 10)).hops;
        expect(compressHops(hops).every((entry) => entry.type === "hop")).toBe(true);
    });

    it("folds the middle into one gap that accounts for every hidden hop", () => {
        const hops = summarizeChain(chain).hops;
        const entries = compressHops(hops, 12, 6);
        const gaps = entries.filter((entry) => entry.type === "gap");
        expect(gaps).toHaveLength(1);
        const gap = gaps[0];
        if (gap.type !== "gap") throw new Error("expected gap");
        expect(gap.count).toBe(36 - 18);
        const hidden = Object.values(gap.counts).reduce((a, b) => a + b, 0);
        expect(hidden).toBe(gap.count);
        expect(entries.filter((entry) => entry.type === "hop")).toHaveLength(18);
        const last = entries[entries.length - 1];
        expect(last.type === "hop" && last.txid).toBe("batch");
    });
});
