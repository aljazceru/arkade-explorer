import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { useParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";

import { indexerClient } from "@/lib/api/indexer";
import { hasMorePages } from "@/lib/api/fetchAllPages";
import { addressToScriptHex } from "@/lib/decode";
import { PAGINATION } from "@/lib/constants";
import { sumVtxoValue, aggregateAssetBalances, uniqueVtxos } from "@/lib/vtxo-aggregation";
import { MoneyDisplay } from "@/components/shared/money-display";
import { debounce } from "@/lib/debounce";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { usePendingOutpoints } from "@/hooks/use-pending-outpoints";
import { useWatchlist } from "@/hooks/use-watchlist";
import { useNow, useExitDelays, useChainTip } from "@/hooks/use-expiry";
import { VtxoList } from "@/components/shared/vtxo-list";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { ErrorMessage } from "@/components/shared/error-message";
import { PageTransition } from "@/components/shared/page-transition";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Hash } from "@/components/atlas/hash";
import { Segmented } from "@/components/atlas/segmented";
import { Term } from "@/components/atlas/term";
import { AddressConstellation } from "@/components/atlas/address/constellation";
import { AddressFacts } from "@/components/atlas/address/facts";
import { atlasVtxoState, type AtlasVtxoContext } from "@/lib/atlas/vtxo-state";
import { summarizeAddress, urgencyRank } from "@/lib/atlas/address-summary";
import { remainingLifetime } from "@/lib/vtxo-display";
import type { VirtualCoin } from "@arkade-os/sdk";

type VtxoFilter = "all" | "spendable" | "recoverable" | "spent";
type StatusFilter = "all" | "preconfirmed" | "settled";
type SortKey = "urgency" | "amount" | "expiry" | "newest";

const FILTER_OPTIONS: { value: VtxoFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "spendable", label: "Spendable" },
    { value: "recoverable", label: "Recoverable" },
    { value: "spent", label: "Spent" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "preconfirmed", label: "Preconfirmed" },
    { value: "settled", label: "Settled" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: "urgency", label: "Urgency" },
    { value: "expiry", label: "Expiry" },
    { value: "amount", label: "Amount" },
    { value: "newest", label: "Newest" },
];

interface SortInfo {
    rank: number;
    expiresAtMs: number | null;
    value: number;
    createdAtMs: number | null;
}

