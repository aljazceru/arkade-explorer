import { describe, expect, it } from "vitest";
import arkadeSnapshot from "../../../public/observation/arkade.json";
import barkSnapshot from "../../../public/observation/bark.json";
import {
    buildBarkdRecords,
    buildOverviewRecords,
    formatSnapshotLabel,
    getArkadeRecordStatus,
} from "@/components/overview/records-table";
import type { BarkdVtxo } from "@/lib/barkd";
import type { ArkadeObservation, ArkadeVtxoRow, BarkObservation } from "@/lib/observation";
import { parseRelativeTimelock, timelockToSecondsAndBlocks } from "@/lib/vtxo-display";

const arkade = arkadeSnapshot as unknown as ArkadeObservation;
const bark = barkSnapshot as unknown as BarkObservation;

const DAY = 86_400;

describe("getArkadeRecordStatus", () => {
    const baseRow: ArkadeVtxoRow = { txid: "synthetic", vout: 0, amount_sat: 1_000 };
    const exitSeconds = 3 * DAY;
    const threeDaysElevenHours = 3 * DAY + 11 * 3_600 + 59 * 60;

    const cases: Array<{
        name: string;
        row: ArkadeVtxoRow;
        exitSeconds: number | null;
        expected: {
            status: "urgent" | "expired" | "unknown" | "settled" | "healthy";
            statusLabel: string;
            needsReview: boolean;
            leftSeconds: number | null;
        };
    }> = [
        {
            name: "settles a spent row even when its expiry is urgent",
            row: { ...baseRow, isSpent: true, urgent: true, left_seconds: 60 },
            exitSeconds,
            // The spent flag wins; the explicit urgent flag still requires review.
            expected: {
                status: "settled",
                statusLabel: "Settled",
                needsReview: true,
                leftSeconds: 60,
            },
        },
        {
            name: "expires at zero remaining seconds",
            row: { ...baseRow, left_seconds: 0 },
            exitSeconds,
            // Zero is expired (not urgent), needs review, and remains zero in the result.
            expected: {
                status: "expired",
                statusLabel: "Expired",
                needsReview: true,
                leftSeconds: 0,
            },
        },
        {
            name: "expires when the explicit expired flag is set",
            row: { ...baseRow, left_seconds: DAY, expired: true },
            exitSeconds,
            // The explicit flag wins over positive time remaining.
            expected: {
                status: "expired",
                statusLabel: "Expired",
                needsReview: true,
                leftSeconds: DAY,
            },
        },
        {
            name: "marks a null lifetime unknown",
            row: { ...baseRow, left_seconds: null },
            exitSeconds,
            // Null stays null and cannot be used to compute an expiry countdown.
            expected: {
                status: "unknown",
                statusLabel: "Expiry unknown",
                needsReview: true,
                leftSeconds: null,
            },
        },
        {
            name: "marks the exact exit threshold urgent",
            row: { ...baseRow, left_seconds: exitSeconds },
            exitSeconds,
            // At 259,200 seconds the row is urgent; formatDuration renders 3d 0h.
            expected: {
                status: "urgent",
                statusLabel: "3d 0h left",
                needsReview: true,
                leftSeconds: exitSeconds,
            },
        },
        {
            name: "marks an explicitly urgent row urgent and formats its countdown",
            row: { ...baseRow, left_seconds: threeDaysElevenHours, urgent: true },
            exitSeconds,
            // 3d 11h 59m floors to 3d 11h using the app duration formatter.
            expected: {
                status: "urgent",
                statusLabel: "3d 11h left",
                needsReview: true,
                leftSeconds: threeDaysElevenHours,
            },
        },
        {
            name: "keeps a row healthy above the exit threshold",
            row: { ...baseRow, left_seconds: threeDaysElevenHours },
            exitSeconds,
            // The same 3d 11h display is healthy because the row is beyond the 3-day threshold.
            expected: {
                status: "healthy",
                statusLabel: "3d 11h left",
                needsReview: false,
                leftSeconds: threeDaysElevenHours,
            },
        },
        {
            name: "reports an unavailable exit window separately from unknown expiry",
            row: { ...baseRow, left_seconds: 3_600 },
            exitSeconds: null,
            // Lifetime is known as 3,600 seconds, but there is no exit delay to compare against.
            expected: {
                status: "unknown",
                statusLabel: "Exit window unavailable",
                needsReview: false,
                leftSeconds: 3_600,
            },
        },
    ];

    it.each(cases)("$name", ({ row, exitSeconds: rowExitSeconds, expected }) => {
        expect(getArkadeRecordStatus(row, rowExitSeconds)).toEqual(expected);
    });
});

