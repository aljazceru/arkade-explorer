import type { VirtualCoin } from "@arkade-os/sdk";

/**
 * Clustering + packing for the address "constellation" canvas.
 * Pure functions — the component only renders what these return.
 *
 * Three caps keep huge addresses legible:
 *  - MAX_FEATURED_CELLS bounds the number of cluster cells on the grid;
 *  - MAX_DOTS_PER_CLUSTER bounds dots inside one live cluster;
 *  - MAX_HISTORY_DOTS bounds dots drawn for all-spent (history) clusters.
 * Everything beyond the caps folds into at most three summary cells
 * (action / live / history) — never thousands of circles or labels.
 */

export interface ConstellationVtxo {
    outpoint: string;
    txid: string;
    vout: number;
    value: number;
    /** Commitment (batch) txid this VTXO is anchored to, or null when unknown. */
    commitment: string | null;
    /** When the VTXO was created (unix ms), or null. */
    createdAtMs: number | null;
    /** Batch expiry (unix ms), or null. */
    expiresAtMs: number | null;
    /** Share of lifetime still ahead, 0..1, or null when unknown. */
    lifetimeLeft: number | null;
    /** Atlas state (see atlasVtxoState). */
    state: string;
    /** True for terminal states: spent, spent-in-batch. */
    spent: boolean;
    /** True when the state needs action (renew / expired). */
    urgent: boolean;
}

export interface ConstellationCluster {
    /** Commitment txid, or null for the unanchored bucket. */
    commitment: string | null;
    /** Members that fit the dot caps (the drawable subset). */
    vtxos: ConstellationVtxo[];
    /** Total members before capping — what the label reports. */
    totalCount: number;
    /** Members dropped by the dot caps inside this cluster. */
    overflowCount: number;
    /** Live (unspent) count across ALL members — what the label emphasises. */
    liveCount: number;
    /** True when every member is terminal (history cluster). */
    history: boolean;
    /** True when any member is in the exit window or expired. */
    needsAction: boolean;
}

/**
 * The commitment a VTXO belongs to: its own batch commitment, or the one that
 * settled/forfeited it. `settledBy` is the commitment txid for settled VTXOs.
 */
export function vtxoCommitmentId(vtxo: VirtualCoin): string | null {
    const ids = vtxo.commitmentTxIds ?? [];
    if (ids.length > 0 && ids[0]) return ids[0];
    if (vtxo.settledBy) return vtxo.settledBy;
    return null;
}

/**
 * A VTXO is terminal (history) when it can no longer be spent or recovered:
 * consumed off-chain, used as an input to a commitment, or already exited
 * on-chain (unrolled). Swept and expired VTXOs stay "live" — their value is
 * recoverable through the operator.
 */
export function isTerminalState(state: string): boolean {
    return state === "spent" || state === "spent-in-batch" || state === "unrolled";
}

/**
 * Group VTXOs by commitment. Clusters that need action sort first, then by
 * live count desc, then by commitment id for stability. Members are sorted by
 * expiry so the most urgent sit at the centre of the disc.
 */
export function clusterVtxos(vtxos: ConstellationVtxo[]): ConstellationCluster[] {
    const map = new Map<string | null, ConstellationVtxo[]>();
    for (const v of vtxos) {
        const list = map.get(v.commitment);
        if (list) list.push(v);
        else map.set(v.commitment, [v]);
    }

    const clusters: ConstellationCluster[] = [];
    for (const [commitment, members] of map) {
        members.sort((a, b) => (a.expiresAtMs ?? Infinity) - (b.expiresAtMs ?? Infinity));
        const liveCount = members.filter((v) => !v.spent).length;
        clusters.push({
            commitment,
            vtxos: members,
            totalCount: members.length,
            overflowCount: 0,
            liveCount,
            history: liveCount === 0,
            needsAction: members.some((v) => v.urgent),
        });
    }

    clusters.sort((a, b) => {
        if (a.needsAction !== b.needsAction) return a.needsAction ? -1 : 1;
        if (a.liveCount !== b.liveCount) return b.liveCount - a.liveCount;
        // unanchored (null) always last among equals
        if (a.commitment === null && b.commitment !== null) return 1;
        if (b.commitment === null && a.commitment !== null) return -1;
        return (a.commitment ?? "").localeCompare(b.commitment ?? "");
    });
    return clusters;
}

// ---------------------------------------------------------------------------
// Caps + cell selection
// ---------------------------------------------------------------------------

/** Max cluster cells drawn on the grid (the rest fold into summary cells). */
export const MAX_FEATURED_CELLS = 10;
/** Max individual dots drawn inside one live cluster. */
export const MAX_DOTS_PER_CLUSTER = 60;
/** Max dots drawn across ALL history clusters combined. */
export const MAX_HISTORY_DOTS = 24;
/** Max summary (aggregate) cells appended after the featured clusters. */
export const MAX_AGGREGATE_CELLS = 3;

