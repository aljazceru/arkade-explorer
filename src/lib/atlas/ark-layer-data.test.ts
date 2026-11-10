import { describe, expect, it } from "vitest";
import arkadeSnapshot from "../../../public/observation/arkade.json";
import type { ArkadeObservation } from "@/lib/observation";
import type { OverviewRecord } from "@/lib/overview-records";
import { buildArkLayerInput, medianBatchLifetimeSeconds } from "@/lib/atlas/ark-layer-data";
import type { ChainBlock } from "@/hooks/use-recent-blocks";
import type { SecondServerTx } from "@/lib/live-second";

const arkade = arkadeSnapshot as unknown as ArkadeObservation;
const NOW = Math.floor(Date.now() / 1000);

function record(over: Partial<OverviewRecord>): OverviewRecord {
    return {
        id: "r1",
        txid: "tx1",
        network: "arkade",
        kind: "virtual",
        entity: "vtxo",
        typeLabel: "Virtual",
        label: "Payment output #0",
        amountSat: 1000,
        amountLabel: "VTXO value",
        status: "healthy",
        statusLabel: "5d 0h left",
        needsReview: false,
        leftSeconds: 400_000,
        exitSeconds: 86_400,
        createdAtSeconds: NOW - 3600,
        expiresAtSeconds: NOW + 400_000,
        recordedAt: NOW - 3600,
        snapshotFetchedAt: arkade.fetched_at,
        sourceLabel: "Arkade VTXO snapshot",
        commitmentTxids: [],
        blockHeight: null,
        ...over,
    };
}

const blocks: ChainBlock[] = Array.from({ length: 20 }, (_, i) => ({
    height: 900_000 - i,
    hash: `hash${i}`,
    time: NOW - i * 600,
    txCount: 1500,
    size: 1_400_000,
}));

