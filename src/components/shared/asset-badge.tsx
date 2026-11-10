import { Link } from "react-router-dom";
import { useAssetDetails } from "@/hooks/use-asset-details";
import { truncateHash } from "@/lib/utils";
import { isSafeImageUrl } from "@/lib/api/indexer";
import { cn } from "@/lib/utils";

interface AssetBadgeProps {
    assetId: string;
    className?: string;
}

export function AssetBadge({ assetId, className = "" }: AssetBadgeProps) {
    const { assetDetails } = useAssetDetails(assetId);

    const metadata = assetDetails?.metadata;
    const label = metadata?.ticker || metadata?.name || truncateHash(assetId, 6, 6);
    const hasIcon = metadata?.icon && isSafeImageUrl(metadata.icon);

    return (
        <span className={cn("inline-flex items-center gap-1.5", className)}>
            <Link
                to={`/asset/${assetId}`}
                className="inline-flex items-center gap-1.5 rounded border border-cp/40 bg-cp/10 px-1.5 py-px font-mono text-[10.5px] font-semibold uppercase tracking-wide text-cp transition-colors hover:bg-cp/20"
                title={assetId}
            >
                {label}
                {hasIcon && <img src={metadata.icon} alt="" className="h-3 w-3 rounded-full" />}
            </Link>
        </span>
    );
}
