import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { formatRelativeTime } from "@/lib/formatters";
import { formatSats, truncateId } from "@/lib/observation";
import {
    formatRecordTime,
    recordTimeSeconds,
    type NetworkScope,
    type OverviewRecord,
} from "@/lib/overview-records";
import { Glyph, VtxoGlyph, type GlyphKind } from "@/components/atlas/glyph";
import { Tag } from "@/components/atlas/tag";
import { Segmented } from "@/components/atlas/segmented";
import { cn } from "@/lib/utils";

const RECORDS_PAGE_SIZE = 15;

function rowGlyph(record: OverviewRecord):
    | { kind: GlyphKind }
    | {
          vtxoState:
              "renew" | "expired" | "unknown" | "preconfirmed" | "settled" | "spent" | "unrolled";
      } {
    if (record.entity === "vtxo") {
        const vtxoState =
            record.status === "urgent"
                ? ("renew" as const)
                : record.status === "expired"
                  ? ("expired" as const)
                  : record.status === "unknown" || record.status === "swept"
                    ? ("unknown" as const)
                    : record.status === "spent"
                      ? ("spent" as const)
                      : record.status === "unrolled"
                        ? ("unrolled" as const)
                        : ("preconfirmed" as const);
        return { vtxoState };
    }
    if (record.kind === "commitment") return { kind: "commitment" };
    return { kind: "round" };
}
function networkTag(record: OverviewRecord) {
    return record.network === "arkade" ? (
        <span className="micro text-virt">Arkade</span>
    ) : (
        <span className="micro text-chain">Second</span>
    );
}

/** On-chain rows read as muted "block N · k conf"-style facts, never state pills. */
function stateCell(record: OverviewRecord) {
    if (record.status === "confirmed") {
        return (
            <span className="font-mono text-[10.5px] text-faint">
                {record.blockHeight !== null
                    ? `block ${record.blockHeight.toLocaleString("en-US")}`
                    : "confirmed"}
            </span>
        );
    }
    if (record.status === "observed" && record.kind === "onchain") {
        return <span className="font-mono text-[10.5px] text-faint">observed</span>;
    }
    // Live operator-stream rows are not a problem state: show a neutral "Live"
    // tag only for safe statuses. urgent/expired/unknown/spent always surface
    // the real status — a live badge must never hide unknown risk.
    const SAFE_LIVE = new Set<OverviewRecord["status"]>([
        "healthy",
        "observed",
        "confirmed",
        "locked",
    ]);
    if (record.liveSource === true && SAFE_LIVE.has(record.status)) {
        return <Tag tone="neutral">Live</Tag>;
    }
    return (
        <Tag
            tone={
                record.status === "urgent" ||
                record.status === "expired" ||
                record.status === "unknown" ||
                record.status === "swept"
                    ? "warning"
                    : record.status === "unrolled" || record.status === "spent"
                      ? "faint" // consumed/exit-in-progress — not "ok" green
                      : "virt"
            }
            dashed={record.status === "unknown" || record.status === "swept"}
        >
            {record.statusLabel}
        </Tag>
    );
}

