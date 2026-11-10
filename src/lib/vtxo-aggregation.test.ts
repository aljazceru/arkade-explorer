import { describe, it, expect } from "vitest";
import type { VirtualCoin } from "@arkade-os/sdk";
import {
    isVtxoActive,
    sumVtxoValue,
    sumActiveVtxoValue,
    aggregateAssetBalances,
    uniqueVtxos,
} from "@/lib/vtxo-aggregation";

function makeVtxo(p: Partial<VirtualCoin> & { value: number }): VirtualCoin {
    return {
        txid: "t",
        vout: 0,
        spentBy: "",
        isSpent: false,
        assets: [],
        ...p,
    } as unknown as VirtualCoin;
}

describe("isVtxoActive", () => {
    it("is active when not spent", () => {
        expect(isVtxoActive(makeVtxo({ value: 1 }))).toBe(true);
    });
    it("is inactive when spentBy is set", () => {
        expect(isVtxoActive(makeVtxo({ value: 1, spentBy: "abc" }))).toBe(false);
    });
    it("is inactive when isSpent is true", () => {
        expect(isVtxoActive(makeVtxo({ value: 1, isSpent: true }))).toBe(false);
    });
    it("is inactive when settledBy a commitment", () => {
        expect(isVtxoActive(makeVtxo({ value: 1, settledBy: "commit" }))).toBe(false);
    });
    it("is inactive when swept", () => {
        expect(isVtxoActive(makeVtxo({ value: 1, isSwept: true }))).toBe(false);
    });
    it("is inactive when unrolled", () => {
        expect(isVtxoActive(makeVtxo({ value: 1, isUnrolled: true }))).toBe(false);
    });
    it("stays active when finalized in a batch but not consumed", () => {
        expect(
            isVtxoActive(makeVtxo({ value: 1, isPreconfirmed: false, commitmentTxIds: ["c"] })),
        ).toBe(true);
    });
});

describe("sumVtxoValue / sumActiveVtxoValue", () => {
    const vtxos = [
        makeVtxo({ value: 100 }),
        makeVtxo({ value: 200, spentBy: "x" }),
        makeVtxo({ value: 300 }),
    ];
    it("sumVtxoValue sums every vtxo (total received)", () => {
        expect(sumVtxoValue(vtxos)).toBe(600);
    });
    it("sumActiveVtxoValue sums only active vtxos (balance)", () => {
        expect(sumActiveVtxoValue(vtxos)).toBe(400);
    });
    it("returns 0 for an empty list", () => {
        expect(sumVtxoValue([])).toBe(0);
        expect(sumActiveVtxoValue([])).toBe(0);
    });
});

describe("aggregateAssetBalances", () => {
    it("aggregates active vs total per asset id across the full set", () => {
        const vtxos = [
            makeVtxo({
                value: 0,
                assets: [{ assetId: "A", amount: 10n }] as VirtualCoin["assets"],
            }),
            makeVtxo({
                value: 0,
                spentBy: "x",
                assets: [{ assetId: "A", amount: 5n }] as VirtualCoin["assets"],
            }),
            makeVtxo({ value: 0, assets: [{ assetId: "B", amount: 7n }] as VirtualCoin["assets"] }),
        ];
        const result = aggregateAssetBalances(vtxos);
        expect(result.get("A")).toEqual({ active: 10n, total: 15n });
        expect(result.get("B")).toEqual({ active: 7n, total: 7n });
    });
});

describe("uniqueVtxos", () => {
    it("dedupes by outpoint and prefers the terminal state over a stale active record", () => {
        const txid = "a".repeat(64);
        const active = makeVtxo({ txid, vout: 0, value: 100 });
        const spent = makeVtxo({
            txid,
            vout: 0,
            value: 100,
            isSpent: true,
            spentBy: "b".repeat(64),
        });
        const other = makeVtxo({ txid: "c".repeat(64), vout: 1, value: 200 });
        // Overlapping paginated reads: same outpoint arrives active then spent.
        expect(uniqueVtxos([active, spent, other])).toEqual([spent, other]);
    });

    it("keeps the first record when duplicates agree on state", () => {
        const txid = "d".repeat(64);
        const first = makeVtxo({ txid, vout: 2, value: 100 });
        const dup = makeVtxo({ txid, vout: 2, value: 999 });
        expect(uniqueVtxos([first, dup])).toEqual([first]);
    });

    it("does not double-count assets for a duplicated outpoint", () => {
        const txid = "e".repeat(64);
        const asset = { assetId: "A", amount: 10n };
        const v1 = makeVtxo({ txid, vout: 0, value: 100, assets: [asset] });
        const v2 = makeVtxo({ txid, vout: 0, value: 100, assets: [asset], isSpent: true });
        const balances = aggregateAssetBalances(uniqueVtxos([v1, v2]));
        expect(balances.get("A")).toEqual({ active: 0n, total: 10n });
    });
});
