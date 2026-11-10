import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import * as btc from "@scure/btc-signer";
import type { CommitmentTx, VirtualCoin } from "@arkade-os/sdk";
import { indexerClient } from "@/lib/api/indexer";
import { fetchAllPages } from "@/lib/api/fetchAllPages";
import { usePendingOutpoints } from "@/hooks/use-pending-outpoints";
import { parseVirtualTxs, parseTransaction, toHex } from "@/lib/tx-parse";
import type { ParsedTx, SubtypeContext, TxSubtype } from "@/lib/tx-parse";
import { emulatorScripts, extractSpendPath } from "@/lib/arkadeScript";
import type { SpendPath } from "@/lib/arkadeScript";
import { useServerInfo } from "@/providers/server-info-provider";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ArkadeTxData {
    txid: string;
    hex: string; // base64 PSBT
}

export interface CommitmentTxData {
    txid: string;
    metadata: CommitmentTx;
    hex: string; // raw hex
    forfeitTxids: string[];
    connectors: Array<{ txid: string; children: Record<number, string> }>;
}

// ---------------------------------------------------------------------------
// Parse the transaction (pure, memoized)
// ---------------------------------------------------------------------------

export function useParsedTx(opts: {
    type: "arkade" | "commitment";
    txid: string;
    hex: string;
    vtxoData?: VirtualCoin[];
    commitmentMetadata?: CommitmentTx;
}): ParsedTx | null {
    const { type, txid, hex, vtxoData, commitmentMetadata } = opts;
    const { serverInfo } = useServerInfo();

    const serverCtx: SubtypeContext = useMemo(
        () => ({
            forfeitPubkey: serverInfo?.forfeitPubkey,
            checkpointTapscript: serverInfo?.checkpointTapscript,
            network: serverInfo?.network,
            signerPubkey: serverInfo?.signerPubkey,
        }),
        [serverInfo],
    );

    return useMemo(() => {
        if (!hex) return null;
        return parseTransaction({
            type,
            txid,
            hex,
            vtxoData,
            commitmentMetadata,
            serverInfo: serverCtx,
        });
    }, [type, txid, hex, vtxoData, commitmentMetadata, serverCtx]);
}

// ---------------------------------------------------------------------------
// VTXO data for the transaction's outputs (arkade only)
// ---------------------------------------------------------------------------

/** Outpoints of every non-anchor, non-extension output of a parsed tx. */
export function txOutputOutpoints(parsed: ParsedTx | null, txid: string) {
    if (!parsed) return [];
    return parsed.outputs
        .filter((o) => !o.isAnchor && !o.isArkExtension)
        .map((o) => ({ txid, vout: o.index }));
}

export function useTxVtxos(outpoints: Array<{ txid: string; vout: number }>, enabled: boolean) {
    const key = JSON.stringify(outpoints);
    return useQuery({
        queryKey: ["tx-vtxos", key],
        queryFn: async () => {
            if (outpoints.length === 0) return { vtxos: [] };
            return await indexerClient.getVtxos({ outpoints });
        },
        enabled: enabled && outpoints.length > 0,
    });
}

// ---------------------------------------------------------------------------
// Forfeit / checkpoint input VTXO (the VTXO spent by input 0)
// ---------------------------------------------------------------------------

export function useInput0Vtxo(
    parsed: ParsedTx | null,
    subtype: TxSubtype,
    enabled: boolean,
): VirtualCoin | null {
    const outpoint = useMemo(() => {
        if (!parsed || parsed.tx.inputsLength === 0) return null;
        const input = parsed.tx.getInput(0);
        if (!input?.txid || input.index === undefined) return null;
        return { txid: toHex(input.txid), vout: input.index };
    }, [parsed]);

    const { data } = useQuery({
        queryKey: ["tx-input0-vtxo", outpoint?.txid, outpoint?.vout, subtype],
        queryFn: async () => {
            if (!outpoint) return null;
            const result = await indexerClient.getVtxos({ outpoints: [outpoint] });
            return result.vtxos?.[0] ?? null;
        },
        enabled: enabled && (subtype === "forfeit" || subtype === "checkpoint") && !!outpoint,
    });
    return data ?? null;
}

// ---------------------------------------------------------------------------
// Commitment input VTXOs (for "settled by" links)
// ---------------------------------------------------------------------------

