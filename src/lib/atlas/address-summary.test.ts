import { describe, it, expect } from "vitest";
import type { VirtualCoin } from "@arkade-os/sdk";
import { summarizeAddress, urgencyRank } from "@/lib/atlas/address-summary";
import type { AtlasVtxoContext } from "@/lib/atlas/vtxo-state";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const DAY = 86_400_000;

function makeVtxo(p: Partial<VirtualCoin> = {}): VirtualCoin {
    return {
        txid: "aa",
        vout: 0,
        value: 1000,
        spentBy: "",
        isSpent: false,
        createdAt: new Date(NOW - 10 * DAY),
        expiresAt: new Date(NOW + 30 * DAY),
        ...p,
    } as unknown as VirtualCoin;
}

const CTX: AtlasVtxoContext = {
    nowMs: NOW,
    exitDelay: { type: "seconds", value: 7 * 24 * 3600 }, // 7d exit window
    tipHeight: null,
    pendingOutpoints: new Set(),
};

describe("summarizeAddress", () => {
    it("returns zeros for an empty set", () => {
        const s = summarizeAddress([], CTX);
        expect(s.totalVtxos).toBe(0);
        expect(s.unspentCount).toBe(0);
        expect(s.receivedSats).toBe(0);
        expect(s.nearestExpiryMs).toBeNull();
        expect(s.needsAction.count).toBe(0);
    });

    it("buckets live VTXOs by urgency", () => {
        const vtxos = [
            // healthy: expires in 30d, exit window 7d
            makeVtxo({ value: 100 }),
            // in exit window: expires in 3d
            makeVtxo({ value: 200, expiresAt: new Date(NOW + 3 * DAY) }),
            // expired: expires yesterday
            makeVtxo({ value: 300, expiresAt: new Date(NOW - DAY) }),
            // unknown: no expiry evidence
            makeVtxo({ value: 400, expiresAt: undefined }),
            // spent
            makeVtxo({ value: 500, isSpent: true, spentBy: "deadbeef" }),
        ];
        const s = summarizeAddress(vtxos, CTX);
        expect(s.totalVtxos).toBe(5);
        expect(s.unspentCount).toBe(4);
        expect(s.spentCount).toBe(1);
        expect(s.receivedSats).toBe(1500);
        expect(s.unspentSats).toBe(1000);
        expect(s.buckets.healthy.count).toBe(1);
        expect(s.buckets.exitWindow.count).toBe(1);
        expect(s.buckets.expired.count).toBe(1);
        expect(s.buckets.unknown.count).toBe(1);
        expect(s.needsAction.count).toBe(2);
        expect(s.needsAction.sats).toBe(500);
    });

    it("counts swept VTXOs in the swept bucket", () => {
        const vtxos = [makeVtxo({ value: 100, isSwept: true })];
        const s = summarizeAddress(vtxos, CTX);
        expect(s.buckets.swept.count).toBe(1);
        expect(s.unspentCount).toBe(1);
    });

    it("spent-in-batch (settledBy) counts as spent, not unspent", () => {
        const vtxos = [makeVtxo({ value: 100, settledBy: "commit1", spentBy: "", isSpent: false })];
        const s = summarizeAddress(vtxos, CTX);
        expect(s.stateCounts["spent-in-batch"]).toBe(1);
        expect(s.spentCount).toBe(1);
        expect(s.unspentCount).toBe(0);
    });

    it("nearestExpiryMs is the earliest live expiry", () => {
        const vtxos = [
            makeVtxo({ expiresAt: new Date(NOW + 10 * DAY) }),
            makeVtxo({ expiresAt: new Date(NOW + 2 * DAY) }),
            makeVtxo({ expiresAt: new Date(NOW - DAY), value: 1 }), // expired still counts? no — see below
        ];
        const s = summarizeAddress(vtxos, CTX);
        // expired VTXOs are still "live" (non-terminal) so their expiry counts.
        expect(s.nearestExpiryMs).toBe(NOW - DAY);
    });

    it("needsAction.nearestExpiryMs only covers renew/expired", () => {
        const vtxos = [
            makeVtxo({ expiresAt: new Date(NOW + 10 * DAY) }), // healthy
            makeVtxo({ expiresAt: new Date(NOW + 2 * DAY) }), // renew
        ];
        const s = summarizeAddress(vtxos, CTX);
        expect(s.needsAction.nearestExpiryMs).toBe(NOW + 2 * DAY);
    });

    it("counts unrolled VTXOs separately — not spent, not unspent", () => {
        const vtxos = [makeVtxo({ value: 100, isUnrolled: true }), makeVtxo({ value: 200 })];
        const s = summarizeAddress(vtxos, CTX);
        expect(s.stateCounts.unrolled).toBe(1);
        expect(s.unrolledCount).toBe(1);
        expect(s.unrolledSats).toBe(100);
        expect(s.spentCount).toBe(0);
        expect(s.unspentCount).toBe(1);
        expect(s.unspentSats).toBe(200);
    });
});

describe("urgencyRank", () => {
    it("orders needs-action states before healthy and spent last", () => {
        expect(urgencyRank("expired")).toBeLessThan(urgencyRank("renew"));
        expect(urgencyRank("renew")).toBeLessThan(urgencyRank("preconfirmed"));
        expect(urgencyRank("settled")).toBeLessThan(urgencyRank("spent"));
        expect(urgencyRank("spent")).toBeLessThan(urgencyRank("spent-in-batch"));
    });
});
