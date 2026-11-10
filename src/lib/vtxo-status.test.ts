import { describe, it, expect } from "vitest";
import { deriveVtxoStatus, isRecoverable } from "@/lib/vtxo-status";

const base = { txid: "aa", vout: 0 };

describe("deriveVtxoStatus", () => {
    it("is spendable when not spent", () => {
        expect(deriveVtxoStatus({ ...base })).toBe("spendable");
    });

    it("is spent when isSpent is true and no pending set is given", () => {
        expect(deriveVtxoStatus({ ...base, isSpent: true })).toBe("spent");
    });

    it("is spent when spentBy is set", () => {
        expect(deriveVtxoStatus({ ...base, spentBy: "bb" })).toBe("spent");
    });

    it("is unfinalized when spent and the outpoint is in the pending set", () => {
        const pending = new Set(["aa:0"]);
        expect(deriveVtxoStatus({ ...base, isSpent: true }, pending)).toBe("unfinalized");
    });

    it("stays spent when spent but the outpoint is NOT in the pending set", () => {
        const pending = new Set(["cc:1"]);
        expect(deriveVtxoStatus({ ...base, isSpent: true }, pending)).toBe("spent");
    });

    it("never marks an unspent VTXO unfinalized, even if its outpoint is in the set", () => {
        const pending = new Set(["aa:0"]); // a preconfirmed-but-unspent VTXO can appear here
        expect(deriveVtxoStatus({ ...base }, pending)).toBe("spendable");
    });
});

describe("isRecoverable", () => {
    const PAST = Date.now() - 1000;
    const FUTURE = Date.now() + 60_000;

    it("is recoverable when explicitly swept", () => {
        expect(isRecoverable({ isSwept: true })).toBe(true);
    });

    it("does not round a future expiry down into recoverability", () => {
        const now = Date.UTC(2026, 10, 8);
        expect(isRecoverable({ expiresAt: new Date(now + 1) }, now)).toBe(false);
        expect(isRecoverable({ expiresAt: new Date(now) }, now)).toBe(true);
    });

    it("is recoverable when its expiry is in the past", () => {
        expect(isRecoverable({ expiresAt: new Date(PAST) })).toBe(true);
        expect(isRecoverable({ expiresAt: String(Math.floor(PAST / 1000)) })).toBe(true);
        expect(isRecoverable({ expiresAtHeight: 100 }, Date.now(), 101)).toBe(true);
        expect(isRecoverable({ expiresAtHeight: 100 }, Date.now(), 99)).toBe(false);
        // No tip → height expiry cannot be evaluated.
        expect(isRecoverable({ expiresAtHeight: 100 }, Date.now())).toBe(false);
    });

    it("is NOT recoverable when spent or unrolled, even if swept/expired", () => {
        expect(isRecoverable({ isSwept: true, isSpent: true })).toBe(false);
        expect(isRecoverable({ isSwept: true, spentBy: "x" })).toBe(false);
        expect(isRecoverable({ isSwept: true, settledBy: "c" })).toBe(false);
        expect(isRecoverable({ isSwept: true, isUnrolled: true })).toBe(false);
        expect(isRecoverable({ expiresAt: new Date(PAST), isSpent: true })).toBe(false);
    });

    it("is not recoverable when it is neither swept nor expired", () => {
        expect(isRecoverable({ expiresAt: new Date(FUTURE) })).toBe(false);
        expect(isRecoverable({})).toBe(false);
    });
});
