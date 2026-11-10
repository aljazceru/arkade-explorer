/**
 * Pure layout math for the transaction flow map: inputs on the left, this tx
 * in the middle, outputs on the right (desktop) or stacked vertically (mobile),
 * then the unroll spine continuing downward to the on-chain anchor.
 *
 * All coordinates are in SVG user units; the component renders them verbatim.
 */

export interface FlowNode {
    /** Centre x. */
    x: number;
    /** Centre y. */
    y: number;
    /** Node radius, scaled by √amount. */
    r: number;
}

export interface FlowEdge {
    /** Cubic bezier control points: start, c1, c2, end. */
    points: [number, number, number, number, number, number, number, number];
}

export interface SpineRow {
    kind: "hop" | "gap" | "anchor";
    /** Centre y of the row. */
    y: number;
    /** For hops: txid + kind; for gaps: count + per-kind counts. */
    hop?: { txid: string; kind: string };
    gap?: { count: number; counts: Record<string, number> };
    anchor?: { txid: string; height: number | null; mempoolUrl?: string };
}

export interface TxFlowLayout {
    width: number;
    height: number;
    vertical: boolean;
    txNode: { x: number; y: number };
    inputs: FlowNode[];
    outputs: FlowNode[];
    inputEdges: FlowEdge[];
    outputEdges: FlowEdge[];
    /** "spent by" stub per spent output: outX → stubX dashed edge + stub centre. */
    spentStubs: Array<{ outputIndex: number; stubX: number; y: number; spentBy: string }>;
    spineY0: number;
    spineRows: SpineRow[];
    /** Whether the spine section exists at all. */
    hasSpine: boolean;
}

const MIN_R = 10;
const MAX_R = 28;
const MOBILE_MIN_R = 20;
export function nodeRadius(amount: number, maxAmount: number, vertical: boolean): number {
    const cap = vertical ? MOBILE_MIN_R : MAX_R;
    const floor = vertical ? MOBILE_MIN_R : MIN_R;
    if (maxAmount <= 0) return floor;
    return Math.max(floor, Math.min(cap, floor + (cap - floor) * Math.sqrt(amount / maxAmount)));
}

interface SpineEntry {
    type: "hop" | "gap";
    txid?: string;
    kind?: string;
    count?: number;
    counts?: Record<string, number>;
}

/**
 * Lay out the merged flow + spine map.
 *
 * Desktop (`vertical=false`): inputs column at ~20% width, outputs at ~80%,
 * tx node centred between them, spine continues down the centre.
 * Mobile (`vertical=true`): inputs stacked above the tx node, outputs below,
 * spine under that — a metro-style column.
 */