describe("buildOverviewRecords", () => {
    it("builds virtual, commitment, reference, and on-chain records from minimal fixtures", () => {
        const arkadeFixture: ArkadeObservation = {
            fetched_at: "2026-01-02T03:04:05Z",
            info: {},
            stats_24h: {},
            trends: [],
            recent_activity: [],
            vtxos: [
                {
                    txType: "refresh",
                    txid: "vtxo-a",
                    vout: 1,
                    amount_sat: 1_234,
                    left_seconds: 300_000,
                    createdAt: "1700000000",
                    commitmentTxids: ["commit-onchain", "ref-only", "ref-only"],
                },
                {
                    txType: "commitment",
                    txid: "commit-row",
                    vout: 0,
                    amount_sat: 777,
                    left_seconds: 3_000,
                },
            ],
            commitments: {
                "commit-onchain": {
                    _onchain: { block_height: 42, total_sats: 5_000, block_time: 1_700_000_100 },
                },
                "commit-observed": { totalOutputAmount: "2000", startedAt: "1700000200" },
            },
            notes: [],
            source: {},
        };
        const barkFixture: BarkObservation = {
            fetched_at: "2026-01-02T03:04:06Z",
            info: {},
            recent_server_txs: [
                {
                    txid: "bark-confirmed",
                    block_height: 12,
                    block_time_rome: "2026-01-02T03:00:00Z",
                    vin: 1,
                    vout: 2,
                    total_sats: 900,
                    direction: "to_server",
                    mempool_url: "https://example.invalid/confirmed",
                },
                {
                    txid: "bark-observed",
                    vin: 1,
                    vout: 1,
                    total_sats: 400,
                    direction: "from_server",
                    mempool_url: "https://example.invalid/observed",
                },
            ],
            stats_24h: {},
            notes: [],
            source: {},
        };
        const records = buildOverviewRecords(arkadeFixture, barkFixture, 3_600);

        // The virtual row has 300,000 seconds left (3d 11h after flooring); the commitment
        // row is urgent at 3,000 seconds; map commitments are confirmed/observed; duplicate
        // ref-only ids collapse to one amount-less reference; Bark status follows block height.
        expect(
            records.map((record) => ({
                id: record.id,
                kind: record.kind,
                amountSat: record.amountSat,
                status: record.status,
                statusLabel: record.statusLabel,
                needsReview: record.needsReview,
                leftSeconds: record.leftSeconds,
                blockHeight: record.blockHeight,
            })),
        ).toEqual([
            {
                id: "arkade-vtxo:vtxo-a:1",
                kind: "virtual",
                amountSat: 1_234,
                status: "healthy",
                statusLabel: "3d 11h left",
                needsReview: false,
                leftSeconds: 300_000,
                blockHeight: null,
            },
            {
                id: "arkade-commitment:commit-onchain",
                kind: "commitment",
                amountSat: 5_000,
                status: "confirmed",
                statusLabel: "Confirmed",
                needsReview: false,
                leftSeconds: null,
                blockHeight: 42,
            },
            {
                id: "arkade-commitment:commit-observed",
                kind: "commitment",
                amountSat: 2_000,
                status: "observed",
                statusLabel: "Observed",
                needsReview: false,
                leftSeconds: null,
                blockHeight: null,
            },
            {
                id: "arkade-commitment:commit-row",
                kind: "commitment",
                amountSat: 777,
                status: "urgent",
                statusLabel: "50m left",
                needsReview: true,
                leftSeconds: 3_000,
                blockHeight: null,
            },
            {
                id: "arkade-commitment:ref-only",
                kind: "commitment",
                amountSat: null,
                status: "observed",
                statusLabel: "Observed",
                needsReview: false,
                leftSeconds: null,
                blockHeight: null,
            },
            {
                id: "second-onchain:bark-confirmed",
                kind: "onchain",
                amountSat: 900,
                status: "confirmed",
                statusLabel: "Confirmed",
                needsReview: false,
                leftSeconds: null,
                blockHeight: 12,
            },
            {
                id: "second-onchain:bark-observed",
                kind: "onchain",
                amountSat: 400,
                status: "observed",
                statusLabel: "Observed",
                needsReview: false,
                leftSeconds: null,
                blockHeight: null,
            },
        ]);
        expect(
            records.filter((record) => record.kind === "virtual").map((record) => record.txid),
        ).toEqual(["vtxo-a"]);
        expect(
            records.filter((record) => record.label === "Arkade commitment reference"),
        ).toHaveLength(1);
    });
});

