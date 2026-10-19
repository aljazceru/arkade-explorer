import { useMemo } from "react";
import { AlertTriangle, Clock3, Layers3, Wallet } from "lucide-react";
import { formatDuration, formatSats } from "@/lib/observation";
import type { OverviewRecord, NetworkScope } from "@/components/overview/records-table";

function StatCard({
    label,
    value,
    detail,
    icon,
    accent = false,
}: {
    label: string;
    value: string;
    detail: string;
    icon: React.ReactNode;
    accent?: boolean;
}) {
    return (
        <article className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                {icon}
                {label}
            </div>
            <p
                className={`mt-3 truncate text-2xl font-semibold tabular-nums ${accent ? "text-warning" : "text-foreground"}`}
            >
                {value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </article>
    );
}

type OverviewStatsProps = {
    records: OverviewRecord[];
    scope: NetworkScope;
    arkadeConfigured: boolean;
    arkadeLoading: boolean;
    arkadeError: Error | null;
    secondConfigured: boolean;
    secondLoading: boolean;
    secondError: Error | null;
};

export function OverviewStats({
    records,
    scope,
    arkadeConfigured,
    arkadeLoading,
    arkadeError,
    secondConfigured,
    secondLoading,
    secondError,
}: OverviewStatsProps) {
    const summary = useMemo(() => {
        const relevantSources =
            scope === "arkade"
                ? [
                      {
                          configured: arkadeConfigured,
                          loading: arkadeLoading,
                          error: arkadeError,
                          label: "operator indexer",
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
                            label: "operator indexer",
                        },
                        {
                            configured: secondConfigured,
                            loading: secondLoading,
                            error: secondError,
                            label: "Second",
                        },
                    ];
        const relevantRecords = records.filter(
            (record) => scope === "all" || record.network === scope,
        );
        const configuredSources = relevantSources.filter((source) => source.configured);
        const state =
            configuredSources.length === 0
                ? "unconfigured"
                : relevantSources.some((source) => source.configured && source.error)
                  ? "error"
                  : relevantSources.some((source) => source.configured && source.loading)
                    ? "loading"
                    : "ready";
        const reviewRecords = relevantRecords.filter((record) => record.needsReview);
        const virtualRecords = relevantRecords.filter((record) => record.kind === "virtual");
        const activeLifetimes = virtualRecords.flatMap((record) =>
            record.status !== "settled" && record.leftSeconds !== null ? [record.leftSeconds] : [],
        );
        const nearest = activeLifetimes.length > 0 ? Math.min(...activeLifetimes) : null;
        const urgentCount = reviewRecords.filter((record) => record.status === "urgent").length;
        const expiredCount = reviewRecords.filter((record) => record.status === "expired").length;
        const unknownCount = reviewRecords.filter((record) => record.status === "unknown").length;
        const value = reviewRecords.reduce((sum, record) => sum + (record.amountSat ?? 0), 0);
        const onchainCount = relevantRecords.filter((record) => record.kind !== "virtual").length;
        const sourceErrors = relevantSources
            .filter((source) => source.configured && source.error)
            .map((source) => `${source.label}: ${source.error?.message || "unavailable"}`);
        const unconfiguredDetail =
            scope === "arkade"
                ? "Add scripts to your watchlist or connect barkd — the operator publishes no global listing"
                : scope === "second"
                  ? "Second on-chain source not configured"
                  : "Add scripts to your watchlist or connect barkd — the operator publishes no global listing; Second on-chain source not configured";
        const stateDetail =
            state === "unconfigured"
                ? unconfiguredDetail
                : state === "error"
                  ? sourceErrors.join(" · ")
                  : state === "loading"
                    ? "Loading live records…"
                    : null;
        const liveSources = [
            ...new Set(
                relevantRecords
                    .map((record) => record.sourceLabel)
                    .filter((source) => source.toLowerCase().includes("live")),
            ),
        ];
        const configuredLiveSources = relevantSources
            .filter((source) => source.configured)
            .map((source) => `${source.label} · live`);
        const sourceDetail =
            liveSources.length > 0
                ? liveSources.join(" · ")
                : configuredLiveSources.join(" · ") || "live";

        return {
            state,
            stateDetail,
            readyDetail: sourceDetail,
            reviewCount: reviewRecords.length,
            urgentCount,
            expiredCount,
            unknownCount,
            nearest,
            value,
            virtualCount: virtualRecords.length,
            onchainCount,
            transactionCount: relevantRecords.length,
        };
    }, [
        arkadeConfigured,
        arkadeError,
        arkadeLoading,
        records,
        scope,
        secondConfigured,
        secondError,
        secondLoading,
    ]);

    const unavailableValue =
        summary.state === "loading"
            ? "Loading"
            : summary.state === "error"
              ? "Unavailable"
              : summary.state === "unconfigured"
                ? "—"
                : null;
    const unavailableDetail = summary.stateDetail ?? summary.readyDetail;

    return (
        <section
            aria-label="Live summary for selected networks"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
            <StatCard
                label="Needs review"
                value={unavailableValue ?? String(summary.reviewCount)}
                detail={
                    summary.state === "ready"
                        ? `${summary.urgentCount} near expiry · ${summary.expiredCount} expired · ${summary.unknownCount} unknown · ${summary.readyDetail}`
                        : unavailableDetail
                }
                icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                accent={summary.state === "ready" && summary.reviewCount > 0}
            />
            <StatCard
                label="Nearest expiry"
                value={
                    unavailableValue ??
                    (summary.nearest === null
                        ? "—"
                        : summary.nearest <= 0
                          ? "Expired"
                          : formatDuration(summary.nearest))
                }
                detail={
                    summary.state === "ready"
                        ? `${summary.nearest === null ? "No active expiry evidence" : "Live VTXO expiry"} · ${summary.readyDetail}`
                        : unavailableDetail
                }
                icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard
                label="Transactions"
                value={unavailableValue ?? String(summary.transactionCount)}
                detail={
                    summary.state === "ready"
                        ? `${summary.virtualCount} virtual · ${summary.onchainCount} on-chain · ${summary.readyDetail}`
                        : unavailableDetail
                }
                icon={<Layers3 className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard
                label="Value needing review"
                value={unavailableValue ?? formatSats(summary.value)}
                detail={
                    summary.state === "ready"
                        ? `Across ${summary.reviewCount} outputs · ${summary.readyDetail}`
                        : unavailableDetail
                }
                icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
                accent={summary.state === "ready" && summary.value > 0}
            />
        </section>
    );
}
