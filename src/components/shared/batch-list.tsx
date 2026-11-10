import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Layers, Leaf, TreePine } from "lucide-react";
import { MoneyDisplay } from "@/components/shared/money-display";
import { BadgeStatus, BadgeRecoverable } from "@/components/shared/badge-status";
import { deriveVtxoStatus, isRecoverable } from "@/lib/vtxo-status";
import { VtxoList } from "@/components/shared/vtxo-list";
import { truncateHash, formatTimestamp, cn } from "@/lib/utils";
import { indexerClient } from "@/lib/api/indexer";
import { fetchAllPages } from "@/lib/api/fetchAllPages";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Tag } from "@/components/atlas/tag";
import { Glyph } from "@/components/atlas/glyph";
import { Hash } from "@/components/atlas/hash";
import type { BatchInfo, Outpoint, VirtualCoin } from "@arkade-os/sdk";
import { useNow } from "@/hooks/use-expiry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatchEntry {
    /** Key from metadata.batches — bare vout string (e.g. "0", "1") or "txid:vout". */
    outpoint: string;
    info: BatchInfo;
}

interface BatchListProps {
    batches: BatchEntry[];
    /** Commitment transaction id — used to resolve bare vout keys to full outpoints. */
    commitmentTxid: string;
}

interface TreeNode {
    txid: string;
    children: Record<number, string>;
}