/** A grid cell folding many clusters/members into one summary. */
export interface ClusterAggregate {
    /** VTXOs folded into this cell (non-featured clusters + dot overflow). */
    vtxoCount: number;
    /** Distinct non-featured commitments folded in. */
    clusterCount: number;
    totalSats: number;
    /** True when everything folded is history (all spent). */
    history: boolean;
    /** True when anything folded needs action. */
    needsAction: boolean;
}

/** What one grid cell renders: a real cluster or a folded aggregate. */
export type ConstellationItem =
    | { kind: "cluster"; cluster: ConstellationCluster }
    | { kind: "aggregate"; aggregate: ClusterAggregate };

interface Bucket {
    vtxoCount: number;
    clusterCount: number;
    totalSats: number;
    history: boolean;
    needsAction: boolean;
}

export interface ConstellationCaps {
    maxFeaturedCells?: number;
    maxDotsPerCluster?: number;
    maxHistoryDots?: number;
    maxAggregateCells?: number;
}

const DEFAULT_CAPS = {
    maxFeaturedCells: MAX_FEATURED_CELLS,
    maxDotsPerCluster: MAX_DOTS_PER_CLUSTER,
    maxHistoryDots: MAX_HISTORY_DOTS,
    maxAggregateCells: MAX_AGGREGATE_CELLS,
};

function emptyBucket(): Bucket {
    return { vtxoCount: 0, clusterCount: 0, totalSats: 0, history: true, needsAction: false };
}

function bucketFor(cluster: ConstellationCluster): "action" | "live" | "history" {
    if (cluster.needsAction) return "action";
    return cluster.history ? "history" : "live";
}

function addMembers(bucket: Bucket, members: ConstellationVtxo[]) {
    for (const v of members) {
        bucket.vtxoCount += 1;
        bucket.totalSats += v.value;
        if (!v.spent) bucket.history = false;
        if (v.urgent) bucket.needsAction = true;
    }
}

export interface ConstellationSelection {
    /** Grid-ready items: featured clusters first, then aggregate cells. */
    items: ConstellationItem[];
    totalVtxos: number;
    /** Individual dots that will be drawn across all featured clusters. */
    drawnVtxos: number;
}

/**
 * Pick which clusters get cells and fold the rest into summary cells.
 * Featured clusters keep their drawable members; overflow members and
 * non-featured clusters accumulate into action/live/history buckets.
 */
