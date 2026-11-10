import {
    useState,
    useRef,
    useLayoutEffect,
    createContext,
    useContext,
    useMemo,
    type ReactNode,
} from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";
import type { VirtualCoin } from "@arkade-os/sdk";
import { MoneyDisplay } from "@/components/shared/money-display";
import { AssetAmountDisplay } from "@/components/shared/asset-amount-display";
import { CopyButton } from "@/components/shared/copy-button";
import { truncateHash, formatTimestamp, cn } from "@/lib/utils";
import { constructArkAddress } from "@/lib/arkAddress";
import { useServerInfo } from "@/providers/server-info-provider";
import { ExpiryCountdown } from "@/components/shared/expiry-countdown";
import { useNow, useExitDelays, useChainTip } from "@/hooks/use-expiry";
import { VtxoStateTag } from "@/components/atlas/vtxo-state-tag";
import { Hash } from "@/components/atlas/hash";
import { MicroLabel } from "@/components/atlas/panel";
import { atlasVtxoState, type AtlasVtxoContext, type AtlasVtxoView } from "@/lib/atlas/vtxo-state";

type ListStyle = "table" | "cards" | "dense-rows";

const EMPTY_PENDING: ReadonlySet<string> = new Set<string>();

/** Shared Atlas context for every row: one clock, one exit delay, one tip. */
const AtlasCtxContext = createContext<AtlasVtxoContext>({
    nowMs: 0,
    exitDelay: null,
    tipHeight: null,
    pendingOutpoints: EMPTY_PENDING,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Attempt to derive an Arkade address from the VTXO's script or PSBT. */
function deriveAddress(
    vtxo: VirtualCoin,
    signerPubkey: string | undefined,
    network: string | undefined,
): string | null {
    // First try the vtxo.script field directly (hex scriptPubKey from indexer)
    if (vtxo.script && signerPubkey && network) {
        try {
            const scriptBytes = hex.decode(vtxo.script);
            const addr = constructArkAddress(scriptBytes, signerPubkey, network);
            if (addr) return addr;
        } catch {
            // fall through
        }
    }

    // Then try extracting from PSBT
    const psbtBase64 = (vtxo as unknown as Record<string, unknown>)._psbt;
    if (typeof psbtBase64 === "string" && signerPubkey && network) {
        try {
            const psbtBytes = Uint8Array.from(atob(psbtBase64), (c) => c.charCodeAt(0));
            const tx = btc.Transaction.fromPSBT(psbtBytes);
            const vout = vtxo.vout ?? 0;
            if (tx.outputsLength > vout) {
                const output = tx.getOutput(vout);
                if (output?.script) {
                    const addr = constructArkAddress(output.script, signerPubkey, network);
                    if (addr) return addr;
                }
            }
        } catch {
            // PSBT decode failed
        }
    }

    return null;
}

/** Atlas state for one VTXO, read from the shared per-list context. */
function useVtxoAtlas(vtxo: VirtualCoin): AtlasVtxoView {
    const ctx = useContext(AtlasCtxContext);
    return useMemo(() => atlasVtxoState(vtxo, ctx), [vtxo, ctx]);
}

function StatusTag({ vtxo }: { vtxo: VirtualCoin }) {
    const view = useVtxoAtlas(vtxo);
    return <VtxoStateTag state={view.state} />;
}

// ---------------------------------------------------------------------------
// Shared sub-components for VTXO detail fields
// ---------------------------------------------------------------------------

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <MicroLabel className="w-20 shrink-0 sm:w-24">{label}</MicroLabel>
            <div className="min-w-0 text-xs text-foreground">{children}</div>
        </div>
    );
}

function CreatedAt({ vtxo }: { vtxo: VirtualCoin }) {
    if (!vtxo.createdAt) return null;
    const ts = vtxo.createdAt instanceof Date ? vtxo.createdAt.getTime() : Number(vtxo.createdAt);
    return (
        <DetailRow label="created">
            <span className="font-mono text-[11px] text-muted-foreground">
                {formatTimestamp(ts)}
            </span>
        </DetailRow>
    );
}

function SpentByLink({ vtxo }: { vtxo: VirtualCoin }) {
    if (!vtxo.spentBy || vtxo.spentBy === "") return null;
    const label = vtxo.settledBy ? "forfeit tx" : "spent by";
    return (
        <DetailRow label={label}>
            <Hash
                value={vtxo.spentBy}
                to={`/tx/${vtxo.spentBy}`}
                head={10}
                tail={6}
                label="spent-by txid"
            />
        </DetailRow>
    );
}

