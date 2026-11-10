import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Transaction } from "@scure/btc-signer";
import type { VirtualCoin } from "@arkade-os/sdk";
import { layoutTxFlow, compressSpineEntries, type TxFlowLayout } from "@/lib/tx-flow";
import { atlasVtxoState, ATLAS_STATE_META, type AtlasVtxoState } from "@/lib/atlas/vtxo-state";
import type { ChainSummary } from "@/lib/atlas/chain";
import { useNow, useExitDelays, useChainTip } from "@/hooks/use-expiry";
import { useVtxoChain } from "@/hooks/use-vtxo-chain";
import { middleTruncate } from "@/components/atlas/hash";
import { Glyph, VtxoGlyph, type GlyphKind } from "@/components/atlas/glyph";
import { Panel } from "@/components/atlas/panel";
import { formatSats } from "@/lib/utils";
import type { ParsedTx, ParsedOutput, ParsedInput } from "@/lib/tx-parse";
import type { SpendPath } from "@/lib/arkadeScript";
import type { RelativeTimelock } from "@/lib/vtxo-display";
import { ESPLORA } from "@/lib/live-second";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxMapProps {
    parsed: ParsedTx;
    txid: string;
    vtxoData?: VirtualCoin[] | undefined;
    checkpointVtxo: VirtualCoin | null;
    forfeitVtxo: VirtualCoin | null;
    pendingOutpoints: ReadonlySet<string>;
    inputSpendPaths: Array<SpendPath | null>;
    outputSpendPaths: Map<number, SpendPath>;
    spendingTxs: Transaction[];
    settlementLeafTxs: Transaction[];
    subtype: string;
    selectedVout: number | null;
    onSelectVout: (vout: number) => void;
    /** Pre-fetched chain summary; if provided, skips internal fetch. */
    chainSummary?: ChainSummary | null;
    chainLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Spine entry → glyph kind
// ---------------------------------------------------------------------------

const SPINE_KIND_GLYPH: Record<string, GlyphKind> = {
    ark: "ark",
    checkpoint: "checkpoint",
    tree: "tree",
    commitment: "commitment",
    unknown: "ark",
};

const SPINE_KIND_LABEL: Record<string, string> = {
    ark: "Arkade tx",
    checkpoint: "Checkpoint",
    tree: "Tree tx",
    commitment: "Commitment",
    unknown: "Unknown",
};

const SPINE_KIND_CLASS: Record<string, string> = {
    ark: "text-virt",
    checkpoint: "text-cp",
    tree: "text-muted-foreground",
    commitment: "text-chain",
    unknown: "text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TxMap({
    parsed,
    txid,
    vtxoData: _vtxoData,
    checkpointVtxo,
    forfeitVtxo,
    pendingOutpoints,
    subtype,
    selectedVout,
    onSelectVout,
    chainSummary: chainSummaryProp,
    chainLoading: chainLoadingProp,
}: TxMapProps) {
    const now = useNow(30_000);
    const { unilateralExitDelay } = useExitDelays();
    // Chain tip only matters for height-based expiry (regtest-like deployments).
    const hasHeightExpiry = useMemo(
        () =>
            checkpointVtxo?.expiresAtHeight != null ||
            forfeitVtxo?.expiresAtHeight != null ||
            parsed.outputs.some((o) => o.vtxo?.expiresAtHeight != null),
        [parsed.outputs, checkpointVtxo, forfeitVtxo],
    );
    const tipHeight = useChainTip(hasHeightExpiry);

    // Determine the VTXO outpoint for the spine: selected output or first unspent VTXO
    const spineOutpoint = useMemo(() => {
        const outputs = parsed.outputs;
        const defaultVout = (() => {
            for (const o of outputs) {
                if (o.isAnchor || o.isArkExtension) continue;
                const v = effectiveVtxo(o, checkpointVtxo, forfeitVtxo, subtype);
                if (v && !v.isSpent && !v.spentBy) return o.index;
            }
            for (const o of outputs) {
                if (!o.isAnchor && !o.isArkExtension) return o.index;
            }
            return outputs[0]?.index ?? null;
        })();
        const vout = selectedVout ?? defaultVout;
        if (vout === null) return null;
        return { txid, vout };
    }, [parsed.outputs, selectedVout, txid, checkpointVtxo, forfeitVtxo, subtype]);

    const { summary: chainSummaryInternal, isLoading: chainLoadingInternal } = useVtxoChain(
        chainSummaryProp !== undefined ? null : spineOutpoint,
    );
    const chainSummary = chainSummaryProp !== undefined ? chainSummaryProp : chainSummaryInternal;
    const chainLoading = chainLoadingProp !== undefined ? chainLoadingProp : chainLoadingInternal;

    const spineEntries = useMemo(() => {
        if (!chainSummary) return [];
        const hops = chainSummary.hops.filter((h, i) => !(i === 0 && h.txid === txid));
        return compressSpineEntries(hops.map((h) => ({ txid: h.txid, kind: h.kind })));
    }, [chainSummary, txid]);

    const anchorTxid = chainSummary?.anchors[chainSummary.anchors.length - 1] ?? null;

    // Fetch block height for the anchor commitment tx from Esplora
    const { data: anchorTxStatus } = useQuery({
        queryKey: ["anchor-tx-status", anchorTxid],
        queryFn: async () => {
            if (!anchorTxid) return null;
            const res = await fetch(`${ESPLORA}/tx/${anchorTxid}`);
            if (!res.ok) return null;
            const data = (await res.json()) as {
                status?: { confirmed?: boolean; block_height?: number };
            };
            return data.status?.confirmed ? (data.status.block_height ?? null) : null;
        },
        enabled: !!anchorTxid,
        staleTime: 60_000,
    });

    const spineAnchor = useMemo(() => {
        if (!anchorTxid) return null;
        return { txid: anchorTxid, height: anchorTxStatus ?? null };
    }, [anchorTxid, anchorTxStatus]);

    const vertical = useIsMobile();

    const layout = useMemo(() => {
        const inputAmounts = parsed.inputs.map((i) => Number(i.amount ?? 0));
        const outputAmounts = parsed.outputs.map((o) => Number(o.amount));
        const anchorFlags = parsed.outputs.map((o) => o.isAnchor);
        const spentBy = parsed.outputs.map((o) => {
            const v = effectiveVtxo(o, checkpointVtxo, forfeitVtxo, subtype);
            if (!v) return null;
            const spent = v.isSpent === true || (!!v.spentBy && v.spentBy !== "");
            if (!spent) return null;
            return v.spentBy && v.spentBy !== "" ? v.spentBy : null;
        });
        return layoutTxFlow({
            inputCount: parsed.inputs.length,
            outputCount: parsed.outputs.length,
            inputAmounts,
            outputAmounts,
            anchorFlags,
            spentBy,
            spineEntries,
            spineAnchor,
            vertical,
        });
    }, [parsed, checkpointVtxo, forfeitVtxo, subtype, spineEntries, spineAnchor, vertical]);

    return (
        <Panel
            variant="canvas"
            title="Flow → unroll"
            subtitle="inputs → this tx → outputs, then the ancestry spine down to its on-chain anchor"
            bodyClassName="relative"
        >
            <TxMapSvg
                layout={layout}
                parsed={parsed}
                txid={txid}
                checkpointVtxo={checkpointVtxo}
                forfeitVtxo={forfeitVtxo}
                pendingOutpoints={pendingOutpoints}
                subtype={subtype}
                selectedVout={selectedVout}
                onSelectVout={onSelectVout}
                chainLoading={chainLoading}
                now={now}
                exitDelay={unilateralExitDelay}
                tipHeight={tipHeight}
            />
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Effective VTXO resolution (mirrors old OutputCard logic)
// ---------------------------------------------------------------------------

function effectiveVtxo(
    output: ParsedOutput,
    checkpointVtxo: VirtualCoin | null,
    forfeitVtxo: VirtualCoin | null,
    _subtype: string,
): VirtualCoin | undefined {
    if (checkpointVtxo && !output.isAnchor) return checkpointVtxo;
    if (forfeitVtxo && output.isForfeit) return forfeitVtxo;
    return output.vtxo;
}

// ---------------------------------------------------------------------------
// Mobile detection
// ---------------------------------------------------------------------------

function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== "undefined" ? window.innerWidth < 720 : false,
    );
    useEffect(() => {
        if (typeof window === "undefined") return;
        const handler = () => setIsMobile(window.innerWidth < 720);
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
    }, []);
    return isMobile;
}

