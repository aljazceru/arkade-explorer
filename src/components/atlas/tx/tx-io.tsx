import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import type { VirtualCoin } from "@arkade-os/sdk";
import type { asset as AssetNs } from "@arkade-os/sdk";
import { CopyButton } from "@/components/shared/copy-button";
import { MoneyDisplay } from "@/components/shared/money-display";
import { AssetAmountDisplay } from "@/components/shared/asset-amount-display";
import { AssetBadge } from "@/components/shared/asset-badge";
import { BadgeStatus, BadgeRecoverable } from "@/components/shared/badge-status";
import { deriveVtxoStatus, isRecoverable } from "@/lib/vtxo-status";
import { truncateHash } from "@/lib/utils";
import { capList } from "@/lib/cap-list";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Tag } from "@/components/atlas/tag";
import { Hash, middleTruncate } from "@/components/atlas/hash";
import {
    packetAssetsForIndex,
    getMempoolUrl,
    type ParsedTx,
    type ParsedInput,
    type ParsedOutput,
} from "@/lib/tx-parse";
import type { SpendPath, ScriptView } from "@/lib/arkadeScript";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxIoProps {
    parsed: ParsedTx;
    txid: string;
    type: "arkade" | "commitment";
    subtype: string;
    checkpointVtxo: VirtualCoin | null;
    forfeitVtxo: VirtualCoin | null;
    inputVtxoMap: Map<string, VirtualCoin>;
    batchRootTxids: Map<number, string>;
    connectorOutputIndices: Set<number>;
    pendingOutpoints: ReadonlySet<string>;
    inputSpendPaths: Array<SpendPath | null>;
    outputSpendPaths: Map<number, SpendPath>;
    assetPacket: AssetNs.Packet | null;
    packetExtensions: Array<{ type: number; name: string }>;
    forfeitAddress: string;
    network?: string;
    /** Chain tip for height-based expiry evaluation; null when unavailable. */
    tipHeight?: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TxIo({
    parsed,
    txid,
    type,
    subtype,
    checkpointVtxo,
    forfeitVtxo,
    inputVtxoMap,
    batchRootTxids,
    connectorOutputIndices,
    pendingOutpoints,
    inputSpendPaths,
    outputSpendPaths,
    assetPacket,
    packetExtensions,
    forfeitAddress,
    network,
    tipHeight,
}: TxIoProps) {
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Inputs */}
                <Panel title={`Inputs (${parsed.inputs.length})`}>
                    <div className="divide-y divide-border">
                        {parsed.inputs.map((input) => {
                            const inputKey = `${input.txid}:${input.vout}`;
                            const inputVtxo = inputVtxoMap.get(inputKey);
                            const inputMempoolUrl =
                                type === "commitment" && input.txid
                                    ? getMempoolUrl(network, input.txid)
                                    : undefined;
                            return (
                                <InputRow
                                    key={`input-${input.index}`}
                                    input={input}
                                    assetPacket={assetPacket}
                                    txid={txid}
                                    settlementTxId={inputVtxo?.settledBy || undefined}
                                    mempoolUrl={inputMempoolUrl}
                                    spendPath={inputSpendPaths[input.index]}
                                />
                            );
                        })}
                    </div>
                </Panel>

                {/* Outputs */}
                <Panel title={`Outputs (${parsed.outputs.length})`}>
                    <div className="divide-y divide-border">
                        {parsed.outputs.map((output) => (
                            <OutputRow
                                key={`output-${output.index}`}
                                output={output}
                                txid={txid}
                                subtype={subtype}
                                forfeitAddress={forfeitAddress}
                                assetPacket={assetPacket}
                                isConnector={connectorOutputIndices.has(output.index)}
                                batchRootTxid={batchRootTxids.get(output.index)}
                                forfeitVtxo={forfeitVtxo}
                                checkpointVtxo={checkpointVtxo}
                                pendingOutpoints={pendingOutpoints}
                                spendPath={outputSpendPaths.get(output.index)}
                                network={network}
                                tipHeight={tipHeight}
                            />
                        ))}
                    </div>
                </Panel>
            </div>

            {/* Packet section */}
            {(assetPacket || packetExtensions.length > 0) && (
                <PacketSection
                    assetPacket={assetPacket}
                    txid={txid}
                    extensions={packetExtensions}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Input row — Atlas ledger style
// ---------------------------------------------------------------------------

function InputRow({
    input,
    assetPacket,
    txid,
    settlementTxId,
    mempoolUrl,
    spendPath,
}: {
    input: ParsedInput;
    assetPacket: AssetNs.Packet | null;
    txid: string;
    settlementTxId?: string;
    mempoolUrl?: string;
    spendPath?: SpendPath | null;
}) {
    const inputAssets = useMemo(
        () => packetAssetsForIndex(assetPacket, txid, "inputs", input.index),
        [assetPacket, txid, input.index],
    );

    return (
        <div className="px-4 py-3">
            {/* Header: index + amount + source link */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 font-mono text-[10px] text-faint">
                        #{input.index}
                    </span>
                    {input.txid && <span className="text-xs text-muted-foreground">← from</span>}
                    {input.txid &&
                        (mempoolUrl ? (
                            <a
                                href={mempoolUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-virt hover:underline"
                            >
                                {middleTruncate(input.txid, 8, 4)}
                            </a>
                        ) : (
                            <Link
                                to={`/tx/${input.txid}`}
                                className="font-mono text-xs text-virt hover:underline"
                            >
                                {middleTruncate(input.txid, 8, 4)}
                            </Link>
                        ))}
                    {input.vout !== null && (
                        <span className="font-mono text-[10px] text-faint">:{input.vout}</span>
                    )}
                </div>
                {input.amount !== null && (
                    <MoneyDisplay
                        sats={Number(input.amount)}
                        className="text-xs font-semibold text-foreground shrink-0"
                    />
                )}
            </div>

            {/* Asset amounts */}
            {inputAssets.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {inputAssets.map((a, ai) => (
                        <AssetAmountDisplay
                            key={ai}
                            amount={a.amount}
                            assetId={a.assetId}
                            valueClassName="text-xs font-semibold text-foreground"
                            unitClassName="text-xs"
                        />
                    ))}
                </div>
            )}

            {/* Address / script */}
            {input.arkAddress ? (
                <div className="mt-1">
                    {input.arkAddress.startsWith("ark1") || input.arkAddress.startsWith("tark1") ? (
                        <Link
                            to={`/address/${input.arkAddress}`}
                            className="font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {middleTruncate(input.arkAddress, 12, 8)}
                        </Link>
                    ) : (
                        <span className="font-mono text-[11px] text-muted-foreground">
                            {middleTruncate(input.arkAddress, 12, 8)}
                        </span>
                    )}
                </div>
            ) : input.scriptHex ? (
                <div className="mt-1 break-all font-mono text-[10px] text-faint">
                    {input.scriptHex.substring(0, 60)}…
                </div>
            ) : null}

            {/* Spend path */}
            {spendPath && <SpendPathLine spendPath={spendPath} />}

            {/* Settlement link */}
            {settlementTxId && (
                <div className="mt-1">
                    <Link
                        to={`/commitment-tx/${settlementTxId}`}
                        className="inline-flex items-center gap-1 text-[11px] text-ok hover:underline"
                    >
                        settled in <Hash value={settlementTxId} head={8} tail={4} copy={false} />
                    </Link>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Output row — Atlas ledger style
// ---------------------------------------------------------------------------

function OutputRow({
    output,
    txid,
    forfeitAddress,
    assetPacket,
    isConnector,
    batchRootTxid,
    forfeitVtxo,
    checkpointVtxo,
    pendingOutpoints,
    spendPath,
    tipHeight,
}: {
    output: ParsedOutput;
    txid: string;
    subtype: string;
    forfeitAddress: string;
    assetPacket: AssetNs.Packet | null;
    isConnector?: boolean;
    batchRootTxid?: string;
    forfeitVtxo?: VirtualCoin | null;
    checkpointVtxo?: VirtualCoin | null;
    pendingOutpoints?: ReadonlySet<string>;
    spendPath?: SpendPath | null;
    network?: string;
    tipHeight?: number | null;
}) {
    const effectiveVtxo =
        checkpointVtxo && !output.isAnchor
            ? checkpointVtxo
            : forfeitVtxo && output.isForfeit
              ? forfeitVtxo
              : output.vtxo;
    const vtxo = effectiveVtxo;
    const vtxoStatus = vtxo ? deriveVtxoStatus(vtxo, pendingOutpoints) : undefined;
    const isSpent = vtxo?.isSpent === true || (vtxo?.spentBy && vtxo.spentBy !== "");
    let spendingTxid: string | null = null;
    let spendingIsCommitment = false;
    if (checkpointVtxo && !output.isAnchor && checkpointVtxo.arkTxId) {
        spendingTxid = checkpointVtxo.arkTxId;
    } else if (vtxo?.spentBy && vtxo.spentBy !== "") {
        spendingTxid = vtxo.spentBy;
    } else if (vtxo?.settledBy && vtxo.settledBy !== "") {
        spendingTxid = vtxo.settledBy;
        spendingIsCommitment = true;
    }
    if (spendingTxid === txid) spendingTxid = null;

    const outputAssets = useMemo(() => {
        const assets: Array<{ assetId: string; amount: number | bigint }> = [];
        if (!output.isAnchor && !output.isArkExtension) {
            if (vtxo?.assets && vtxo.assets.length > 0) {
                // Asset.amount is bigint (supplies exceed 2^53); keep exact.
                vtxo.assets.forEach((a) => assets.push({ assetId: a.assetId, amount: a.amount }));
            } else {
                const packetAssets = packetAssetsForIndex(
                    assetPacket,
                    txid,
                    "outputs",
                    output.index,
                );
                assets.push(...packetAssets);
            }
        }
        return assets;
    }, [output, vtxo, assetPacket, txid]);

    return (
        <div className="px-4 py-3">
            {/* Header: index + tags + amount + spent link */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="shrink-0 font-mono text-[10px] text-faint">
                        #{output.index}
                    </span>
                    {output.isAnchor && <Tag tone="faint">Anchor</Tag>}
                    {output.isArkExtension && <Tag tone="faint">OP_RETURN</Tag>}
                    {output.isForfeit && <Tag tone="alert">Forfeit</Tag>}
                    {output.isBatch && output.batchInfo && (
                        <Link
                            to={
                                batchRootTxid ? `/tx/${batchRootTxid}` : `#batch-${output.batchKey}`
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-chain/30 bg-chain/10 px-1.5 py-0.5 text-[10px] font-semibold text-chain hover:bg-chain/20 transition-colors"
                            title={
                                batchRootTxid ? `View batch root tx: ${batchRootTxid}` : undefined
                            }
                        >
                            Batch #{parseInt(output.batchKey) + 1}
                        </Link>
                    )}
                    {outputAssets.length > 0 && <Tag tone="virt">Asset</Tag>}
                    {isConnector && <Tag tone="cp">Connector</Tag>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <MoneyDisplay
                        sats={Number(output.amount)}
                        className="text-xs font-semibold text-foreground"
                    />
                    {isSpent && spendingTxid && (
                        <span className="text-[10px] text-faint">spent by</span>
                    )}
                    {isSpent && spendingTxid && (
                        <Link
                            to={
                                spendingIsCommitment
                                    ? `/commitment-tx/${spendingTxid}`
                                    : `/tx/${spendingTxid}`
                            }
                            className="font-mono text-[11px] text-virt hover:underline"
                        >
                            {middleTruncate(spendingTxid, 6, 4)} →
                        </Link>
                    )}
                    {!isSpent && output.isBatch && batchRootTxid && (
                        <Link
                            to={`/tx/${batchRootTxid}`}
                            className="font-mono text-[11px] text-chain hover:underline"
                            title="View batch root tx"
                        >
                            {middleTruncate(batchRootTxid, 6, 4)} →
                        </Link>
                    )}
                </div>
            </div>

            {/* Status badges */}
            {vtxo && !output.isAnchor && (
                <div className="mt-1 flex items-center gap-1.5">
                    <BadgeStatus status={vtxoStatus!} />
                    {isRecoverable(vtxo, Date.now(), tipHeight) && vtxoStatus !== "spent" && (
                        <BadgeRecoverable />
                    )}
                </div>
            )}

            {/* Batch info */}
            {output.isBatch && output.batchInfo && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                    {output.batchInfo.totalOutputVtxos} VTXO
                    {output.batchInfo.totalOutputVtxos !== 1 ? "s" : ""}
                </div>
            )}

            {/* Asset amounts */}
            {outputAssets.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {outputAssets.map((a, ai) => (
                        <AssetAmountDisplay
                            key={ai}
                            amount={a.amount}
                            assetId={a.assetId}
                            valueClassName="text-xs font-semibold text-foreground"
                            unitClassName="text-xs"
                        />
                    ))}
                </div>
            )}

            {/* Address / script / forfeit details */}
            {output.isForfeit ? (
                <div className="mt-1 space-y-0.5">
                    <div className="text-[11px] font-semibold text-alert">Arkade operator</div>
                    {forfeitAddress && (
                        <div className="break-all font-mono text-[10px] text-muted-foreground">
                            {forfeitAddress}
                        </div>
                    )}
                    {forfeitVtxo?.settledBy && (
                        <div className="text-[11px] text-muted-foreground">
                            Settled in{" "}
                            <Link
                                to={`/commitment-tx/${forfeitVtxo.settledBy}`}
                                className="font-mono text-virt hover:underline"
                            >
                                <Hash
                                    value={forfeitVtxo.settledBy}
                                    head={8}
                                    tail={4}
                                    copy={false}
                                />
                            </Link>
                        </div>
                    )}
                </div>
            ) : output.arkAddress ? (
                <div className="mt-1 flex items-center gap-1.5">
                    {output.arkAddress.startsWith("ark1") ||
                    output.arkAddress.startsWith("tark1") ? (
                        <Link
                            to={`/address/${output.arkAddress}`}
                            className="font-mono text-[11px] text-virt hover:underline"
                        >
                            {middleTruncate(output.arkAddress, 12, 8)}
                        </Link>
                    ) : (
                        <span className="font-mono text-[11px] text-muted-foreground">
                            {middleTruncate(output.arkAddress, 12, 8)}
                        </span>
                    )}
                    <CopyButton text={output.arkAddress} />
                </div>
            ) : output.isArkExtension ? (
                <div className="mt-1 break-all font-mono text-[10px] text-faint">
                    Packet · {output.scriptHex.substring(0, 40)}…
                </div>
            ) : output.isAnchor ? (
                <div className="mt-1 break-all font-mono text-[10px] text-faint">
                    {output.scriptHex.substring(0, 40)}…
                </div>
            ) : output.scriptHex ? (
                <div className="mt-1 flex items-center gap-1.5">
                    <Link
                        to={`/address/${output.scriptHex}`}
                        className="break-all font-mono text-[11px] text-virt hover:underline"
                    >
                        {output.scriptHex.substring(0, 40)}…
                    </Link>
                    <CopyButton text={output.scriptHex} />
                </div>
            ) : null}

            {/* Spend path */}
            {isSpent && spendPath && <SpendPathLine spendPath={spendPath} />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Spend path line (key path / script path with opcodes)
// ---------------------------------------------------------------------------

function ScriptOpcodes({ caption, script }: { caption: string; script: ScriptView }) {
    return (
        <div className="mt-1 rounded-md bg-secondary/50 px-2 py-1">
            <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {caption}
                </span>
                <CopyButton text={script.scriptHex} />
            </div>
            <div className="flex max-h-40 flex-wrap gap-x-1.5 overflow-y-auto font-mono text-[10px] leading-relaxed">
                {script.asm.length === 0 ? (
                    <span className="break-all text-muted-foreground">{script.scriptHex}</span>
                ) : (
                    script.asm.map((op, i) =>
                        op.startsWith("OP_") ? (
                            <span key={i} className="text-foreground">
                                {op}
                            </span>
                        ) : (
                            <span key={i} className="break-all text-muted-foreground" title={op}>
                                {op.length > 16 && !op.startsWith('"')
                                    ? truncateHash(op, 6, 6)
                                    : op}
                            </span>
                        ),
                    )
                )}
            </div>
        </div>
    );
}

function SpendPathLine({ spendPath }: { spendPath: SpendPath }) {
    const script = spendPath.kind === "script-path" ? spendPath.info : null;
    const label = script
        ? `${script.label} script`
        : spendPath.kind === "key-path"
          ? "Key path"
          : "Script path";
    return (
        <div className="mt-1 text-xs">
            <div className="flex items-center gap-1.5">
                <span className="uppercase text-muted-foreground">Spent via:</span>
                <Tag tone={script?.arkadeScript ? "virt" : "neutral"}>{label}</Tag>
            </div>
            {script?.arkadeScript && (
                <ScriptOpcodes caption="Arkade Script" script={script.arkadeScript} />
            )}
            {script && <ScriptOpcodes caption="Tapscript" script={script} />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Packet section
// ---------------------------------------------------------------------------

const PACKET_ROW_CAP = 50;

function PacketSection({
    assetPacket,
    txid,
    extensions,
}: {
    assetPacket: AssetNs.Packet | null;
    txid: string;
    extensions: Array<{ type: number; name: string }>;
}) {
    const hasAssetGroups = (assetPacket?.groups?.length ?? 0) > 0;
    if (!hasAssetGroups && extensions.length === 0) return null;

    return (
        <Panel title="Packet">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                {extensions.map((ext, i) => (
                    <Tag key={i} tone="virt">
                        {ext.name}
                    </Tag>
                ))}
            </div>
            <PacketGroups assetPacket={assetPacket} txid={txid} hasAssetGroups={hasAssetGroups} />
        </Panel>
    );
}

function PacketGroups({
    assetPacket,
    txid,
    hasAssetGroups,
}: {
    assetPacket: AssetNs.Packet | null;
    txid: string;
    hasAssetGroups: boolean;
}) {
    const groups: AssetNs.AssetGroup[] = hasAssetGroups ? (assetPacket?.groups ?? []) : [];
    if (!hasAssetGroups) return null;

    return (
        <div className="max-h-[28rem] space-y-3 overflow-y-auto p-4">
            {groups.map((group, gi) => (
                <PacketGroup key={gi} group={group} txid={txid} gi={gi} />
            ))}
        </div>
    );
}

function PacketGroup({ group, txid, gi }: { group: AssetNs.AssetGroup; txid: string; gi: number }) {
    const [showAllInputs, setShowAllInputs] = useState(false);
    const [showAllOutputs, setShowAllOutputs] = useState(false);

    const isIssuance = group.isIssuance();
    const assetIdStr =
        group.assetId?.toString() ||
        (isIssuance ? txid + gi.toString(16).padStart(4, "0") : "Unknown");

    const { visible: visibleInputs, hiddenCount: hiddenInputs } = capList(
        group.inputs,
        PACKET_ROW_CAP,
        showAllInputs,
    );
    const { visible: visibleOutputs, hiddenCount: hiddenOutputs } = capList(
        group.outputs,
        PACKET_ROW_CAP,
        showAllOutputs,
    );

    return (
        <div className="space-y-2 rounded-lg border border-border bg-secondary/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <AssetBadge assetId={assetIdStr} />
                <CopyButton text={assetIdStr} />
                {isIssuance && <Tag tone="ok">Issuance</Tag>}
            </div>
            {visibleInputs.length > 0 && (
                <div>
                    <MicroLabel>Inputs</MicroLabel>
                    <div className="mt-0.5 ml-2 space-y-0.5">
                        {visibleInputs.map((inp, ii) => (
                            <div
                                key={ii}
                                className="flex items-center gap-1 font-mono text-xs text-muted-foreground"
                            >
                                <span>vin:{inp.vin} →</span>
                                <AssetAmountDisplay
                                    amount={Number(inp.amount)}
                                    assetId={assetIdStr}
                                    valueClassName="text-foreground font-semibold text-xs"
                                    unitClassName="text-xs"
                                />
                            </div>
                        ))}
                        {hiddenInputs > 0 && (
                            <button
                                onClick={() => setShowAllInputs(true)}
                                className="mt-1 text-xs text-primary hover:underline"
                            >
                                Show {hiddenInputs} more input{hiddenInputs !== 1 ? "s" : ""}
                            </button>
                        )}
                    </div>
                </div>
            )}
            {visibleOutputs.length > 0 && (
                <div>
                    <MicroLabel>Outputs</MicroLabel>
                    <div className="mt-0.5 ml-2 space-y-0.5">
                        {visibleOutputs.map((out, oi) => (
                            <div
                                key={oi}
                                className="flex items-center gap-1 font-mono text-xs text-muted-foreground"
                            >
                                <span>vout:{out.vout} →</span>
                                <AssetAmountDisplay
                                    amount={Number(out.amount)}
                                    assetId={assetIdStr}
                                    valueClassName="text-foreground font-semibold text-xs"
                                    unitClassName="text-xs"
                                />
                            </div>
                        ))}
                        {hiddenOutputs > 0 && (
                            <button
                                onClick={() => setShowAllOutputs(true)}
                                className="mt-1 text-xs text-primary hover:underline"
                            >
                                Show {hiddenOutputs} more output{hiddenOutputs !== 1 ? "s" : ""}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
