import { describe, expect, it } from "vitest";
import {
    arkMinGapPx,
    arkNodeRadius,
    computeArkLayer,
    formatStubAnchor,
    hourlyAreaPath,
    placeRailLabels,
    placeStubLabels,
    stackLane,
    timeForHeight,
    type ArkBlock,
    type ArkCommitment,
    type ArkEvent,
    type ArkLayerInput,
    type ArkSecondTx,
} from "@/lib/atlas/ark-layer";

const HOUR = 3600;
const DAY = 86400;
const NOW = 1_800_000_000; // fixed clock

function blocksBetween(
    startHeight: number,
    count: number,
    startTime: number,
    interval = 600,
): ArkBlock[] {
    // Newest-first like Esplora; tests want coverage of [NOW-30h, NOW].
    return Array.from({ length: count }, (_, i) => ({
        height: startHeight - i,
        time: startTime - i * interval,
        txCount: 2000 + i,
        size: 1_500_000,
    }));
}
function baseInput(overrides: Partial<ArkLayerInput> = {}): ArkLayerInput {
    return {
        nowSec: NOW,
        windowSec: DAY,
        // 144 blocks × 600 s = 24 h ending at NOW.
        blocks: blocksBetween(800_000, 144, NOW),
        ...overrides,
    };
}
describe("timeForHeight", () => {
    const sampled = [
        { height: 100, time: 1000 },
        { height: 110, time: 7000 }, // 600 s/block
    ];

    it("returns the exact time for a sampled height", () => {
        expect(timeForHeight(110, sampled, 600)).toBe(7000);
    });

    it("interpolates an unsampled height from the nearest block", () => {
        // nearest is 110 (distance 2 vs 13): 7000 + 2*600
        expect(timeForHeight(112, sampled, 600)).toBe(8200);
        // nearest is 100 (distance 5 vs 8): 1000 + 5*600
        expect(timeForHeight(105, sampled, 600)).toBe(4000);
    });

    it("returns null without a median interval or samples", () => {
        expect(timeForHeight(105, sampled, null)).toBeNull();
        expect(timeForHeight(105, [], 600)).toBeNull();
    });
});

describe("arkNodeRadius", () => {
    it("scales with sqrt(amount) and clamps", () => {
        expect(arkNodeRadius(0, 1000)).toBe(3.5);
        expect(arkNodeRadius(null, 1000)).toBe(3.5);
        // max amount → 3.5 + 7 = 10.5
        expect(arkNodeRadius(1000, 1000)).toBeCloseTo(10.5);
        // quarter of max → 3.5 + 7*0.5 = 7
        expect(arkNodeRadius(250, 1000)).toBeCloseTo(7);
        expect(arkNodeRadius(1e12, 1)).toBe(10.5);
    });
});

describe("arkMinGapPx", () => {
    it("matches the window bands", () => {
        expect(arkMinGapPx(6 * HOUR)).toBe(30);
        expect(arkMinGapPx(6 * HOUR + 1)).toBe(22);
        expect(arkMinGapPx(DAY)).toBe(22);
        expect(arkMinGapPx(DAY + 1)).toBe(14);
    });
});

describe("stackLane", () => {
    it("keeps baseline spacing and stacks close items, capped", () => {
        const items = [
            { x: 100, id: "a" },
            { x: 110, id: "b" }, // within gap → stack 1
            { x: 115, id: "c" }, // within gap of b → stack 2
            { x: 200, id: "d" }, // gap vs 115 is 85 → reset
            { x: 205, id: "e" }, // stack 1
        ];
        const out = stackLane(items, 100, 22, 3, 15);
        expect(out.map((o) => [o.id, o.y, o.stack])).toEqual([
            ["a", 100, 0],
            ["b", 115, 1],
            ["c", 130, 2],
            ["d", 100, 0],
            ["e", 115, 1],
        ]);
    });

    it("caps the stack depth", () => {
        const items = Array.from({ length: 8 }, (_, i) => ({ x: 100 + i * 5, id: String(i) }));
        const out = stackLane(items, 0, 22, 3, 15);
        expect(Math.max(...out.map((o) => o.stack))).toBe(3);
    });

    it("sorts by x regardless of input order", () => {
        const out = stackLane(
            [
                { x: 50, id: "late" },
                { x: 10, id: "early" },
            ],
            0,
            22,
            3,
            15,
        );
        expect(out.map((o) => o.id)).toEqual(["early", "late"]);
    });
});

