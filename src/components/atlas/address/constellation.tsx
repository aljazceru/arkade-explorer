import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { VirtualCoin } from "@arkade-os/sdk";
import { Panel } from "@/components/atlas/panel";
import { useNow } from "@/hooks/use-expiry";
import { atlasVtxoState, ATLAS_STATE_META, type AtlasVtxoContext } from "@/lib/atlas/vtxo-state";
import {
    clusterVtxos,
    selectConstellation,
    layoutConstellation,
    vtxoCommitmentId,
    isTerminalState,
    type ConstellationCluster,
    type ConstellationVtxo,
    type PackedCell,
    type PackedVtxo,
} from "@/lib/atlas/address-cluster";
import { cn, formatSats } from "@/lib/utils";
import { formatDuration } from "@/lib/vtxo-display";

const DESKTOP = { w: 800, h: 560, cols: 4 };
const NARROW = { w: 400, h: 470, cols: 2 };

/** Below sm the viewBox narrows so labels stay legible at ~1:1 scale. */
function useNarrowViewport(): boolean {
    const [narrow, setNarrow] = useState(() =>
        typeof window !== "undefined" ? window.innerWidth < 640 : false,
    );
    useEffect(() => {
        const handler = () => setNarrow(window.innerWidth < 640);
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
    }, []);
    return narrow;
}

interface Props {
    vtxos: VirtualCoin[];
    ctx: AtlasVtxoContext;
    className?: string;
}

function toConstellationVtxo(vtxo: VirtualCoin, ctx: AtlasVtxoContext): ConstellationVtxo {
    const view = atlasVtxoState(vtxo, ctx);
    const created = vtxo.createdAt instanceof Date ? vtxo.createdAt.getTime() : null;
    const expires =
        view.remaining?.expiresAtMs ??
        (vtxo.expiresAt instanceof Date ? vtxo.expiresAt.getTime() : null);
    let lifetimeLeft: number | null = null;
    if (created !== null && expires !== null && expires > created) {
        lifetimeLeft = Math.min(1, Math.max(0, (expires - ctx.nowMs) / (expires - created)));
    }
    return {
        outpoint: `${vtxo.txid}:${vtxo.vout}`,
        txid: vtxo.txid,
        vout: vtxo.vout ?? 0,
        value: Number(vtxo.value) || 0,
        commitment: vtxoCommitmentId(vtxo),
        createdAtMs: created,
        expiresAtMs: expires,
        lifetimeLeft,
        state: view.state,
        spent: isTerminalState(view.state),
        urgent: view.state === "renew" || view.state === "expired",
    };
}

/**
 * The address "constellation": VTXOs clustered by commitment anchor, ring arc =
 * lifetime left, coral = exit window, faint = spent/history. Small clusters
 * beyond the cell cap fold into summary cells — never thousands of dots.
 */