function SettledByLink({ vtxo }: { vtxo: VirtualCoin }) {
    if (!vtxo.settledBy) return null;
    return (
        <DetailRow label="settled by">
            <Hash
                value={vtxo.settledBy}
                to={`/commitment-tx/${vtxo.settledBy}`}
                head={10}
                tail={6}
                label="commitment txid"
            />
        </DetailRow>
    );
}

function AssetsList({ vtxo }: { vtxo: VirtualCoin }) {
    if (!vtxo.assets || vtxo.assets.length === 0) return null;
    return (
        <DetailRow label="assets">
            <span className="flex flex-wrap gap-1.5">
                {vtxo.assets.map((asset, idx) => (
                    <span
                        key={idx}
                        className="inline-flex items-center rounded border border-line-strong px-1.5 py-0.5"
                    >
                        <AssetAmountDisplay
                            amount={asset.amount}
                            assetId={asset.assetId}
                            valueClassName="font-mono text-[11px] text-foreground"
                            unitClassName="font-mono text-[11px] text-foreground"
                        />
                    </span>
                ))}
            </span>
        </DetailRow>
    );
}

function AddressLink({
    vtxo,
    signerPubkey,
    network,
    showScript,
}: {
    vtxo: VirtualCoin;
    signerPubkey: string | undefined;
    network: string | undefined;
    showScript?: boolean;
}) {
    // Use vtxo.script + server info to derive address when showScript is true
    const address = showScript || vtxo.script ? deriveAddress(vtxo, signerPubkey, network) : null;

    if (!address) return null;
    return (
        <DetailRow label="address">
            <Hash
                value={address}
                to={`/address/${address}`}
                head={12}
                tail={8}
                label="arkade address"
            />
        </DetailRow>
    );
}

function DebugToggle({ vtxo }: { vtxo: VirtualCoin }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-t border-border pt-2">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="micro inline-flex items-center gap-1 text-faint transition-colors hover:text-foreground"
                aria-expanded={open}
            >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {open ? "hide" : "show"} raw json
            </button>
            {open && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-secondary/40 p-3 text-[11px]">
                    <code className="font-mono text-muted-foreground">
                        {JSON.stringify(vtxo, null, 2)}
                    </code>
                </pre>
            )}
        </div>
    );
}