describe("placeStubLabels", () => {
    it("places non-colliding labels in row 0 first, row 1 on collision", () => {
        const stubs = [
            { x: 100, anchorTime: 0, inWindow: false, dir: -1 as const, rels: ["a"] },
            { x: 120, anchorTime: 0, inWindow: false, dir: -1 as const, rels: ["b"] }, // 20px away → row 1
            { x: 300, anchorTime: 0, inWindow: false, dir: 1 as const, rels: ["c"] },
        ];
        const out = placeStubLabels(stubs, 1000);
        expect(out).toHaveLength(3);
        expect(out.find((s) => s.rels[0] === "a")?.row).toBe(0);
        expect(out.find((s) => s.rels[0] === "b")?.row).toBe(1);
        expect(out.find((s) => s.rels[0] === "c")?.row).toBe(0);
    });

    it("drops a label that collides on both rows", () => {
        const stubs = [
            { x: 100, anchorTime: 0, inWindow: false, dir: -1 as const, rels: ["a"] },
            { x: 110, anchorTime: 0, inWindow: false, dir: -1 as const, rels: ["b"] },
            { x: 118, anchorTime: 0, inWindow: false, dir: -1 as const, rels: ["c"] },
        ];
        const out = placeStubLabels(stubs, 1000);
        // a→row0, b→row1, c collides with both → dropped
        expect(out.map((s) => s.rels[0])).toEqual(["a", "b"]);
    });
});

describe("formatStubAnchor", () => {
    it("formats in-window and directional anchors", () => {
        expect(formatStubAnchor(500, 900, true)).toBe("in win");
        // anchor 10d before edge → "anchored <10d"
        expect(formatStubAnchor(900 - 10 * DAY, 900, false)).toBe("anchored <10d");
        // anchor after edge → ">"
        expect(formatStubAnchor(900 + 3 * DAY + 100, 900, false)).toBe("anchored >3d");
    });
});

describe("placeRailLabels", () => {
    it("spaces labels by width and keeps the last label near the edge", () => {
        const items = [
            { x: 100, height: 1 },
            { x: 120, height: 2 }, // 20 < 34 → skipped
            { x: 140, height: 3 }, // 40 ≥ 34 → placed
            { x: 150, height: 4 }, // last; 10 < 18.7 → skipped
        ];
        const out = placeRailLabels(items, 1000, 34);
        expect([...out.keys()]).toEqual([1, 3]);
    });
});

describe("hourlyAreaPath", () => {
    const xOf = (t: number) => t; // identity for math checks
    it("returns null with no active buckets", () => {
        expect(hourlyAreaPath([], xOf, 100, 20, 0, 1000)).toBeNull();
        expect(
            hourlyAreaPath([{ hourStart: 0, virtualTxCount: 0 }], xOf, 100, 20, 0, 1000),
        ).toBeNull();
    });

    it("builds a step path clipped to the plot and breaks on gaps", () => {
        const buckets = [
            { hourStart: -HOUR, virtualTxCount: 5 }, // clipped left edge
            { hourStart: 0, virtualTxCount: 5 },
            { hourStart: HOUR, virtualTxCount: 0 }, // gap
            { hourStart: 2 * HOUR, virtualTxCount: 2 },
        ];
        const d = hourlyAreaPath(buckets, xOf, 100, 20, 0, 10 * HOUR);
        expect(d).not.toBeNull();
        // Two subpaths (two Z) because of the zero-count hour.
        expect(d!.match(/Z/g)).toHaveLength(2);
        expect(d).toContain("M");
    });
});

