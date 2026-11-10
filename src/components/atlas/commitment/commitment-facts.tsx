import { useMemo } from "react";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Hash } from "@/components/atlas/hash";
import { MoneyDisplay } from "@/components/shared/money-display";
import { cn } from "@/lib/utils";

import { getMempoolUrl, type ParsedTx } from "@/lib/tx-parse";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import type { CommitmentTx } from "@arkade-os/sdk";
import { Pin, PinOff, ExternalLink } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** On-chain figures derived from the explorer's prevout data. */
export interface OnchainTotals {
    /** Sum of input prevout values in sats; null when any prevout is unknown. */
    inputSats: number | null;
    /** Explorer-reported fee in sats; null when unavailable. */
    feeSats: number | null;
}

export interface CommitmentFactsProps {
    parsed: ParsedTx | null;
    txid: string;
    metadata: CommitmentTx | undefined;
    blockHeight?: number | null;
    confirmations?: number | null;
    txHex?: string;
    onchain?: OnchainTotals | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommitmentFacts({
    parsed,
    txid,
    metadata,
    blockHeight,
    confirmations,
    txHex,
    onchain,
}: CommitmentFactsProps) {
    const { isPinned, pinSearch, unpinSearch } = useRecentSearches();
    const pinned = txid ? isPinned(txid) : false;

    // On-chain output total comes from the raw tx itself (output amounts are
    // intrinsic). Input amounts and the fee need Esplora prevouts — the indexer
    // metadata amounts cover forfeited inputs / registered off-chain receivers,
    // not the Bitcoin transaction's inputs and outputs.
    const parsedOut = useMemo(() => {
        if (!parsed) return BigInt(0);
        return parsed.outputs.reduce((s, o) => s + o.amount, 0n);
    }, [parsed]);

    // Fee: prefer the explorer-reported value; derive from prevouts only when
    // the explorer omits it and every input prevout is known.
    const feeSats = useMemo(() => {
        const reported = onchain?.feeSats;
        if (reported != null && Number.isFinite(reported)) return Math.max(0, reported);
        if (onchain?.inputSats != null) {
            const derived = onchain.inputSats - Number(parsedOut);
            if (Number.isFinite(derived) && derived >= 0) return derived;
        }
        return null;
    }, [onchain, parsedOut]);

    const handleTogglePin = () => {
        if (!txid) return;
        if (pinned) unpinSearch(txid);
        else pinSearch(txid, "commitment-tx");
    };

    const batchCount = metadata?.batches ? Object.keys(metadata.batches).length : 0;
    const vtxoCount = metadata?.totalOutputVtxos ?? 0;
    const inputVtxoCount = metadata?.totalInputVtxos ?? 0;
    // The indexer reports session start/end as unix seconds.
    const sessionDuration =
        metadata?.startedAt && metadata?.endedAt
            ? Math.max(0, Math.round(Number(metadata.endedAt) - Number(metadata.startedAt)))
            : null;

    const batchValue = metadata?.totalOutputAmount ? BigInt(metadata.totalOutputAmount) : null;

    return (
        <Panel title="Commitment" bodyClassName="p-4 space-y-4">
            {/* Hero: batch value — the VTXO-domain amount the indexer assigns
                to this commitment's registered receivers, NOT on-chain sats. */}
            <div>
                <MicroLabel>
                    {batchValue !== null ? "registered batch receivers" : "on-chain output value"}
                </MicroLabel>
                <div className="font-mono text-2xl font-medium text-foreground tabular-nums">
                    <MoneyDisplay sats={Number(batchValue ?? parsedOut)} showUnit={false} />
                </div>
                {batchValue !== null && batchValue !== parsedOut && (
                    <div className="mt-0.5 text-[10px] text-faint">
                        on-chain outputs (incl. operator change):{" "}
                        <MoneyDisplay sats={Number(parsedOut)} />
                    </div>
                )}
            </div>
            {/* Session */}
            {metadata && (
                <>
                    <FactRow label="batches">
                        <span className="text-foreground">{batchCount}</span>
                    </FactRow>
                    <FactRow label="registered VTXOs">
                        <span className="text-foreground">
                            {vtxoCount} out · {inputVtxoCount} in
                        </span>
                    </FactRow>
                    {sessionDuration !== null && (
                        <FactRow label="session">
                            <span className="text-foreground">
                                {formatSessionDuration(sessionDuration)}
                            </span>
                        </FactRow>
                    )}
                </>
            )}

            {/* Block */}
            {blockHeight !== null && blockHeight !== undefined && (
                <FactRow label="block">
                    <span className="text-foreground">
                        {blockHeight}
                        {confirmations !== null && confirmations !== undefined && (
                            <span className="text-faint ml-1">({confirmations} conf)</span>
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

            {/* Amounts — batch figures are VTXO-domain indexer metadata;
                on-chain figures are real sats from the raw tx / Esplora. */}
            <div className="border-t border-border pt-3">
                <MicroLabel className="mb-2 block">amounts</MicroLabel>
                {metadata && (
                    <>
                        <FactRow label="forfeited VTXOs">
                            <MoneyDisplay sats={Number(BigInt(metadata.totalInputAmount))} />
                            <span className="text-faint ml-1">
                                ({metadata.totalInputVtxos} vtxo
                                {metadata.totalInputVtxos === 1 ? "" : "s"})
                            </span>
                        </FactRow>
                        <FactRow label="off-chain receivers">
                            <MoneyDisplay sats={Number(BigInt(metadata.totalOutputAmount))} />
                            <span className="text-faint ml-1">
                                ({metadata.totalOutputVtxos} vtxo
                                {metadata.totalOutputVtxos === 1 ? "" : "s"})
                            </span>
                        </FactRow>
                        <p className="mt-1 text-[10px] text-faint">
                            Receiver totals exclude operator fee leaves and on-chain receivers.
                        </p>
                    </>
                )}
                <FactRow label="on-chain out">
                    <MoneyDisplay sats={Number(parsedOut)} />
                </FactRow>
                {onchain?.inputSats != null && (
                    <FactRow label="on-chain in">
                        <MoneyDisplay sats={onchain.inputSats} />
                    </FactRow>
                )}
                {feeSats !== null && (
                    <FactRow label="fee">
                        <MoneyDisplay sats={feeSats} />
                    </FactRow>
                )}
            </div>
            {/* Identifiers */}
            <div className="border-t border-border pt-3">
                <MicroLabel className="mb-2 block">identifiers</MicroLabel>
                <FactRow label="txid">
                    <Hash value={txid} full copy />
                </FactRow>
                {txHex && (
                    <details className="mt-2">
                        <summary className="micro cursor-pointer text-faint hover:text-foreground">
                            raw transaction ({txHex.length} chars)
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded border border-border bg-secondary/30 p-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
                            {txHex}
                        </pre>
                    </details>
                )}
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

function formatSessionDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
}