interface LeafVtxo {
    outpoint: Outpoint;
    amount?: string;
    isSpent?: boolean;
    isSwept?: boolean;
    isPreconfirmed?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a batch key to a full outpoint. Bare "0" → {txid: commitmentTxid, vout: 0}. */
function resolveOutpoint(key: string, commitmentTxid: string): Outpoint | null {
    // Already "txid:vout"
    if (key.includes(":")) {
        const parts = key.split(":");
        if (parts.length !== 2) return null;
        const vout = parseInt(parts[1], 10);
        if (isNaN(vout)) return null;
        return { txid: parts[0], vout };
    }
    // Bare vout index
    const vout = parseInt(key, 10);
    if (isNaN(vout)) return null;
    return { txid: commitmentTxid, vout };
}

/** Extract the batch index for anchor ids. */
function batchIndexFromKey(key: string): string {
    return key.includes(":") ? key.split(":")[1] : key;
}

/** Format a future timestamp as relative time (e.g. "in 30d"). */
function formatFutureTime(timestamp: number, now: number): string {
    const diff = timestamp - now;
    if (diff <= 0) return "now";
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return "in <1m";
    if (seconds < 3600) return `in ${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `in ${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `in ${Math.floor(seconds / 86400)}d`;
    return `in ${Math.floor(seconds / 604800)}w`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TreeNodeView({ node }: { node: TreeNode; depth: number }) {
    const children = Object.entries(node.children ?? {});
    return (
        <div className="ml-4 border-l border-border pl-3">
            <div className="flex items-center gap-1.5 py-0.5">
                <Glyph kind="tree" size={12} className="text-muted-foreground" />
                <Hash value={node.txid} to={`/tx/${node.txid}`} head={10} tail={4} copy={false} />
            </div>
            {children.map(([idx, childTxid]) => (
                <div key={idx} className="ml-4">
                    <div className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground">
                        <span className="font-mono text-faint">vout:{idx}</span>
                        <Hash
                            value={childTxid}
                            to={`/tx/${childTxid}`}
                            head={10}
                            tail={4}
                            copy={false}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function LeafVtxoRow({ leaf }: { leaf: LeafVtxo; expiresAt?: string }) {
    const status = deriveVtxoStatus({
        isSpent: leaf.isSpent,
        isSwept: leaf.isSwept,
        isPreconfirmed: leaf.isPreconfirmed,
    } as VirtualCoin);
    // Leaf rows carry only outpoint+amount+flags — no expiry or unroll fields,
    // so only an explicit swept flag can mark recoverable here.
    const recoverable = isRecoverable({
        isSpent: leaf.isSpent,
        isSwept: leaf.isSwept,
    });
    return (
        <div className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="flex items-center gap-2">
                <Hash
                    value={leaf.outpoint.txid}
                    to={`/tx/${leaf.outpoint.txid}`}
                    head={10}
                    tail={4}
                    copy={false}
                />
                <span className="font-mono text-[10px] text-faint">vout:{leaf.outpoint.vout}</span>
            </div>
            <div className="flex items-center gap-2">
                {leaf.amount && <MoneyDisplay sats={Number(leaf.amount)} className="text-xs" />}
                <BadgeStatus status={status} />
                {recoverable && <BadgeRecoverable />}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Batch item
// ---------------------------------------------------------------------------

function BatchItem({ batch, commitmentTxid }: { batch: BatchEntry; commitmentTxid: string }) {
    const [expanded, setExpanded] = useState(false);
    const now = useNow(30_000);

    const outpoint = useMemo(
        () => resolveOutpoint(batch.outpoint, commitmentTxid),
        [batch.outpoint, commitmentTxid],
    );
    const batchIndex = batchIndexFromKey(batch.outpoint);
    const expiryDate = batch.info.expiresAt ? formatTimestamp(batch.info.expiresAt) : "--";
    const totalAmount = parseInt(batch.info.totalOutputAmount || "0");
    const expiresAtMs = batch.info.expiresAt
        ? new Date(Number(batch.info.expiresAt) * 1000).getTime()
        : null;
    const remaining = expiresAtMs ? expiresAtMs - now : null;
    const expired = remaining !== null && remaining <= 0;
    const urgent = remaining !== null && remaining > 0 && remaining < 3600_000;

    // Query for tree + leaves + vtxos when expanded
    const treeQuery = useQuery({
        queryKey: ["batch-tree", commitmentTxid, batchIndex],
        queryFn: async () => {
            if (!outpoint) return { tree: [], leaves: [], vtxos: [], virtualTxs: [] };
            const [treeResult, leavesResult] = await Promise.all([
                fetchAllPages((opts) => indexerClient.getVtxoTree(outpoint, opts), "vtxoTree"),
                fetchAllPages((opts) => indexerClient.getVtxoTreeLeaves(outpoint, opts), "leaves"),
            ]);
            const rawLeaves: Outpoint[] = leavesResult.leaves || [];
            const leafOutpoints = rawLeaves.map((l) => ({ txid: l.txid, vout: l.vout }));
            let vtxos: VirtualCoin[] = [];
            let virtualTxs: Array<{ txid: string; tx: string }> = [];
            if (leafOutpoints.length > 0) {
                try {
                    const vtxosResult = await fetchAllPages(
                        (opts) => indexerClient.getVtxos({ outpoints: leafOutpoints, ...opts }),
                        "vtxos",
                    );
                    vtxos = vtxosResult.vtxos || [];
                    const leafTxids = [...new Set(rawLeaves.map((l) => l.txid))];
                    if (leafTxids.length > 0) {
                        try {
                            const vtxsResult = await fetchAllPages(
                                (opts) => indexerClient.getVirtualTxs(leafTxids, opts),
                                "txs",
                            );
                            virtualTxs = vtxsResult.txs.map((tx: string, idx: number) => ({
                                txid: leafTxids[idx],
                                tx,
                            }));
                        } catch {
                            // Virtual txs may not be available
                        }
                    }
                } catch {
                    // VTXO fetch may fail
                }
            }
            return {
                tree: treeResult.vtxoTree || [],
                leaves: rawLeaves.map((l) => ({ outpoint: l })),
                vtxos,
                virtualTxs,
            };
        },
        enabled: expanded && !!outpoint,
        staleTime: 60_000,
    });

    const enrichedVtxos = useMemo(() => {
        if (!treeQuery.data?.vtxos) return [];
        if (!treeQuery.data?.virtualTxs) return treeQuery.data.vtxos;
        return treeQuery.data.vtxos.map((vtxo) => {
            const virtualTx = treeQuery.data.virtualTxs.find((t) => t.txid === vtxo.txid);
            if (virtualTx?.tx) return { ...vtxo, _psbt: virtualTx.tx };
            return vtxo;
        });
    }, [treeQuery.data]);

    return (
        <Panel variant="panel" className="overflow-hidden" bodyClassName="p-0">
            <div id={`batch-${batchIndex}`} className="scroll-mt-6">
                {/* Header */}
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
                >
                    {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <Glyph kind="commitment" size={16} className="shrink-0 text-chain" />

                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-foreground">
                                batch #{parseInt(batchIndex) + 1}
                            </span>
                            <span className="font-mono text-xs text-faint">
                                {outpoint
                                    ? truncateHash(`${outpoint.txid}:${outpoint.vout}`, 12, 8)
                                    : batch.outpoint}
                            </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>
                                <MoneyDisplay sats={totalAmount} className="text-xs" />
                            </span>
                            <span>
                                {batch.info.totalOutputVtxos} registered receiver
                                {batch.info.totalOutputVtxos !== 1 ? "s" : ""}
                            </span>
                            <span
                                className={cn(
                                    expired ? "text-alert" : urgent ? "text-alert" : "text-faint",
                                )}
                            >
                                {expired
                                    ? "expired"
                                    : `expires ${formatFutureTime(expiresAtMs ?? 0, now)}`}
                            </span>
                        </div>
                    </div>

                    {batch.info.swept && <Tag tone="warning">swept</Tag>}
                </button>

                {/* Expanded content */}
                {expanded && (
                    <div className="border-t border-border">
                        {treeQuery.isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                <span className="ml-3 text-sm text-muted-foreground">
                                    Loading tree data…
                                </span>
                            </div>
                        ) : (
                            <div className="space-y-4 p-4">
                                {/* Metadata grid */}
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    <div>
                                        <MicroLabel>Amount</MicroLabel>
                                        <MoneyDisplay
                                            sats={totalAmount}
                                            className="text-sm font-semibold text-foreground"
                                        />
                                    </div>
                                    <div>
                                        <MicroLabel>Registered receivers</MicroLabel>
                                        <span className="text-sm font-semibold text-foreground">
                                            {batch.info.totalOutputVtxos}
                                        </span>
                                    </div>
                                    <div>
                                        <MicroLabel>Expires</MicroLabel>
                                        <span className="text-sm text-foreground">
                                            {expiryDate}
                                        </span>
                                    </div>
                                    <div>
                                        <MicroLabel>Status</MicroLabel>
                                        <span className="text-sm text-foreground">
                                            {batch.info.swept ? "Swept" : "Active"}
                                        </span>
                                    </div>
                                </div>

                                {/* Tree */}
                                {treeQuery.data && treeQuery.data.tree.length > 0 && (
                                    <div className="space-y-2">
                                        <MicroLabel className="flex items-center gap-1.5">
                                            <TreePine className="h-3.5 w-3.5" />
                                            VTXO tree ({treeQuery.data.tree.length} nodes)
                                        </MicroLabel>
                                        <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-secondary/30 p-3">
                                            {treeQuery.data.tree.map((node) => (
                                                <TreeNodeView
                                                    key={node.txid}
                                                    node={node}
                                                    depth={0}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* VTXOs */}
                                {enrichedVtxos.length > 0 ? (
                                    <div className="space-y-2">
                                        <MicroLabel className="flex items-center gap-1.5">
                                            <Leaf className="h-3.5 w-3.5" />
                                            VTXOs ({enrichedVtxos.length})
                                        </MicroLabel>
                                        <VtxoList vtxos={enrichedVtxos} showScript />
                                    </div>
                                ) : treeQuery.data && treeQuery.data.leaves.length > 0 ? (
                                    <div className="space-y-2">
                                        <MicroLabel className="flex items-center gap-1.5">
                                            <Leaf className="h-3.5 w-3.5" />
                                            Leaf VTXOs ({treeQuery.data.leaves.length})
                                        </MicroLabel>
                                        <div className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-secondary/30">
                                            {treeQuery.data.leaves.map((leaf) => (
                                                <LeafVtxoRow
                                                    key={`${leaf.outpoint.txid}:${leaf.outpoint.vout}`}
                                                    expiresAt={batch.info.expiresAt}
                                                    leaf={leaf}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {treeQuery.data &&
                                    treeQuery.data.tree.length === 0 &&
                                    treeQuery.data.leaves.length === 0 && (
                                        <p className="py-4 text-center text-sm text-muted-foreground">
                                            No tree data available for this batch.
                                        </p>
                                    )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BatchList({ batches, commitmentTxid }: BatchListProps) {
    if (batches.length === 0) {
        return (
            <Panel variant="panel" bodyClassName="p-6 text-center">
                <Layers className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                    No batches found in this commitment transaction.
                </p>
            </Panel>
        );
    }

    return (
        <Panel variant="panel" title={`Batches (${batches.length})`} bodyClassName="p-0">
            <div className="divide-y divide-border">
                {batches.map((batch) => (
                    <BatchItem key={batch.outpoint} batch={batch} commitmentTxid={commitmentTxid} />
                ))}
            </div>
        </Panel>
    );
}
