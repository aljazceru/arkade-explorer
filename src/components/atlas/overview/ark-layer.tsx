import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type WheelEvent as ReactWheelEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/formatters";
import { formatSatsInt } from "@/lib/overview-records";
import {
    computeArkLayer,
    type ArkCommitment,
    type ArkEventKind,
    type ArkLayerInput,
    type ArkLayerLayout,
    type ArkRailItem,
    type PlacedArkCommitment,
    type PlacedArkEvent,
    type PlacedSecondTx,
} from "@/lib/atlas/ark-layer";
import { Panel } from "@/components/atlas/panel";
import { Segmented } from "@/components/atlas/segmented";
import { middleTruncate } from "@/components/atlas/hash";

type WindowChoice = "21600" | "86400" | "604800";
type LaneChoice = "all" | "arkade" | "second";

const WINDOW_OPTIONS: ReadonlyArray<{ value: WindowChoice; label: string; sec: number }> = [
    { value: "21600", label: "6 h", sec: 6 * 3600 },
    { value: "86400", label: "24 h", sec: 24 * 3600 },
    { value: "604800", label: "7 d", sec: 7 * 86400 },
];
const LANE_OPTIONS: ReadonlyArray<{ value: LaneChoice; label: string }> = [
    { value: "all", label: "All" },
    { value: "arkade", label: "Arkade" },
    { value: "second", label: "Second" },
];
const MINIMAP_SPAN_SEC = 7 * 86400;
const MINIMAP_BINS = 60;

interface TooltipState {
    x: number;
    y: number;
    title: string;
    lines: string[];
    txid?: string;
    href?: string;
}

