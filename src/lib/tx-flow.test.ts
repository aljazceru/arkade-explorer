import { describe, it, expect } from "vitest";
import { layoutTxFlow, compressSpineEntries, nodeRadius } from "@/lib/tx-flow";

describe("nodeRadius", () => {
    it("scales by square root of amount", () => {
        const r1 = nodeRadius(100, 10000, false);
        const r2 = nodeRadius(10000, 10000, false);
        expect(r2).toBeGreaterThan(r1);
        // √(100/10000) = 0.1 → r1 should be near floor + 10% of range
        expect(r1).toBeLessThan(r2);
    });

    it("clamps to min/max", () => {
        expect(nodeRadius(0, 1000, false)).toBe(10);
        expect(nodeRadius(1e18, 1, false)).toBeLessThanOrEqual(28);
    });

    it("caps lower on mobile", () => {
        const desktop = nodeRadius(10000, 10000, false);
        const mobile = nodeRadius(10000, 10000, true);
        expect(mobile).toBeLessThanOrEqual(desktop);
    });
});

describe("layoutTxFlow", () => {
    const base = {
        inputCount: 2,
        outputCount: 3,
        inputAmounts: [5000, 3000],
        outputAmounts: [4000, 2000, 1000],
        anchorFlags: [false, false, true],
        spentBy: [null, "spenttx", null] as Array<string | null>,
        spineEntries: [] as Array<{ type: "hop"; txid: string; kind: string }>,
        spineAnchor: null,
        vertical: false,
    };

    it("lays out inputs left, outputs right, tx centred", () => {
        const layout = layoutTxFlow(base);
        expect(layout.width).toBe(1000);
        expect(layout.inputs).toHaveLength(2);
        expect(layout.outputs).toHaveLength(3);
        // inputs on the left, outputs on the right
        expect(layout.inputs[0].x).toBeLessThan(layout.txNode.x);
        expect(layout.outputs[0].x).toBeGreaterThan(layout.txNode.x);
        // tx node is centred horizontally
        expect(layout.txNode.x).toBeCloseTo(layout.width / 2);
    });

    it("anchor outputs get a fixed small radius", () => {
        const layout = layoutTxFlow(base);
        const anchorOut = layout.outputs[2];
        expect(anchorOut.r).toBe(7);
    });

    it("spent outputs produce a stub", () => {
        const layout = layoutTxFlow(base);
        expect(layout.spentStubs).toHaveLength(1);
        expect(layout.spentStubs[0].spentBy).toBe("spenttx");
        expect(layout.spentStubs[0].outputIndex).toBe(1);
    });

    it("no spine → no spine rows", () => {
        const layout = layoutTxFlow(base);
        expect(layout.hasSpine).toBe(false);
        expect(layout.spineRows).toHaveLength(0);
    });

    it("spine entries produce rows", () => {
        const layout = layoutTxFlow({
            ...base,
            spineEntries: [
                { type: "hop", txid: "a".repeat(64), kind: "ark" },
                { type: "hop", txid: "b".repeat(64), kind: "commitment" },
            ],
            spineAnchor: { txid: "c".repeat(64), height: 12345 },
        });
        expect(layout.hasSpine).toBe(true);
        expect(layout.spineRows).toHaveLength(3); // 2 hops + 1 anchor
        expect(layout.spineRows[2].kind).toBe("anchor");
    });

    it("mobile layout stacks inputs above outputs", () => {
        const layout = layoutTxFlow({ ...base, vertical: true });
        expect(layout.vertical).toBe(true);
        expect(layout.width).toBe(460);
        // inputs above tx, outputs below
        expect(layout.inputs[0].y).toBeLessThan(layout.txNode.y);
        expect(layout.outputs[0].y).toBeGreaterThan(layout.txNode.y);
    });
});

describe("compressSpineEntries", () => {
    const hops = Array.from({ length: 40 }, (_, i) => ({
        txid: `tx${i}`,
        kind: i % 2 === 0 ? "ark" : "checkpoint",
    }));

    it("keeps short chains whole", () => {
        const short = hops.slice(0, 10);
        const entries = compressSpineEntries(short);
        expect(entries.every((e) => e.type === "hop")).toBe(true);
        expect(entries).toHaveLength(10);
    });

    it("folds middle into a gap with per-kind counts", () => {
        const entries = compressSpineEntries(hops, 12, 6);
        const gaps = entries.filter((e) => e.type === "gap");
        expect(gaps).toHaveLength(1);
        const gap = gaps[0];
        if (gap.type !== "gap") throw new Error("expected gap");
        expect(gap.count).toBe(40 - 18);
        const hidden = Object.values(gap.counts!).reduce((a, b) => a + b, 0);
        expect(hidden).toBe(gap.count);
    });
});
