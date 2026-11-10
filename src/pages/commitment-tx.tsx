import { useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { indexerClient } from "@/lib/api/indexer";
import { fetchAllPages } from "@/lib/api/fetchAllPages";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { PageTransition } from "@/components/shared/page-transition";
import { BatchList } from "@/components/shared/batch-list";
import { CommitmentMap } from "@/components/atlas/commitment/commitment-map";
import { CommitmentFacts } from "@/components/atlas/commitment/commitment-facts";
import { CommitmentIo } from "@/components/atlas/commitment/commitment-io";
import {
    useParsedTx,
    useCommitmentInputVtxos,
    useSpendPaths,
    useBatchRootTxids,
    useConnectorOutputIndices,
} from "@/hooks/use-tx-detail";
import { useChainTip } from "@/hooks/use-expiry";
import { ESPLORA } from "@/lib/live-second";
interface EsploraTxStatus {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
    blockhash?: string;
    fee?: number;
    weight?: number;
    vsize?: number;
}

interface EsploraVin {
    prevout?: { value?: number } | null;
}

interface EsploraVout {
    value?: number;
}

interface EsploraTxResponse {
    txid: string;
    status: EsploraTxStatus;
    fee?: number;
    weight?: number;
    vsize?: number;
    vin?: EsploraVin[];
    vout?: EsploraVout[];
}

export function CommitmentTxPage() {
    const { txid } = useParams<{ txid: string }>();
    const { addRecentSearch } = useRecentSearches();
    const addedToRecentRef = useRef<string | null>(null);

    useEffect(() => {
        document.title = txid
            ? `Commitment transaction ${txid.slice(0, 8)}... | ark.observer`
            : "ark.observer";
        return () => {
            document.title = "ark.observer";
        };
    }, [txid]);

    // Fetch commitment tx metadata
    const {
        data: metadata,
        isLoading: isLoadingMeta,
        error: metaError,
    } = useQuery({
        queryKey: ["commitment-tx", txid],
        queryFn: () => indexerClient.getCommitmentTx(txid!),
        enabled: !!txid,
        retry: false,
    });

    // Fetch virtual tx hex
    const { data: virtualTxData } = useQuery({
        queryKey: ["virtual-tx", txid],
        queryFn: () => indexerClient.getVirtualTxs([txid!]),
        enabled: !!txid,
        retry: false,
    });

    // Fetch forfeit transaction IDs
    const { data: forfeitData } = useQuery({
        queryKey: ["commitment-tx-forfeits", txid],
        queryFn: () =>
            fetchAllPages((opts) => indexerClient.getCommitmentTxForfeitTxs(txid!, opts), "txids"),
        enabled: !!txid && !!metadata,
    });

    // Fetch connector transactions
    const { data: connectorsData } = useQuery({
        queryKey: ["commitment-tx-connectors", txid],
        queryFn: () =>
            fetchAllPages(
                (opts) => indexerClient.getCommitmentTxConnectors(txid!, opts),
                "connectors",
            ),
        enabled: !!txid && !!metadata,
    });

    // Fetch on-chain status from Esplora
    const { data: txStatus } = useQuery<EsploraTxResponse | null>({
        queryKey: ["commitment-tx-esplora", txid],
        queryFn: async () => {
            if (!txid) return null;
            const res = await fetch(`${ESPLORA}/tx/${txid}`);
            if (!res.ok) return null;
            return (await res.json()) as EsploraTxResponse;
        },
        enabled: !!txid && !!metadata,
        retry: false,
        staleTime: 30_000,
    });

    // Chain tip for confirmations
    const tipHeight = useChainTip(!!metadata);

    useLayoutEffect(() => {
        if (txid && metadata && addedToRecentRef.current !== txid) {
            addedToRecentRef.current = txid;
            setTimeout(() => addRecentSearch(txid, "commitment-tx"), 0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [txid, metadata]);

    const txHex = virtualTxData?.txs?.[0] || "";
    const forfeitTxids = forfeitData?.txids || [];
    const connectors = connectorsData?.connectors || [];

    // Parse the commitment tx
    const parsedTx = useParsedTx({
        type: "commitment",
        txid: txid ?? "",
        hex: txHex,
        commitmentMetadata: metadata,
    });

    // Commitment-specific hooks
    const inputVtxoMap = useCommitmentInputVtxos(parsedTx, !!metadata);
    const batchRootTxids = useBatchRootTxids(parsedTx, metadata, txid ?? "");
    const connectorOutputIndices = useConnectorOutputIndices(parsedTx, connectors, txid ?? "");

    // Spend paths for inputs
    const { inputSpendPaths } = useSpendPaths({
        parsed: parsedTx,
        spendingTxs: [],
        settlementLeafTxs: [],
        txid: txid ?? "",
    });

    const batchEntries = useMemo(() => {
        if (!metadata?.batches) return [];
        return Object.entries(metadata.batches).map(([outpoint, info]) => ({
            outpoint,
            info,
        }));
    }, [metadata]);

    // Block height and confirmations
    const blockHeight = txStatus?.status?.confirmed ? (txStatus.status.block_height ?? null) : null;
    const confirmations =
        txStatus?.status?.confirmed && blockHeight !== null && tipHeight !== null
            ? Math.max(1, tipHeight - blockHeight + 1)
            : txStatus?.status?.confirmed
              ? 1
              : 0;

    // On-chain input total + fee from Esplora prevouts. The commitment tx is
    // decoded from raw hex, so its inputs carry no witnessUtxo amounts — the
    // indexer metadata amounts are VTXO-domain (forfeited inputs / issued
    // batch outputs), NOT on-chain sats. Esplora prevouts are authoritative.
    const onchainTotals = useMemo(() => {
        if (!txStatus) return null;
        const vin = txStatus.vin;
        let inputSats: number | null = null;
        if (vin && vin.length > 0) {
            let sum = 0;
            let complete = true;
            for (const input of vin) {
                const value = input.prevout?.value;
                if (typeof value !== "number" || !Number.isFinite(value)) {
                    complete = false;
                    break;
                }
                sum += value;
            }
            if (complete) inputSats = sum;
        }
        const reportedFee = txStatus.fee;
        const feeSats =
            typeof reportedFee === "number" && Number.isFinite(reportedFee) ? reportedFee : null;
        if (inputSats === null && feeSats === null) return null;
        return { inputSats, feeSats };
    }, [txStatus]);

    if (!txid) {
        return (
            <div className="rounded-xl border border-border bg-card p-6">
                <div className="rounded-lg border border-alert/30 bg-alert/10 p-4 text-center">
                    <p className="text-sm font-medium text-alert">No transaction ID provided</p>
                </div>
            </div>
        );
    }

    if (isLoadingMeta) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    <div className="h-4 w-10 animate-pulse rounded bg-muted" />
                    <span className="text-muted-foreground">/</span>
                    <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                </div>
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center justify-center py-12">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <span className="ml-3 text-sm text-muted-foreground">
                            Loading commitment transaction…
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    if (metaError) {
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
                    <span className="text-sm text-foreground">Commitment transaction</span>
                </div>
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="rounded-lg border border-alert/30 bg-alert/10 p-4 text-center">
                        <p className="mb-1 text-sm font-medium text-alert">
                            Failed to load commitment transaction
                        </p>
                        <p className="text-xs text-muted-foreground break-all">
                            {metaError instanceof Error ? metaError.message : "Unknown error"}
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                            {txid}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (!metadata) return null;

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
                    <span className="text-sm text-foreground">Commitment transaction</span>
                </div>

                {/* Map + Facts grid */}
                {parsedTx && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2">
                            <CommitmentMap
                                parsed={parsedTx}
                                txid={txid}
                                batchRootTxids={batchRootTxids}
                                connectorOutputIndices={connectorOutputIndices}
                                forfeitTxids={forfeitTxids}
                                connectors={connectors}
                                blockHeight={blockHeight}
                                confirmations={confirmations}
                            />
                        </div>
                        <CommitmentFacts
                            parsed={parsedTx}
                            txid={txid}
                            metadata={metadata}
                            blockHeight={blockHeight}
                            confirmations={confirmations}
                            txHex={txHex}
                            onchain={onchainTotals}
                        />
                    </div>
                )}

                {/* IO details */}
                {parsedTx && (
                    <CommitmentIo
                        parsed={parsedTx}
                        txid={txid}
                        forfeitAddress={parsedTx.forfeitAddress}
                        forfeitTxids={forfeitTxids}
                        connectors={connectors}
                        inputSpendPaths={inputSpendPaths}
                        inputVtxoMap={inputVtxoMap}
                        batchRootTxids={batchRootTxids}
                        connectorOutputIndices={connectorOutputIndices}
                    />
                )}

                {/* Batch list */}
                <BatchList batches={batchEntries} commitmentTxid={txid} />
            </div>
        </PageTransition>
    );
}
