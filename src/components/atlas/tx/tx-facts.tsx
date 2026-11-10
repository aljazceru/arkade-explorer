import { useMemo } from "react";
import type { VirtualCoin } from "@arkade-os/sdk";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Hash } from "@/components/atlas/hash";
import { Term } from "@/components/atlas/term";
import { VtxoStateTag } from "@/components/atlas/vtxo-state-tag";
import { MoneyDisplay } from "@/components/shared/money-display";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/formatters";
import { formatDuration, expiryKindLabel } from "@/lib/vtxo-display";
import { aggregateVtxoFacts, getMempoolUrl, type ParsedTx } from "@/lib/tx-parse";
import { atlasVtxoState, type AtlasVtxoState } from "@/lib/atlas/vtxo-state";
import { useNow, useExitDelays, useChainTip } from "@/hooks/use-expiry";
import type { ChainSummary } from "@/lib/atlas/chain";
import type { RelativeTimelock } from "@/lib/vtxo-display";
import { Pin, PinOff, ExternalLink } from "lucide-react";
import { useRecentSearches } from "@/hooks/use-recent-searches";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxFactsProps {
    parsed: ParsedTx | null;
    txid: string;
    type: "arkade" | "commitment";
    subtype: string;
    vtxoData: VirtualCoin[] | undefined;
    pendingOutpoints: ReadonlySet<string>;
    chainSummary: ChainSummary | null;
    /** Raw PSBT/hex for the collapsed raw section. */
    rawData?: string;
    rawLabel?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TxFacts({
    parsed,
    txid,
    type,
    subtype,
    vtxoData,
    pendingOutpoints,
    chainSummary,
    rawData,
    rawLabel,
}: TxFactsProps) {
    const now = useNow(30_000);
    const { unilateralExitDelay } = useExitDelays();
    // Only poll the chain tip when a height-based expiry actually needs it.
    const hasHeightExpiry = vtxoData?.some((v) => v.expiresAtHeight != null) ?? false;
    const tipHeight = useChainTip(hasHeightExpiry);
    const { isPinned, pinSearch, unpinSearch } = useRecentSearches();
    const pinned = txid ? isPinned(txid) : false;

    const aggregate = useMemo(() => aggregateVtxoFacts(vtxoData), [vtxoData]);

    // Aggregate VTXO state for the header tag
    const aggregateState = useMemo((): AtlasVtxoState | null => {
        if (!vtxoData || vtxoData.length === 0) return null;
        const priority: Record<AtlasVtxoState, number> = {
            renew: 0,
            expired: 1,
            unknown: 2,
            preconfirmed: 3,
            settled: 4,
            swept: 5,
            unfinalized: 6,
            spent: 7,
            "spent-in-batch": 8,
            unrolled: 9,
        };
        let best: AtlasVtxoState | null = null;
        let bestPri = 99;
        for (const v of vtxoData) {
            const view = atlasVtxoState(v, {
                nowMs: now,
                exitDelay: unilateralExitDelay,
                tipHeight,
                pendingOutpoints,
            });
            const pri = priority[view.state];
            if (pri < bestPri) {
                bestPri = pri;
                best = view.state;
            }
        }
        return best;
    }, [vtxoData, now, unilateralExitDelay, tipHeight, pendingOutpoints]);

    // Totals — inputs without witness data (amount === null) are excluded, so
    // "total in" is only exact when every input amount is known.
    const { totalIn, inputsMissingAmount } = useMemo(() => {
        if (!parsed) return { totalIn: BigInt(0), inputsMissingAmount: 0 };
        let missing = 0;
        const sum = parsed.inputs.reduce((acc, i) => {
            if (i.amount === null) {
                missing++;
                return acc;
            }
            return acc + i.amount;
        }, BigInt(0));
        return { totalIn: sum, inputsMissingAmount: missing };
    }, [parsed]);
    const totalOut = useMemo(() => {
        if (!parsed) return BigInt(0);
        return parsed.outputs.reduce((sum, o) => sum + o.amount, BigInt(0));
    }, [parsed]);

    // Exit depth
    const exitDepth = chainSummary?.exitDepth ?? null;
    const anchors = chainSummary?.anchors ?? [];

    const handleTogglePin = () => {
        if (!txid) return;
        if (pinned) unpinSearch(txid);
        else pinSearch(txid, type === "commitment" ? "commitment-tx" : "transaction");
    };

    return (
        <Panel title="Transaction" bodyClassName="p-4 space-y-4">
            {/* Hero: total output */}
            <div>
                <MicroLabel>total output</MicroLabel>
                <div className="font-mono text-2xl font-medium text-foreground tabular-nums">
                    <MoneyDisplay sats={Number(totalOut)} showUnit={false} />
                </div>
            </div>

            {/* State */}
            {aggregateState && (
                <FactRow label="state">
                    <VtxoStateTag state={aggregateState} />
                </FactRow>
            )}
            <FactRow label="kind">
                <span className="text-foreground">{subtypeLabel(subtype, type)}</span>
            </FactRow>

            {/* Created / Expires */}
            {aggregate.earliestCreatedAt && (
                <FactRow label="created">
                    <span
                        className="text-foreground"
                        title={new Date(aggregate.earliestCreatedAt).toISOString()}
                    >
                        {formatDateCompact(aggregate.earliestCreatedAt)}
                        <span className="text-faint ml-1">
                            ({formatRelativeTime(aggregate.earliestCreatedAt, now)})
                        </span>
                    </span>
                </FactRow>
            )}
            {aggregate.aggregateKind === "active" && aggregate.earliestExpiry ? (
                <FactRow label="expires">
                    <ExpiryValue
                        expiresAtMs={aggregate.earliestExpiry}
                        now={now}
                        exitDelay={unilateralExitDelay}
                    />
                </FactRow>
            ) : !aggregateState ? (
                <FactRow label="status">
                    <span className="text-foreground">
                        {expiryKindLabel(aggregate.aggregateKind)}
                    </span>
                </FactRow>
            ) : null}

            {/* Exit depth — "unknown" when the chain contains hops whose type
                the SDK would skip during unroll (UNSPECIFIED), so the real
                broadcast count cannot be derived. */}
            {chainSummary && (
                <FactRow label={<Term k="exitDepth">exit depth</Term>}>
                    <span className="text-foreground">
                        {exitDepth !== null ? exitDepth : "unknown"}
                        {exitDepth !== null && (
                            <span className="text-faint ml-1">(off-chain hops)</span>
                        )}
                    </span>
                </FactRow>
            )}

            {/* Counts */}
            {parsed && (
                <>
                    <FactRow label="inputs">
                        <span className="text-foreground">{parsed.inputs.length}</span>
                    </FactRow>
                    <FactRow label="outputs">
                        <span className="text-foreground">{parsed.outputs.length}</span>
                    </FactRow>
                </>
            )}

            {/* Anchors */}
            {anchors.length > 0 && (
                <div className="border-t border-border pt-3">
                    <MicroLabel className="mb-2 block">anchored by</MicroLabel>
                    <ul className="space-y-1">
                        {anchors.map((anchorTxid) => (
                            <li
                                key={anchorTxid}
                                className="flex items-center justify-between gap-2"
                            >
                                <Hash
                                    value={anchorTxid}
                                    to={`/commitment-tx/${anchorTxid}`}
                                    head={10}
                                    tail={4}
                                    copy={false}
                                />
                                <span className="font-mono text-[10px] text-faint">commitment</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Identifiers */}
            <div className="border-t border-border pt-3">
                <MicroLabel className="mb-2 block">identifiers</MicroLabel>
                <FactRow label="txid">
                    <Hash value={txid} full copy />
                </FactRow>
                {rawData && (
                    <details className="mt-2">
                        <summary className="micro cursor-pointer text-faint hover:text-foreground">
                            {rawLabel ?? "raw data"}
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded border border-border bg-secondary/30 p-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
                            {rawData}
                        </pre>
                    </details>
                )}
            </div>

            {/* Amounts */}
            <div className="border-t border-border pt-3">
                <MicroLabel className="mb-2 block">amounts</MicroLabel>
                <FactRow label="total in">
                    <MoneyDisplay sats={Number(totalIn)} />
                    {inputsMissingAmount > 0 && (
                        <span className="text-faint ml-1">
                            (~{inputsMissingAmount} input
                            {inputsMissingAmount === 1 ? "" : "s"} unknown)
                        </span>
                    )}
                </FactRow>
                <FactRow label="total out">
                    <MoneyDisplay sats={Number(totalOut)} />
                </FactRow>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2">
                <button
                    onClick={handleTogglePin}
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                        pinned
                            ? "border-chain/40 bg-chain/10 text-chain"
                            : "border-line-strong text-muted-foreground hover:text-foreground",
                    )}
                >
                    {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    {pinned ? "Unpin" : "Pin"}
                </button>
                <a
                    href={getMempoolUrl(undefined, txid)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ExternalLink className="h-3 w-3" />
                    mempool.space ↗
                </a>
            </div>
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FactRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 py-1">
            <MicroLabel className="shrink-0">{label}</MicroLabel>
            <div className="min-w-0 text-right font-mono text-[11.5px] text-foreground">
                {children}
            </div>
        </div>
    );
}

function subtypeLabel(subtype: string, type: string): string {
    if (type === "commitment") return "Commitment transaction";
    switch (subtype) {
        case "forfeit":
            return "Forfeit transaction";
        case "checkpoint":
            return "Checkpoint transaction";
        case "batch-tree":
            return "Batch tree transaction";
        case "connector-tree":
            return "Connector tree transaction";
        default:
            return "Payment";
    }
}

function ExpiryValue({
    expiresAtMs,
    now,
    exitDelay,
}: {
    expiresAtMs: number;
    now: number;
    exitDelay: RelativeTimelock | null;
}) {
    const seconds = Math.floor((expiresAtMs - now) / 1000);
    const expired = seconds <= 0;
    const delaySeconds = exitDelay
        ? exitDelay.type === "blocks"
            ? exitDelay.value * 600
            : exitDelay.value
        : null;
    const urgent = !expired && delaySeconds !== null && seconds <= delaySeconds;
    return (
        <span
            className={cn(expired || urgent ? "text-alert" : "text-foreground")}
            title={new Date(expiresAtMs).toISOString()}
        >
            {formatDateCompact(expiresAtMs)}
            <span className="text-faint ml-1">
                ({expired ? "expired" : formatDuration(seconds)})
            </span>
        </span>
    );
}

function formatDateCompact(ms: number): string {
    return new Date(ms).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
