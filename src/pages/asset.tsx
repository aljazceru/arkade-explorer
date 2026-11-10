import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useAssetDetails } from "@/hooks/use-asset-details";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { AssetDetail } from "@/components/shared/asset-detail";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { ErrorMessage } from "@/components/shared/error-message";
import { PageTransition } from "@/components/shared/page-transition";

export function AssetPage() {
    const { assetId } = useParams<{ assetId: string }>();
    const { assetDetails, isLoading, error } = useAssetDetails(assetId);
    const { addRecentSearch } = useRecentSearches();

    useEffect(() => {
        if (assetId) addRecentSearch(assetId, "asset");
    }, [assetId, addRecentSearch]);

    return (
        <PageTransition>
            <div className="mx-auto w-full max-w-3xl space-y-5">
                <nav
                    className="flex items-center gap-2 text-[12px] text-faint"
                    aria-label="Breadcrumb"
                >
                    <Link
                        to="/"
                        className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                        Home
                    </Link>
                    <span aria-hidden="true">/</span>
                    <span className="font-mono text-foreground">asset</span>
                </nav>

                {isLoading ? (
                    <LoadingSpinner label="Loading asset" />
                ) : error ? (
                    <ErrorMessage
                        title="Failed to load asset"
                        message={error.message || "Failed to load asset details"}
                    />
                ) : assetDetails ? (
                    <AssetDetail assetDetails={assetDetails} />
                ) : (
                    <ErrorMessage title="Not found" message="Asset not found" />
                )}
            </div>
        </PageTransition>
    );
}
