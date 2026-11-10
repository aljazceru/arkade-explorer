import { useEffect, useLayoutEffect, useState, useRef, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as btc from "@scure/btc-signer";
import { indexerClient } from "@/lib/api/indexer";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { PageTransition } from "@/components/shared/page-transition";
import { TxMap } from "@/components/atlas/tx/tx-map";
import { TxFacts } from "@/components/atlas/tx/tx-facts";
import { TxIo } from "@/components/atlas/tx/tx-io";
import {
    useParsedTx,
    useTxVtxos,
    txOutputOutpoints,
    useInput0Vtxo,
    useSpendingTxs,
    useSettlementLeafTxs,
    useSpendPaths,
    useTxPendingOutpoints,
} from "@/hooks/use-tx-detail";
import { useVtxoChain } from "@/hooks/use-vtxo-chain";
import { useChainTip } from "@/hooks/use-expiry";
import type { TxSubtype } from "@/lib/tx-parse";

type TxType = "arkade" | "commitment" | null;

export function TransactionPage() {
    const { txid } = useParams<{ txid: string }>();
    const navigate = useNavigate();
    const { addRecentSearch } = useRecentSearches();
    const [txType, setTxType] = useState<TxType>(null);
    const addedToRecentRef = useRef<string | null>(null);
    const [selectedVout, setSelectedVout] = useState<number | null>(null);

    useEffect(() => {
        document.title = txid ? `Tx ${txid.slice(0, 8)}... | ark.observer` : "ark.observer";
        return () => {
            document.title = "ark.observer";
        };
    }, [txid]);

    useEffect(() => {
        setTxType(null);
        setSelectedVout(null);
    }, [txid]);

    // Try to fetch as virtual/arkade tx first
    const {
        data: virtualTxData,
        isLoading: isLoadingVirtual,
        error: virtualError,
    } = useQuery({
        queryKey: ["virtual-tx", txid],
        queryFn: async () => {
            if (!txid) throw new Error("No txid provided");
            return await indexerClient.getVirtualTxs([txid]);
        },
        enabled: !!txid && txType === null,
        retry: false,
    });

    const psbtBase64 = virtualTxData?.txs?.[0];

    // Parse the PSBT to determine subtype and get outpoints
    const parsed = useMemo(() => {
        if (!psbtBase64) return null;
        try {
            const psbtBytes = Uint8Array.from(atob(psbtBase64), (c) => c.charCodeAt(0));
            const tx = btc.Transaction.fromPSBT(psbtBytes);
            // Quick parse for outpoints — full parse happens in useParsedTx
            const outpoints = [];
            for (let vout = 0; vout < tx.outputsLength; vout++) {
                const output = tx.getOutput(vout);
                const scriptHex = output?.script
                    ? Array.from(output.script)
                          .map((b) => b.toString(16).padStart(2, "0"))
                          .join("")
                    : "";
                const isAnchor = scriptHex.startsWith("51024e73");
                const isArkExtension = scriptHex.startsWith("6a");
                if (!isAnchor && !isArkExtension) {
                    outpoints.push({ txid: txid!, vout });
                }
            }
            return { outpoints };
        } catch {
            return null;
        }
    }, [psbtBase64, txid]);

    const currentTxOutpoints = parsed?.outpoints ?? [];
    const outpointsKey = JSON.stringify(currentTxOutpoints);

    const { data: vtxoData } = useQuery({
        queryKey: ["tx-vtxos", txid, outpointsKey],
        queryFn: async () => {
            if (currentTxOutpoints.length === 0) return { vtxos: [] };
            return await indexerClient.getVtxos({ outpoints: currentTxOutpoints });
        },
        enabled: currentTxOutpoints.length > 0 && txType === "arkade",
    });

    const virtualTxNotFound =
        !!virtualError || (!isLoadingVirtual && !!virtualTxData && !virtualTxData.txs?.[0]);

    const { data: commitmentData, isLoading: isLoadingCommitment } = useQuery({
        queryKey: ["commitment-tx-check", txid],
        queryFn: async () => {
            if (!txid) throw new Error("No txid provided");
            return await indexerClient.getCommitmentTx(txid);
        },
        enabled: !!txid && virtualTxNotFound,
        retry: false,
    });

    useEffect(() => {
        if (virtualTxData?.txs?.[0]) {
            const txData = virtualTxData.txs[0];
            const isHex = /^[0-9a-fA-F]+$/.test(txData);
            if (isHex) {
                setTxType("commitment");
                navigate(`/commitment-tx/${txid}`, { replace: true });
            } else {
                setTxType("arkade");
            }
        } else if (virtualTxNotFound) {
            if (commitmentData) {
                navigate(`/commitment-tx/${txid}`, { replace: true });
            } else if (!isLoadingCommitment) {
                setTxType("arkade");
            }
        }
    }, [virtualTxData, virtualTxNotFound, commitmentData, isLoadingCommitment, txid, navigate]);

    useLayoutEffect(() => {
        if (txid && txType === "arkade") {
            const key = `${txid}-${txType}`;
            if (addedToRecentRef.current !== key) {
                addedToRecentRef.current = key;
                setTimeout(() => {
                    addRecentSearch(txid, "transaction");
                }, 0);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [txid, txType]);

    // --- Arkade tx detail hooks (only when type is confirmed) ---
    const txHex = virtualTxData?.txs?.[0] || "";
    const parsedTx = useParsedTx({
        type: "arkade",
        txid: txid ?? "",
        hex: txHex,
        vtxoData: vtxoData?.vtxos,
    });
    const subtype: TxSubtype = parsedTx?.subtype ?? "generic";

    const outpoints = useMemo(() => txOutputOutpoints(parsedTx, txid ?? ""), [parsedTx, txid]);
    const { data: fullVtxoData } = useTxVtxos(outpoints, txType === "arkade");
    const input0Vtxo = useInput0Vtxo(parsedTx, subtype, txType === "arkade");
    const checkpointVtxo = subtype === "checkpoint" ? input0Vtxo : null;
    const forfeitVtxo = subtype === "forfeit" ? input0Vtxo : null;

    const spendingTxs = useSpendingTxs(parsedTx, txid ?? "", checkpointVtxo, txType === "arkade");
    const settlementLeafTxs = useSettlementLeafTxs(parsedTx, forfeitVtxo, txType === "arkade");
    const { inputSpendPaths, outputSpendPaths } = useSpendPaths({
        parsed: parsedTx,
        spendingTxs,
        settlementLeafTxs,
        txid: txid ?? "",
    });
    const pendingOutpoints = useTxPendingOutpoints(
        fullVtxoData?.vtxos ?? vtxoData?.vtxos,
        input0Vtxo,
    );

    const allVtxos = fullVtxoData?.vtxos ?? vtxoData?.vtxos;
    // Only poll the chain tip when a height-based expiry needs it.
    const hasHeightExpiry = allVtxos?.some((v) => v.expiresAtHeight != null) ?? false;
    const tipHeight = useChainTip(hasHeightExpiry);

    // Spine outpoint for the unroll chain (selected output or first unspent VTXO)
    const spineOutpoint = useMemo(() => {
        if (!parsedTx || !txid) return null;
        const outputs = parsedTx.outputs;
        const defaultVout = (() => {
            for (const o of outputs) {
                if (o.isAnchor || o.isArkExtension) continue;
                const v =
                    checkpointVtxo && !o.isAnchor
                        ? checkpointVtxo
                        : forfeitVtxo && o.isForfeit
                          ? forfeitVtxo
                          : o.vtxo;
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
    }, [parsedTx, txid, selectedVout, checkpointVtxo, forfeitVtxo]);

    const { summary: chainSummary, isLoading: chainLoading } = useVtxoChain(spineOutpoint);

    // Asset packet is already parsed in useParsedTx
    const assetPacket = parsedTx?.assetPacket ?? null;
    const packetExtensions = parsedTx?.packetExtensions ?? [];

    if (!txid) {
        return (
            <div className="rounded-xl border border-border bg-card p-6">
                <div className="rounded-lg border border-alert/30 bg-alert/10 p-4 text-center">
                    <p className="text-sm font-medium text-alert">No transaction ID provided</p>
                </div>
            </div>
        );
    }

    if (isLoadingVirtual || isLoadingCommitment || txType === null) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <div className="h-4 w-10 animate-pulse rounded bg-muted" />
                    <span className="text-muted-foreground">/</span>
                    <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                </div>
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center justify-center py-12">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <span className="ml-3 text-sm text-muted-foreground">
                            Determining transaction type…
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    if (txType === "arkade") {
        if (virtualError) {
            return (
                <div className="space-y-6">
                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                            Home
                        </Link>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-sm text-foreground">Transaction</span>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="rounded-lg border border-alert/30 bg-alert/10 p-4 text-center">
                            <p className="mb-1 text-sm font-medium text-alert">
                                Transaction not found
                            </p>
                            <p className="text-xs text-muted-foreground break-all">
                                {virtualError.message}
                            </p>
                            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                                {txid}
                            </p>
                        </div>
                    </div>
                </div>
            );
        }

        if (!parsedTx) {
            // Empty PSBT or parse failure — treat as not found
            if (!txHex) {
                return (
                    <div className="space-y-6">
                        <div className="flex items-center gap-3">
                            <Link
                                to="/"
                                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                            >
                                Home
                            </Link>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-sm text-foreground">Transaction</span>
                        </div>
                        <div className="rounded-xl border border-border bg-card p-6">
                            <div className="rounded-lg border border-alert/30 bg-alert/10 p-4 text-center">
                                <p className="mb-1 text-sm font-medium text-alert">
                                    Transaction not found
                                </p>
                                <p className="text-xs text-muted-foreground break-all">{txid}</p>
                            </div>
                        </div>
                    </div>
                );
            }
            return (
                <div className="space-y-6">
                    <div className="rounded-xl border border-border bg-card p-6">
                        <div className="flex items-center justify-center py-12">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            <span className="ml-3 text-sm text-muted-foreground">
                                Parsing transaction…
                            </span>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <PageTransition>
                <div className="space-y-6">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                            Home
                        </Link>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-sm text-foreground">Transaction</span>
                    </div>

                    {/* Map + Facts grid */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2">
                            <TxMap
                                parsed={parsedTx}
                                txid={txid}
                                vtxoData={allVtxos}
                                checkpointVtxo={checkpointVtxo}
                                forfeitVtxo={forfeitVtxo}
                                pendingOutpoints={pendingOutpoints}
                                inputSpendPaths={inputSpendPaths}
                                outputSpendPaths={outputSpendPaths}
                                spendingTxs={spendingTxs}
                                settlementLeafTxs={settlementLeafTxs}
                                subtype={subtype}
                                selectedVout={selectedVout}
                                onSelectVout={setSelectedVout}
                                chainSummary={chainSummary}
                                chainLoading={chainLoading}
                            />
                        </div>
                        <TxFacts
                            parsed={parsedTx}
                            txid={txid}
                            type="arkade"
                            subtype={subtype}
                            vtxoData={allVtxos}
                            pendingOutpoints={pendingOutpoints}
                            chainSummary={chainSummary}
                            rawData={txHex}
                            rawLabel="Raw virtual transaction (PSBT)"
                        />
                    </div>

                    {/* IO details */}
                    <TxIo
                        parsed={parsedTx}
                        txid={txid}
                        type="arkade"
                        subtype={subtype}
                        checkpointVtxo={checkpointVtxo}
                        forfeitVtxo={forfeitVtxo}
                        inputVtxoMap={new Map()}
                        batchRootTxids={new Map()}
                        connectorOutputIndices={new Set()}
                        pendingOutpoints={pendingOutpoints}
                        inputSpendPaths={inputSpendPaths}
                        outputSpendPaths={outputSpendPaths}
                        assetPacket={assetPacket}
                        packetExtensions={packetExtensions}
                        forfeitAddress=""
                        tipHeight={tipHeight}
                    />
                </div>
            </PageTransition>
        );
    }

    return null;
}
