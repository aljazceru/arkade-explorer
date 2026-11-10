import { Link } from "react-router-dom";
import { useAssetDetails } from "@/hooks/use-asset-details";
import { truncateHash } from "@/lib/utils";
import { isSafeImageUrl, formatAssetAmount, assetDecimals } from "@/lib/api/indexer";
import { cn } from "@/lib/utils";

interface AssetAmountDisplayProps {
    amount: number | bigint;
    assetId: string;
    className?: string;
    valueClassName?: string;
    unitClassName?: string;
    hideUnit?: boolean;
}

export function AssetAmountDisplay({
    amount,
    assetId,
    className = "",
    valueClassName = "",
    unitClassName = "",
    hideUnit = false,
}: AssetAmountDisplayProps) {
    const { assetDetails, isLoading } = useAssetDetails(assetId);

    const metadata = assetDetails?.metadata;
    const decimals = assetDecimals(metadata);
    // Present-but-invalid decimals metadata: raw base units are shown, marked.
    const decimalsInvalid = metadata?.decimals != null && decimals === null;
    const ticker = metadata?.ticker || metadata?.name || truncateHash(assetId, 6, 6);
    const formatted = formatAssetAmount(amount, decimals);

    return (
        <span className={cn("inline-flex items-center gap-1", className)}>
            <span
                className={valueClassName}
                title={
                    decimalsInvalid ? "invalid decimals metadata — raw base units shown" : undefined
                }
            >
                {formatted}
            </span>
            {decimalsInvalid && (
                <span
                    className="text-[9px] text-faint"
                    title="invalid decimals metadata — raw base units shown"
                >
                    ?
                </span>
            )}
            {!hideUnit && metadata?.icon && isSafeImageUrl(metadata.icon) && (
                <img src={metadata.icon} alt="" className="inline h-3.5 w-3.5 rounded-full" />
            )}
            {!hideUnit && (
                <Link
                    to={`/asset/${assetId}`}
                    className={cn(
                        "font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-virt hover:underline",
                        unitClassName,
                        isLoading && "animate-pulse",
                    )}
                    title={assetId}
                >
                    {ticker}
                </Link>
            )}
        </span>
    );
}
