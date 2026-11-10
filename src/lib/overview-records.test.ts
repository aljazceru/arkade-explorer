import { describe, expect, it } from "vitest";
import arkadeSnapshot from "../../public/observation/arkade.json";
import {
    buildBarkdRecords,
    buildOverviewRecords,
    getArkadeRecordStatus,
} from "@/lib/overview-records";
import type { BarkdVtxo } from "@/lib/barkd";
import type { ArkadeObservation, ArkadeVtxoRow } from "@/lib/observation";

const NOW = Date.UTC(2026, 10, 7, 20);
const SECOND = NOW / 1000;
const DAY = 86_400;
const row: ArkadeVtxoRow = { txid: "coin", vout: 0, amount_sat: 1000 };
function snapshot(overrides: Partial<ArkadeObservation> = {}): ArkadeObservation {
    return {
        fetched_at: new Date(NOW).toISOString(),
        info: {},
        stats_24h: {},
        trends: [],
        recent_activity: [],
        vtxos: [],
        commitments: {},
        notes: [],
        source: {},
        ...overrides,
    };
}

// Classification boundaries and source precedence, not formatting snapshots.
describe("snapshot coin safety", () => {
    it.each([
        [DAY + 1, "healthy", false],
        [DAY, "urgent", true],
        [1, "urgent", true],
        [0, "expired", true],
        [-1, "expired", true],
    ] as const)(
        "classifies %i seconds remaining against the reported delay",
        (left, status, review) => {
            const result = getArkadeRecordStatus(
                { ...row, expiresAt_unix: SECOND + left },
                DAY,
                NOW,
            );
            expect(result.status).toBe(status);
            expect(result.needsReview).toBe(review);
            expect(result.leftSeconds).toBe(left);
        },
    );

    it.each([{ isSpent: true }, { spentBy: "spend" }, { settledBy: "batch" }])(
        "never treats a consumed output as an available settled coin: %j",
        (terminal) => {
            const result = getArkadeRecordStatus(
                { ...row, ...terminal, urgent: true, expiresAt_unix: SECOND - DAY },
                DAY,
                NOW,
            );
            expect(result.status).toBe("spent");
            expect(result.needsReview).toBe(false);
        },
    );

    it("advances a stored countdown from its observation timestamp", () => {
        const observed = new Date(NOW - 2 * DAY * 1000).toISOString();
        const result = getArkadeRecordStatus({ ...row, left_seconds: DAY }, DAY, NOW, observed);
        expect(result.leftSeconds).toBe(-DAY);
        expect(result.status).toBe("expired");
    });

    it("does not reuse an undated countdown or call an unknown exit margin healthy", () => {
        expect(getArkadeRecordStatus({ ...row, left_seconds: DAY }, DAY, NOW)).toMatchObject({
            status: "unknown",
            leftSeconds: null,
            needsReview: true,
        });
        expect(
            getArkadeRecordStatus({ ...row, expiresAt_unix: SECOND + DAY }, null, NOW),
        ).toMatchObject({ status: "unknown", needsReview: true });
    });

    it("prefers absolute expiry and the current margin over frozen urgency flags", () => {
        const result = getArkadeRecordStatus(
            {
                ...row,
                left_seconds: 10,
                urgent: true,
                expired: true,
                expiresAt: String(SECOND + 2 * DAY),
            },
            DAY,
            NOW,
            new Date(NOW - DAY * 1000).toISOString(),
        );
        expect(result).toMatchObject({
            status: "healthy",
            leftSeconds: 2 * DAY,
            needsReview: false,
        });
    });

    it("requires a chain tip for height-typed wire expiry instead of treating it as 1970", () => {
        const heightRow = {
            ...row,
            expiresAt: "975100",
            expiresAt_unix: 975100,
            left_seconds: -100,
        };
        const unknown = getArkadeRecordStatus(heightRow, DAY, NOW, new Date(NOW).toISOString());
        expect(unknown.status).toBe("unknown");
        expect(unknown.leftSeconds).toBeNull();
        const [record] = buildOverviewRecords(
            snapshot({ vtxos: [heightRow] }),
            null,
            DAY,
            NOW,
            975000,
        );
        expect(record.status).toBe("urgent");
        expect(record.leftSeconds).toBe(100 * 600);
        expect(record.expiresAtSeconds).toBeNull();
        expect(record.expiryHeight).toBe(975100);
    });

    it("keeps swept and already-unrolled outputs out of the healthy expiry state", () => {
        const future = { ...row, expiresAt_unix: SECOND + 30 * DAY };
        expect(getArkadeRecordStatus({ ...future, isSwept: true }, DAY, NOW)).toMatchObject({
            status: "swept",
            leftSeconds: null,
            needsReview: true,
        });
        expect(getArkadeRecordStatus({ ...future, isUnrolled: true }, DAY, NOW)).toMatchObject({
            status: "unrolled",
            leftSeconds: null,
            needsReview: false,
        });
        expect(
            getArkadeRecordStatus({ ...future, isUnrolled: true, isSpent: true }, DAY, NOW).status,
        ).toBe("spent");
    });
});