function VtxoDetails({
    vtxo,
    showScript,
    signerPubkey,
    network,
}: {
    vtxo: VirtualCoin;
    showScript?: boolean;
    signerPubkey?: string;
    network?: string;
}) {
    return (
        <div className="space-y-1.5">
            <CreatedAt vtxo={vtxo} />
            <AssetsList vtxo={vtxo} />
            <AddressLink
                vtxo={vtxo}
                signerPubkey={signerPubkey}
                network={network}
                showScript={showScript}
            />
            <SpentByLink vtxo={vtxo} />
            <SettledByLink vtxo={vtxo} />
            <DebugToggle vtxo={vtxo} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VtxoListProps {
    vtxos: VirtualCoin[];
    showScript?: boolean;
    variant?: ListStyle;
    className?: string;
    pendingOutpoints?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
    return (
        <div className="rounded-lg border border-border bg-card px-4 py-10 text-center">
            <p className="micro text-faint">No VTXOs found</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Table variant
// ---------------------------------------------------------------------------

function VtxoTable({
    vtxos,
    showScript,
    className,
    signerPubkey,
    network,
}: {
    vtxos: VirtualCoin[];
    showScript?: boolean;
    className?: string;
    signerPubkey?: string;
    network?: string;
}) {
    return (
        <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-secondary/40">
                            <th className="micro px-4 py-2.5 text-left text-faint">Outpoint</th>
                            <th className="micro px-4 py-2.5 text-right text-faint">Amount</th>
                            <th className="micro px-4 py-2.5 text-center text-faint">State</th>
                            <th className="micro px-4 py-2.5 text-right text-faint">
                                Expiry · time left
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {vtxos.map((vtxo) => {
                            const outpointStr = `${vtxo.txid}:${vtxo.vout}`;
                            return (
                                <VtxoTableRow
                                    key={outpointStr}
                                    vtxo={vtxo}
                                    showScript={showScript}
                                    signerPubkey={signerPubkey}
                                    network={network}
                                />
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function VtxoTableRow({
    vtxo,
    showScript,
    signerPubkey,
    network,
}: {
    vtxo: VirtualCoin;
    showScript?: boolean;
    signerPubkey?: string;
    network?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const view = useVtxoAtlas(vtxo);
    const urgent = view.state === "renew" || view.state === "expired";

    return (
        <>
            {/* Main row */}
            <tr
                className={cn(
                    "border-b border-border transition-colors last:border-b-0 hover:bg-secondary/40",
                    urgent && "bg-alert/10 shadow-[inset_2px_0_0_hsl(var(--destructive))]",
                    expanded && "bg-secondary/30",
                )}
            >
                <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setExpanded(!expanded)}
                            className="shrink-0 text-faint transition-colors hover:text-foreground"
                            aria-label={expanded ? "Collapse details" : "Expand details"}
                            aria-expanded={expanded}
                        >
                            {expanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                            )}
                        </button>
                        <Link
                            to={`/tx/${vtxo.txid}`}
                            className="font-mono text-[12px] text-foreground hover:text-virt"
                        >
                            {truncateHash(vtxo.txid, 8, 6)}:{vtxo.vout}
                        </Link>
                        <CopyButton
                            text={`${vtxo.txid}:${vtxo.vout}`}
                            label="outpoint"
                            className="shrink-0"
                        />
                    </div>
                </td>
                <td className="px-4 py-2.5 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                        <MoneyDisplay
                            sats={vtxo.value}
                            className="font-mono text-[12px] text-foreground"
                        />
                        {vtxo.assets &&
                            vtxo.assets.length > 0 &&
                            vtxo.assets.map((asset, idx: number) => (
                                <AssetAmountDisplay
                                    key={idx}
                                    amount={asset.amount}
                                    assetId={asset.assetId}
                                    valueClassName="font-mono text-[11px] font-semibold text-foreground"
                                    unitClassName="font-mono text-[11px] text-foreground"
                                />
                            ))}
                    </div>
                </td>
                <td className="px-4 py-2.5 text-center">
                    <StatusTag vtxo={vtxo} />
                </td>
                <td className="px-4 py-2.5 text-right">
                    <ExpiryCountdown vtxo={vtxo} showBadge={false} />
                </td>
            </tr>

            {/* Expanded detail row */}
            {expanded && (
                <tr className="border-b border-border bg-secondary/20">
                    <td colSpan={4} className="px-4 py-3">
                        <div className="space-y-1.5 pl-7">
                            <VtxoDetails
                                vtxo={vtxo}
                                signerPubkey={signerPubkey}
                                network={network}
                                showScript={showScript}
                            />
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Cards variant
// ---------------------------------------------------------------------------

function VtxoCards({
    vtxos,
    showScript,
    className,
    signerPubkey,
    network,
}: {
    vtxos: VirtualCoin[];
    showScript?: boolean;
    className?: string;
    signerPubkey?: string;
    network?: string;
}) {
    return (
        <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}>
            {vtxos.map((vtxo) => {
                const outpointStr = `${vtxo.txid}:${vtxo.vout}`;
                return (
                    <VtxoCard
                        key={outpointStr}
                        vtxo={vtxo}
                        outpointStr={outpointStr}
                        showScript={showScript}
                        signerPubkey={signerPubkey}
                        network={network}
                    />
                );
            })}
        </div>
    );
}

function VtxoCard({
    vtxo,
    outpointStr,
    showScript,
    signerPubkey,
    network,
}: {
    vtxo: VirtualCoin;
    outpointStr: string;
    showScript?: boolean;
    signerPubkey?: string;
    network?: string;
}) {
    const view = useVtxoAtlas(vtxo);
    const urgent = view.state === "renew" || view.state === "expired";
    return (
        <div
            className={cn(
                "rounded-lg border bg-card p-4 transition-colors hover:bg-secondary/30",
                urgent ? "border-alert/60 bg-alert/5" : "border-border",
            )}
        >
            {/* Header: outpoint + copy */}
            <div className="mb-3 flex items-center justify-between gap-2">
                <Link
                    to={`/tx/${vtxo.txid}`}
                    className="min-w-0 truncate font-mono text-[12px] text-foreground hover:text-virt"
                >
                    {truncateHash(vtxo.txid, 8, 6)}:{vtxo.vout}
                </Link>
                <CopyButton text={outpointStr} label="outpoint" className="shrink-0" />
            </div>

            {/* Amount */}
            <div className="mb-3">
                <MoneyDisplay
                    sats={vtxo.value}
                    className="font-mono text-lg font-semibold text-foreground"
                />
            </div>

            {/* Assets */}
            <AssetsList vtxo={vtxo} />

            {/* Created at */}
            {vtxo.createdAt && (
                <div className="mt-2">
                    <CreatedAt vtxo={vtxo} />
                </div>
            )}

            {/* Address */}
            <div className="mt-2">
                <AddressLink
                    vtxo={vtxo}
                    signerPubkey={signerPubkey}
                    network={network}
                    showScript={showScript}
                />
            </div>

            {/* Spent by / Settled by */}
            {vtxo.spentBy && vtxo.spentBy !== "" && (
                <div className="mt-2">
                    <SpentByLink vtxo={vtxo} />
                </div>
            )}
            {vtxo.settledBy && (
                <div className="mt-2">
                    <SettledByLink vtxo={vtxo} />
                </div>
            )}

            {/* Footer: status + expiry */}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <StatusTag vtxo={vtxo} />
                <ExpiryCountdown vtxo={vtxo} compact showBadge={false} />
            </div>

            {/* Debug toggle */}
            <div className="mt-3">
                <DebugToggle vtxo={vtxo} />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Dense-rows variant (virtualized)
// ---------------------------------------------------------------------------

function VtxoDenseRows({
    vtxos,
    showScript,
    className,
    signerPubkey,
    network,
}: {
    vtxos: VirtualCoin[];
    showScript?: boolean;
    className?: string;
    signerPubkey?: string;
    network?: string;
}) {
    const parentRef = useRef<HTMLDivElement>(null);
    const [scrollMargin, setScrollMargin] = useState(0);

    // offsetTop shifts when content above the list (filters, facts column on
    // mobile) loads or resizes after mount — keep the virtualizer's
    // scrollMargin in sync or rows drift and leave blank bands.
    useLayoutEffect(() => {
        const el = parentRef.current;
        if (!el) return;
        const update = () => {
            const top = el.offsetTop;
            setScrollMargin((prev) => (prev === top ? prev : top));
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el.offsetParent ?? document.body);
        window.addEventListener("resize", update);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", update);
        };
    }, []);

    const virtualizer = useWindowVirtualizer({
        count: vtxos.length,
        estimateSize: () => 34,
        overscan: 12,
        scrollMargin,
        getItemKey: (index) => `${vtxos[index].txid}:${vtxos[index].vout}`,
    });

    return (
        <div
            ref={parentRef}
            className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}
        >
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: "relative",
                    width: "100%",
                }}
            >
                {virtualizer.getVirtualItems().map((item) => {
                    const vtxo = vtxos[item.index];
                    return (
                        <div
                            key={item.key}
                            data-index={item.index}
                            ref={virtualizer.measureElement}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                            }}
                        >
                            <VtxoDenseRow
                                vtxo={vtxo}
                                index={item.index}
                                showScript={showScript}
                                signerPubkey={signerPubkey}
                                network={network}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function VtxoDenseRow({
    vtxo,
    index,
    showScript,
    signerPubkey,
    network,
}: {
    vtxo: VirtualCoin;
    index: number;
    showScript?: boolean;
    signerPubkey?: string;
    network?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const view = useVtxoAtlas(vtxo);
    const urgent = view.state === "renew" || view.state === "expired";

    return (
        <div
            className={cn(
                "transition-colors",
                index % 2 === 0 && "bg-secondary/25",
                "hover:bg-secondary/50",
                urgent && "bg-alert/10 shadow-[inset_2px_0_0_hsl(var(--destructive))]",
                expanded && "bg-secondary/40",
            )}
        >
            {/* Main dense row — wraps to two lines on narrow screens */}
            <div className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
                <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="shrink-0 text-faint transition-colors hover:text-foreground"
                    aria-label={expanded ? "Collapse" : "Expand"}
                    aria-expanded={expanded}
                >
                    {expanded ? (
                        <ChevronDown className="h-3 w-3" />
                    ) : (
                        <ChevronRight className="h-3 w-3" />
                    )}
                </button>

                {/* Outpoint */}
                <Link
                    to={`/tx/${vtxo.txid}`}
                    className="min-w-0 shrink font-mono text-[12px] text-foreground hover:text-virt"
                >
                    {truncateHash(vtxo.txid, 6, 4)}:{vtxo.vout}
                </Link>

                {/* Spent by inline */}
                {vtxo.spentBy && vtxo.spentBy !== "" && (
                    <Link
                        to={`/tx/${vtxo.spentBy}`}
                        className="shrink-0 font-mono text-[10px] text-faint transition-colors hover:text-foreground hidden sm:inline"
                        title={`Spent by ${vtxo.spentBy}`}
                    >
                        spent:{truncateHash(vtxo.spentBy, 4, 4)}
                    </Link>
                )}

                {/* Settled by inline */}
                {vtxo.settledBy && (
                    <Link
                        to={`/commitment-tx/${vtxo.settledBy}`}
                        className="shrink-0 font-mono text-[10px] text-faint transition-colors hover:text-foreground hidden sm:inline"
                        title={`Settled by ${vtxo.settledBy}`}
                    >
                        settled:{truncateHash(vtxo.settledBy, 4, 4)}
                    </Link>
                )}

                {/* Spacer pushes the trailing group right on the first line */}
                <span className="flex-1" />

                {/* Amount + assets */}
                <span className="flex shrink-0 items-center gap-2">
                    <MoneyDisplay
                        sats={vtxo.value}
                        className="font-mono text-[12px] text-foreground"
                    />
                    {vtxo.assets &&
                        vtxo.assets.length > 0 &&
                        vtxo.assets.map((asset, idx: number) => (
                            <AssetAmountDisplay
                                key={idx}
                                amount={asset.amount}
                                assetId={asset.assetId}
                                valueClassName="font-mono text-[11px] font-semibold text-foreground"
                                unitClassName="font-mono text-[11px] text-foreground"
                            />
                        ))}
                </span>

                {/* State + expiry: wraps under the identity line on narrow screens */}
                <span className="flex shrink-0 items-center gap-2">
                    <StatusTag vtxo={vtxo} />
                    <ExpiryCountdown
                        vtxo={vtxo}
                        compact
                        showBadge={false}
                        className="shrink-0 text-right"
                    />
                </span>
            </div>

            {/* Expanded details */}
            {expanded && (
                <div className="px-3 pb-2.5 pl-9">
                    <VtxoDetails
                        vtxo={vtxo}
                        signerPubkey={signerPubkey}
                        network={network}
                        showScript={showScript}
                    />
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component (variant-aware)
// ---------------------------------------------------------------------------

export function VtxoList({
    vtxos,
    showScript,
    variant: overrideVariant,
    className,
    pendingOutpoints,
}: VtxoListProps) {
    const { serverInfo } = useServerInfo();
    const variant = overrideVariant ?? "table";

    const signerPubkey = serverInfo?.signerPubkey;
    const network = serverInfo?.network;

    // One shared clock/delay/tip for every row's atlasVtxoState call.
    const now = useNow();
    const { unilateralExitDelay } = useExitDelays();
    const needsTip = vtxos.some(
        (v) => v.expiresAtHeight !== undefined && v.expiresAtHeight !== null,
    );
    const tipHeight = useChainTip(needsTip);

    const atlasCtx = useMemo<AtlasVtxoContext>(
        () => ({
            nowMs: now,
            exitDelay: unilateralExitDelay,
            tipHeight,
            pendingOutpoints: pendingOutpoints ?? EMPTY_PENDING,
        }),
        [now, unilateralExitDelay, tipHeight, pendingOutpoints],
    );

    if (vtxos.length === 0) {
        return <EmptyState />;
    }

    const body = (() => {
        switch (variant) {
            case "cards":
                return (
                    <VtxoCards
                        vtxos={vtxos}
                        showScript={showScript}
                        className={className}
                        signerPubkey={signerPubkey}
                        network={network}
                    />
                );
            case "dense-rows":
                return (
                    <VtxoDenseRows
                        vtxos={vtxos}
                        showScript={showScript}
                        className={className}
                        signerPubkey={signerPubkey}
                        network={network}
                    />
                );
            case "table":
            default:
                return (
                    <VtxoTable
                        vtxos={vtxos}
                        showScript={showScript}
                        className={className}
                        signerPubkey={signerPubkey}
                        network={network}
                    />
                );
        }
    })();

    return <AtlasCtxContext.Provider value={atlasCtx}>{body}</AtlasCtxContext.Provider>;
}