// ---------------------------------------------------------------------------
// SVG renderer
// ---------------------------------------------------------------------------

interface TxMapSvgProps {
    layout: TxFlowLayout;
    parsed: ParsedTx;
    txid: string;
    checkpointVtxo: VirtualCoin | null;
    forfeitVtxo: VirtualCoin | null;
    pendingOutpoints: ReadonlySet<string>;
    subtype: string;
    selectedVout: number | null;
    onSelectVout: (vout: number) => void;
    chainLoading: boolean;
    now: number;
    exitDelay: RelativeTimelock | null;
    tipHeight: number | null;
}

function TxMapSvg({
    layout,
    parsed,
    txid,
    checkpointVtxo,
    forfeitVtxo,
    pendingOutpoints,
    subtype,
    selectedVout,
    onSelectVout,
    chainLoading,
    now,
    exitDelay,
    tipHeight,
}: TxMapSvgProps) {
    const {
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
    } = layout;

    const vtxoStates = useMemo(() => {
        const map = new Map<number, { state: AtlasVtxoState; lifetimeLeft: number | null }>();
        for (const output of parsed.outputs) {
            const v = effectiveVtxo(output, checkpointVtxo, forfeitVtxo, subtype);
            if (!v) continue;
            const view = atlasVtxoState(v, {
                nowMs: now,
                exitDelay,
                tipHeight,
                pendingOutpoints,
            });
            map.set(output.index, { state: view.state, lifetimeLeft: view.lifetimeLeft });
        }
        for (const input of parsed.inputs) {
            // Input VTXOs are consumed by this tx — always show as spent (faint).
            // Only checkpoint subtype has a resolvable VTXO for the input.
            if (subtype === "checkpoint" && input.index === 0 && checkpointVtxo) {
                const view = atlasVtxoState(checkpointVtxo, {
                    nowMs: now,
                    exitDelay,
                    tipHeight,
                    pendingOutpoints,
                });
                map.set(-1 - input.index, { state: view.state, lifetimeLeft: view.lifetimeLeft });
            } else {
                // No resolvable VTXO → treat as spent (consumed by this tx)
                map.set(-1 - input.index, { state: "spent" as AtlasVtxoState, lifetimeLeft: null });
            }
        }
        return map;
    }, [parsed, checkpointVtxo, forfeitVtxo, subtype, now, exitDelay, tipHeight, pendingOutpoints]);

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="block h-auto w-full"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Transaction flow map"
        >
            <defs>
                <pattern id="atlas-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                    <circle cx="1" cy="1" r="1" className="fill-grid" />
                </pattern>
            </defs>
            <rect width={width} height={height} fill="url(#atlas-grid)" />

            {/* Edges */}
            {inputEdges.map((edge, i) => (
                <path
                    key={`ie-${i}`}
                    d={bezierPath(edge.points)}
                    fill="none"
                    className="stroke-virt"
                    strokeWidth="1.3"
                />
            ))}
            {outputEdges.map((edge, i) => (
                <path
                    key={`oe-${i}`}
                    d={bezierPath(edge.points)}
                    fill="none"
                    className="stroke-virt"
                    strokeWidth="1.3"
                />
            ))}

            {/* Tx node */}
            <TxNodeSvg x={txNode.x} y={txNode.y} subtype={subtype} txid={txid} />

            {/* Spine connector */}
            {hasSpine && (
                <line
                    x1={txNode.x}
                    y1={txNode.y + 38}
                    x2={txNode.x}
                    y2={spineY0 - 8}
                    className="stroke-line-strong"
                    strokeWidth="1.4"
                />
            )}

            {/* Inputs */}
            {inputs.map((node, i) => {
                const input = parsed.inputs[i];
                const vtxoState = vtxoStates.get(-1 - i);
                return (
                    <InputNodeSvg
                        key={`in-${i}`}
                        node={node}
                        input={input}
                        state={vtxoState}
                        vertical={vertical}
                    />
                );
            })}

            {/* Outputs */}
            {outputs.map((node, i) => {
                const output = parsed.outputs[i];
                const vtxoState = vtxoStates.get(output.index);
                const isSelected =
                    selectedVout === output.index ||
                    (selectedVout === null && isDefaultSelected(output, parsed));
                return (
                    <OutputNodeSvg
                        key={`out-${i}`}
                        node={node}
                        output={output}
                        state={vtxoState}
                        selected={isSelected}
                        onSelect={() => onSelectVout(output.index)}
                        spentStub={spentStubs.find((s) => s.outputIndex === i)}
                        vertical={vertical}
                    />
                );
            })}

            {/* Spine rows */}
            {spineRows.map((row, i) => (
                <SpineRowSvg key={`spine-${i}`} row={row} cx={width / 2} />
            ))}

            {chainLoading && (
                <text x={width / 2} y={18} textAnchor="middle" className="fill-faint" fontSize="10">
                    loading unroll path…
                </text>
            )}
        </svg>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function bezierPath(
    points: [number, number, number, number, number, number, number, number],
): string {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = points;
    return `M ${x0} ${y0} C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3}`;
}

function isDefaultSelected(output: ParsedOutput, parsed: ParsedTx): boolean {
    for (const o of parsed.outputs) {
        if (o.isAnchor || o.isArkExtension) continue;
        if (o.vtxo && !o.vtxo.isSpent && !o.vtxo.spentBy) return o.index === output.index;
    }
    return false;
}

function TxNodeSvg({
    x,
    y,
    subtype,
    txid,
}: {
    x: number;
    y: number;
    subtype: string;
    txid: string;
}) {
    // Map subtype to display label — never show "generic"
    const kindLabel = (() => {
        switch (subtype) {
            case "forfeit":
                return "forfeit";
            case "checkpoint":
                return "checkpoint";
            case "batch-tree":
                return "batch tree";
            case "connector-tree":
                return "connector tree";
            default:
                return "payment";
        }
    })();
    return (
        <g transform={`translate(${x} ${y})`}>
            <rect
                x={-52}
                y={-28}
                width={104}
                height={56}
                rx={12}
                className="fill-card"
                stroke="hsl(var(--virt))"
                strokeWidth="1.6"
            />
            <text
                y={-6}
                textAnchor="middle"
                className="fill-foreground"
                fontSize="13"
                fontWeight="600"
            >
                {kindLabel}
            </text>
            <text y={10} textAnchor="middle" className="fill-virt" fontSize="10">
                {middleTruncate(txid, 8, 4)}
            </text>
        </g>
    );
}

function InputNodeSvg({
    node,
    input,
    state,
    vertical,
}: {
    node: { x: number; y: number; r: number };
    input: ParsedInput;
    state?: { state: AtlasVtxoState; lifetimeLeft: number | null };
    vertical: boolean;
}) {
    const amt = input.amount !== null ? Number(input.amount) : 0;
    const glyphSize = vertical ? 36 : node.r * 2.2;
    const labelY = vertical ? node.r + 18 : node.r + 14;
    return (
        <g transform={`translate(${node.x} ${node.y})`} className="cursor-pointer">
            <VtxoGlyph
                state={state?.state ?? "spent"}
                lifetimeLeft={state?.lifetimeLeft ?? null}
                size={glyphSize}
                className="text-virt"
            />
            <text y={labelY} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
                {formatSats(amt)}
            </text>
            {input.txid && <title>{`input ${input.txid}:${input.vout}`}</title>}
        </g>
    );
}

function OutputNodeSvg({
    node,
    output,
    state,
    onSelect,
    spentStub: _spentStub,
    vertical,
}: {
    node: { x: number; y: number; r: number };
    output: ParsedOutput;
    state?: { state: AtlasVtxoState; lifetimeLeft: number | null };
    selected: boolean;
    onSelect: () => void;
    spentStub?: { stubX: number; y: number; spentBy: string };
    vertical: boolean;
}) {
    const amt = Number(output.amount);
    const isAnchor = output.isAnchor;
    const isExt = output.isArkExtension;
    const isForfeit = output.isForfeit;
    const isBatch = output.isBatch;
    const glyphSize = vertical ? 36 : node.r * 2.2;
    const amountY = vertical ? node.r + 16 : node.r + 14;
    const stateY = vertical ? node.r + 28 : node.r + 24;
    return (
        <g
            transform={`translate(${node.x} ${node.y})`}
            className="cursor-pointer"
            onClick={onSelect}
        >
            {isAnchor ? (
                <>
                    <rect
                        x={-8}
                        y={-8}
                        width={16}
                        height={16}
                        fill="none"
                        className="stroke-faint"
                        strokeWidth="1.2"
                        strokeDasharray="2 2"
                    />
                    <text y={24} textAnchor="middle" className="fill-faint" fontSize="9">
                        anchor
                    </text>
                </>
            ) : isExt ? (
                <>
                    <rect
                        x={-9}
                        y={-6}
                        width={18}
                        height={12}
                        rx={3}
                        fill="none"
                        className="stroke-line-strong"
                        strokeWidth="1.2"
                    />
                    <text y={node.r + 14} textAnchor="middle" className="fill-faint" fontSize="9">
                        OP_RETURN
                    </text>
                </>
            ) : (
                <>
                    {/* VTXO glyph with state ring */}
                    <VtxoGlyph
                        state={state?.state ?? "spent"}
                        lifetimeLeft={state?.lifetimeLeft ?? null}
                        size={glyphSize}
                        className={isForfeit ? "text-alert" : "text-virt"}
                    />
                    <text
                        y={amountY}
                        textAnchor="middle"
                        className="fill-muted-foreground"
                        fontSize="10"
                    >
                        {formatSats(amt)}
                    </text>
                    {state && (
                        <text y={stateY} textAnchor="middle" className="fill-faint" fontSize="8">
                            {ATLAS_STATE_META[state.state].label}
                        </text>
                    )}
                    {isForfeit && (
                        <text
                            y={-node.r - 8}
                            textAnchor="middle"
                            className="fill-alert"
                            fontSize="9"
                        >
                            forfeit
                        </text>
                    )}
                    {isBatch && (
                        <text
                            y={-node.r - 8}
                            textAnchor="middle"
                            className="fill-chain"
                            fontSize="9"
                        >
                            batch #{parseInt(output.batchKey) + 1}
                        </text>
                    )}
                </>
            )}
            <title>{`output ${output.index} · ${formatSats(amt)} sats`}</title>
        </g>
    );
}

function SpineRowSvg({
    row,
    cx,
}: {
    row: {
        kind: string;
        y: number;
        hop?: { txid: string; kind: string };
        gap?: { count: number; counts: Record<string, number> };
        anchor?: { txid: string; height: number | null };
    };
    cx: number;
}) {
    const y = row.y;
    if (row.kind === "gap" && row.gap) {
        const w = 200;
        const h = 24;
        return (
            <g transform={`translate(${cx} ${y})`} className="cursor-pointer">
                <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={6}
                    className="fill-card stroke-cp"
                    strokeWidth="1"
                />
                <text y={4} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
                    … {row.gap.count} hops compressed
                </text>
                <title>{`${row.gap.count} chain entries elided`}</title>
            </g>
        );
    }
    if (row.kind === "anchor" && row.anchor) {
        const mempoolUrl = `https://mempool.space/tx/${row.anchor.txid}`;
        return (
            <a href={mempoolUrl} target="_blank" rel="noopener noreferrer">
                <g transform={`translate(${cx} ${y})`}>
                    {/* Commitment glyph on a stem above the block */}
                    <line
                        x1={0}
                        y1={-16}
                        x2={0}
                        y2={-4}
                        className="stroke-line-strong"
                        strokeWidth="1.2"
                    />
                    <Glyph kind="commitment" size={16} className="text-chain" />
                    {/* Block tile */}
                    <rect
                        x={-10}
                        y={0}
                        width={20}
                        height={20}
                        className="fill-card stroke-chain"
                        strokeWidth="1.5"
                    />
                    <text
                        y={14}
                        textAnchor="middle"
                        className="fill-chain"
                        fontSize="9"
                        fontWeight="600"
                    >
                        {row.anchor.height ? `B${row.anchor.height}` : "◆"}
                    </text>
                    <text y={32} textAnchor="middle" className="fill-faint" fontSize="8">
                        {row.anchor.height ? `block ${row.anchor.height}` : "commitment"}
                    </text>
                    <title>{`commitment tx ${row.anchor.txid}`}</title>
                </g>
            </a>
        );
    }
    if (row.kind === "hop" && row.hop) {
        const glyphKind = SPINE_KIND_GLYPH[row.hop.kind] ?? "ark";
        const label = SPINE_KIND_LABEL[row.hop.kind] ?? row.hop.kind;
        const toneClass = SPINE_KIND_CLASS[row.hop.kind] ?? "text-muted-foreground";
        return (
            <g transform={`translate(${cx} ${y})`} className="cursor-pointer">
                <Glyph kind={glyphKind} size={16} className={toneClass} />
                <text x={22} y={4} className="fill-foreground" fontSize="11">
                    {middleTruncate(row.hop.txid, 10, 4)}
                </text>
                <text x={22} y={16} className="fill-faint" fontSize="9">
                    {label}
                </text>
                <title>{`${label} · ${row.hop.txid}`}</title>
            </g>
        );
    }
    return null;
}
