import { useState } from "react";
import { Link } from "react-router-dom";
import { Shield, Image as ImageIcon, ChevronDown, ChevronRight } from "lucide-react";
import type { AssetDetails } from "@/lib/api/indexer";
import { isSafeImageUrl, formatAssetAmount, assetDecimals } from "@/lib/api/indexer";
import { useAssetIconApproval } from "@/providers/asset-icon-approval-provider";
import { CopyButton } from "@/components/shared/copy-button";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Tag } from "@/components/atlas/tag";
import { ImageLightbox } from "@/components/shared/image-lightbox";
import { cn } from "@/lib/utils";

interface AssetDetailProps {
    assetDetails: AssetDetails;
    className?: string;
}

function FactRow({
    label,
    children,
    mono = true,
}: {
    label: string;
    children: React.ReactNode;
    mono?: boolean;
}) {
    return (
        <div className="flex items-baseline justify-between gap-4 border-t border-border/60 py-2 first:border-t-0">
            <MicroLabel className="shrink-0 pt-0.5">{label}</MicroLabel>
            <div
                className={cn(
                    "min-w-0 break-all text-right text-[12.5px] text-foreground",
                    mono && "font-mono",
                )}
            >
                {children}
            </div>
        </div>
    );
}

export function AssetDetail({ assetDetails, className }: AssetDetailProps) {
    const [showDebug, setShowDebug] = useState(false);
    const { isApproved, isVerified, approve, revoke } = useAssetIconApproval();
    const metadata = assetDetails.metadata;
    const decimals = assetDecimals(metadata);
    // Present-but-invalid decimals metadata: amounts show raw base units.
    const decimalsInvalid = metadata?.decimals != null && decimals === null;
    const iconUrl = metadata?.icon;
    const hasIcon = !!iconUrl && isSafeImageUrl(iconUrl);
    const iconApproved = isApproved(assetDetails.assetId);
    const iconVerified = isVerified(assetDetails.assetId);
    const showIcon = hasIcon && (iconApproved || iconVerified);

    // AssetId format: 64 hex chars (txid) + remaining chars (group index)
    const genesisTxid =
        assetDetails.assetId.length >= 64 ? assetDetails.assetId.substring(0, 64) : null;

    return (
        <Panel className={className}>
            <div className="space-y-5 p-5">
                {/* Header with icon */}
                <div className="flex items-start gap-4">
                    {showIcon ? (
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-secondary/40">
                            <ImageLightbox
                                src={iconUrl!}
                                alt={metadata?.name ?? "Asset icon"}
                                className="h-full w-full object-cover"
                            />
                        </div>
                    ) : hasIcon && !iconApproved ? (
                        <button
                            type="button"
                            onClick={() => approve(assetDetails.assetId)}
                            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40 text-faint transition-colors hover:bg-secondary hover:text-foreground"
                            title="Click to approve loading this asset icon"
                            aria-label="Approve loading this asset icon"
                        >
                            <ImageIcon className="h-5 w-5" aria-hidden="true" />
                        </button>
                    ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40">
                            <span className="text-lg font-semibold text-muted-foreground">
                                {metadata?.ticker?.charAt(0) ?? "?"}
                            </span>
                        </div>
                    )}

                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-[15px] font-semibold text-foreground">
                                {metadata?.name ?? "Unknown asset"}
                            </h2>
                            {iconVerified && (
                                <Tag tone="ok" title="Verified asset metadata">
                                    <Shield className="h-3 w-3" aria-hidden="true" /> Verified
                                </Tag>
                            )}
                        </div>
                        {metadata?.ticker && (
                            <span className="mt-0.5 block font-mono text-[12px] text-muted-foreground">
                                {metadata.ticker}
                            </span>
                        )}
                    </div>
                </div>

                {/* Detail rows */}
                <div>
                    <FactRow label="Asset ID">
                        <span className="inline-flex items-center gap-1">
                            <span className="break-all">{assetDetails.assetId}</span>
                            <CopyButton text={assetDetails.assetId} label="asset id" />
                        </span>
                    </FactRow>

                    {genesisTxid && (
                        <FactRow label="Genesis TX">
                            <Link
                                to={`/tx/${genesisTxid}`}
                                className="text-virt underline-offset-2 hover:underline"
                            >
                                {genesisTxid.slice(0, 8)}…{genesisTxid.slice(-8)}
                            </Link>
                        </FactRow>
                    )}

                    <FactRow label="Supply">
                        {formatAssetAmount(assetDetails.supply, decimals)}
                        {metadata?.ticker ? ` ${metadata.ticker}` : ""}
                        {decimalsInvalid && (
                            <span className="text-faint"> (raw units — invalid decimals)</span>
                        )}
                    </FactRow>

                    <FactRow label="Decimals">
                        {decimals ?? (decimalsInvalid ? "invalid" : "—")}
                    </FactRow>

                    {assetDetails.controlAssetId && (
                        <FactRow label="Control asset">
                            <span className="inline-flex items-center gap-1">
                                <Link
                                    to={`/asset/${assetDetails.controlAssetId}`}
                                    className="break-all text-virt underline-offset-2 hover:underline"
                                >
                                    {assetDetails.controlAssetId.slice(0, 8)}…
                                    {assetDetails.controlAssetId.slice(-8)}
                                </Link>
                                <CopyButton
                                    text={assetDetails.controlAssetId}
                                    label="control asset id"
                                />
                            </span>
                        </FactRow>
                    )}
                </div>

                {/* Icon approval toggle (non-verified assets only) */}
                {hasIcon && !iconVerified && (
                    <div className="flex items-center justify-between border-t border-border/60 pt-3">
                        <MicroLabel>Asset icon</MicroLabel>
                        <button
                            type="button"
                            onClick={() => {
                                if (iconApproved) {
                                    revoke(assetDetails.assetId);
                                } else {
                                    approve(assetDetails.assetId);
                                }
                            }}
                            className="rounded-md border border-line-strong bg-secondary px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            {iconApproved ? "Hide icon" : "Show icon"}
                        </button>
                    </div>
                )}
            </div>

            {/* Raw metadata disclosure */}
            <div className="border-t border-border">
                <button
                    type="button"
                    onClick={() => setShowDebug((prev) => !prev)}
                    aria-expanded={showDebug}
                    className="flex w-full items-center gap-1.5 px-5 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-faint transition-colors hover:text-foreground"
                >
                    {showDebug ? (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Raw metadata
                </button>
                {showDebug && (
                    <pre className="max-h-64 overflow-auto border-t border-border bg-canvas px-5 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {JSON.stringify(assetDetails, null, 2)}
                    </pre>
                )}
            </div>
        </Panel>
    );
}
