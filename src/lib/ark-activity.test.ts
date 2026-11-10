import { describe, expect, it } from "vitest";
import type { TxNotificationEvent } from "@arkade-os/sdk";
import { buildArkActivityRecord } from "@/lib/ark-activity";

const observedAt = Date.UTC(2026, 10, 7);
const notification: NonNullable<TxNotificationEvent["arkTx"]> = {
    txid: "transaction",
    tx: "",
    spentVtxos: [],
    spendableVtxos: [
        {
            outpoint: { txid: "transaction", vout: 0 },
            amount: "12345",
            script: "",
            createdAt: "1794000000",
            expiresAt: "1795000000",
            commitmentTxids: ["anchor"],
            isPreconfirmed: true,
            isSwept: false,
            isSpent: false,
            isUnrolled: false,
            spentBy: null,
        },
    ],
};

describe("operator notification evidence", () => {
    it("does not equate a commitment announcement with an on-chain confirmation", () => {
        const record = buildArkActivityRecord({ commitmentTx: notification }, observedAt)!;
        expect(record.kind).toBe("commitment");
        expect(record.status).toBe("observed");
        expect(record.blockHeight).toBeNull();
        expect(record.createdAtSeconds).toBeNull();
    });

    it("does not turn a transaction notification into an unspent coin with aggregate expiry", () => {
        const record = buildArkActivityRecord({ arkTx: notification }, observedAt)!;
        expect(record.entity).toBe("transaction");
        expect(record.expiresAtSeconds).toBeNull();
        expect(record.leftSeconds).toBeNull();
        expect(record.needsReview).toBe(false);
    });

    it("places sweep announcements on-chain rather than in the virtual transaction lane", () => {
        const record = buildArkActivityRecord(
            { sweepTx: { ...notification, sweptVtxos: [{ txid: "expired", vout: 1 }] } },
            observedAt,
        )!;
        expect(record.kind).toBe("onchain");
        expect(record.status).toBe("observed");
    });

    it("does not present partial malformed amounts as a complete sum", () => {
        const record = buildArkActivityRecord(
            {
                arkTx: {
                    ...notification,
                    spendableVtxos: [
                        ...notification.spendableVtxos,
                        { ...notification.spendableVtxos[0], amount: "unknown" },
                    ],
                },
            },
            observedAt,
        )!;
        expect(record.amountSat).toBeNull();
    });

    it("distinguishes zero-valued reported outputs from no reported outputs", () => {
        const zero = buildArkActivityRecord(
            {
                arkTx: {
                    ...notification,
                    spendableVtxos: [{ ...notification.spendableVtxos[0], amount: "0" }],
                },
            },
            observedAt,
        )!;
        const absent = buildArkActivityRecord(
            { arkTx: { ...notification, spendableVtxos: [] } },
            observedAt,
        )!;
        expect(zero.amountSat).toBe(0);
        expect(absent.amountSat).toBeNull();
    });
});