export function AddressConstellation({ vtxos, ctx, className }: Props) {
    const now = useNow();
    const narrow = useNarrowViewport();
    const view = narrow ? NARROW : DESKTOP;

    const { cells, totalVtxos, drawnVtxos } = useMemo(() => {
        const liveCtx = { ...ctx, nowMs: now };
        const cvs = vtxos.map((v) => toConstellationVtxo(v, liveCtx));
        const selection = selectConstellation(
            clusterVtxos(cvs),
            narrow ? { maxFeaturedCells: 6, maxDotsPerCluster: 40, maxHistoryDots: 12 } : {},
        );
        const layout = layoutConstellation(selection.items, {
            width: view.w,
            height: view.h,
            maxCols: view.cols,
        });
        return {
            cells: layout.cells,
            totalVtxos: selection.totalVtxos,
            drawnVtxos: selection.drawnVtxos,
        };
    }, [vtxos, ctx, now, narrow, view]);

    const vb = useMemo(() => fitViewBox(cells, view.w, view.h), [cells, view]);

    return (
        <Panel
            variant="canvas"
            className={className}
            title={
                <span className="flex items-center gap-2">
                    Constellation
                    <span className="micro font-normal text-faint">
                        {totalVtxos.toLocaleString("en-US")} vtxos
                        {drawnVtxos < totalVtxos &&
                            ` · ${drawnVtxos.toLocaleString("en-US")} shown`}
                        {" · clustered by commitment"}
                    </span>
                </span>
            }
            subtitle="ring = lifetime left · coral = exit window · faint = spent"
            bodyClassName="relative"
        >
            <svg
                viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
                className={
                    narrow ? "block h-[400px] w-full" : "block h-[420px] w-full sm:h-[520px]"
                }
                role="img"
                aria-label="VTXOs clustered by commitment"
            >
                <defs>
                    <pattern
                        id="atlas-const-dots"
                        width="24"
                        height="24"
                        patternUnits="userSpaceOnUse"
                    >
                        <circle cx="1.5" cy="1.5" r="1" className="fill-grid" />
                    </pattern>
                </defs>
                <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#atlas-const-dots)" />

                {cells.map((cell, i) => (
                    <CellNode key={cellKey(cell, i)} cell={cell} />
                ))}

                <text
                    x={vb.x + vb.w / 2}
                    y={vb.y + vb.h - 5}
                    textAnchor="middle"
                    className="fill-faint"
                    fontSize="10"
                    fontFamily="var(--font-mono, monospace)"
                >
                    clusters = commitment anchors · ring arc = lifetime remaining · coral = exit
                    window · dashed/faint = spent
                </text>
            </svg>
        </Panel>
    );
}

function cellKey(cell: PackedCell, index: number): string {
    if (cell.item.kind === "cluster") {
        return cell.item.cluster.commitment ?? `__none_${index}`;
    }
    return `__agg_${cell.item.aggregate.needsAction ? "a" : ""}${cell.item.aggregate.history ? "h" : "l"}_${index}`;
}

/** Cluster heading. History clusters are drawn faint, so the label stays short enough
 *  not to run into its neighbour. */
function clusterLabel(cluster: ConstellationCluster): string {
    const anchor = cluster.commitment
        ? `${cluster.commitment.slice(0, 6)}…${cluster.commitment.slice(-4)}`
        : "unanchored";
    return `${anchor} · ×${cluster.totalCount}`;
}

interface ViewBoxFit {
    x: number;
    y: number;
    w: number;
    h: number;
}

const CAPTION_H = 18;

/**
 * Fit the SVG viewBox to the drawn content (margins included) instead of the
 * whole layout canvas, so cluster labels render large enough to read. Content
 * is authored in layout coords (0..view.w × 0..view.h); the fit only reframes
 * the visible window — preserveAspectRatio keeps it undistorted.
 */
function fitViewBox(cells: PackedCell[], viewW: number, viewH: number): ViewBoxFit {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const eat = (x1: number, y1: number, x2: number, y2: number) => {
        if (x1 < minX) minX = x1;
        if (y1 < minY) minY = y1;
        if (x2 > maxX) maxX = x2;
        if (y2 > maxY) maxY = y2;
    };

    for (const cell of cells) {
        if (cell.item.kind === "aggregate") {
            const { w, h } = aggregateCardMetrics(cell.item.aggregate, cell.cell.w);
            eat(cell.cx - w / 2 - 6, cell.cy - h / 2 - 6, cell.cx + w / 2 + 6, cell.cy + h / 2 + 6);
            continue;
        }
        const cluster = cell.item.cluster;
        const reach = cell.radius * 0.94 + cell.dotRadius + 4;
        eat(cell.cx - reach, cell.cy - reach, cell.cx + reach, cell.cy + reach);
        // Label row at the top of the cell: diamond + commitment line (+overflow).
        const label = clusterLabel(cluster);
        const labelW = label.length * 11 * 0.6;
        eat(cell.cx - labelW / 2, cell.cell.y, cell.cx + labelW / 2, cell.cell.y + 26);
        if (cluster.overflowCount > 0) {
            const ov = `+${cluster.overflowCount} more`;
            const ovW = ov.length * 9 * 0.6;
            eat(cell.cx - ovW / 2, cell.cell.y + 27, cell.cx + ovW / 2, cell.cell.y + 41);
        }
    }

    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: viewW, h: viewH };

    const pad = 18;
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    const w = Math.min(viewW, maxX + pad) - x;
    const h = Math.min(viewH, maxY + pad + CAPTION_H) - y;
    return { x, y, w: Math.max(80, w), h: Math.max(80, h) };
}

