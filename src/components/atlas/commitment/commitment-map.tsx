import { Link } from "react-router-dom";
import type { ParsedTx, ParsedOutput } from "@/lib/tx-parse";
import { Panel } from "@/components/atlas/panel";
import { Glyph } from "@/components/atlas/glyph";
import { middleTruncate } from "@/components/atlas/hash";
import { formatSats } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/formatters";
import { useRecentBlocks } from "@/hooks/use-recent-blocks";
import { useNow } from "@/hooks/use-expiry";

export interface CommitmentMapProps {
    parsed: ParsedTx;
    txid: string;
    batchRootTxids: Map<number, string>;
    connectorOutputIndices: Set<number>;
    forfeitTxids?: string[];
    connectors?: Array<{ txid: string; children?: Record<number, string> }>;
    blockHeight?: number | null;
    confirmations?: number | null;
}

/** Blocks drawn either side of the anchor block. */
const RAIL_SIDE = 3;
const RAIL_SPACING = 64;
/** Vertical distance between output rows. */
const ROW = 64;
/** Anchor x: room for the connector/forfeit fans on the left. */
const AX = 40 + RAIL_SIDE * RAIL_SPACING;
/** Output column x. */
const OX = AX + 250;
const WIDTH = OX + 190;
/** Txids listed per fan before folding into "+N more". */
const FAN_ROWS = 2;

/**
 * The commitment ◆ standing on its Bitcoin block among its neighbours, its
 * on-chain outputs (batch, connector, other) flowing right, and the round's
 * connector and forfeit transactions fanned in from the left.
 */