export function useCommitmentInputVtxos(parsed: ParsedTx | null, enabled: boolean) {
    const outpoints = useMemo(() => {
        if (!parsed || !enabled) return [];
        const result: Array<{ txid: string; vout: number }> = [];
        for (let i = 0; i < parsed.tx.inputsLength; i++) {
            const input = parsed.tx.getInput(i);
            if (input?.txid) {
                result.push({ txid: toHex(input.txid), vout: input.index ?? 0 });
            }
        }
        return result;
    }, [parsed, enabled]);

    const key = JSON.stringify(outpoints);
    const { data } = useQuery({
        queryKey: ["commitment-input-vtxos", key],
        queryFn: async () => {
            if (outpoints.length === 0) return new Map<string, VirtualCoin>();
            const result = await indexerClient.getVtxos({ outpoints });
            const map = new Map<string, VirtualCoin>();
            for (const vtxo of result.vtxos || []) {
                map.set(`${vtxo.txid}:${vtxo.vout}`, vtxo);
            }
            return map;
        },
        enabled: enabled && outpoints.length > 0,
    });
    return data ?? new Map<string, VirtualCoin>();
}

// ---------------------------------------------------------------------------
// Spending transactions (arkade only): txs that spent this tx's VTXOs
// ---------------------------------------------------------------------------

export function useSpendingTxs(
    parsed: ParsedTx | null,
    txid: string,
    checkpointVtxo: VirtualCoin | null,
    enabled: boolean,
): btc.Transaction[] {
    const spendingTxids = useMemo(() => {
        if (!parsed || !enabled) return [];
        const ids = new Set<string>();
        for (const output of parsed.outputs) {
            if (checkpointVtxo && !output.isAnchor && checkpointVtxo.arkTxId) {
                ids.add(checkpointVtxo.arkTxId);
            } else {
                const vtxo = output.vtxo;
                if (vtxo?.spentBy) ids.add(vtxo.spentBy);
                if (vtxo?.arkTxId) ids.add(vtxo.arkTxId);
            }
        }
        ids.delete(txid);
        return [...ids];
    }, [parsed, txid, checkpointVtxo, enabled]);

    const { data } = useQuery({
        queryKey: ["spending-txs", spendingTxids],
        queryFn: async () =>
            parseVirtualTxs((await indexerClient.getVirtualTxs(spendingTxids)).txs),
        enabled: enabled && spendingTxids.length > 0,
        retry: false,
    });
    return data ?? [];
}

// ---------------------------------------------------------------------------
// Settlement leaf transactions: VTXOs settled by a commitment reveal their
// Arkade Script in the leaf txs the batch creates.
// ---------------------------------------------------------------------------

export function useSettlementLeafTxs(
    parsed: ParsedTx | null,
    forfeitVtxo: VirtualCoin | null,
    enabled: boolean,
): btc.Transaction[] {
    const settlementTxids = useMemo(() => {
        if (!parsed || !enabled) return [];
        const ids = new Set<string>();
        const vtxos: Array<VirtualCoin | undefined> = [
            forfeitVtxo ?? undefined,
            ...parsed.outputs.map((o) => o.vtxo),
        ];
        for (const v of vtxos) {
            if (v?.settledBy) ids.add(v.settledBy);
        }
        return [...ids];
    }, [parsed, forfeitVtxo, enabled]);

    const { data } = useQuery({
        queryKey: ["settlement-leaf-txs", settlementTxids],
        queryFn: async () => {
            const leafTxids = new Set<string>();
            for (const commitmentTxid of settlementTxids) {
                const { batches } = await indexerClient.getCommitmentTx(commitmentTxid);
                for (const vout of Object.keys(batches ?? {})) {
                    const { leaves } = await fetchAllPages(
                        (opts) =>
                            indexerClient.getVtxoTreeLeaves(
                                { txid: commitmentTxid, vout: Number(vout) },
                                opts,
                            ),
                        "leaves",
                    );
                    for (const leaf of leaves ?? []) leafTxids.add(leaf.txid);
                }
            }
            if (leafTxids.size === 0) return [];
            return parseVirtualTxs((await indexerClient.getVirtualTxs([...leafTxids])).txs);
        },
        enabled: enabled && settlementTxids.length > 0,
        retry: false,
    });
    return data ?? [];
}

// ---------------------------------------------------------------------------
// Spend paths: how each input/output VTXO was spent
// ---------------------------------------------------------------------------

export function useSpendPaths(opts: {
    parsed: ParsedTx | null;
    spendingTxs: btc.Transaction[];
    settlementLeafTxs: btc.Transaction[];
    txid: string;
}): {
    inputSpendPaths: Array<SpendPath | null>;
    outputSpendPaths: Map<number, SpendPath>;
} {
    const { parsed, spendingTxs, settlementLeafTxs, txid } = opts;
    const { serverInfo } = useServerInfo();

    const spendOpts = useMemo(() => {
        const txs = [...(parsed ? [parsed.tx] : []), ...spendingTxs, ...settlementLeafTxs];
        return {
            operatorPubkeyHex: serverInfo?.signerPubkey,
            arkadeScripts: txs.flatMap(emulatorScripts),
        };
    }, [parsed, spendingTxs, settlementLeafTxs, serverInfo?.signerPubkey]);

    const inputSpendPaths = useMemo(() => {
        if (!parsed) return [];
        return Array.from({ length: parsed.tx.inputsLength }, (_, i) =>
            extractSpendPath(parsed.tx.getInput(i), spendOpts),
        );
    }, [parsed, spendOpts]);

    const outputSpendPaths = useMemo(() => {
        const map = new Map<number, SpendPath>();
        for (const spendingTx of spendingTxs) {
            for (let i = 0; i < spendingTx.inputsLength; i++) {
                const input = spendingTx.getInput(i);
                if (!input?.txid || toHex(input.txid) !== txid) continue;
                const path = extractSpendPath(input, spendOpts);
                if (path) map.set(input.index ?? 0, path);
            }
        }
        return map;
    }, [spendingTxs, txid, spendOpts]);

    return { inputSpendPaths, outputSpendPaths };
}