function CellNode({ cell }: { cell: PackedCell }) {
    if (cell.item.kind === "aggregate") {
        return <AggregateCell cell={cell} />;
    }
    return <ClusterCell cell={cell} cluster={cell.item.cluster} />;
}

function ClusterCell({ cell, cluster }: { cell: PackedCell; cluster: ConstellationCluster }) {
    const { cx, cy, packed, dotRadius } = cell;
    const dead = cluster.history;
    const labelY = cell.cell.y + 24;
    const commitment = cluster.commitment;

    return (
        <g>
            {/* faint cell separator */}
            <line
                x1={cell.cell.x}
                y1={cell.cell.y + cell.cell.h}
                x2={cell.cell.x + cell.cell.w}
                y2={cell.cell.y + cell.cell.h}
                className="stroke-border"
                strokeWidth="0.5"
                opacity="0.5"
            />

            {/* commitment diamond + label */}
            {commitment ? (
                <Link to={`/commitment-tx/${commitment}`} className="cursor-pointer">
                    <g transform={`translate(${cx} ${cell.cell.y + 9})`}>
                        <path
                            d="M0 -5 L5 0 L0 5 L-5 0 Z"
                            className="fill-canvas stroke-chain"
                            strokeWidth="1.2"
                        />
                    </g>
                </Link>
            ) : null}
            <text
                x={cx}
                y={labelY}
                textAnchor="middle"
                fontSize="11"
                className="fill-faint"
                fontFamily="var(--font-mono, monospace)"
            >
                {clusterLabel(cluster)}
                {dead && <title>history: every VTXO in this commitment is spent</title>}
            </text>
            {cluster.overflowCount > 0 && (
                <text
                    x={cx}
                    y={labelY + 13}
                    textAnchor="middle"
                    fontSize="9"
                    className="fill-faint"
                    fontFamily="var(--font-mono, monospace)"
                >
                    {`+${cluster.overflowCount} more`}
                </text>
            )}

            {/* spokes from cell centre to each dot */}
            {packed.map((v) => (
                <line
                    key={v.outpoint}
                    x1={cx}
                    y1={cy - 6}
                    x2={v.x}
                    y2={v.y}
                    className="stroke-line-strong"
                    strokeWidth="0.5"
                    opacity="0.35"
                />
            ))}

            {/* VTXO dots */}
            {packed.map((v) => (
                <VtxoDot key={v.outpoint} v={v} r={dotRadius} dim={dead} />
            ))}
        </g>
    );
}

interface AggregateLine {
    text: string;
    size: number;
    cls: string;
}

/**
 * Card metrics shared by the renderer and fitViewBox: the card is sized to its
 * (split) text lines so long sat counts never spill, and capped at cell width
 * minus 12 so neighbouring cards always keep ≥12 px between them.
 */