export function ActivityTable({
    records,
    scope,
    onScopeChange,
    selectedId,
    onSelect,
    arkadeConfigured,
    arkadeLoading,
    arkadeError,
    secondConfigured,
    secondLoading,
    secondError,
}: {
    records: OverviewRecord[];
    scope: NetworkScope;
    onScopeChange: (scope: NetworkScope) => void;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    arkadeConfigured: boolean;
    arkadeLoading: boolean;
    arkadeError: Error | null;
    secondConfigured: boolean;
    secondLoading: boolean;
    secondError: Error | null;
}) {
    const [layer, setLayer] = useState<"all" | "virtual" | "onchain">("all");
    const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
    const [search, setSearch] = useState("");
    const [sortDirection, setSortDirection] = useState<"ascending" | "descending" | null>(null);
    const [visibleCount, setVisibleCount] = useState(RECORDS_PAGE_SIZE);

    const inScope = useMemo(
        () => records.filter((record) => scope === "all" || record.network === scope),
        [records, scope],
    );
    const networkCounts = useMemo(
        () => ({
            all: records.length,
            arkade: records.filter((record) => record.network === "arkade").length,
            second: records.filter((record) => record.network === "second").length,
        }),
        [records],
    );
    const counts = useMemo(
        () => ({
            all: inScope.length,
            virtual: inScope.filter((record) => record.entity === "vtxo").length,
            onchain: inScope.filter((record) => record.entity !== "vtxo").length,
            review: inScope.filter((record) => record.needsReview).length,
        }),
        [inScope],
    );
    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = inScope.filter((record) => {
            if (layer === "virtual" && record.entity !== "vtxo") return false;
            if (layer === "onchain" && record.entity === "vtxo") return false;
            if (!query) return true;
            return [record.label, record.txid, record.network, record.statusLabel]
                .join(" ")
                .toLowerCase()
                .includes(query);
        });
        if (sortDirection) {
            filtered.sort((a, b) => {
                if (a.amountSat === null) return b.amountSat === null ? 0 : 1;
                if (b.amountSat === null) return -1;
                const result = a.amountSat - b.amountSat;
                return sortDirection === "ascending" ? result : -result;
            });
        } else {
            // Default: newest activity first; records without a timestamp sink last.
            filtered.sort((a, b) => {
                const ta = recordTimeSeconds(a);
                const tb = recordTimeSeconds(b);
                if (ta === null) return tb === null ? 0 : 1;
                if (tb === null) return -1;
                return tb - ta;
            });
        }
        return filtered;
    }, [inScope, layer, needsReviewOnly, search, sortDirection]);

    useEffect(() => {
        if (selectedId && !visible.some((record) => record.id === selectedId)) onSelect(null);
    }, [onSelect, selectedId, visible]);

    useEffect(() => {
        setVisibleCount(RECORDS_PAGE_SIZE);
    }, [layer, needsReviewOnly, search, sortDirection, scope]);

    const displayed = useMemo(() => visible.slice(0, visibleCount), [visible, visibleCount]);

    const rawCount = inScope.length;
    const sourceFreshness = useMemo(() => {
        const labels = new Set(inScope.map((record) => record.sourceLabel));
        if (scope === "arkade" || scope === "all") {
            if (arkadeError) {
                labels.delete("operator indexer · live");
                labels.add("operator indexer · unavailable");
            } else if (!labels.has("operator indexer · live")) {
                labels.add(
                    !arkadeConfigured
                        ? "watchlist · not configured"
                        : arkadeLoading
                          ? "operator indexer · loading"
                          : "operator indexer · live",
                );
            }
        }
        if (scope === "second" || scope === "all") {
            if (secondError) {
                labels.add("Second live source · unavailable");
            } else if (!labels.has("mempool · live") && !labels.has("barkd · live")) {
                labels.add(
                    secondConfigured
                        ? secondLoading
                            ? "Second live source · loading"
                            : "Second live source · live"
                        : "Second on-chain source · not configured",
                );
            }
        }
        return [...labels].join(" · ");
    }, [
        arkadeConfigured,
        arkadeError,
        arkadeLoading,
        inScope,
        scope,
        secondConfigured,
        secondError,
        secondLoading,
    ]);

    let emptyTitle = "No matching transactions";
    let emptyMessage = "Try another search or clear the filters.";
    if (rawCount === 0) {
        const relevantSources =
            scope === "arkade"
                ? [
                      {
                          configured: arkadeConfigured,
                          loading: arkadeLoading,
                          error: arkadeError,
                          label: "Arkade",
                      },
                  ]
                : scope === "second"
                  ? [
                        {
                            configured: secondConfigured,
                            loading: secondLoading,
                            error: secondError,
                            label: "Second",
                        },
                    ]
                  : [
                        {
                            configured: arkadeConfigured,
                            loading: arkadeLoading,
                            error: arkadeError,
                            label: "Arkade",
                        },
                        {
                            configured: secondConfigured,
                            loading: secondLoading,
                            error: secondError,
                            label: "Second",
                        },
                    ];
        const configuredSources = relevantSources.filter((source) => source.configured);
        const failedSources = relevantSources.filter((source) => source.configured && source.error);
        if (configuredSources.length === 0) {
            emptyTitle = "No live sources configured";
            emptyMessage =
                scope === "second"
                    ? "Second on-chain source not configured."
                    : "Add scripts to your watchlist or connect barkd — the operator publishes no global listing.";
        } else if (failedSources.length > 0) {
            emptyTitle = `${failedSources.map((source) => source.label).join(" and ")} live source unavailable`;
            emptyMessage = failedSources
                .map((source) => source.error?.message || `${source.label} source unavailable`)
                .join(" · ");
        } else if (relevantSources.some((source) => source.configured && source.loading)) {
            emptyTitle = "Loading live records";
            emptyMessage =
                "Records from the configured live sources will appear when they respond.";
        } else if (scope === "arkade") {
            emptyTitle = "No watched VTXOs";
            emptyMessage = "The operator indexer returned no VTXOs for your watchlist scripts.";
        } else if (scope === "second") {
            emptyTitle = "No live Second records";
            emptyMessage = "No on-chain server transactions or wallet VTXOs were returned.";
        } else {
            emptyTitle = "No live records";
            emptyMessage =
                "Configured live sources returned no watched VTXOs or on-chain transactions.";
        }
    }

    return (
        <section className="min-w-0" aria-labelledby="records-heading">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <h2 id="records-heading" className="sr-only">
                    Transactions
                </h2>
                <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
                    <Segmented
                        ariaLabel="Network"
                        value={scope}
                        onChange={onScopeChange}
                        options={(
                            [
                                ["all", "All networks", networkCounts.all],
                                ["arkade", "Arkade", networkCounts.arkade],
                                ["second", "Second", networkCounts.second],
                            ] as const
                        ).map(([value, label, count]) => ({ value, label, count }))}
                    />
                    <Segmented
                        ariaLabel="Transaction type"
                        value={layer}
                        onChange={setLayer}
                        options={(
                            [
                                ["all", "All", counts.all],
                                ["virtual", "VTXOs", counts.virtual],
                                ["onchain", "Transactions", counts.onchain],
                            ] as const
                        ).map(([value, label, count]) => ({ value, label, count }))}
                    />
                    <button
                        type="button"
                        aria-pressed={needsReviewOnly}
                        onClick={() => setNeedsReviewOnly((value) => !value)}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                            needsReviewOnly
                                ? "border-warning/40 bg-warning/10 text-warning"
                                : "border-line-strong text-muted-foreground hover:bg-secondary hover:text-foreground",
                        )}
                    >
                        Needs review{" "}
                        <span className="font-mono text-[10.5px]">{counts.review}</span>
                    </button>
                    <label className="relative min-w-[12rem] flex-1 xl:flex-none">
                        <span className="sr-only">
                            Search label, transaction ID, network, or status
                        </span>
                        <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search transactions"
                            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
                        />
                    </label>
                </div>
            </div>
            <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="border-b border-border text-micro text-faint">
                        <tr>
                            <th scope="col" className="w-[18px] px-2 py-2.5" />
                            <th scope="col" className="px-2 py-2.5 font-medium">
                                Time
                            </th>
                            <th scope="col" className="px-2 py-2.5 font-medium">
                                Transaction
                            </th>
                            <th scope="col" className="px-2 py-2.5 font-medium">
                                Network
                            </th>
                            <th scope="col" className="px-2 py-2.5 font-medium">
                                Type
                            </th>
                            <th
                                scope="col"
                                aria-sort={sortDirection ?? "none"}
                                className="px-2 py-2.5 text-right font-medium"
                            >
                                <button
                                    type="button"
                                    aria-label="Sort by amount"
                                    onClick={() =>
                                        setSortDirection((value) =>
                                            value === "ascending" ? "descending" : "ascending",
                                        )
                                    }
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                >
                                    Amount{" "}
                                    <span aria-hidden="true">
                                        {sortDirection === "ascending"
                                            ? "↑"
                                            : sortDirection === "descending"
                                              ? "↓"
                                              : "↕"}
                                    </span>
                                </button>
                            </th>
                            <th scope="col" className="px-2 py-2.5 font-medium">
                                State
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {displayed.map((record) => {
                            const glyph = rowGlyph(record);
                            const timeSec = recordTimeSeconds(record);
                            return (
                                <tr
                                    key={record.id}
                                    role="button"
                                    aria-pressed={record.id === selectedId}
                                    data-record-id={record.id}
                                    tabIndex={0}
                                    onClick={(event) => {
                                        event.currentTarget.focus();
                                        onSelect(record.id);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            onSelect(record.id);
                                        }
                                    }}
                                    className={cn(
                                        "cursor-pointer outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50",
                                        record.id === selectedId &&
                                            "border-l-2 border-virt bg-accent/10",
                                    )}
                                >
                                    <td className="px-2 py-2.5">
                                        {"vtxoState" in glyph ? (
                                            <VtxoGlyph
                                                state={glyph.vtxoState}
                                                lifetimeLeft={null}
                                                size={14}
                                            />
                                        ) : (
                                            <Glyph kind={glyph.kind} size={14} />
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">
                                        {timeSec === null ? (
                                            <span>—</span>
                                        ) : (
                                            <span title={formatRecordTime(timeSec)}>
                                                {formatRelativeTime(timeSec * 1000)}
                                            </span>
                                        )}
                                    </td>
                                    <td className="max-w-[20rem] px-2 py-2.5">
                                        <div className="min-w-0">
                                            <span className="block truncate font-medium text-foreground">
                                                {record.label}
                                            </span>
                                            <p className="truncate font-mono text-xs text-muted-foreground">
                                                {truncateId(record.txid)}
                                            </p>
                                        </div>
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-2.5">
                                        {networkTag(record)}
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">
                                        {record.typeLabel}
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                                        {record.amountSat === null ? (
                                            <span className="text-muted-foreground">—</span>
                                        ) : (
                                            <>
                                                <span className="text-foreground">
                                                    {formatSats(record.amountSat).replace(
                                                        / sats$/,
                                                        "",
                                                    )}
                                                </span>
                                                <span className="ml-1 text-muted-foreground">
                                                    sats
                                                </span>
                                            </>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-2 py-2.5">
                                        {stateCell(record)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {visible.length === 0 && (
                <div className="px-6 py-12 text-center">
                    <h3 className="text-base font-semibold text-foreground">{emptyTitle}</h3>
                    <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                        {emptyMessage}
                    </p>
                    {(search || needsReviewOnly || layer !== "all") && rawCount > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearch("");
                                setNeedsReviewOnly(false);
                                setLayer("all");
                            }}
                            className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            )}
            {visible.length > displayed.length && (
                <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-4">
                    <span className="text-xs text-muted-foreground">
                        Showing {displayed.length} of {visible.length}
                    </span>
                    <button
                        type="button"
                        onClick={() => setVisibleCount((count) => count + RECORDS_PAGE_SIZE)}
                        className="rounded-md border border-border bg-card px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                    >
                        Show {RECORDS_PAGE_SIZE} more
                    </button>
                </div>
            )}
            <div className="mt-3 flex flex-col gap-1 border-t border-border px-1 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>{sourceFreshness || "No live records"}</span>
            </div>
        </section>
    );
}