export function layoutTxFlow(opts: {
    inputCount: number;
    outputCount: number;
    inputAmounts: number[];
    outputAmounts: number[];
    /** Which outputs are anchors (drawn as hollow squares, no VTXO ring). */
    anchorFlags: boolean[];
    /** spentBy txid per output index, or null. */
    spentBy: Array<string | null>;
    spineEntries: SpineEntry[];
    spineAnchor: { txid: string; height: number | null; mempoolUrl?: string } | null;
    vertical: boolean;
}): TxFlowLayout {
    const {
        inputCount,
        outputCount,
        inputAmounts,
        outputAmounts,
        anchorFlags,
        spentBy,
        spineEntries,
        spineAnchor,
        vertical,
    } = opts;

    const allAmounts = [...inputAmounts, ...outputAmounts];
    const maxAmount = Math.max(1, ...allAmounts);

    let width: number;
    let flowH: number;
    let txY: number;
    const inputs: FlowNode[] = [];
    const outputs: FlowNode[] = [];
    const inputEdges: FlowEdge[] = [];
    const outputEdges: FlowEdge[] = [];
    const spentStubs: TxFlowLayout["spentStubs"] = [];

    let inX = 0;
    let outX = 0;

    if (!vertical) {
        width = 1000;
        const lanes = Math.max(inputCount, outputCount, 1);
        flowH = Math.max(230, 64 + lanes * 56 + 36);
        txY = flowH / 2 - 8;
        inX = width * 0.205;
        outX = width * 0.795;
        const cx = width / 2;

        // Per-lane pitch: ~64px nominal, shrinks only when the band is tight.
        const pitch = (n: number) => (n > 1 ? Math.min(64, (flowH - 110) / Math.max(1, n - 1)) : 0);

        for (let i = 0; i < inputCount; i++) {
            const iy = txY + (i - (inputCount - 1) / 2) * pitch(inputCount);
            const amt = inputAmounts[i] ?? 0;
            const r = nodeRadius(amt, maxAmount, false);
            inputs.push({ x: inX, y: iy, r });
            const portY = txY + Math.max(-30, Math.min(30, (i - (inputCount - 1) / 2) * 22));
            inputEdges.push({
                points: [inX + r + 12, iy, cx - 96, iy, cx - 64, portY, cx - 58, portY],
            });
        }

        for (let i = 0; i < outputCount; i++) {
            const oy = txY + (i - (outputCount - 1) / 2) * pitch(outputCount);
            const amt = outputAmounts[i] ?? 0;
            const isAnchor = anchorFlags[i] ?? false;
            const r = isAnchor ? 7 : nodeRadius(amt, maxAmount, false);
            outputs.push({ x: outX, y: oy, r });
            const portY = txY + Math.max(-30, Math.min(30, (i - (outputCount - 1) / 2) * 22));
            if (isAnchor) {
                outputEdges.push({
                    points: [cx + 58, portY, outX - 30, oy, outX - 14, oy, outX - 8, oy],
                });
            } else {
                outputEdges.push({
                    points: [cx + 58, portY, outX - r - 18, oy, outX - r - 8, oy, outX - r - 3, oy],
                });
                const spent = spentBy[i];
                if (spent) {
                    const stubX = Math.min(width - 50, outX + r + 4 + 58);
                    spentStubs.push({ outputIndex: i, stubX, y: oy, spentBy: spent });
                }
            }
        }
    } else {
        // Vertical mode: horizontal rows — inputs above tx node, outputs below
        width = 460;
        const cx = width / 2;

        // Row dimensions
        const inputRowH = 72;
        const outputRowH = 88;
        const txNodeH = 64;

        // Inputs row position
        const inputsY = 56;

        // Tx node position (computed before edges)
        txY = inputsY + inputRowH + txNodeH / 2;

        // Inputs: one horizontal row above tx node
        const inputsSpacing = inputCount > 0 ? Math.min(72, (width - 80) / inputCount) : 0;
        const inputsStartX = inputCount > 1 ? cx - ((inputCount - 1) * inputsSpacing) / 2 : cx;

        for (let i = 0; i < inputCount; i++) {
            const ix = inputsStartX + i * inputsSpacing;
            const amt = inputAmounts[i] ?? 0;
            const r = nodeRadius(amt, maxAmount, true);
            inputs.push({ x: ix, y: inputsY, r });
            inputEdges.push({
                points: [ix, inputsY + r + 4, ix, txY - 40, cx, txY - 40, cx, txY - 34],
            });
        }
        // Outputs: horizontal row(s) below tx node, wrap at 4 per row
        const outputsPerRow = 4;
        const outputRows = Math.ceil(outputCount / outputsPerRow);
        const outStartY = txY + txNodeH / 2 + 48;

        for (let j = 0; j < outputCount; j++) {
            const row = Math.floor(j / outputsPerRow);
            const col = j % outputsPerRow;
            const rowCount = Math.min(outputsPerRow, outputCount - row * outputsPerRow);
            const oy = outStartY + row * outputRowH + outputRowH / 2;
            const ox = cx - ((rowCount - 1) * 80) / 2 + col * 80;

            const amt = outputAmounts[j] ?? 0;
            const isAnchor = anchorFlags[j] ?? false;
            const r = isAnchor ? 7 : nodeRadius(amt, maxAmount, true);
            outputs.push({ x: ox, y: oy, r });

            if (isAnchor) {
                outputEdges.push({
                    points: [cx, txY + 34, cx, oy - r - 12, ox, oy - r - 12, ox, oy - r - 6],
                });
            } else {
                outputEdges.push({
                    points: [cx, txY + 34, cx, oy - r - 12, ox, oy - r - 12, ox, oy - r - 3],
                });
                const spent = spentBy[j];
                if (spent) {
                    spentStubs.push({ outputIndex: j, stubX: ox, y: oy + r + 16, spentBy: spent });
                }
            }
        }

        flowH = outStartY + (outputRows - 1) * outputRowH + outputRowH + 20;
    }

    const cx = width / 2;
    const txNode = { x: cx, y: txY };

    // Spine continues downward from the tx node.
    const hasSpine = spineEntries.length > 0 || spineAnchor !== null;
    const spineY0 = flowH + 18;
    const rowH = 30;
    const spineRows: SpineRow[] = [];
    let y = spineY0;
    for (const entry of spineEntries) {
        if (entry.type === "gap") {
            spineRows.push({
                kind: "gap",
                y,
                gap: { count: entry.count ?? 0, counts: entry.counts ?? {} },
            });
        } else {
            spineRows.push({
                kind: "hop",
                y,
                hop: { txid: entry.txid ?? "", kind: entry.kind ?? "unknown" },
            });
        }
        y += rowH;
    }
    if (spineAnchor) {
        spineRows.push({ kind: "anchor", y: y + 8, anchor: spineAnchor });
        y += 38;
    }

    const height = hasSpine ? y + 20 : spineY0 + 60;

    return {
        width,
        height,
        vertical,
        txNode,
        inputs,
        outputs,
        inputEdges,
        outputEdges,
        spentStubs,
        spineY0,
        spineRows,
        hasSpine,
    };
}

/** Compress spine entries with per-kind counts for the gap capsule. */
export function compressSpineEntries(
    hops: Array<{ txid: string; kind: string }>,
    head = 12,
    tail = 6,
): SpineEntry[] {
    if (hops.length <= head + tail + 1) {
        return hops.map((hop) => ({ type: "hop" as const, ...hop }));
    }
    const middle = hops.slice(head, hops.length - tail);
    const counts: Record<string, number> = {};
    for (const hop of middle) counts[hop.kind] = (counts[hop.kind] ?? 0) + 1;
    return [
        ...hops.slice(0, head).map((hop) => ({ type: "hop" as const, ...hop })),
        { type: "gap" as const, count: middle.length, counts },
        ...hops.slice(hops.length - tail).map((hop) => ({ type: "hop" as const, ...hop })),
    ];
}