describe("computeArkLayer", () => {
    const event = (over: Partial<ArkEvent>): ArkEvent => ({
        id: "e1",
        txid: "tx1",
        kind: "virtual" as const,
        time: NOW - 2 * HOUR,
        amountSat: 1000,
        recordId: "rec1",
        recordIds: ["rec1"],
        commitmentId: null,
        vtxoCount: 1,
        statusLabel: "7d 0h left",
        needsReview: false,
        state: "healthy" as const,
        live: false,
        ...over,
    });
    const commitment = (over: Partial<ArkCommitment>): ArkCommitment => ({
        txid: "cm1",
        blockHeight: null,
        blockTimeSeconds: null,
        awaitingBlock: true,
        createdAtSeconds: NOW - 5 * HOUR,
        amountSat: 5000,
        vtxoCount: 3,
        recordId: "cmrec1",
        ...over,
    });
    const secondTx = (over: Partial<ArkSecondTx>): ArkSecondTx => ({
        id: "s1",
        txid: "stx1",
        time: NOW - HOUR,
        amountSat: 2000,
        blockHeight: null,
        direction: "to_server",
        recordId: "srec1",
        statusLabel: "Confirmed",
        ...over,
    });

    it("maps time to x on a shared axis and clips outside the window", () => {
        const layout = computeArkLayer(
            baseInput({
                events: [
                    event({ id: "in", time: NOW - 12 * HOUR }),
                    event({ id: "out", time: NOW - 3 * DAY }),
                ],
            }),
        );
        expect(layout.events).toHaveLength(1);
        expect(layout.events[0].id).toBe("in");
        // 12h into a 24h window ending at now → halfway across the plot.
        const plotWidth = layout.plotRight - layout.plotLeft;
        expect(layout.events[0].x).toBeCloseTo(layout.plotLeft + plotWidth / 2, 5);
    });

    it("places the now edge at the right edge when pan is zero", () => {
        const layout = computeArkLayer(baseInput());
        expect(layout.nowX).toBeCloseTo(layout.plotRight, 5);
        expect(layout.tEnd).toBe(NOW);
        expect(layout.tStart).toBe(NOW - DAY);
    });

    it("shifts the window when panning", () => {
        const layout = computeArkLayer(baseInput({ windowSec: DAY }), { panSec: -3600 });
        // panSec -3600 → tEnd = now + 1h: future content enters from the right.
        expect(layout.tEnd).toBe(NOW + HOUR);
    });

    it("anchors a confirmed commitment to its block time on the rail", () => {
        const blocks = baseInput().blocks!;
        const blockTime = blocks[10].time; // inside window
        const cm = commitment({
            txid: "cm-confirmed",
            awaitingBlock: false,
            blockHeight: blocks[10].height,
            blockTimeSeconds: blockTime,
            createdAtSeconds: NOW - DAY,
        });
        const layout = computeArkLayer(baseInput({ blocks, commitments: [cm] }));
        expect(layout.commitments).toHaveLength(1);
        const expectedX =
            layout.plotLeft +
            ((blockTime - layout.tStart) / DAY) * (layout.plotRight - layout.plotLeft);
        expect(layout.commitments[0].x).toBeCloseTo(expectedX, 4);
        expect(layout.commitments[0].awaitingBlock).toBe(false);
        const railItem = layout.rail.find((r) => r.height === blocks[10].height);
        expect(railItem?.commitTxid).toBe("cm-confirmed");
    });

    it("marks unconfirmed commitments as awaiting block at creation time", () => {
        const layout = computeArkLayer(
            baseInput({
                commitments: [commitment({ txid: "cm-wait", createdAtSeconds: NOW - 3 * HOUR })],
            }),
        );
        expect(layout.commitments).toHaveLength(1);
        expect(layout.commitments[0].awaitingBlock).toBe(true);
    });

    it("threads events to in-window commitments and stubs the rest", () => {
        const blocks = baseInput().blocks!;
        const blockTime = blocks[10].time;
        const inWin = commitment({
            txid: "cm-in",
            awaitingBlock: false,
            blockHeight: blocks[10].height,
            blockTimeSeconds: blockTime,
            createdAtSeconds: NOW - DAY,
        });
        const outWin = commitment({
            txid: "cm-out",
            awaitingBlock: false,
            blockHeight: 700_000, // far outside the sample → interpolated time far away
            blockTimeSeconds: null,
            createdAtSeconds: NOW - 10 * DAY,
        });
        const evIn = event({ id: "ev-in", commitmentId: "cm-in", time: NOW - 4 * HOUR });
        const evOut = event({
            id: "ev-out",
            txid: "tx2",
            commitmentId: "cm-out",
            time: NOW - 6 * HOUR,
        });
        const layout = computeArkLayer(
            baseInput({ blocks, commitments: [inWin, outWin], events: [evIn, evOut] }),
        );
        // ev-in's commitment diamond is on canvas → no stub.
        // ev-out's commitment anchor is outside the window → one stub.
        expect(layout.stubs).toHaveLength(1);
        expect(layout.stubs[0].rels).toContain("rec:rec1");
        // Both commitments still placed if their anchor times are in window:
        // cm-out's interpolated time is far outside → only cm-in placed.
        expect(layout.commitments.map((c) => c.txid)).toEqual(["cm-in"]);
    });

    it("flags interpolated commitment anchors as estimated", () => {
        const blocks = baseInput().blocks!;
        // Remove one block from the sample so its height is unsampled; the
        // commitment at that height gets an interpolated (estimated) anchor.
        const sparseBlocks = blocks.filter((b) => b.height !== 799990);
        const cm = commitment({
            txid: "cm-est",
            awaitingBlock: false,
            blockHeight: 799990, // removed from sample → interpolated time
            blockTimeSeconds: null,
            createdAtSeconds: NOW - DAY,
        });
        const layout = computeArkLayer(baseInput({ blocks: sparseBlocks, commitments: [cm] }));
        expect(layout.commitments).toHaveLength(1);
        expect(layout.commitments[0].anchorEstimated).toBe(true);
    });

    it("does not flag observed block-time anchors as estimated", () => {
        const blocks = baseInput().blocks!;
        const blockTime = blocks[10].time;
        const cm = commitment({
            txid: "cm-obs",
            awaitingBlock: false,
            blockHeight: blocks[10].height,
            blockTimeSeconds: blockTime,
            createdAtSeconds: NOW - DAY,
        });
        const layout = computeArkLayer(baseInput({ blocks, commitments: [cm] }));
        expect(layout.commitments).toHaveLength(1);
        expect(layout.commitments[0].anchorEstimated).toBe(false);
    });

    it("filters lanes", () => {
        const layout = computeArkLayer(
            baseInput({ events: [event({})], secondTxs: [secondTx({})] }),
            { lane: "arkade" },
        );
        expect(layout.events).toHaveLength(1);
        expect(layout.secondTxs).toHaveLength(0);
        expect(layout.rail.every((r) => r.secondTxid === undefined)).toBe(true);

        const secondOnly = computeArkLayer(
            baseInput({ events: [event({})], secondTxs: [secondTx({})] }),
            { lane: "second" },
        );
        expect(secondOnly.events).toHaveLength(0);
        expect(secondOnly.secondTxs).toHaveLength(1);
    });

    it("positions Second txs at their block time and offsets shared blocks", () => {
        const blocks = baseInput().blocks!;
        const bt = blocks[5].time;
        const tx = secondTx({ blockHeight: blocks[5].height, time: bt });
        const layout = computeArkLayer(baseInput({ blocks, secondTxs: [tx] }));
        const expectedX =
            layout.plotLeft + ((bt - layout.tStart) / DAY) * (layout.plotRight - layout.plotLeft);
        expect(layout.secondTxs[0].x).toBeCloseTo(expectedX, 4);
        expect(layout.rail.find((r) => r.height === blocks[5].height)?.secondTxid).toBe("stx1");
    });

    it("shows the next-round ghost only for a future announced time", () => {
        // A future nextRoundAt inside the panned window renders the ghost.
        const inside = computeArkLayer(baseInput({ nextRoundAt: NOW + 30 * 60 }), {
            panSec: -3600,
        });
        expect(inside.nextRound).not.toBeNull();
        expect(inside.nextRound?.time).toBe(NOW + 30 * 60);
        // A future time outside the visible window does not render.
        const outside = computeArkLayer(baseInput({ nextRoundAt: NOW + 3 * DAY }));
        expect(outside.nextRound).toBeNull();
        // A past nextRoundAt is NOT rolled forward — the server announced a
        // time that has passed; inventing the next one would fabricate a
        // schedule the server never published.
        const rolled = computeArkLayer(baseInput({ nextRoundAt: NOW - 90 * 60 }), {
            panSec: -4 * HOUR,
        });
        expect(rolled.nextRound).toBeNull();
    });

    it("builds coverage meta and rail ordering", () => {
        const layout = computeArkLayer(
            baseInput({
                secondTxs: [secondTx({ blockHeight: 800_030, time: NOW - 2 * HOUR })],
            }),
        );
        const times = layout.rail.map((r) => r.time);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(layout.coverage).toContain("sampled blocks");
        expect(layout.coverage).toContain("Arkade txs");
        expect(layout.coverage).toContain("commitments");
        expect(layout.coverage).toContain("Second txs");
    });
});