export function selectConstellation(
    clusters: ConstellationCluster[],
    caps: ConstellationCaps = {},
): ConstellationSelection {
    const buckets: Record<"action" | "live" | "history", Bucket> = {
        action: emptyBucket(),
        live: emptyBucket(),
        history: emptyBucket(),
    };

    // Ignore explicit `undefined` overrides so callers can pass sparse caps.
    const c = { ...DEFAULT_CAPS };
    for (const key of Object.keys(caps) as (keyof ConstellationCaps)[]) {
        const value = caps[key];
        if (value !== undefined) {
            (c as Record<keyof ConstellationCaps, number>)[key] = value;
        }
    }
    const items: ConstellationItem[] = [];
    let drawnVtxos = 0;
    let totalVtxos = 0;
    let historyBudget = c.maxHistoryDots;

    clusters.forEach((cluster, idx) => {
        totalVtxos += cluster.totalCount;
        const featured = idx < c.maxFeaturedCells;

        // How many members this cluster may draw.
        let cap = c.maxDotsPerCluster;
        if (cluster.history) cap = Math.min(cap, Math.max(0, historyBudget));
        const drawable = cluster.vtxos.slice(0, cap);
        if (cluster.history) historyBudget -= drawable.length;
        const overflow = cluster.vtxos.slice(drawable.length);

        if (!featured) {
            // Whole cluster folds into its bucket.
            const b = buckets[bucketFor(cluster)];
            b.clusterCount += 1;
            addMembers(b, cluster.vtxos);
            return;
        }

        const capped: ConstellationCluster = {
            ...cluster,
            vtxos: drawable,
            overflowCount: cluster.overflowCount + overflow.length,
        };
        drawnVtxos += drawable.length;
        items.push({ kind: "cluster", cluster: capped });

        // Overflow members join the bucket as vtxos (commitment stays featured).
        if (overflow.length > 0) {
            const b = buckets[bucketFor(cluster)];
            addMembers(b, overflow);
        }
        // A history cluster that drew nothing still shows its label + count.
    });

    // Emit non-empty buckets as aggregate cells, action first, capped.
    let emitted = 0;
    for (const key of ["action", "live", "history"] as const) {
        if (emitted >= c.maxAggregateCells) break;
        const b = buckets[key];
        if (b.vtxoCount === 0) continue;
        emitted += 1;
        items.push({
            kind: "aggregate",
            aggregate: {
                vtxoCount: b.vtxoCount,
                clusterCount: b.clusterCount,
                totalSats: b.totalSats,
                history: b.history && !b.needsAction,
                needsAction: b.needsAction,
            },
        });
    }

    return { items, totalVtxos, drawnVtxos };
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

export interface PackedVtxo extends ConstellationVtxo {
    x: number;
    y: number;
}

export interface PackedCell {
    item: ConstellationItem;
    /** Centre of the cell's disc area, viewBox units. */
    cx: number;
    cy: number;
    /** Radius of the cluster's layout disc (0 for aggregates). */
    radius: number;
    /** Cell bounds (for label anchoring). */
    cell: { x: number; y: number; w: number; h: number };
    packed: PackedVtxo[];
    /** Per-VTXO ring radius in viewBox units. */
    dotRadius: number;
}

const GOLDEN = 2.39996;

/**
 * Deterministic phyllotaxis packing: no RNG, stable order, uniform density.
 * Live members pack toward the centre; spent members sit on the rim.
 * Positions are returned aligned with the input array.
 */
export function packCluster(
    vtxos: ConstellationVtxo[],
    radius: number,
): { x: number; y: number; r: number }[] {
    const n = vtxos.length;
    if (n === 0) return [];

    const out: ({ x: number; y: number; r: number } | undefined)[] = new Array(n);

    if (n === 1) {
        out[0] = { x: 0, y: 0, r: radius };
        return out as { x: number; y: number; r: number }[];
    }

    const order = vtxos
        .map((v, i) => ({ v, i }))
        .sort(
            (a, b) =>
                Number(a.v.spent) - Number(b.v.spent) ||
                (a.v.expiresAtMs ?? 0) - (b.v.expiresAtMs ?? 0),
        );

    const small = n <= 4;
    order.forEach(({ i }, sortedIdx) => {
        let x = 0;
        let y = 0;
        if (small) {
            const ang = -Math.PI / 2 + (sortedIdx * Math.PI * 2) / n;
            const rr = radius * 0.45;
            x = Math.cos(ang) * rr;
            y = Math.sin(ang) * rr * 0.85;
        } else {
            const t = sortedIdx + 0.5;
            const ang = sortedIdx * GOLDEN - Math.PI / 2;
            const rr = radius * Math.sqrt(t / n) * 0.92;
            x = Math.cos(ang) * rr;
            y = Math.sin(ang) * rr;
        }
        out[i] = { x, y, r: radius };
    });

    return out as { x: number; y: number; r: number }[];
}

export interface LayoutOptions {
    width: number;
    height: number;
    /** Top inset reserved for the label row inside the SVG. */
    headerInset?: number;
    /** Bottom inset for the caption strip. */
    footerInset?: number;
    /** Max cells per row before wrapping. */
    maxCols?: number;
}

/**
 * Lay out cells on a grid of equal size. Cluster items pack their VTXOs;
 * aggregate items render as a summary card in the same cell.
 */
export function layoutConstellation(
    items: ConstellationItem[],
    opts: LayoutOptions,
): { width: number; height: number; cells: PackedCell[] } {
    const { width, height } = opts;
    const headerInset = opts.headerInset ?? 34;
    const footerInset = opts.footerInset ?? 18;
    const maxCols = opts.maxCols ?? 4;

    const n = items.length;
    if (n === 0) return { width, height, cells: [] };

    const cols = Math.min(n, maxCols);
    const rows = Math.ceil(n / cols);
    const cw = width / cols;
    const ch = (height - headerInset - footerInset) / rows;

    const cells: PackedCell[] = items.map((item, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cellX = col * cw;
        const cellY = headerInset + row * ch;
        const cx = cellX + cw / 2;
        const labelY = cellY + 20;
        // Reserve room for the diamond + commitment label + overflow line so the
        // packed dots always keep ≥6 px clearance below them.
        const availTop = labelY + 22;
        const availBot = cellY + ch - 8;
        const cy = availTop + Math.max(0, availBot - availTop) / 2;
        const cell = { x: cellX, y: cellY, w: cw, h: ch };

        if (item.kind === "aggregate") {
            return { item, cx, cy, radius: 0, cell, packed: [], dotRadius: 0 };
        }

        const cluster = item.cluster;
        // Dot radius tiers keep dense clusters legible.
        const count = cluster.vtxos.length;
        const dotRadius = count > 18 ? 3.8 : count > 8 ? 4.6 : count > 3 ? 5.6 : 7;
        // Outer dot extent is radius*0.94 + dotRadius; cap the disc so the whole
        // extent fits the available height with 7 px breathing room top and bottom.
        const maxR = Math.min(
            cw * 0.47,
            Math.max(8, (availBot - availTop - 14 - 2 * dotRadius) / 1.88),
            Math.min(cw, ch) * 0.42,
        );
        // Bigger clusters get bigger discs but capped; history clusters smaller.
        const base = 30 + Math.sqrt(cluster.totalCount) * 6.5;
        const radius = Math.max(12, Math.min(maxR, base)) * (cluster.history ? 0.85 : 1);

        const positions = packCluster(cluster.vtxos, radius * 0.94);
        const packedVtxos: PackedVtxo[] = cluster.vtxos.map((v, i) => {
            const p = positions[i];
            return { ...v, x: cx + p.x, y: cy + p.y };
        });

        return { item, cx, cy, radius, cell, packed: packedVtxos, dotRadius };
    });

    return { width, height, cells };
}
