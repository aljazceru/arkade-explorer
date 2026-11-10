import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { AppProviders } from "@/providers/app-providers";
import { DynamicLayout } from "@/components/dynamic-layout";
import { LoadingSpinner } from "@/components/shared/loading-spinner";

// Each route is its own chunk: the exit flow and the canvases stay out of the
// first paint, and a failing page module cannot take the others down with it.
const HomePage = lazy(() => import("@/pages/home").then((m) => ({ default: m.HomePage })));
const TransactionPage = lazy(() =>
    import("@/pages/tx").then((m) => ({ default: m.TransactionPage })),
);
const CommitmentTxPage = lazy(() =>
    import("@/pages/commitment-tx").then((m) => ({ default: m.CommitmentTxPage })),
);
const AddressPage = lazy(() => import("@/pages/address").then((m) => ({ default: m.AddressPage })));
const AssetPage = lazy(() => import("@/pages/asset").then((m) => ({ default: m.AssetPage })));
const UnilateralExitPage = lazy(() =>
    import("@/pages/unilateral-exit").then((m) => ({ default: m.UnilateralExitPage })),
);
const WatchlistPage = lazy(() =>
    import("@/pages/watchlist").then((m) => ({ default: m.WatchlistPage })),
);
const ObservePage = lazy(() => import("@/pages/observe").then((m) => ({ default: m.ObservePage })));
const NotFoundPage = lazy(() =>
    import("@/pages/not-found").then((m) => ({ default: m.NotFoundPage })),
);

export function App() {
    return (
        <AppProviders>
            <DynamicLayout>
                <Suspense fallback={<LoadingSpinner label="Loading view" />}>
                    <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/tx/:txid" element={<TransactionPage />} />
                        <Route path="/commitment-tx/:txid" element={<CommitmentTxPage />} />
                        <Route path="/address/:address" element={<AddressPage />} />
                        <Route path="/asset/:assetId" element={<AssetPage />} />
                        {/* Dedicated, intentionally UNLINKED keyless exit executor. */}
                        <Route path="/unilateral-exit" element={<UnilateralExitPage />} />
                        <Route path="/watchlist" element={<WatchlistPage />} />
                        <Route path="/observe" element={<ObservePage />} />
                        <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                </Suspense>
            </DynamicLayout>
        </AppProviders>
    );
}
