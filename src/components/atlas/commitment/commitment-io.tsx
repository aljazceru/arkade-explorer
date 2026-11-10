import { Link } from "react-router-dom";
import type { VirtualCoin } from "@arkade-os/sdk";
import { CopyButton } from "@/components/shared/copy-button";
import { MoneyDisplay } from "@/components/shared/money-display";
import { truncateHash } from "@/lib/utils";
import { Panel } from "@/components/atlas/panel";
import { Tag } from "@/components/atlas/tag";
import { Hash, middleTruncate } from "@/components/atlas/hash";
import { getMempoolUrl, type ParsedTx, type ParsedInput, type ParsedOutput } from "@/lib/tx-parse";
import type { SpendPath, ScriptView } from "@/lib/arkadeScript";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitmentIoProps {
    parsed: ParsedTx;
    txid: string;
    forfeitAddress?: string;
    network?: string;
    forfeitTxids?: string[];
    connectors?: Array<{ txid: string; children?: Record<number, string> }>;
    inputSpendPaths: Array<SpendPath | null>;
    inputVtxoMap?: Map<string, VirtualCoin>;
    batchRootTxids: Map<number, string>;
    connectorOutputIndices: Set<number>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommitmentIo({
    parsed,
    txid,
    forfeitAddress,
    network: _network,
    forfeitTxids,
    connectors,
    inputSpendPaths,
    inputVtxoMap,
    batchRootTxids,
    connectorOutputIndices,
}: CommitmentIoProps) {
    return (
        <div className="space-y-6">
            {/* On-chain inputs/outputs */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Panel title={`On-chain inputs (${parsed.inputs.length})`}>
                    <div className="divide-y divide-border">
                        {parsed.inputs.map((input) => (
                            <InputRow
                                key={`input-${input.index}`}
                                input={input}
                                txid={txid}
                                spendPath={inputSpendPaths[input.index]}
                                vtxo={inputVtxoMap?.get(`${input.txid}:${input.vout}`)}
                            />
                        ))}
                    </div>
                </Panel>

                <Panel title={`On-chain outputs (${parsed.outputs.length})`}>
                    <div className="divide-y divide-border">
                        {parsed.outputs.map((output) => (
                            <OutputRow
                                key={`output-${output.index}`}
                                output={output}
                                batchRootTxid={batchRootTxids.get(output.index)}
                                isConnector={connectorOutputIndices.has(output.index)}
                                txid={txid}
                                forfeitAddress={forfeitAddress}
                            />
                        ))}
                    </div>
                </Panel>
            </div>

            {/* Forfeit transactions */}
            {forfeitTxids && forfeitTxids.length > 0 && (
                <Panel title={`Forfeit transactions (${forfeitTxids.length})`}>
                    <div className="divide-y divide-border">
                        {forfeitTxids.map((fTxid) => (
                            <Link
                                key={fTxid}
                                to={`/tx/${fTxid}`}
                                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/50"
                            >
                                <Hash value={fTxid} head={12} tail={8} copy={false} />
                                <span className="font-mono text-[10px] text-faint">forfeit</span>
                            </Link>
                        ))}
                    </div>
                </Panel>
            )}

            {/* Connectors */}
            {connectors && connectors.length > 0 && (
                <Panel title={`Connector transactions (${connectors.length})`}>
                    <div className="divide-y divide-border">
                        {connectors.map((c) => (
                            <Link
                                key={c.txid}
                                to={`/tx/${c.txid}`}
                                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/50"
                            >
                                <Hash value={c.txid} head={12} tail={8} copy={false} />
                            </Link>
                        ))}
                    </div>
                </Panel>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Input row — Atlas ledger style
// ---------------------------------------------------------------------------

function InputRow({
    input,
    txid: _txid,
    spendPath,
    vtxo,
    network,
}: {
    input: ParsedInput;
    txid: string;
    spendPath?: SpendPath | null;
    vtxo?: VirtualCoin;
    network?: string;
}) {
    const mempoolUrl = input.txid ? getMempoolUrl(network, input.txid) : undefined;

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

            {/* Address / script */}
            {input.arkAddress ? (
                <div className="mt-1">
                    <span className="font-mono text-[11px] text-muted-foreground">
                        {middleTruncate(input.arkAddress, 12, 8)}
                    </span>
                </div>
            ) : input.scriptHex ? (
                <div className="mt-1 break-all font-mono text-[10px] text-faint">
                    {input.scriptHex.substring(0, 60)}…
                </div>
            ) : null}

            {/* Settlement link */}
            {vtxo?.settledBy && vtxo.settledBy !== "" && (
                <div className="mt-1">
                    <Link
                        to={`/commitment-tx/${vtxo.settledBy}`}
                        className="inline-flex items-center gap-1 text-[11px] text-ok hover:underline"
                    >
                        settled in <Hash value={vtxo.settledBy} head={8} tail={4} copy={false} />
                    </Link>
                </div>
            )}

            {/* Spend path */}
            {spendPath && <SpendPathLine spendPath={spendPath} />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Output row — Atlas ledger style
// ---------------------------------------------------------------------------

function OutputRow({
    output,
    batchRootTxid,
    isConnector,
    txid: _txid,
    forfeitAddress,
}: {
    output: ParsedOutput;
    batchRootTxid?: string;
    isConnector?: boolean;
    txid: string;
    forfeitAddress?: string;
}) {
    const amt = Number(output.amount);
    const isBatch = output.isBatch;
    const isForfeit = output.isForfeit;
    const isAnchor = output.isAnchor || output.isArkExtension;

    return (
        <div className="px-4 py-3">
            {/* Header: index + tags + amount + batch link */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    <span className="shrink-0 font-mono text-[10px] text-faint">
                        #{output.index}
                    </span>
                    {isAnchor && <Tag tone="faint">Anchor</Tag>}
                    {output.isArkExtension && <Tag tone="faint">OP_RETURN</Tag>}
                    {isForfeit && <Tag tone="alert">Forfeit</Tag>}
                    {isBatch && output.batchInfo && (
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
                    {isConnector && <Tag tone="cp">Connector</Tag>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <MoneyDisplay sats={amt} className="text-xs font-semibold text-foreground" />
                    {isBatch && batchRootTxid && (
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

            {/* Batch info */}
            {isBatch && output.batchInfo && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                    {output.batchInfo.totalOutputVtxos} registered receiver
                    {output.batchInfo.totalOutputVtxos !== 1 ? "s" : ""}
                </div>
            )}

            {/* Address / script */}
            {output.isForfeit ? (
                <div className="mt-1 space-y-0.5">
                    <div className="text-[11px] font-semibold text-alert">Arkade operator</div>
                    {forfeitAddress && (
                        <div className="break-all font-mono text-[10px] text-muted-foreground">
                            {forfeitAddress}
                        </div>
                    )}
                </div>
            ) : output.arkAddress ? (
                <div className="mt-1 flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                        {middleTruncate(output.arkAddress, 12, 8)}
                    </span>
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
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
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
