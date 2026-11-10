import { describe, it, expect } from "vitest";
import { atlasVtxoState, type AtlasVtxoInput } from "@/lib/atlas/vtxo-state";
import { parseRelativeTimelock } from "@/lib/vtxo-display";

const NOW = Date.UTC(2026, 10, 7, 13, 0, 0);
const DAY = 86_400_000;
const exitDelay = parseRelativeTimelock(605184n); // ~7 days
const ctx = { nowMs: NOW, exitDelay };

function vtxo(p: Partial<AtlasVtxoInput>): AtlasVtxoInput {
    return { txid: "aa", vout: 0, spentBy: "", settledBy: "", isSpent: false, ...p };
}

describe("atlasVtxoState", () => {
    it("a VTXO consumed by a commitment is spent-in-batch even if also flagged spent", () => {
        const view = atlasVtxoState(vtxo({ settledBy: "c0ffee", isSpent: true }), ctx);
        expect(view.state).toBe("spent-in-batch");
        expect(view.remaining).toBeNull();
    });

    it("an off-chain spend is spent, or unfinalized while its spend is pending", () => {
        expect(atlasVtxoState(vtxo({ spentBy: "cp" }), ctx).state).toBe("spent");
        const pending = new Set(["aa:0"]);
        expect(
            atlasVtxoState(vtxo({ spentBy: "cp" }), { ...ctx, pendingOutpoints: pending }).state,
        ).toBe("unfinalized");
    });

    it("a swept unspent VTXO is swept, whatever its expiry says", () => {
        const view = atlasVtxoState(
            vtxo({ isSwept: true, expiresAt: new Date(NOW + 20 * DAY) }),
            ctx,
        );
        expect(view.state).toBe("swept");
    });

    it("past expiry is expired", () => {
        expect(atlasVtxoState(vtxo({ expiresAt: new Date(NOW - 1000) }), ctx).state).toBe(
            "expired",
        );
    });

    it("inside the exit window, including exactly at the delay, is renew", () => {
        expect(atlasVtxoState(vtxo({ expiresAt: new Date(NOW + 3 * DAY) }), ctx).state).toBe(
            "renew",
        );
        const atDelay = new Date(NOW + 605_184_000);
        expect(atlasVtxoState(vtxo({ expiresAt: atDelay }), ctx).state).toBe("renew");
    });

    it("never reports a live VTXO as healthy without expiry evidence or an exit delay", () => {
        expect(atlasVtxoState(vtxo({}), ctx).state).toBe("unknown");
        const far = vtxo({ expiresAt: new Date(NOW + 20 * DAY) });
        expect(atlasVtxoState(far, { nowMs: NOW, exitDelay: null }).state).toBe("unknown");
        expect(atlasVtxoState(vtxo({ expiresAtHeight: 980_000 }), ctx).state).toBe("unknown");
    });

    it("a healthy VTXO is preconfirmed or settled by its batch status", () => {
        const far = new Date(NOW + 20 * DAY);
        expect(atlasVtxoState(vtxo({ expiresAt: far, isPreconfirmed: true }), ctx).state).toBe(
            "preconfirmed",
        );
        expect(atlasVtxoState(vtxo({ expiresAt: far, isPreconfirmed: false }), ctx).state).toBe(
            "settled",
        );
    });

    it("reports the share of lifetime left from creation to expiry", () => {
        const view = atlasVtxoState(
            vtxo({ createdAt: new Date(NOW - 10 * DAY), expiresAt: new Date(NOW + 20 * DAY) }),
            ctx,
        );
        expect(view.lifetimeLeft).toBeCloseTo(2 / 3, 3);
    });

    it("an unrolled VTXO is 'unrolled' (exit started), not live or spent", () => {
        const view = atlasVtxoState(
            vtxo({ isUnrolled: true, expiresAt: new Date(NOW + DAY) }),
            ctx,
        );
        expect(view.state).toBe("unrolled");
        expect(view.remaining).toBeNull();
        // Spent still wins over unrolled.
        expect(atlasVtxoState(vtxo({ isUnrolled: true, spentBy: "x" }), ctx).state).toBe("spent");
    });
});