describe("observed records", () => {
    it("keeps sibling outputs separate and a spent duplicate supersedes an unspent duplicate", () => {
        const a = { ...row, expiresAt_unix: SECOND + DAY };
        const data = snapshot({ vtxos: [a, { ...a, isSpent: true }, a, { ...a, vout: 1 }] });
        const records = buildOverviewRecords(data, null, DAY / 2, NOW);
        expect(records.map((r) => [r.id, r.status])).toEqual([
            ["arkade-vtxo:coin:0", "spent"],
            ["arkade-vtxo:coin:1", "healthy"],
        ]);
        expect(records.every((r) => r.entity === "vtxo")).toBe(true);
    });

    it("uses batch value rather than the on-chain output sum including change", () => {
        const data = snapshot({
            commitments: {
                batch: {
                    totalOutputAmount: "71613",
                    _onchain: {
                        total_sats: 2591287,
                        block_height: 974976,
                        block_time: SECOND - 60,
                    },
                },
            },
        });
        const [record] = buildOverviewRecords(data, null, DAY, NOW);
        expect(record.amountSat).toBe(71613);
        expect(record.entity).toBe("transaction");
        expect(record.status).toBe("confirmed");
        expect(record.blockHeight).toBe(974976);
    });

    it("does not infer confirmation from commitment metadata without a block", () => {
        const [record] = buildOverviewRecords(
            snapshot({
                commitments: {
                    batch: { totalOutputAmount: "500", startedAt: String(SECOND - 60) },
                },
            }),
            null,
            DAY,
            NOW,
        );
        expect(record.status).toBe("observed");
        expect(record.blockHeight).toBeNull();
    });

    it("does not convert a commitment-labelled VTXO into the commitment transaction", () => {
        const records = buildOverviewRecords(
            snapshot({
                vtxos: [
                    {
                        ...row,
                        txType: "commitment",
                        commitmentTxids: ["anchor"],
                        expiresAt_unix: SECOND + DAY,
                    },
                ],
            }),
            null,
            DAY,
            NOW,
        );
        const coin = records.find((r) => r.txid === "coin")!;
        expect(coin.entity).toBe("vtxo");
        expect(coin.kind).toBe("virtual");
        const anchor = records.find((r) => r.txid === "anchor")!;
        expect(anchor.entity).toBe("transaction");
        expect(anchor.amountSat).toBeNull();
        expect(anchor.blockHeight).toBeNull();
    });

    it("retains discovered activity when VTXO enrichment fails without fabricating coins", () => {
        const data = snapshot({
            recent_activity: [{ txid: "discovered", txType: "virtual", createdAt: SECOND - 10 }],
            vtxos: [{ txid: "discovered", vout: 0, amount_sat: 0, error: "upstream unavailable" }],
        });
        const [record] = buildOverviewRecords(data, null, DAY, NOW);
        expect(record.txid).toBe("discovered");
        expect(record.entity).toBe("transaction");
        expect(record.amountSat).toBeNull();
        expect(record.expiresAtSeconds).toBeNull();
        expect(record.status).toBe("observed");
        expect(record.createdAtSeconds).toBe(SECOND - 10);
    });

    it("does not add archive transaction totals on top of their sampled outputs", () => {
        const records = buildOverviewRecords(
            snapshot({
                recent_activity: [{ txid: "coin", txType: "virtual", createdAt: SECOND }],
                vtxos: [{ ...row, expiresAt_unix: SECOND + DAY }],
            }),
            null,
            DAY,
            NOW,
        );
        expect(records).toHaveLength(1);
        expect(records[0].entity).toBe("vtxo");
    });

    it("recomputes old fixture expiry rather than reusing the collection-day countdown", () => {
        const records = buildOverviewRecords(
            arkadeSnapshot as unknown as ArkadeObservation,
            null,
            null,
            NOW,
        );
        const expired = records.find((r) => r.txid.startsWith("80db0cfa") && r.id.endsWith(":0"));
        expect(expired?.status).toBe("expired");
        expect(expired?.needsReview).toBe(true);
        const batch = records.find((r) => r.id.startsWith("arkade-commitment:8841e8fc"));
        expect(batch?.amountSat).toBe(943);
    });
});

const walletCoin: BarkdVtxo = {
    id: "wallet:0",
    amountSat: 1200,
    policyType: "server",
    expiryHeight: 1100,
    exitDelta: 144,
    exitDepth: 2,
    chainAnchor: "anchor:0",
    state: { type: "spendable" },
};
describe("wallet expiry", () => {
    it("uses the coin's own exit delay, not a newer server parameter", () => {
        const [record] = buildBarkdRecords([walletCoin], 1000, 6 * 600, NOW);
        expect(record.status).toBe("urgent");
        expect(record.exitSeconds).toBe(144 * 600);
        expect(record.leftSeconds).toBe(100 * 600);
        expect(record.expiryHeight).toBe(1100);
        expect(record.blockHeight).toBeNull();
    });

    it("keeps a locked coin's expiry ticking", () => {
        const locked = { ...walletCoin, state: { type: "locked" as const } };
        const [record] = buildBarkdRecords([locked], 1101, null, NOW);
        expect(record.status).toBe("expired");
        expect(record.needsReview).toBe(true);
        expect(record.leftSeconds).toBe(-600);
    });

    it("does not mark missing chain-tip data safe", () => {
        const [record] = buildBarkdRecords([walletCoin], null, null, NOW);
        expect(record.status).toBe("unknown");
        expect(record.needsReview).toBe(true);
        expect(record.leftSeconds).toBeNull();
    });

    it.each(["spent", "exited"] as const)("excludes %s coins from expiry warnings", (type) => {
        const [record] = buildBarkdRecords([{ ...walletCoin, state: { type } }], 9999, null, NOW);
        expect(record.status).toBe("spent");
        expect(record.needsReview).toBe(false);
        expect(record.leftSeconds).toBeNull();
    });
});
