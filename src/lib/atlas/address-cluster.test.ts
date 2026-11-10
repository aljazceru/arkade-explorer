import { describe, it, expect } from "vitest";
import type { VirtualCoin } from "@arkade-os/sdk";
import {
    vtxoCommitmentId,
    isTerminalState,
    clusterVtxos,
    packCluster,
    layoutConstellation,
    selectConstellation,
    MAX_FEATURED_CELLS,
    MAX_DOTS_PER_CLUSTER,
    MAX_HISTORY_DOTS,
    type ConstellationVtxo,
} from "@/lib/atlas/address-cluster";

function makeVtxo(p: Partial<VirtualCoin> = {}): VirtualCoin {
    return {
        txid: "aa",
        vout: 0,
        value: 1000,
        spentBy: "",
        isSpent: false,
        ...p,
    } as unknown as VirtualCoin;
}

function cv(p: Partial<ConstellationVtxo> & { outpoint?: string }): ConstellationVtxo {
    const txid = p.txid ?? "t";
    const vout = p.vout ?? 0;
    return {
        outpoint: p.outpoint ?? `${txid}:${vout}`,
        txid,
        vout,
        value: 1000,
        commitment: null,
        createdAtMs: null,
        expiresAtMs: null,
        lifetimeLeft: null,
        state: "settled",
        spent: false,
        urgent: false,
        ...p,
    };
}

describe("vtxoCommitmentId", () => {
    it("prefers commitmentTxIds[0]", () => {
        const v = makeVtxo({ commitmentTxIds: ["c1", "c2"], settledBy: "s1" });
        expect(vtxoCommitmentId(v)).toBe("c1");
    });
    it("falls back to settledBy", () => {
        expect(vtxoCommitmentId(makeVtxo({ settledBy: "s1" }))).toBe("s1");
    });
    it("returns null when nothing identifies a commitment", () => {
        expect(vtxoCommitmentId(makeVtxo())).toBeNull();
    });
});

describe("isTerminalState", () => {
    it("treats spent/spent-in-batch/unrolled as terminal but swept as recoverable", () => {
        expect(isTerminalState("spent")).toBe(true);
        expect(isTerminalState("spent-in-batch")).toBe(true);
        expect(isTerminalState("unrolled")).toBe(true);
        expect(isTerminalState("swept")).toBe(false);
    });
    it("treats live states as non-terminal", () => {
        for (const s of ["renew", "expired", "unknown", "preconfirmed", "settled", "unfinalized"]) {
            expect(isTerminalState(s)).toBe(false);
        }
    });
});

describe("clusterVtxos", () => {
    it("groups by commitment and sorts needs-action first", () => {
        const vtxos = [
            cv({ outpoint: "a:0", commitment: "c1" }),
            cv({ outpoint: "b:0", commitment: "c2", urgent: true }),
            cv({ outpoint: "c:0", commitment: "c1" }),
        ];
        const clusters = clusterVtxos(vtxos);
        expect(clusters).toHaveLength(2);
        expect(clusters[0].commitment).toBe("c2");
        expect(clusters[0].needsAction).toBe(true);
        expect(clusters[1].commitment).toBe("c1");
        expect(clusters[1].vtxos.map((v) => v.outpoint)).toEqual(["a:0", "c:0"]);
        expect(clusters[1].totalCount).toBe(2);
    });

    it("marks a cluster history when every member is spent", () => {
        const vtxos = [
            cv({ outpoint: "a:0", commitment: "c1", spent: true, state: "spent" }),
            cv({ outpoint: "b:0", commitment: "c1", spent: true, state: "spent-in-batch" }),
        ];
        const [cluster] = clusterVtxos(vtxos);
        expect(cluster.history).toBe(true);
        expect(cluster.liveCount).toBe(0);
    });

    it("sorts by live count desc within equal urgency", () => {
        const vtxos = [
            cv({ outpoint: "a:0", commitment: "small" }),
            cv({ outpoint: "b:0", commitment: "big" }),
            cv({ outpoint: "c:0", commitment: "big" }),
        ];
        const clusters = clusterVtxos(vtxos);
        expect(clusters[0].commitment).toBe("big");
    });

    it("puts the unanchored bucket last among equals", () => {
        const vtxos = [
            cv({ outpoint: "a:0", commitment: null }),
            cv({ outpoint: "b:0", commitment: "c1" }),
        ];
        const clusters = clusterVtxos(vtxos);
        expect(clusters[clusters.length - 1].commitment).toBeNull();
    });
});