describe("buildBarkdRecords", () => {
    const now = Date.UTC(2026, 0, 2, 3, 4, 5);
    const cases: Array<{
        name: string;
        row: BarkdVtxo;
        tipHeight: number | null;
        expected: {
            id: string;
            status: string;
            statusLabel: string;
            leftSeconds: number | null;
            chainAnchor: string;
        };
    }> = [
        {
            name: "healthy spendable VTXO far beyond the exit window",
            row: {
                id: "far:0",
                amountSat: 1_000,
                policyType: "server",
                expiryHeight: 2_000,
                exitDelta: 6,
                exitDepth: null,
                chainAnchor: "anchor:far",
                state: { type: "spendable" },
            },
            tipHeight: 1_000,
            // 2,000 - 1,000 = 1,000 blocks; 1,000 * 600 = 600,000 seconds = 6d 22h.
            expected: {
                id: "second-barkd:far:0",
                status: "healthy",
                statusLabel: "6d 22h left",
                leftSeconds: 600_000,
                chainAnchor: "anchor:far",
            },
        },
        {
            name: "urgent spendable VTXO inside the exit window",
            row: {
                id: "urgent:1",
                amountSat: 2_000,
                policyType: "server",
                expiryHeight: 1_005,
                exitDelta: 6,
                exitDepth: 2,
                chainAnchor: "anchor:urgent",
                state: { type: "spendable" },
            },
            tipHeight: 1_000,
            // Five blocks remain (3,000 seconds), within the 3,600-second exit delay: 50m.
            expected: {
                id: "second-barkd:urgent:1",
                status: "urgent",
                statusLabel: "50m left",
                leftSeconds: 3_000,
                chainAnchor: "anchor:urgent",
            },
        },
        {
            name: "unknown when the chain tip is unavailable",
            row: {
                id: "unknown:2",
                amountSat: 3_000,
                policyType: "server",
                expiryHeight: 1_005,
                exitDelta: 6,
                exitDepth: null,
                chainAnchor: "anchor:unknown",
                state: { type: "spendable" },
            },
            tipHeight: null,
            // No tip means the expiry difference is unknown rather than an estimated countdown.
            expected: {
                id: "second-barkd:unknown:2",
                status: "unknown",
                statusLabel: "Expiry unknown",
                leftSeconds: null,
                chainAnchor: "anchor:unknown",
            },
        },
        {
            name: "keeps a locked VTXO locked without a countdown",
            row: {
                id: "locked:3",
                amountSat: 4_000,
                policyType: "server",
                expiryHeight: 1_005,
                exitDelta: 6,
                exitDepth: null,
                chainAnchor: "anchor:locked",
                state: { type: "locked" },
            },
            tipHeight: 1_000,
            // Locked state is terminal for this status calculation; it has no lifetime countdown.
            expected: {
                id: "second-barkd:locked:3",
                status: "locked",
                statusLabel: "Locked in round",
                leftSeconds: null,
                chainAnchor: "anchor:locked",
            },
        },
        {
            name: "settles a spent VTXO without a countdown",
            row: {
                id: "spent:4",
                amountSat: 5_000,
                policyType: "server",
                expiryHeight: 1_005,
                exitDelta: 6,
                exitDepth: null,
                chainAnchor: "anchor:spent",
                state: { type: "spent" },
            },
            tipHeight: 1_000,
            // Spent state wins over the still-positive 3,000-second computed lifetime.
            expected: {
                id: "second-barkd:spent:4",
                status: "settled",
                statusLabel: "Settled",
                leftSeconds: null,
                chainAnchor: "anchor:spent",
            },
        },
        {
            name: "expires when the height difference is negative",
            row: {
                id: "expired:5",
                amountSat: 6_000,
                policyType: "server",
                expiryHeight: 999,
                exitDelta: 6,
                exitDepth: null,
                chainAnchor: "anchor:expired",
                state: { type: "spendable" },
            },
            tipHeight: 1_000,
            // 999 - 1,000 = -1 block; -1 * 600 = -600 seconds, so the row is expired.
            expected: {
                id: "second-barkd:expired:5",
                status: "expired",
                statusLabel: "Expired",
                leftSeconds: -600,
                chainAnchor: "anchor:expired",
            },
        },
    ];

    it.each(cases)("$name", ({ row, tipHeight, expected }) => {
        const [record] = buildBarkdRecords([row], tipHeight, 3_600, now);
        expect(record).toMatchObject({
            id: expected.id,
            status: expected.status,
            statusLabel: expected.statusLabel,
            leftSeconds: expected.leftSeconds,
            liveSource: true,
            chainAnchor: expected.chainAnchor,
        });
    });
});