export function AddressPage() {
    const { address } = useParams<{ address: string }>();
    const [vtxoFilter, setVtxoFilter] = useState<VtxoFilter>("all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [sortKey, setSortKey] = useState<SortKey>("urgency");
    const { addRecentSearch, isPinned, pinSearch, unpinSearch } = useRecentSearches();
    const { has: watchlistHas, add: watchlistAdd, remove: watchlistRemove } = useWatchlist();
    const subscriptionRef = useRef<AbortController | null>(null);
    const now = useNow();
    const { unilateralExitDelay } = useExitDelays();

    const scriptHex = useMemo(() => {
        if (!address) return null;
        try {
            return addressToScriptHex(address);
        } catch {
            return null;
        }
    }, [address]);

    useEffect(() => {
        if (address) addRecentSearch(address, "address");
    }, [address, addRecentSearch]);

    const {
        data,
        isLoading,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
        refetch,
    } = useInfiniteQuery({
        queryKey: ["address-vtxos", scriptHex, vtxoFilter],
        queryFn: async ({ pageParam = 0 }) => {
            if (!scriptHex) throw new Error("Invalid address");

            const opts: Parameters<typeof indexerClient.getVtxos>[0] = {
                scripts: [scriptHex],
                pageIndex: pageParam,
                pageSize: PAGINATION.MAX_PAGE_SIZE,
            };

            if (vtxoFilter === "spendable") opts.spendableOnly = true;
            if (vtxoFilter === "spent") opts.spentOnly = true;
            if (vtxoFilter === "recoverable") opts.recoverableOnly = true;

            return indexerClient.getVtxos(opts);
        },
        getNextPageParam: (lastPage) =>
            hasMorePages(lastPage.page) ? lastPage.page!.next : undefined,
        initialPageParam: 0,
        enabled: !!scriptHex,
    });

    const handleRetryPage = () => {
        void fetchNextPage();
    };

    useEffect(() => {
        if (!scriptHex) return;

        const abortController = new AbortController();
        subscriptionRef.current = abortController;

        const debouncedRefetch = debounce(() => {
            if (!abortController.signal.aborted) refetch();
        }, 1500);

        async function subscribe() {
            try {
                const subscriptionId = await indexerClient.subscribeForScripts([scriptHex!]);
                const subscription = indexerClient.getSubscription(
                    subscriptionId,
                    abortController.signal,
                );

                for await (const _event of subscription) {
                    if (abortController.signal.aborted) break;
                    debouncedRefetch();
                }
            } catch (err) {
                if (!abortController.signal.aborted) {
                    console.error("Subscription error:", err);
                }
            }
        }

        subscribe();

        return () => {
            debouncedRefetch.cancel();
            abortController.abort();
            subscriptionRef.current = null;
        };
    }, [scriptHex, refetch]);

    // Auto-drain every page so balances reflect the complete dataset. A failed
    // page fetch stops the loop (React Query already retried it) instead of
    // retry-looping forever; the retry affordance below resumes the drain.
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, data?.pages.length]);

    const allVtxos = useMemo(
        () => uniqueVtxos(data?.pages.flatMap((page) => page.vtxos) ?? []),
        [data],
    );

    // Detect spends that were submitted but not finalized. Only query when at least
    // one VTXO is actually spent, so addresses with nothing spent pay no extra request.
    const anySpent = useMemo(
        () => allVtxos.some((v) => v.isSpent || (!!v.spentBy && v.spentBy !== "")),
        [allVtxos],
    );

    const pendingOutpoints = usePendingOutpoints({
        scripts: scriptHex ? [scriptHex] : undefined,
        enabled: !!scriptHex && anySpent,
    });

    // Chain tip only matters for height-based expiry (regtest-like deployments).
    const hasHeightExpiry = useMemo(
        () => allVtxos.some((v) => v.expiresAtHeight !== undefined && v.expiresAtHeight !== null),
        [allVtxos],
    );
    const tipHeight = useChainTip(hasHeightExpiry);

    const ctx = useMemo<AtlasVtxoContext>(
        () => ({
            nowMs: now,
            exitDelay: unilateralExitDelay,
            tipHeight,
            pendingOutpoints,
        }),
        [now, unilateralExitDelay, tipHeight, pendingOutpoints],
    );

    const summary = useMemo(() => summarizeAddress(allVtxos, ctx), [allVtxos, ctx]);

    // Per-VTXO sort keys computed once against the live context.
    const sortInfo = useMemo(() => {
        const map = new Map<string, SortInfo>();
        for (const v of allVtxos) {
            const key = `${v.txid}:${v.vout}`;
            const view = atlasVtxoState(v, ctx);
            const remaining = view.remaining ?? remainingLifetime(v, now, tipHeight);
            map.set(key, {
                rank: urgencyRank(view.state),
                expiresAtMs: remaining?.expiresAtMs ?? null,
                value: Number(v.value) || 0,
                createdAtMs: v.createdAt instanceof Date ? v.createdAt.getTime() : null,
            });
        }
        return map;
    }, [allVtxos, ctx, now, tipHeight]);

    const filteredVtxos = useMemo(() => {
        let list = allVtxos;
        if (statusFilter !== "all") {
            // Canonical state precedence: spent > swept > preconfirmed > settled.
            list = list.filter(
                (vtxo) =>
                    vtxo.isSpent !== true &&
                    vtxo.isSwept !== true &&
                    (statusFilter === "preconfirmed"
                        ? vtxo.isPreconfirmed === true
                        : vtxo.isPreconfirmed !== true),
            );
        }
        const info = (v: VirtualCoin) =>
            sortInfo.get(`${v.txid}:${v.vout}`) ?? {
                rank: 9,
                expiresAtMs: null,
                value: 0,
                createdAtMs: null,
            };
        const sorted = [...list].sort((a, b) => {
            const ia = info(a);
            const ib = info(b);
            switch (sortKey) {
                case "amount":
                    return ib.value - ia.value;
                case "expiry":
                    return (ia.expiresAtMs ?? Infinity) - (ib.expiresAtMs ?? Infinity);
                case "newest":
                    return (ib.createdAtMs ?? 0) - (ia.createdAtMs ?? 0);
                case "urgency":
                default: {
                    if (ia.rank !== ib.rank) return ia.rank - ib.rank;
                    return (ia.expiresAtMs ?? Infinity) - (ib.expiresAtMs ?? Infinity);
                }
            }
        });
        return sorted;
    }, [allVtxos, statusFilter, sortKey, sortInfo]);
    const filteredOutputValue = useMemo(() => sumVtxoValue(filteredVtxos), [filteredVtxos]);

    const isDraining = hasNextPage || isFetchingNextPage;
    const loadedPages = data?.pages.length ?? 0;
    const totalPages = data?.pages[0]?.page?.total ?? null;

    const hasAssets = useMemo(
        () => allVtxos.some((v) => v.assets && v.assets.length > 0),
        [allVtxos],
    );
    const assetBalances = useMemo(
        () => (hasAssets ? Array.from(aggregateAssetBalances(allVtxos).entries()) : []),
        [allVtxos, hasAssets],
    );

    const pinned = address ? isPinned(address) : false;
    const watched = scriptHex ? watchlistHas(scriptHex) : false;

    const handleTogglePin = () => {
        if (!address) return;
        if (pinned) unpinSearch(address);
        else pinSearch(address, "address");
    };

    const handleToggleWatch = () => {
        if (!scriptHex) return;
        if (watched) watchlistRemove(scriptHex);
        else watchlistAdd(scriptHex, address ?? undefined);
    };

    if (!scriptHex) {
        return (
            <div className="space-y-6">
                <Breadcrumb />
                <ErrorMessage
                    title="Invalid address"
                    message="Could not decode the provided address."
                />
            </div>
        );
    }

    const showData = !isLoading && allVtxos.length > 0;

    return (
        <PageTransition>
            <div className="space-y-4">
                <Breadcrumb />

                {/* Header */}
                <Panel bodyClassName="px-4 py-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="micro mb-1.5 text-faint">Arkade address</div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                <Hash
                                    value={address!}
                                    full
                                    label="address"
                                    className="text-[13px]"
                                />
                                <span className="hidden items-center gap-1.5 sm:inline-flex">
                                    <MicroLabel>script</MicroLabel>
                                    <Hash value={scriptHex} head={10} tail={6} label="script hex" />
                                </span>
                                <span className="micro text-faint">
                                    {summary.totalVtxos.toLocaleString("en-US")} vtxos
                                    {isFetchNextPageError
                                        ? " · partial"
                                        : isDraining
                                          ? " · loading…"
                                          : ""}
                                </span>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                onClick={handleToggleWatch}
                                aria-pressed={watched}
                                className={
                                    watched
                                        ? "inline-flex h-8 items-center rounded-md border border-virt/60 bg-virt/10 px-3 text-xs text-virt"
                                        : "inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-xs text-muted-foreground hover:text-foreground"
                                }
                            >
                                {watched ? "Watching" : "Watch"}
                            </button>
                            <button
                                type="button"
                                onClick={handleTogglePin}
                                aria-pressed={pinned}
                                className={
                                    pinned
                                        ? "inline-flex h-8 items-center rounded-md border border-virt/60 bg-virt/10 px-3 text-xs text-virt"
                                        : "inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-xs text-muted-foreground hover:text-foreground"
                                }
                            >
                                {pinned ? "Pinned" : "Pin"}
                            </button>
                        </div>
                    </div>
                </Panel>
                {error && allVtxos.length > 0 && (
                    <p
                        role="alert"
                        className="rounded-md border border-warning/40 p-3 text-sm text-warning"
                    >
                        {isFetchNextPageError
                            ? "Partial results: a page failed to load. Values below include only loaded outputs; retry the missing pages below."
                            : "The latest refresh failed. Showing the last received data, not a freshly verified balance."}
                    </p>
                )}

                {/* Main grid: constellation + table (left) · facts (right).
                    On mobile the facts panel comes first. */}
                <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
                    <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
                        {/* Constellation */}
                        {showData ? (
                            <AddressConstellation vtxos={allVtxos} ctx={ctx} />
                        ) : (
                            <Panel
                                variant="canvas"
                                title="Constellation"
                                subtitle="VTXOs clustered by commitment"
                                className="h-[280px]"
                                bodyClassName="flex h-full items-center justify-center"
                            >
                                {isLoading ? (
                                    <LoadingSpinner label="Loading VTXOs" />
                                ) : error ? (
                                    <ErrorMessage
                                        message={
                                            error instanceof Error
                                                ? error.message
                                                : "Failed to fetch VTXOs"
                                        }
                                    />
                                ) : (
                                    <p className="micro text-faint">No VTXOs found</p>
                                )}
                            </Panel>
                        )}

                        {/* Filters + balance + table */}
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <span className="flex items-center gap-2">
                                    <span className="micro text-faint">Type</span>
                                    <Segmented
                                        value={vtxoFilter}
                                        onChange={setVtxoFilter}
                                        options={FILTER_OPTIONS}
                                        ariaLabel="Filter by VTXO type"
                                    />
                                </span>
                                <span className="flex items-center gap-2">
                                    <span className="micro text-faint">Status</span>
                                    <Segmented
                                        value={statusFilter}
                                        onChange={setStatusFilter}
                                        options={STATUS_OPTIONS}
                                        ariaLabel="Filter by VTXO status"
                                    />
                                </span>
                                <span className="flex items-center gap-2">
                                    <span className="micro text-faint">Sort</span>
                                    <Segmented
                                        value={sortKey}
                                        onChange={setSortKey}
                                        options={SORT_OPTIONS}
                                        ariaLabel="Sort VTXOs"
                                    />
                                </span>
                                <span className="ml-auto flex items-center gap-2">
                                    <span className="micro text-faint">Loaded output value</span>
                                    <MoneyDisplay
                                        sats={filteredOutputValue}
                                        className="font-mono text-[12px] text-foreground"
                                    />
                                    <span className="font-mono text-[11px] text-faint">
                                        ({filteredVtxos.length.toLocaleString("en-US")}{" "}
                                        <Term k="vtxo">VTXOs</Term>)
                                    </span>
                                    {isDraining && (
                                        <span className="inline-flex items-center gap-1.5 text-faint">
                                            {!isFetchNextPageError && (
                                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-virt" />
                                            )}
                                            {loadedPages}
                                            {totalPages !== null ? `/${totalPages}` : ""} pages
                                        </span>
                                    )}
                                </span>
                            </div>

                            {isLoading ? (
                                <LoadingSpinner label="Loading VTXOs" />
                            ) : error && allVtxos.length === 0 ? null : (
                                <>
                                    <VtxoList
                                        vtxos={filteredVtxos}
                                        variant="dense-rows"
                                        pendingOutpoints={pendingOutpoints}
                                    />
                                    {isFetchingNextPage && <LoadingSpinner label="Loading page" />}
                                    {isFetchNextPageError && hasNextPage && (
                                        <button
                                            type="button"
                                            onClick={handleRetryPage}
                                            className="mx-auto block rounded-md border border-line-strong px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                        >
                                            Some pages failed to load — retry
                                        </button>
                                    )}
                                    {!isDraining && !error && filteredVtxos.length > 0 && (
                                        <p className="micro py-2 text-center text-faint">
                                            All VTXOs loaded
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* Facts — first on mobile */}
                    <aside className="order-1 min-w-0 lg:order-2">
                        {showData ? (
                            <AddressFacts
                                summary={summary}
                                now={now}
                                hasAssets={hasAssets}
                                assetBalances={assetBalances}
                                isDraining={isDraining}
                            />
                        ) : (
                            !isLoading &&
                            !error && (
                                <Panel title="Facts" bodyClassName="px-4 py-3">
                                    <p className="micro text-faint">No VTXOs found</p>
                                </Panel>
                            )
                        )}
                    </aside>
                </div>
            </div>
        </PageTransition>
    );
}

function Breadcrumb() {
    return (
        <div className="flex items-center gap-2">
            <Link to="/" className="micro text-faint hover:text-foreground">
                Home
            </Link>
            <span className="text-faint">/</span>
            <span className="micro text-muted-foreground">Address</span>
        </div>
    );
}