describe("buildArkLayerInput", () => {
    it("groups virtual records by txid into one event", () => {
        const input = buildArkLayerInput(
            [
                record({ id: "a:0", txid: "shared" }),
                record({ id: "a:1", txid: "shared", amountSat: 500 }),
                record({ id: "b:0", txid: "other", amountSat: 250 }),
            ],
            null,
            blocks,
            null,
            { nowSec: NOW },
        );
        expect(input.events!).toHaveLength(2);
        const shared = input.events!.find((e) => e.txid === "shared");
        expect(shared?.vtxoCount).toBe(2);
        expect(shared?.amountSat).toBe(1500);
        expect(shared?.recordIds).toEqual(["a:0", "a:1"]);
    });

    it("does not double-count transaction notifications with VTXO outputs", () => {
        // A txid can have both per-output VTXO records (entity "vtxo") and a
        // stream transaction notification (entity "transaction") whose amount
        // is itself a sum of those outputs. The event amount must come only
        // from the VTXO entities.
        const input = buildArkLayerInput(
            [
                record({ id: "snap:0", txid: "mixed", amountSat: 1000 }),
                record({ id: "snap:1", txid: "mixed", amountSat: 500 }),
                record({
                    id: "ark-stream-transaction:mixed",
                    txid: "mixed",
                    kind: "virtual",
                    entity: "transaction",
                    typeLabel: "Virtual · stream",
                    amountSat: 1500, // notification sum — must NOT be added
                    amountLabel: "New VTXO outputs (notification)",
                    createdAtSeconds: NOW - 1800,
                    recordedAt: NOW - 1800,
                }),
            ],
            null,
            blocks,
            null,
            { nowSec: NOW },
        );
        expect(input.events!).toHaveLength(1);
        const event = input.events![0];
        expect(event.amountSat).toBe(1500); // 1000 + 500, not +1500 again
        expect(event.vtxoCount).toBe(2); // only real VTXO entities
        expect(event.recordIds).toHaveLength(3); // all members still linked
    });

    it("excludes unconfirmed Second txs from canvas (no honest time)", () => {
        const mempoolTx: SecondServerTx = {
            txid: "mempool1",
            blockHeight: null,
            blockTimeSeconds: null, // unconfirmed — no block_time
            direction: "to_server",
            totalSats: 500,
        };
        const input = buildArkLayerInput([], null, blocks, [mempoolTx], { nowSec: NOW });
        // Unconfirmed txs have no honest position — they stay in the records
        // table with unknown time rather than sliding on the canvas.
        expect(input.secondTxs!).toHaveLength(0);
    });

    it("skips records with no honest timestamp", () => {
        const input = buildArkLayerInput(
            [record({ createdAtSeconds: null, recordedAt: null })],
            null,
            blocks,
            null,
            { nowSec: NOW },
        );
        expect(input.events!).toHaveLength(0);
    });

    it("maps snapshot commitments with on-chain anchors", () => {
        const input = buildArkLayerInput([], arkade, blocks, null, { nowSec: NOW });
        const txids = Object.keys(arkade.commitments ?? {});
        expect(input.commitments!.length).toBe(txids.length);
        const confirmed = input.commitments!.filter((c) => !c.awaitingBlock);
        expect(confirmed.length).toBeGreaterThan(0);
        expect(confirmed[0].blockHeight).not.toBeNull();
        expect(confirmed[0].blockTimeSeconds).not.toBeNull();
        expect(confirmed[0].vtxoCount).not.toBeNull();
    });

    it("marks commitments without a block as awaiting", () => {
        const fake = {
            ...arkade,
            commitments: {
                deadbeef: { startedAt: String(NOW - 100), endedAt: String(NOW - 50), batches: {} },
            },
        } as unknown as ArkadeObservation;
        const input = buildArkLayerInput([], fake, blocks, null, { nowSec: NOW });
        expect(input.commitments!).toHaveLength(1);
        expect(input.commitments![0].awaitingBlock).toBe(true);
        expect(input.commitments![0].blockHeight).toBeNull();
        expect(input.commitments![0].createdAtSeconds).toBe(NOW - 100);
    });

    it("merges stream commitment records into snapshot commitments", () => {
        const streamCm = record({
            id: "ark-stream-commitment:cm1",
            txid: "cm1",
            kind: "commitment",
            entity: "transaction",
            typeLabel: "Commitment · stream",
            createdAtSeconds: NOW - 600,
            recordedAt: NOW - 600,
        });
        const fake = {
            ...arkade,
            commitments: {
                cm1: {
                    startedAt: String(NOW - 700),
                    endedAt: String(NOW - 650),
                    totalOutputAmount: "42000",
                    batches: { "0": { totalOutputVtxos: 2, expiresAt: String(NOW + 1000) } },
                    _onchain: { block_height: 899_990, block_time: NOW - 500, total_sats: 1 },
                },
            },
        } as unknown as ArkadeObservation;
        const input = buildArkLayerInput([streamCm], fake, blocks, null, { nowSec: NOW });
        expect(input.commitments!).toHaveLength(1);
        const cm = input.commitments![0];
        expect(cm.txid).toBe("cm1");
        expect(cm.blockHeight).toBe(899_990);
        expect(cm.amountSat).toBe(42000);
        expect(cm.vtxoCount).toBe(2);
        expect(cm.awaitingBlock).toBe(false);
    });

    it("keeps Second lane to live server txs only", () => {
        const liveTx: SecondServerTx = {
            txid: "stx1",
            blockHeight: 899_999,
            blockTimeSeconds: NOW - 300,
            direction: "to_server",
            totalSats: 12_345,
        };
        const secondRecord = record({
            id: "second-live:stx1",
            txid: "stx1",
            network: "second",
            kind: "onchain",
            entity: "transaction",
            typeLabel: "On-chain · live",
            createdAtSeconds: NOW - 300,
            recordedAt: NOW - 300,
            blockHeight: 899_999,
        });
        const barkRecord = record({
            id: "second-onchain:bark1",
            txid: "bark1",
            network: "second",
            kind: "onchain",
            entity: "transaction",
            createdAtSeconds: NOW - 200,
            recordedAt: NOW - 200,
        });
        const input = buildArkLayerInput([secondRecord, barkRecord], null, blocks, [liveTx], {
            nowSec: NOW,
        });
        expect(input.secondTxs!).toHaveLength(1);
        expect(input.secondTxs![0].txid).toBe("stx1");
        expect(input.secondTxs![0].direction).toBe("to_server");
    });

    it("flags hourly as unavailable when displayDate has no timezone", () => {
        const input = buildArkLayerInput([], arkade, blocks, null, { nowSec: NOW });
        // The fixture's displayDate is "YYYY-MM-DD HH:MM" with no timezone.
        // We MUST NOT fabricate one — the band is unavailable, not misaligned.
        expect(input.hourlyUnavailable).toBe(true);
        expect(input.hourly ?? []).toHaveLength(0);
    });

    it("parses hourly buckets when displayDate has explicit timezone", () => {
        const tzAware = {
            ...arkade,
            trends: [
                { displayDate: "2026-10-19T14:00:00Z", virtualTxCount: 5 },
                { displayDate: "2026-10-19T15:00:00Z", virtualTxCount: 3 },
            ],
        } as unknown as ArkadeObservation;
        const input = buildArkLayerInput([], tzAware, blocks, null, { nowSec: NOW });
        expect(input.hourlyUnavailable).toBe(false);
        expect(input.hourly).toHaveLength(2);
        expect(input.hourly![0].hourStart % 3600).toBe(0);
    });

    it("carries window/lane/nextRound options through", () => {
        const input = buildArkLayerInput([], null, blocks, null, {
            nowSec: NOW,
            windowSec: 6 * 3600,
            lane: "second",
            nextRoundAt: NOW + 600,
        });
        expect(input.windowSec).toBe(6 * 3600);
        expect(input.lane).toBe("second");
        expect(input.nextRoundAt).toBe(NOW + 600);
    });
});

describe("medianBatchLifetimeSeconds", () => {
    it("returns the median expiresAt-endedAt span", () => {
        const fake = {
            commitments: {
                a: {
                    endedAt: "1000",
                    batches: {
                        "0": { expiresAt: "2000" },
                        "1": { expiresAt: "4000" },
                    },
                },
                b: { endedAt: "5000", batches: { "0": { expiresAt: "9000" } } },
            },
        } as unknown as ArkadeObservation;
        const { seconds, sampleCount } = medianBatchLifetimeSeconds(fake);
        expect(sampleCount).toBe(3);
        // spans: 1000, 3000, 4000 → median 3000
        expect(seconds).toBe(3000);
    });

    it("returns null for empty input", () => {
        expect(medianBatchLifetimeSeconds(null).seconds).toBeNull();
        expect(medianBatchLifetimeSeconds(arkade).sampleCount).toBeGreaterThan(0);
    });
});