describe("formatSnapshotLabel", () => {
    it("formats snapshot time and age using the supplied clock", () => {
        const label = formatSnapshotLabel(
            "2026-10-19T12:34:56.000Z",
            Date.parse("2026-10-19T13:34:56.000Z"),
        );
        expect(label).toMatch(/^Snapshot \d{2}:\d{2} · 1h old$/);
    });

    it("reports unavailable snapshot timestamps", () => {
        expect(formatSnapshotLabel(undefined, 0)).toBe("Snapshot time unavailable");
        expect(formatSnapshotLabel("not a date", 0)).toBe("Snapshot time unavailable");
    });
});

describe("snapshot record invariants", () => {
    it("builds unique records whose classifications match the raw snapshots", () => {
        const rawDelay = arkade.info.unilateralExitDelay;
        const exitSeconds =
            typeof rawDelay === "string" || typeof rawDelay === "number"
                ? timelockToSecondsAndBlocks(parseRelativeTimelock(rawDelay)).seconds
                : null;
        const records = buildOverviewRecords(arkade, bark, exitSeconds);
        const nonCommitmentVtxos = arkade.vtxos.filter((row) => row.txType !== "commitment");
        const commitmentRowIds = new Set(
            arkade.vtxos.filter((row) => row.txType === "commitment").map((row) => row.txid),
        );
        const commitmentObjectIds = new Set(Object.keys(arkade.commitments));
        const representedCommitmentIds = new Set([...commitmentRowIds, ...commitmentObjectIds]);
        const referencedCommitmentIds = new Set(
            arkade.vtxos.flatMap((row) => row.commitmentTxids ?? []),
        );
        const additionalCommitmentRows = [...commitmentRowIds].filter(
            (txid) => !commitmentObjectIds.has(txid),
        ).length;
        const referenceOnlyCommitments = [...referencedCommitmentIds].filter(
            (txid) => !representedCommitmentIds.has(txid),
        ).length;
        const expectedCount =
            nonCommitmentVtxos.length +
            commitmentObjectIds.size +
            additionalCommitmentRows +
            referenceOnlyCommitments +
            bark.recent_server_txs.length;

        const virtualRecords = records.filter((record) => record.kind === "virtual");
        const commitmentRecords = records.filter((record) => record.kind === "commitment");
        const onchainRecords = records.filter((record) => record.kind === "onchain");

        // Counts are derived from raw rows and independently deduplicated txid sets: every
        // non-commitment VTXO, each indexed commitment, unrepresented commitment row/reference,
        // and each Second server transaction contributes exactly one record.
        expect(virtualRecords).toHaveLength(nonCommitmentVtxos.length);
        expect(commitmentRecords).toHaveLength(
            commitmentObjectIds.size + additionalCommitmentRows + referenceOnlyCommitments,
        );
        expect(onchainRecords).toHaveLength(bark.recent_server_txs.length);
        expect(virtualRecords.length + commitmentRecords.length + onchainRecords.length).toBe(
            records.length,
        );
        expect(records.length).toBe(expectedCount);

        const ids = records.map((record) => record.id);
        expect(new Set(ids).size).toBe(records.length);
        for (const row of arkade.vtxos.filter((candidate) => candidate.txType === "commitment")) {
            expect(records).not.toContainEqual(
                expect.objectContaining({
                    id: `arkade-vtxo:${row.txid}:${row.vout}`,
                    kind: "virtual",
                }),
            );
        }

        for (const record of records) {
            if (record.needsReview) {
                const sourceRow = arkade.vtxos.find((row) => row.txid === record.txid);
                expect(
                    ["urgent", "expired", "unknown"].includes(record.status) ||
                        sourceRow?.urgent === true,
                ).toBe(true);
            }
            if (record.amountSat === null) {
                expect(record.kind).toBe("commitment");
                expect(record.label).toBe("Arkade commitment reference");
            }
        }

        for (const record of onchainRecords) {
            const sourceTx = bark.recent_server_txs.find((row) => row.txid === record.txid);
            expect(sourceTx).toBeDefined();
            const confirmed =
                sourceTx?.block_height !== undefined && sourceTx.block_height !== null;
            expect(record.statusLabel).toBe(confirmed ? "Confirmed" : "Observed");
        }

        expect(formatSnapshotLabel(arkade.fetched_at)).toMatch(/^Snapshot \d{2}:\d{2} · .*old$/);
    });
});