export function CommitmentMap({
    parsed,
    txid,
    batchRootTxids,
    connectorOutputIndices,
    forfeitTxids = [],
    connectors = [],
    blockHeight,
    confirmations,
}: CommitmentMapProps) {
    const now = useNow(30_000);
    const { blocks, tipHeight } = useRecentBlocks(50);

    const confirmed = typeof blockHeight === "number" && blockHeight > 0;
    const anchorTime = confirmed ? blocks.find((b) => b.height === blockHeight)?.time : undefined;
    // Confirmations pin the tip exactly; fall back to the recent-blocks tip.
    const tip =
        confirmed && confirmations && confirmations > 0
            ? blockHeight + confirmations - 1
            : tipHeight;
    const railHeights = confirmed
        ? Array.from({ length: RAIL_SIDE * 2 + 1 }, (_, i) => blockHeight - RAIL_SIDE + i).filter(
              (h) => tip === null || h <= tip,
          )
        : [];

    const outputs = parsed.outputs;
    const rowY = (i: number) => 40 + i * ROW;
    const lastRowY = rowY(Math.max(outputs.length - 1, 0));
    const railY = Math.max(lastRowY + 64, 236);
    const diamondY = railY - 104;
    const height = railY + 52;

    return (
        <Panel
            variant="canvas"
            title="Block anchor"
            subtitle="this commitment tx sits in a Bitcoin block; batches settle off-chain until their anchor"
        >
            <div className="overflow-x-auto">
                <svg
                    viewBox={`0 0 ${WIDTH} ${height}`}
                    className="block h-auto w-full min-w-[620px]"
                    role="img"
                    aria-label={
                        confirmed
                            ? `Commitment transaction anchored in block ${blockHeight}`
                            : "Unconfirmed commitment transaction"
                    }
                >
                    <defs>
                        <pattern
                            id="atlas-grid-commit"
                            width="24"
                            height="24"
                            patternUnits="userSpaceOnUse"
                        >
                            <circle cx="1" cy="1" r="1" className="fill-grid" />
                        </pattern>
                    </defs>
                    <rect width={WIDTH} height={height} fill="url(#atlas-grid-commit)" />

                    {/* Block rail */}
                    {railHeights.length > 1 && (
                        <line
                            x1={AX + (railHeights[0] - blockHeight!) * RAIL_SPACING}
                            x2={
                                AX +
                                (railHeights[railHeights.length - 1] - blockHeight!) * RAIL_SPACING
                            }
                            y1={railY}
                            y2={railY}
                            className="stroke-line-strong"
                        />
                    )}
                    {railHeights.map((h) => {
                        const x = AX + (h - blockHeight!) * RAIL_SPACING;
                        const anchor = h === blockHeight;
                        const size = anchor ? 16 : 10;
                        return (
                            <g key={h}>
                                <rect
                                    x={x - size / 2}
                                    y={railY - size / 2}
                                    width={size}
                                    height={size}
                                    rx={2}
                                    className={
                                        anchor
                                            ? "fill-chain/20 stroke-chain"
                                            : "fill-canvas stroke-line-strong"
                                    }
                                    strokeWidth={anchor ? 1.5 : 1}
                                />
                                <text
                                    x={x}
                                    y={railY + 24}
                                    textAnchor="middle"
                                    fontSize="10"
                                    className={
                                        anchor ? "fill-chain font-mono" : "fill-faint font-mono"
                                    }
                                    fontWeight={anchor ? 600 : 400}
                                >
                                    {h.toLocaleString("en-US")}
                                </text>
                                <title>{anchor ? `Anchor block ${h}` : `Block ${h}`}</title>
                            </g>
                        );
                    })}
                    {confirmed && (
                        <text
                            x={AX}
                            y={railY + 40}
                            textAnchor="middle"
                            fontSize="10"
                            className="fill-faint"
                        >
                            {[
                                confirmations ? `${confirmations} conf` : null,
                                anchorTime ? formatRelativeTime(anchorTime * 1000, now) : null,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </text>
                    )}
                    {!confirmed && (
                        <g>
                            <rect
                                x={AX - 8}
                                y={railY - 8}
                                width={16}
                                height={16}
                                rx={2}
                                fill="none"
                                className="stroke-faint"
                                strokeDasharray="3 2"
                            />
                            <text
                                x={AX}
                                y={railY + 24}
                                textAnchor="middle"
                                fontSize="10"
                                className="fill-faint"
                            >
                                mempool · unconfirmed
                            </text>
                        </g>
                    )}

                    {/* Stem: the ◆ stands on its block */}
                    <line
                        x1={AX}
                        x2={AX}
                        y1={diamondY + 12}
                        y2={railY - 9}
                        className={confirmed ? "stroke-chain/60" : "stroke-faint"}
                        strokeDasharray={confirmed ? undefined : "3 3"}
                    />

                    {/* Edges: ◆ → outputs */}
                    {outputs.map((output, i) => {
                        const y = rowY(i);
                        const role = outputRole(output, connectorOutputIndices);
                        return (
                            <path
                                key={`edge-${output.index}`}
                                d={`M ${AX + 12} ${diamondY} C ${AX + 120} ${diamondY}, ${OX - 120} ${y}, ${OX - 14} ${y}`}
                                fill="none"
                                className={ROLE_STROKE[role]}
                                strokeWidth="1.2"
                                strokeDasharray={role === "anchor" ? "3 3" : undefined}
                            />
                        );
                    })}

                    {/* Connector and forfeit fans */}
                    {connectors.length > 0 && (
                        <Fan
                            label="connectors"
                            labelClass="fill-cp"
                            leaderClass="stroke-cp/60"
                            txids={connectors.map((c) => c.txid)}
                            y={diamondY - 38}
                            leaderTo={diamondY - 5}
                        />
                    )}
                    {forfeitTxids.length > 0 && (
                        <Fan
                            label="forfeits"
                            labelClass="fill-alert"
                            leaderClass="stroke-alert/60"
                            txids={forfeitTxids}
                            y={diamondY + 24}
                            leaderTo={diamondY + 5}
                        />
                    )}

                    {/* The commitment ◆ */}
                    <text
                        x={AX}
                        y={diamondY - 32}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight={600}
                        className="fill-chain"
                    >
                        commitment
                    </text>
                    <text
                        x={AX}
                        y={diamondY - 18}
                        textAnchor="middle"
                        fontSize="10"
                        className="fill-faint font-mono"
                    >
                        {middleTruncate(txid, 6, 4)}
                    </text>
                    <path
                        d={`M ${AX} ${diamondY - 11} L ${AX + 11} ${diamondY} L ${AX} ${diamondY + 11} L ${AX - 11} ${diamondY} Z`}
                        className="fill-canvas stroke-chain"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                    />

                    {/* Outputs */}
                    {outputs.map((output, i) => (
                        <OutputNode
                            key={`out-${output.index}`}
                            output={output}
                            role={outputRole(output, connectorOutputIndices)}
                            y={rowY(i)}
                            batchRootTxid={batchRootTxids.get(output.index)}
                        />
                    ))}
                </svg>
            </div>
        </Panel>
    );
}

type OutputRole = "batch" | "connector" | "forfeit" | "anchor" | "other";

const ROLE_STROKE: Record<OutputRole, string> = {
    batch: "stroke-chain",
    connector: "stroke-cp",
    forfeit: "stroke-alert",
    anchor: "stroke-faint",
    other: "stroke-line-strong",
};

function outputRole(output: ParsedOutput, connectorOutputIndices: Set<number>): OutputRole {
    if (output.isBatch) return "batch";
    if (connectorOutputIndices.has(output.index)) return "connector";
    if (output.isForfeit) return "forfeit";
    if (output.isAnchor || output.isArkExtension) return "anchor";
    return "other";
}

/** A labelled list of round txids on the left, with a leader into the ◆. */
function Fan({
    label,
    labelClass,
    leaderClass,
    txids,
    y,
    leaderTo,
}: {
    label: string;
    labelClass: string;
    leaderClass: string;
    txids: string[];
    y: number;
    leaderTo: number;
}) {
    const x = AX - 64;
    const shown = txids.slice(0, FAN_ROWS);
    const more = txids.length - shown.length;
    return (
        <g>
            <line
                x1={x + 6}
                y1={y - 4}
                x2={AX - 10}
                y2={leaderTo}
                className={leaderClass}
                strokeDasharray="2 3"
            />
            <text
                x={x}
                y={y}
                textAnchor="end"
                fontSize="10"
                fontWeight={600}
                className={labelClass}
            >
                {label} · {txids.length}
            </text>
            {shown.map((t, i) => (
                <text
                    key={t}
                    x={x}
                    y={y + 14 * (i + 1)}
                    textAnchor="end"
                    fontSize="10"
                    className="fill-faint font-mono"
                >
                    <title>{t}</title>
                    {middleTruncate(t, 6, 4)}
                </text>
            ))}
            {more > 0 && (
                <text
                    x={x}
                    y={y + 14 * (shown.length + 1)}
                    textAnchor="end"
                    fontSize="10"
                    className="fill-faint"
                >
                    +{more} more
                </text>
            )}
        </g>
    );
}

function OutputNode({
    output,
    role,
    y,
    batchRootTxid,
}: {
    output: ParsedOutput;
    role: OutputRole;
    y: number;
    batchRootTxid?: string;
}) {
    const sats = formatSats(Number(output.amount));
    const batchNo = role === "batch" ? Number.parseInt(output.batchKey, 10) + 1 : null;
    const batchVtxos: number | undefined = output.batchInfo?.totalOutputVtxos;
    const title =
        role === "batch"
            ? `batch #${batchNo}`
            : role === "connector"
              ? "connector"
              : role === "forfeit"
                ? "forfeit"
                : role === "anchor"
                  ? output.isArkExtension
                      ? "extension"
                      : "anchor"
                  : `output #${output.index}`;
    const titleClass =
        role === "batch"
            ? "fill-chain"
            : role === "connector"
              ? "fill-cp"
              : role === "forfeit"
                ? "fill-alert"
                : "fill-muted-foreground";
    const tx = OX + 20;
    return (
        <g>
            <title>{`output ${output.index} · ${sats} sats${batchNo ? ` · batch ${batchNo}` : ""}`}</title>
            {role === "batch" && (
                <g transform={`translate(${OX - 12} ${y - 12})`}>
                    <circle cx={12} cy={12} r={12} className="fill-canvas stroke-chain" />
                    <g transform="translate(3 3)">
                        <Glyph kind="tree" size={18} />
                    </g>
                </g>
            )}
            {role === "connector" && (
                <circle cx={OX} cy={y} r={9} className="fill-canvas stroke-cp" strokeWidth="1.4" />
            )}
            {role === "forfeit" && (
                <circle
                    cx={OX}
                    cy={y}
                    r={9}
                    className="fill-alert/10 stroke-alert"
                    strokeWidth="1.4"
                />
            )}
            {role === "anchor" && (
                <rect
                    x={OX - 6}
                    y={y - 6}
                    width={12}
                    height={12}
                    fill="none"
                    className="stroke-faint"
                    strokeDasharray="2 2"
                />
            )}
            {role === "other" && (
                <rect
                    x={OX - 7}
                    y={y - 7}
                    width={14}
                    height={14}
                    rx={2}
                    className="fill-canvas stroke-line-strong"
                    strokeWidth="1.3"
                />
            )}
            <text x={tx} y={y - 3} fontSize="11" fontWeight={600} className={titleClass}>
                {title}
                {batchVtxos !== undefined
                    ? ` · ${batchVtxos} receiver${batchVtxos === 1 ? "" : "s"}`
                    : ""}
            </text>
            <text x={tx} y={y + 11} fontSize="10" className="fill-faint font-mono">
                {sats} sats
            </text>
            {batchRootTxid && (
                <Link to={`/tx/${batchRootTxid}`}>
                    <text
                        x={tx}
                        y={y + 25}
                        fontSize="10"
                        className="fill-virt font-mono hover:underline"
                    >
                        tree root {middleTruncate(batchRootTxid, 6, 4)} →
                    </text>
                </Link>
            )}
        </g>
    );
}