function fmtClock(unixSec: number): string {
    const d = new Date(unixSec * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function fmtDay(unixSec: number): string {
    const d = new Date(unixSec * 1000);
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

function ago(unixSec: number | null | undefined): string {
    if (unixSec === null || unixSec === undefined) return "—";
    return formatRelativeTime(unixSec * 1000);
}

function kindLabel(kind: ArkEventKind | string): string {
    switch (kind) {
        case "virtual":
        case "batch":
        case "transaction":
            return kind;
        default:
            return "virtual";
    }
}

function directionLabel(direction: PlacedSecondTx["direction"]): string {
    switch (direction) {
        case "to_server":
            return "to server";
        case "from_server":
            return "from server";
        default:
            return "server";
    }
}

function eventRingClass(state: PlacedArkEvent["state"]): string | null {
    switch (state) {
        case "expired":
            return "stroke-alert";
        case "unknown":
            return "stroke-warning";
        case "spent":
            return "stroke-faint"; // consumed — neutral, not "settled" green
        case "settled":
            return "stroke-ok";
        default:
            return null;
    }
}

export function ArkLayerCanvas({
    input,
    nextRoundAt,
    roundIntervalSec,
    onInspect,
    coverageNote,
    className,
}: {
    /** Base input (records, blocks, commitments, second txs, hourly, nowSec). */
    input: ArkLayerInput;
    nextRoundAt: number | null;
    roundIntervalSec: number | null;
    /** Open the record inspector for a record id (block:<height> for rail clicks). */
    onInspect: (recordId: string) => void;
    /**
     * Optional provenance line rendered under the panel header — e.g. a stale
     * snapshot warning the page computes. Kept as a plain string so the canvas
     * stays presentational.
     */
    coverageNote?: string;
    className?: string;
}) {
    const navigate = useNavigate();
    const [windowSec, setWindowSec] = useState<number>(24 * 3600);
    const [lane, setLane] = useState<LaneChoice>("all");
    const [panSec, setPanSec] = useState(0);
    const [hoverRels, setHoverRels] = useState<ReadonlySet<string> | null>(null);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ startX: number; startPan: number; moved: boolean } | null>(null);

    const layout = useMemo<ArkLayerLayout>(
        () =>
            computeArkLayer(
                {
                    ...input,
                    windowSec,
                    lane,
                    panSec,
                    nextRoundAt,
                },
                {},
            ),
        [input, windowSec, lane, panSec, nextRoundAt],
    );

    // Keep pan inside the prototype's bounds: future headroom minus one hour,
    // never past now.
    useEffect(() => {
        const min = -(windowSec - 3600);
        setPanSec((p) => Math.min(0, Math.max(min, p)));
    }, [windowSec]);

    // Start a narrow viewport at the newest edge once content is laid out.
    useEffect(() => {
        const scroller = stageRef.current?.querySelector<HTMLElement>("[data-atlas-scroll]");
        if (scroller && scroller.scrollWidth > scroller.clientWidth + 8) {
            scroller.scrollLeft = scroller.scrollWidth;
        }
    }, [layout.width, windowSec, lane, layout.counts.arkEvents]);

    const dimFor = useCallback(
        (rels: string[], baseOpacity: number) => {
            if (!hoverRels) return undefined;
            const hit = rels.some((rel) => hoverRels.has(rel));
            return hit ? Math.min(1, baseOpacity * 1.6) : baseOpacity * 0.28;
        },
        [hoverRels],
    );

    const showTip = useCallback((event: ReactPointerEvent, tip: Omit<TooltipState, "x" | "y">) => {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        setTooltip({
            ...tip,
            x: Math.min(Math.max(event.clientX - rect.left + 12, 8), Math.max(8, rect.width - 220)),
            y: Math.min(Math.max(event.clientY - rect.top + 12, 8), Math.max(8, rect.height - 96)),
        });
    }, []);
    const hideTip = useCallback(() => setTooltip(null), []);
    const clearHover = useCallback(() => setHoverRels(null), []);

    // ---- pan: mouse drag on desktop; shift/ctrl+wheel pans vertically -------
    const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (event.pointerType !== "mouse") return;
        dragRef.current = { startX: event.clientX, startPan: panSec, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = event.clientX - drag.startX;
        if (Math.abs(dx) > 3) drag.moved = true;
        if (!drag.moved) return;
        // px → seconds through the rendered scale: unitW canvas units per
        // second; pxPerUnit = rendered px per canvas unit.
        const renderedWidth = event.currentTarget.getBoundingClientRect().width || layout.width;
        const pxPerUnit = renderedWidth / layout.width;
        const unitW = layout.unitW || 1;
        const next = drag.startPan - dx / (pxPerUnit * unitW);
        const min = -(windowSec - 3600);
        setPanSec(Math.min(0, Math.max(min, next)));
    };
    const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
        dragRef.current = null;
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            /* already released */
        }
    };
    const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
        if (!event.shiftKey && !event.ctrlKey) return;
        event.preventDefault();
        const renderedWidth = event.currentTarget.getBoundingClientRect().width || layout.width;
        const pxPerUnit = renderedWidth / layout.width;
        const unitW = layout.unitW || 1;
        const lineFactor = event.deltaMode === 1 ? 16 : 1;
        const deltaSec = (event.deltaY * lineFactor) / (pxPerUnit * unitW);
        setPanSec((p) => {
            const min = -(windowSec - 3600);
            return Math.min(0, Math.max(min, p + deltaSec));
        });
    };

    const windowLabel =
        windowSec <= 24 * 3600 ? (t: number) => fmtClock(t) : (t: number) => fmtDay(t);

    // Lane tags: compact chips pinned at the left edge, vertically centred on
    // each lane via the same y-fractions the SVG viewBox uses. They overlay the
    // scroll area so they stay put while the plot pans beneath them.
    const laneTags: Array<{
        label: string;
        sub?: string;
        y: number;
        cls: string;
        mobileHidden?: boolean;
    }> = [];
    if (lane !== "second") {
        laneTags.push(
            { label: "ARKADE", sub: "virtual txs", y: layout.laneArkY - 8, cls: "text-virt" },
            {
                label: "hourly count",
                sub: layout.hourlyUnavailable ? "tz unknown" : "archive",
                y: layout.laneArkY + 46,
                cls: "text-faint",
                mobileHidden: true,
            },
            {
                label: "COMMITMENTS",
                sub: "anchored to blocks",
                y: layout.laneCommitY - 8,
                cls: "text-chain",
            },
        );
    }
    if (lane !== "arkade") {
        laneTags.push({
            label: "SECOND",
            sub: "server wallet",
            y: layout.laneSecY - 8,
            cls: "text-chain",
        });
    }
    laneTags.push({
        label: "BITCOIN",
        sub: "block rail",
        y: layout.railY - 8,
        cls: "text-chain",
    });

    // Minimap: 7-day density of placed items + the visible window.
    const minimap = useMemo(() => {
        const tEnd = input.nowSec - panSec;
        const t0 = tEnd - MINIMAP_SPAN_SEC;
        const bins = new Array<number>(MINIMAP_BINS).fill(0);
        const binOf = (t: number) =>
            Math.min(
                MINIMAP_BINS - 1,
                Math.max(0, Math.floor(((t - t0) / MINIMAP_SPAN_SEC) * MINIMAP_BINS)),
            );
        const add = (t: number | null) => {
            if (t === null || t < t0 || t > tEnd + MINIMAP_SPAN_SEC) return;
            bins[binOf(t)] += 1;
        };
        for (const e of input.events ?? []) add(e.time);
        for (const c of input.commitments ?? []) {
            add(c.blockTimeSeconds ?? c.createdAtSeconds);
        }
        for (const tx of input.secondTxs ?? []) add(tx.time);
        const max = Math.max(...bins, 1);
        const bars = bins.map((count, i) => ({
            key: i,
            x: (i / MINIMAP_BINS) * 100,
            w: 100 / MINIMAP_BINS - 0.4,
            h: (count / max) * 100,
        }));
        const vx0 = Math.max(0, ((layout.tStart - t0) / MINIMAP_SPAN_SEC) * 100);
        const vx1 = Math.min(100, ((layout.tEnd - t0) / MINIMAP_SPAN_SEC) * 100);
        return { bars, vx0, vx1: Math.max(vx1, vx0 + 2) };
    }, [input, layout.tStart, layout.tEnd, panSec]);

    const commitmentByTxid = useMemo(() => {
        const map = new Map<string, ArkCommitment>();
        for (const c of input.commitments ?? []) map.set(c.txid, c);
        return map;
    }, [input.commitments]);

    // ---- node renderers -------------------------------------------------------
    const renderEventNode = (event: PlacedArkEvent) => {
        const r = event.radius;
        const opacity = dimFor(event.rels, 1);
        const ring = eventRingClass(event.state);
        const ringDash = event.state === "unknown" || event.state === "settled" ? "2 2" : undefined;
        return (
            <g
                key={event.id}
                transform={`translate(${event.x} ${event.y})`}
                style={{ cursor: "pointer", opacity }}
                onPointerEnter={(e) => {
                    setHoverRels(new Set(event.rels));
                    showTip(e, {
                        title: `ark tx · ${kindLabel(event.kind)}`,
                        lines: [
                            middleTruncate(event.txid),
                            `${event.statusLabel} · ${formatSatsInt(event.amountSat)}`,
                            event.kind === "transaction"
                                ? `${event.sourceLabel ?? "archive"} · not a spendable coin`
                                : `${event.vtxoCount} output${event.vtxoCount === 1 ? "" : "s"} · ${ago(event.time)}`,
                            ...(event.amountLabel && event.amountSat !== null
                                ? [`amount = ${event.amountLabel}`]
                                : []),
                        ],
                        txid: event.txid,
                    });
                }}
                onPointerLeave={() => {
                    clearHover();
                    hideTip();
                }}
                onClick={() => {
                    if (event.kind === "batch") {
                        navigate(`/commitment-tx/${event.txid}`);
                    } else {
                        navigate(`/tx/${event.txid}`);
                    }
                }}
            >
                <>
                    <circle r={r} className="fill-canvas stroke-virt" strokeWidth={1.3} />
                    <circle r={Math.max(1.2, r * 0.3)} className="fill-virt" />
                </>
                {ring && (
                    <circle
                        r={r + 3.2}
                        fill="none"
                        className={ring}
                        strokeWidth={event.state === "expired" ? 1.1 : 1}
                        strokeDasharray={ringDash}
                        opacity={0.7}
                    />
                )}
            </g>
        );
    };

    const renderCommitment = (commitment: PlacedArkCommitment) => {
        const opacity = dimFor(commitment.rels, 1);
        const source = commitmentByTxid.get(commitment.txid);
        const blockHeight = source?.blockHeight ?? null;
        return (
            <g
                key={commitment.txid}
                style={{ cursor: "pointer", opacity }}
                onPointerEnter={(e) => {
                    setHoverRels(new Set(commitment.rels));
                    showTip(e, {
                        title: "commitment · batch",
                        lines: [
                            middleTruncate(commitment.txid),
                            `${commitment.vtxoCount ?? "—"} VTXOs · ${
                                blockHeight !== null
                                    ? `block ${blockHeight.toLocaleString("en-US")}${
                                          commitment.anchorEstimated ? " (time est.)" : ""
                                      }`
                                    : "confirmation unknown"
                            } · ${ago(commitment.time)}`,
                        ],
                        txid: commitment.txid,
                    });
                }}
                onPointerLeave={() => {
                    clearHover();
                    hideTip();
                }}
                onClick={() => navigate(`/commitment-tx/${commitment.txid}`)}
            >
                <line
                    x1={commitment.x}
                    y1={commitment.y + 10}
                    x2={commitment.x}
                    y2={layout.railY - 6}
                    className="stroke-chain"
                    strokeWidth={1}
                    opacity={0.5}
                />
                <path
                    d={`M${commitment.x} ${commitment.y - 6.5} L${commitment.x + 6.5} ${commitment.y} L${commitment.x} ${commitment.y + 6.5} L${commitment.x - 6.5} ${commitment.y} Z`}
                    className="fill-canvas stroke-chain"
                    strokeWidth={1.3}
                    strokeLinejoin="round"
                    strokeDasharray={commitment.awaitingBlock ? "2 1.4" : undefined}
                />
            </g>
        );
    };

    const renderSecondTx = (tx: PlacedSecondTx) => {
        const opacity = dimFor(tx.rels, 1);
        return (
            <g
                key={tx.id}
                transform={`translate(${tx.x} ${tx.y})`}
                style={{ cursor: "pointer", opacity }}
                onPointerEnter={(e) => {
                    setHoverRels(new Set(tx.rels));
                    showTip(e, {
                        title: `second · ${directionLabel(tx.direction)}`,
                        lines: [
                            middleTruncate(tx.txid),
                            `${tx.statusLabel} · ${formatSatsInt(tx.amountSat)} · block ${
                                tx.blockHeight?.toLocaleString("en-US") ?? "—"
                            } · ${ago(tx.time)}`,
                        ],
                        txid: tx.txid,
                        href: `https://mempool.space/tx/${tx.txid}`,
                    });
                }}
                onPointerLeave={() => {
                    clearHover();
                    hideTip();
                }}
                onClick={() => window.open(`https://mempool.space/tx/${tx.txid}`, "_blank")}
            >
                {tx.blockHeight !== null && (
                    <line
                        x1={6}
                        y1={8}
                        x2={6}
                        y2={layout.railY - tx.y - 6}
                        className="stroke-chain"
                        strokeWidth={0.8}
                        opacity={0.4}
                    />
                )}
                <path
                    d="M0 -5 L5 0 L0 5 L-5 0 Z"
                    fill="none"
                    className="stroke-chain"
                    strokeWidth={1.1}
                />
            </g>
        );
    };

    const renderRailItem = (item: ArkRailItem, index: number) => {
        const rels = [
            `blk:${item.height}`,
            ...(item.commitTxid ? [`cm:${item.commitTxid}`] : []),
            ...(item.secondTxid ? [`tx:${item.secondTxid}`] : []),
        ];
        const next = layout.rail[index + 1];
        const gap = next ? next.x - item.x : layout.plotRight + 4 - item.x;
        const w = Math.max(1, Math.min(gap - 1, 10));
        const opacity = dimFor(rels, 1);
        const isLast = index === layout.rail.length - 1;
        // Minimum horizontal distance between shown labels, in viewBox units.
        // Heights use 12px text at the minimum 1240px canvas width; a
        // 160-unit pitch keeps neighbouring labels from touching; the wider
        // 24h window steps ~10 min/block (≈150 units) and needs a touch more.
        const labelW = windowSec <= 6 * 3600 ? 160 : windowSec <= 24 * 3600 ? 190 : 160;
        const labelX = item.x;
        const lastLabelX = railLabelX.current;
        const showLabel =
            labelX < layout.plotRight - 24 &&
            (labelX - lastLabelX >= labelW || (isLast && labelX - lastLabelX >= labelW * 0.55));
        if (showLabel) railLabelX.current = labelX;
        const blockTime = fmtClock(item.time);
        const blockDay = fmtDay(item.time);
        return (
            <g
                key={item.height}
                transform={`translate(${item.x} ${layout.railY})`}
                style={{ cursor: "pointer", opacity }}
                onPointerEnter={(e) => {
                    setHoverRels(new Set(rels));
                    showTip(e, {
                        title: `block ${item.height.toLocaleString("en-US")}`,
                        lines: [
                            `${windowSec <= 24 * 3600 ? `${blockDay} ${blockTime}` : blockDay} UTC${
                                item.known
                                    ? ""
                                    : item.estimated
                                      ? " · time estimated"
                                      : " · interpolated"
                            }`,
                            item.txCount !== undefined
                                ? `${item.txCount.toLocaleString("en-US")} txs`
                                : "height outside sampled blocks",
                            ...(item.size !== undefined
                                ? [`${(item.size / 1e6).toFixed(1)} MB`]
                                : []),
                            ...(item.commitTxid
                                ? [`commitment ${middleTruncate(item.commitTxid, 10)}`]
                                : []),
                        ],
                    });
                }}
                onPointerLeave={() => {
                    clearHover();
                    hideTip();
                }}
                onClick={() => onInspect(`block:${item.height}`)}
            >
                {item.known ? (
                    <>
                        <rect
                            x={-w / 2}
                            y={-4.5}
                            width={w}
                            height={9}
                            rx={1}
                            className={cn(
                                item.commitTxid ? "fill-chain" : "fill-line-strong",
                                !item.commitTxid && "opacity-50",
                            )}
                            stroke={
                                item.secondTxid || item.commitTxid
                                    ? "var(--chain)"
                                    : "var(--line-strong)"
                            }
                            strokeWidth={1}
                        />
                        {item.commitTxid && (
                            <rect
                                x={-w / 2}
                                y={-6.5}
                                width={w}
                                height={2.5}
                                className="fill-chain"
                                rx={1}
                            />
                        )}
                    </>
                ) : item.secondTxid ? (
                    <rect
                        x={4.5}
                        y={-3.5}
                        width={3}
                        height={7}
                        className="fill-canvas stroke-chain"
                        strokeWidth={0.9}
                    />
                ) : (
                    <rect
                        x={-1.5}
                        y={-5}
                        width={3}
                        height={10}
                        className="fill-faint opacity-60"
                        rx={0.5}
                    />
                )}
                {showLabel && (
                    <text x={0} y={18} textAnchor="middle" className="fill-faint" fontSize={12}>
                        {item.height.toLocaleString("en-US")}
                    </text>
                )}
            </g>
        );
    };

    // Rail label spacing is sequential — reset per layout via a ref keyed on
    // the layout object identity (recomputed whenever inputs change).
    const railLabelX = useRef(-1e9);
    useEffect(() => {
        railLabelX.current = -1e9;
    }, [layout]);

    const renderStub = (stub: ArkLayerLayout["stubs"][number], index: number) => {
        const opacity = dimFor(stub.rels, 0.8);
        const y = stub.row === 0 ? layout.laneArkY - 21 : layout.laneCommitY - 16;
        // Nearby anchors can share the same annotation; keep every arrow, not overlapping copies.
        const showLabel =
            layout.stubs.findIndex(
                (other) =>
                    other.row === stub.row &&
                    other.text === stub.text &&
                    Math.abs(other.x - stub.x) < 120,
            ) === index;
        return (
            <g key={`${stub.x}-${stub.row}`} opacity={opacity}>
                <title>{stub.text}</title>
                <line
                    x1={stub.dir < 0 ? stub.x + 12 : stub.x - 12}
                    y1={stub.row === 0 ? layout.laneArkY : layout.laneCommitY - 4}
                    x2={stub.dir < 0 ? stub.x + 30 : stub.x - 30}
                    y2={stub.row === 0 ? layout.laneArkY : layout.laneCommitY - 4}
                    className="stroke-virt"
                    strokeWidth={1}
                    opacity={0.7}
                    markerEnd="url(#atlas-arr-virt)"
                />
                {showLabel && (
                    <text
                        x={stub.x}
                        y={y}
                        textAnchor="middle"
                        className="fill-faint"
                        fontSize={12}
                        stroke="var(--canvas)"
                        strokeWidth={4}
                        paintOrder="stroke"
                    >
                        {stub.text}
                    </text>
                )}
            </g>
        );
    };

    const empty =
        layout.counts.arkEvents === 0 && layout.counts.secondTxs === 0 && layout.counts.rail === 0;

    return (
        <Panel
            variant="canvas"
            className={cn("relative", className)}
            title={
                <span className="micro text-faint">
                    The Ark layer
                    <span className="ml-3 font-sans text-xs normal-case tracking-normal text-faint">
                        time (UTC) → · commitments anchor to Bitcoin blocks below
                    </span>
                </span>
            }
            actions={
                <>
                    <Segmented
                        ariaLabel="Time window"
                        value={String(windowSec) as WindowChoice}
                        onChange={(v) => setWindowSec(Number(v))}
                        options={WINDOW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                    <Segmented
                        ariaLabel="Lane filter"
                        value={lane}
                        onChange={setLane}
                        options={LANE_OPTIONS}
                    />
                    <NextRoundBadge nextRoundAt={nextRoundAt} intervalSec={roundIntervalSec} />
                </>
            }
        >
            {coverageNote && (
                <p className="border-b border-border/60 px-4 py-2 text-xs leading-relaxed text-warning">
                    {coverageNote}
                </p>
            )}
            <div ref={stageRef} className="relative">
                <div className="relative">
                    <div data-atlas-scroll className="overflow-x-auto overscroll-x-contain">
                        <svg
                            viewBox={`0 0 ${layout.width} ${layout.height}`}
                            preserveAspectRatio="xMidYMid meet"
                            role="img"
                            aria-label="Ark activity map: virtual transactions, batch commitments and Second server transactions on a shared time axis"
                            className="block h-auto w-full min-w-[1240px] cursor-grab select-none active:cursor-grabbing"
                            onPointerDown={onPointerDown}
                            onPointerMove={onPointerMove}
                            onPointerUp={onPointerUp}
                            onPointerCancel={onPointerUp}
                            onWheel={onWheel}
                        >
                            <defs>
                                <pattern
                                    id="atlas-dots"
                                    width={24}
                                    height={24}
                                    patternUnits="userSpaceOnUse"
                                >
                                    <circle cx={1.2} cy={1.2} r={1} className="fill-grid" />
                                </pattern>
                                <marker
                                    id="atlas-arr-virt"
                                    viewBox="0 0 8 8"
                                    refX={7}
                                    refY={4}
                                    markerWidth={6.5}
                                    markerHeight={6.5}
                                    orient="auto-start-reverse"
                                >
                                    <path d="M0 0 L8 4 L0 8 Z" className="fill-virt" />
                                </marker>
                            </defs>
                            <rect
                                x={0}
                                y={0}
                                width={layout.width}
                                height={layout.height}
                                fill="url(#atlas-dots)"
                            />

                            {/* time axis */}
                            {layout.ticks.map((tick, i) => (
                                <g key={i}>
                                    <line
                                        x1={tick.x}
                                        y1={15}
                                        x2={tick.x}
                                        y2={21}
                                        className="stroke-line-strong"
                                        strokeWidth={1}
                                    />
                                    {tick.x <= layout.plotRight - 30 && (
                                        <text
                                            x={tick.x}
                                            y={10}
                                            textAnchor="middle"
                                            className="fill-faint"
                                            fontSize={12}
                                        >
                                            {windowLabel(tick.time)}
                                        </text>
                                    )}
                                </g>
                            ))}

                            {/* hourly density band — only when timezone is explicit */}
                            {layout.hourlyPath && lane !== "second" && (
                                <path d={layout.hourlyPath} className="fill-virt" opacity={0.11} />
                            )}
                            {layout.hourlyUnavailable && lane !== "second" && (
                                <text
                                    x={layout.plotLeft + 8}
                                    y={layout.laneArkY + 72}
                                    className="fill-faint"
                                    fontSize={12}
                                >
                                    Hourly density unavailable: archive timestamps have no timezone
                                </text>
                            )}

                            {/* block rail */}
                            {layout.rail.map(renderRailItem)}
                            <text
                                x={layout.plotLeft + 6}
                                y={layout.railY + 30}
                                className="fill-faint"
                                fontSize={12}
                            >
                                block height →
                            </text>

                            {/* commitment stems + diamonds */}
                            {layout.commitments.map(renderCommitment)}

                            {/* Arkade virtual events */}
                            {layout.events.map(renderEventNode)}

                            {/* stubs toward off-window anchors */}
                            {layout.stubs.map(renderStub)}

                            {/* Second server txs */}
                            {layout.secondTxs.map(renderSecondTx)}

                            {/* now edge */}
                            <g transform={`translate(${layout.nowX} 0)`}>
                                <line
                                    x1={0}
                                    y1={18}
                                    x2={0}
                                    y2={layout.height - 4}
                                    className="stroke-foreground"
                                    strokeWidth={1}
                                    strokeDasharray="2 4"
                                    opacity={0.5}
                                />
                                <circle
                                    cx={0}
                                    cy={layout.railY}
                                    r={3.5}
                                    className="fill-foreground"
                                />
                            </g>

                            {/* next-round ghost */}
                            {layout.nextRound && (
                                <g
                                    transform={`translate(${layout.nextRound.x} ${layout.laneSecY})`}
                                    opacity={0.5}
                                >
                                    <path
                                        d="M0 -6 L6 0 L0 6 L-6 0 Z"
                                        fill="none"
                                        className="stroke-chain"
                                        strokeWidth={1}
                                    />
                                    <text
                                        x={0}
                                        y={14}
                                        textAnchor="middle"
                                        className="fill-chain"
                                        fontSize={12}
                                    >
                                        next
                                    </text>
                                </g>
                            )}
                        </svg>
                    </div>
                    {/* Lane tags: compact chips pinned at the left edge, centred
                        on each lane via viewBox y-fractions. Overlay the scroll
                        area so they stay put while the plot pans beneath. */}
                    <div
                        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[104px]"
                        aria-hidden="true"
                    >
                        {laneTags.map((tag) => (
                            <div
                                key={tag.label}
                                className={cn(
                                    "absolute left-1.5",
                                    tag.mobileHidden && "hidden md:block",
                                )}
                                style={{
                                    top: `calc(${(tag.y / layout.height) * 100}% - 9px)`,
                                }}
                            >
                                <div className="whitespace-nowrap rounded-sm border border-border/60 bg-canvas/85 px-1.5 py-[3px] text-xs font-semibold leading-none tracking-wide backdrop-blur-[1px]">
                                    <span className={tag.cls}>{tag.label}</span>
                                    {tag.sub && (
                                        <span className="ml-1 hidden font-normal text-faint md:inline">
                                            {tag.sub}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* minimap + coverage meta — counts are window samples, not network totals */}
                <div className="flex flex-col gap-2 border-t border-border px-4 py-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
                    <span className="micro text-faint">
                        {fmtDay(layout.tStart)} → {fmtDay(layout.tEnd)} · {layout.counts.rail}{" "}
                        sampled blocks · {layout.counts.arkEvents}{" "}
                        {layout.counts.arkEvents === 1 ? "Arkade tx" : "Arkade txs"} ·{" "}
                        {layout.counts.secondTxs}{" "}
                        {layout.counts.secondTxs === 1 ? "Second tx" : "Second txs"} in window
                    </span>
                    <div
                        className="h-[34px] w-full shrink-0 sm:h-[34px] sm:w-[150px]"
                        aria-hidden="true"
                    >
                        <svg
                            viewBox="0 0 100 34"
                            preserveAspectRatio="none"
                            className="h-full w-full"
                        >
                            {minimap.bars.map((bar) =>
                                bar.h > 0 ? (
                                    <rect
                                        key={bar.key}
                                        x={bar.x}
                                        y={34 - 3 - (bar.h / 100) * 28}
                                        width={bar.w}
                                        height={(bar.h / 100) * 28}
                                        className="fill-virt"
                                        opacity={0.5}
                                    />
                                ) : null,
                            )}
                            <rect
                                x={minimap.vx0}
                                y={2}
                                width={minimap.vx1 - minimap.vx0}
                                height={29}
                                fill="none"
                                className="stroke-foreground"
                                strokeWidth={1}
                                opacity={0.7}
                            />
                        </svg>
                    </div>
                </div>

                {empty && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <p className="rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-faint">
                            No activity in this window — pan left or widen the window.
                        </p>
                    </div>
                )}

                {tooltip && (
                    <div
                        className="pointer-events-none absolute z-20 w-[220px] rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-lg"
                        style={{ left: tooltip.x, top: tooltip.y }}
                    >
                        <p className="font-semibold text-foreground">{tooltip.title}</p>
                        {tooltip.lines.map((line, i) => (
                            <p
                                key={i}
                                className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
                            >
                                {line}
                            </p>
                        ))}
                        {tooltip.txid && (
                            <p className="mt-1 font-mono text-xs text-faint">
                                {middleTruncate(tooltip.txid, 12)}
                                {tooltip.href ? " ↗" : ""}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </Panel>
    );
}

function NextRoundBadge({
    nextRoundAt,
    intervalSec,
}: {
    nextRoundAt: number | null;
    intervalSec: number | null;
}) {
    const [, force] = useState(0);
    useEffect(() => {
        if (nextRoundAt === null) return;
        const id = setInterval(() => force((n) => n + 1), 30_000);
        return () => clearInterval(id);
    }, [nextRoundAt]);
    if (nextRoundAt === null) return null;
    const left = nextRoundAt - Date.now() / 1000;
    const label =
        left > 0
            ? `next round in ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`
            : "round time passed · awaiting update";
    return (
        <span
            className={cn("micro whitespace-nowrap", left > 0 ? "text-chain" : "text-faint")}
            title={
                intervalSec
                    ? `server-announced round time · nominal interval ${intervalSec}s`
                    : "server-announced round time"
            }
        >
            ◈ {label}
        </span>
    );
}