function aggregateCardMetrics(
    agg: Extract<PackedCell["item"], { kind: "aggregate" }>["aggregate"],
    cellW: number,
): { w: number; h: number; lines: AggregateLine[] } {
    const alert = agg.needsAction;
    const lines: AggregateLine[] = [
        {
            text: `×${agg.vtxoCount.toLocaleString("en-US")} vtxos`,
            size: 12,
            cls: alert ? "fill-alert" : "fill-muted-foreground",
        },
        ...(agg.clusterCount > 0
            ? [{ text: `${agg.clusterCount} commitments`, size: 9, cls: "fill-faint" }]
            : []),
        { text: `${formatSats(agg.totalSats)} sats`, size: 9, cls: "fill-faint" },
        {
            text: alert ? "needs action" : agg.history ? "history" : "more commitments",
            size: 8.5,
            cls: alert ? "fill-alert" : "fill-faint",
        },
    ];
    const widest = Math.max(...lines.map((l) => l.text.length * l.size * 0.68));
    const w = Math.min(Math.max(widest + 30, 110), cellW - 12);
    const h = lines.length * 13 + 16;
    return { w, h, lines };
}

function AggregateCell({ cell }: { cell: PackedCell }) {
    const agg = cell.item.kind === "aggregate" ? cell.item.aggregate : null;
    if (!agg) return null;
    const { cx, cy, cell: bounds } = cell;
    const { w, h, lines } = aggregateCardMetrics(agg, bounds.w);
    const firstY = -h / 2 + 16;

    return (
        <g transform={`translate(${cx} ${cy})`} opacity="0.85">
            <title>{`${agg.vtxoCount.toLocaleString("en-US")} VTXOs across ${agg.clusterCount} commitments · ${formatSats(agg.totalSats)} sats`}</title>
            <rect
                x={-w / 2}
                y={-h / 2}
                width={w}
                height={h}
                rx="5"
                className={cn(
                    "fill-secondary",
                    agg.needsAction ? "stroke-alert" : "stroke-line-strong",
                )}
                strokeWidth="1"
                strokeDasharray="4 3"
            />
            {lines.map((line, i) => (
                <text
                    key={line.text}
                    textAnchor="middle"
                    y={firstY + i * 13}
                    fontSize={line.size}
                    className={cn("font-medium", line.cls)}
                    fontFamily="var(--font-mono, monospace)"
                >
                    {line.text}
                </text>
            ))}
        </g>
    );
}

function VtxoDot({ v, r, dim }: { v: PackedVtxo; r: number; dim: boolean }) {
    const meta = ATLAS_STATE_META[v.state as keyof typeof ATLAS_STATE_META];
    const alert = v.state === "renew" || v.state === "expired";
    const circ = 2 * Math.PI * (r + 2);
    const frac = v.lifetimeLeft === null ? null : Math.max(0.04, v.lifetimeLeft);
    const remainingS =
        v.expiresAtMs !== null ? Math.round((v.expiresAtMs - Date.now()) / 1000) : null;

    return (
        <Link to={`/tx/${v.txid}`} className="cursor-pointer">
            <g transform={`translate(${v.x} ${v.y})`} opacity={dim ? 0.45 : 1}>
                {/* lifetime ring */}
                {frac !== null && !v.spent && (
                    <>
                        <circle r={r + 2} fill="none" className="stroke-border" strokeWidth="1.6" />
                        <circle
                            r={r + 2}
                            fill="none"
                            className={alert ? "stroke-alert" : "stroke-ok"}
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeDasharray={`${circ * frac} ${circ}`}
                            transform="rotate(-90)"
                        />
                    </>
                )}
                {/* dot body */}
                <circle
                    r={r}
                    className={cn(
                        v.spent ? "fill-canvas" : "fill-card",
                        alert && !v.spent
                            ? "stroke-alert"
                            : v.spent
                              ? "stroke-faint"
                              : "stroke-foreground",
                    )}
                    strokeWidth="1.1"
                    strokeDasharray={v.state === "unknown" ? "2 2" : undefined}
                />
                {alert && !v.spent && (
                    <circle r={r + 3.5} fill="none" className="stroke-alert" strokeWidth="0.8" />
                )}
                <title>
                    {`vtxo · ${meta?.label ?? v.state}\n${v.outpoint}\n${formatSats(v.value)} sats` +
                        (remainingS !== null ? `\nexpires in ~${formatDuration(remainingS)}` : "")}
                </title>
            </g>
        </Link>
    );
}