describe("packCluster", () => {
    it("returns a single centred point for one VTXO", () => {
        const [p] = packCluster([cv({})], 40);
        expect(p.x).toBe(0);
        expect(p.y).toBe(0);
    });

    it("spreads members without coincident positions", () => {
        const members = Array.from({ length: 12 }, (_, i) =>
            cv({ outpoint: `t${i}:0`, txid: `t${i}` }),
        );
        const packed = packCluster(members, 60);
        const keys = new Set(packed.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
        expect(keys.size).toBe(members.length);
    });

    it("keeps every point inside the disc", () => {
        const members = Array.from({ length: 20 }, (_, i) =>
            cv({ outpoint: `t${i}:0`, txid: `t${i}` }),
        );
        const radius = 80;
        for (const p of packCluster(members, radius)) {
            expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(radius * 1.05);
        }
    });

    it("returns positions aligned with input order", () => {
        // n>4 takes the phyllotaxis path: live members pack inner, spent rim.
        const members = [
            cv({ outpoint: "s0:0", txid: "s0", spent: true }),
            cv({ outpoint: "s1:0", txid: "s1", spent: true }),
            ...Array.from({ length: 5 }, (_, i) => cv({ outpoint: `l${i}:0`, txid: `l${i}` })),
        ];
        const packed = packCluster(members, 60);
        expect(packed).toHaveLength(7);
        const dist = (i: number) => Math.hypot(packed[i].x, packed[i].y);
        // The two spent members (indices 0,1) sit farther out than live ones.
        expect(dist(0)).toBeGreaterThan(dist(2));
        expect(dist(1)).toBeGreaterThan(dist(2));
        expect(dist(0)).toBeGreaterThan(dist(6));
    });
});

describe("selectConstellation", () => {
    it("features small cluster sets without aggregates", () => {
        const vtxos = [
            cv({ outpoint: "a:0", commitment: "c1" }),
            cv({ outpoint: "b:0", commitment: "c2" }),
        ];
        const sel = selectConstellation(clusterVtxos(vtxos));
        expect(sel.items).toHaveLength(2);
        expect(sel.items.every((i) => i.kind === "cluster")).toBe(true);
        expect(sel.totalVtxos).toBe(2);
        expect(sel.drawnVtxos).toBe(2);
    });

    it("caps featured cells and folds the rest into aggregates", () => {
        // 15 live clusters of 2 vtxos each → 10 featured + aggregates.
        const vtxos = Array.from({ length: 30 }, (_, i) =>
            cv({ outpoint: `t${i}:0`, txid: `t${i}`, commitment: `c${Math.floor(i / 2)}` }),
        );
        const sel = selectConstellation(clusterVtxos(vtxos));
        const clusterItems = sel.items.filter((i) => i.kind === "cluster");
        const aggItems = sel.items.filter((i) => i.kind === "aggregate");
        expect(clusterItems).toHaveLength(MAX_FEATURED_CELLS);
        expect(aggItems.length).toBeGreaterThan(0);
        expect(aggItems.length).toBeLessThanOrEqual(3);
        // All 30 vtxos accounted for: drawn dots + aggregate vtxoCount.
        const aggVtxos = aggItems.reduce(
            (s, i) => s + (i.kind === "aggregate" ? i.aggregate.vtxoCount : 0),
            0,
        );
        expect(sel.drawnVtxos + aggVtxos).toBe(30);
    });

    it("ignores explicit undefined cap overrides (sparse caps bug)", () => {
        // Callers passing `{ maxFeaturedCells: undefined }` must not wipe the
        // defaults — this regressed the whole constellation to aggregates.
        const vtxos = [
            cv({ outpoint: "a:0", commitment: "c1" }),
            cv({ outpoint: "b:0", commitment: "c2" }),
        ];
        const sel = selectConstellation(clusterVtxos(vtxos), {
            maxFeaturedCells: undefined,
            maxDotsPerCluster: undefined,
            maxHistoryDots: undefined,
        });
        expect(sel.items).toHaveLength(2);
        expect(sel.items.every((i) => i.kind === "cluster")).toBe(true);
        expect(sel.drawnVtxos).toBe(2);
    });

    it("features every unspent cluster within the cell cap, none aggregated", () => {
        // 6 live clusters × 2 unspent + 20 history clusters × 1 spent.
        // Live clusters sort first, so all 6 are featured; only history overflows.
        const live = Array.from({ length: 12 }, (_, i) =>
            cv({
                outpoint: `l${i}:0`,
                txid: `l${i}`,
                commitment: `live${Math.floor(i / 2)}`,
                spent: false,
                state: "settled",
            }),
        );
        const hist = Array.from({ length: 20 }, (_, i) =>
            cv({
                outpoint: `h${i}:0`,
                txid: `h${i}`,
                commitment: `hist${i}`,
                spent: true,
                state: "spent",
            }),
        );
        const sel = selectConstellation(clusterVtxos([...live, ...hist]));

        const liveItems = sel.items.filter(
            (i) => i.kind === "cluster" && i.cluster.commitment?.startsWith("live"),
        );
        expect(liveItems).toHaveLength(6);
        for (const item of liveItems) {
            if (item.kind === "cluster") {
                expect(item.cluster.vtxos).toHaveLength(2);
                expect(item.cluster.overflowCount).toBe(0);
                expect(item.cluster.vtxos.every((v) => !v.spent)).toBe(true);
            }
        }

        // No live/action aggregate: every unspent VTXO is drawn, not folded.
        const liveAgg = sel.items.find(
            (i) => i.kind === "aggregate" && !i.aggregate.history && !i.aggregate.needsAction,
        );
        const actionAgg = sel.items.find((i) => i.kind === "aggregate" && i.aggregate.needsAction);
        expect(liveAgg).toBeUndefined();
        expect(actionAgg).toBeUndefined();

        // History overflow is accounted for in the history aggregate.
        const histAgg = sel.items.find((i) => i.kind === "aggregate" && i.aggregate.history);
        expect(histAgg).toBeDefined();
        if (histAgg?.kind === "aggregate") {
            // 4 history clusters were featured (10 cells − 6 live) and drew 1 dot
            // each; the remaining 16 spent VTXOs fold into the aggregate.
            expect(histAgg.aggregate.vtxoCount).toBe(16);
        }
        expect(sel.totalVtxos).toBe(32);
    });

    it("caps dots inside an oversized live cluster", () => {
        const members = Array.from({ length: MAX_DOTS_PER_CLUSTER + 30 }, (_, i) =>
            cv({ outpoint: `t${i}:0`, txid: `t${i}`, commitment: "big" }),
        );
        const sel = selectConstellation(clusterVtxos(members));
        const [item] = sel.items;
        expect(item.kind).toBe("cluster");
        if (item.kind === "cluster") {
            expect(item.cluster.vtxos).toHaveLength(MAX_DOTS_PER_CLUSTER);
            expect(item.cluster.overflowCount).toBe(30);
            expect(item.cluster.totalCount).toBe(MAX_DOTS_PER_CLUSTER + 30);
        }
        // The 30 overflow members land in the live aggregate.
        const live = sel.items.find(
            (i) => i.kind === "aggregate" && !i.aggregate.history && !i.aggregate.needsAction,
        );
        expect(live).toBeDefined();
        if (live?.kind === "aggregate") expect(live.aggregate.vtxoCount).toBe(30);
    });

    it("caps history dots across all history clusters", () => {
        // 10 history clusters × 10 spent vtxos = 100 history members.
        const members = Array.from({ length: 100 }, (_, i) =>
            cv({
                outpoint: `t${i}:0`,
                txid: `t${i}`,
                commitment: `c${Math.floor(i / 10)}`,
                spent: true,
                state: "spent",
            }),
        );
        const sel = selectConstellation(clusterVtxos(members));
        const drawn = sel.drawnVtxos;
        expect(drawn).toBeLessThanOrEqual(MAX_HISTORY_DOTS);
        const hist = sel.items.find((i) => i.kind === "aggregate" && i.aggregate.history);
        expect(hist).toBeDefined();
        if (hist?.kind === "aggregate") {
            expect(hist.aggregate.vtxoCount).toBe(100 - drawn);
        }
    });

    it("keeps needs-action clusters featured ahead of larger live ones", () => {
        const vtxos = [
            // 12 big live clusters first by liveCount, 1 small urgent cluster.
            ...Array.from({ length: 24 }, (_, i) =>
                cv({ outpoint: `a${i}:0`, txid: `a${i}`, commitment: `big${Math.floor(i / 2)}` }),
            ),
            cv({ outpoint: "z:0", txid: "z", commitment: "urgent", urgent: true }),
        ];
        const sel = selectConstellation(clusterVtxos(vtxos));
        const first = sel.items[0];
        expect(first.kind).toBe("cluster");
        if (first.kind === "cluster") expect(first.cluster.commitment).toBe("urgent");
    });
});

describe("layoutConstellation", () => {
    it("lays out items in a grid and returns viewBox dims", () => {
        const clusters = clusterVtxos([
            cv({ outpoint: "a:0", commitment: "c1" }),
            cv({ outpoint: "b:0", commitment: "c2" }),
            cv({ outpoint: "c:0", commitment: "c3" }),
            cv({ outpoint: "d:0", commitment: "c4" }),
            cv({ outpoint: "e:0", commitment: "c5" }),
        ]);
        const sel = selectConstellation(clusters);
        const { width, height, cells } = layoutConstellation(sel.items, {
            width: 800,
            height: 560,
        });
        expect(width).toBe(800);
        expect(height).toBe(560);
        expect(cells).toHaveLength(sel.items.length);
        for (const pc of cells) {
            expect(pc.cx).toBeGreaterThan(0);
            expect(pc.cx).toBeLessThan(width);
            expect(pc.cy).toBeGreaterThan(0);
            expect(pc.cy).toBeLessThan(height);
        }
    });

    it("returns empty for no items", () => {
        const { cells } = layoutConstellation([], { width: 800, height: 560 });
        expect(cells).toHaveLength(0);
    });
});