describe("Arkade status properties", () => {
    it("keeps urgency threshold crossings, expiry, and terminal priority consistent", () => {
        let seed = 0x1badf00d;
        const next = () => {
            seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
            return seed;
        };
        const baseRow: ArkadeVtxoRow = { txid: "generated", vout: 0, amount_sat: 1 };

        for (let index = 0; index < 200; index += 1) {
            const exitSeconds = 2 + (next() % 1_000_000);
            const justAbove = getArkadeRecordStatus(
                { ...baseRow, left_seconds: exitSeconds + 1 },
                exitSeconds,
            );
            const atThreshold = getArkadeRecordStatus(
                { ...baseRow, left_seconds: exitSeconds },
                exitSeconds,
            );
            const justBelow = getArkadeRecordStatus(
                { ...baseRow, left_seconds: exitSeconds - 1 },
                exitSeconds,
            );
            // Above the fixed threshold is healthy; at and just below it are urgent.
            expect(justAbove.status).toBe("healthy");
            expect(atThreshold.status).toBe("urgent");
            expect(justBelow.status).toBe("urgent");

            const negativeSeconds = -(next() % 10_000) - 1;
            expect(
                getArkadeRecordStatus({ ...baseRow, left_seconds: negativeSeconds }, exitSeconds)
                    .status,
            ).toBe("expired");

            const terminalSignal = next() % 3;
            const terminalRow: ArkadeVtxoRow = {
                ...baseRow,
                left_seconds: terminalSignal === 1 ? negativeSeconds : exitSeconds - 1,
                urgent: true,
                ...(terminalSignal === 0
                    ? { isSpent: true }
                    : terminalSignal === 1
                      ? { spentBy: "terminal-spend" }
                      : { settledBy: "terminal-settlement" }),
            };
            // Any terminal marker wins the visible status even with an urgent flag or expiry.
            expect(getArkadeRecordStatus(terminalRow, exitSeconds).status).toBe("settled");
        }
    });
});