// ---------------------------------------------------------------------------
// Pending (unfinalized) spends
// ---------------------------------------------------------------------------

export function useTxPendingOutpoints(
    vtxoData: VirtualCoin[] | undefined,
    input0Vtxo: VirtualCoin | null,
) {
    const statusVtxos = useMemo(
        () => [...(vtxoData ?? []), input0Vtxo].filter((v): v is VirtualCoin => v !== null),
        [vtxoData, input0Vtxo],
    );
    const anySpent = useMemo(
        () => statusVtxos.some((v) => v.isSpent || (!!v.spentBy && v.spentBy !== "")),
        [statusVtxos],
    );
    const scripts = useMemo(() => {
        const set = new Set<string>();
        for (const v of statusVtxos) if (v.script) set.add(v.script);
        return [...set];
    }, [statusVtxos]);
    return usePendingOutpoints({ scripts, enabled: anySpent });
}

// ---------------------------------------------------------------------------
// Commitment-specific: batch roots, connector outputs
// ---------------------------------------------------------------------------

export function useBatchRootTxids(
    parsed: ParsedTx | null,
    metadata: CommitmentTx | undefined,
    txid: string,
): Map<number, string> {
    const batchVouts = useMemo(() => {
        if (!parsed || !metadata?.batches) return [];
        return Object.keys(metadata.batches).map((key) => parseInt(key));
    }, [parsed, metadata]);

    const queries = useQueries({
        queries: batchVouts.map((vout) => ({
            queryKey: ["vtxo-tree", txid, vout],
            queryFn: () =>
                fetchAllPages(
                    (opts: Parameters<typeof indexerClient.getVtxoTree>[1]) =>
                        indexerClient.getVtxoTree({ txid, vout }, opts),
                    "vtxoTree",
                ),
            enabled: !!parsed && !!txid,
        })),
    });

    return useMemo(() => {
        const map = new Map<number, string>();
        queries.forEach((query, index) => {
            const tree = query.data?.vtxoTree;
            if (!tree || tree.length === 0) return;
            const allChildTxids = new Set<string>();
            for (const node of tree) {
                if (node.children) {
                    for (const childTxid of Object.values(node.children)) {
                        allChildTxids.add(childTxid);
                    }
                }
            }
            const rootNode = tree.find((node) => !allChildTxids.has(node.txid));
            if (rootNode) map.set(batchVouts[index], rootNode.txid);
        });
        return map;
    }, [queries, batchVouts]);
}

export function useConnectorOutputIndices(
    parsed: ParsedTx | null,
    connectors: Array<{ txid: string; children: Record<number, string> }> | undefined,
    txid: string,
): Set<number> {
    const rootConnectorTxid = useMemo(() => {
        if (!connectors || connectors.length === 0) return null;
        const allChildTxids = new Set<string>();
        for (const conn of connectors) {
            if (conn.children) {
                for (const childTxid of Object.values(conn.children)) {
                    allChildTxids.add(childTxid);
                }
            }
        }
        return connectors.find((conn) => !allChildTxids.has(conn.txid))?.txid ?? null;
    }, [connectors]);

    const { data: rootConnectorRaw } = useQuery({
        queryKey: ["connector-root-tx", rootConnectorTxid],
        queryFn: async () => {
            if (!rootConnectorTxid) return null;
            const result = await indexerClient.getVirtualTxs([rootConnectorTxid]);
            return result.txs[0] ?? null;
        },
        enabled: !!rootConnectorTxid,
        retry: false,
    });

    return useMemo(() => {
        const indices = new Set<number>();
        if (!rootConnectorRaw || !parsed) return indices;
        const rootConnectorTx = parseVirtualTxs([rootConnectorRaw])[0];
        if (!rootConnectorTx) return indices;
        for (let i = 0; i < rootConnectorTx.inputsLength; i++) {
            const input = rootConnectorTx.getInput(i);
            if (input?.txid && toHex(input.txid) === txid) {
                indices.add(input.index ?? 0);
            }
        }
        return indices;
    }, [rootConnectorRaw, txid, parsed]);
}
