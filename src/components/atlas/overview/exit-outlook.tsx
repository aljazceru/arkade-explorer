import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { OverviewRecord } from "@/lib/overview-records";
import { formatDuration, formatSats } from "@/lib/observation";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Tag } from "@/components/atlas/tag";
import { cn } from "@/lib/utils";

/**
 * Exit outlook: observed unspent VTXOs plotted by days-until-expiry on a 31-day
 * ruler, exit windows hatched per operator, plus the personal-coin stats that
 * used to live in YourCoins. Everything is derived from the records Home
 * already merges — no separate data source.
 */

const RULER_DAYS = 31;

interface RulerDot {
    key: string;
    xPct: number; // percent across the 320-wide SVG plot (x = 16 + d/31*288)
    radius: number; // px radius, sqrt-scaled by amount, clamped [3, 8]
    state: "renew" | "expired" | "unknown" | "settled" | "spent" | "other";
    record: OverviewRecord;
}

function daysUntilExpiry(record: OverviewRecord, nowSec: number): number | null {
    // Absolute expiry timestamp when the source reports one.
    if (record.expiresAtSeconds !== null) {
        return (record.expiresAtSeconds - nowSec) / 86_400;
    }
    // Height-based expiry (barkd wallet VTXOs): leftSeconds is the estimate the
    // builder already computed against the tip — use it rather than deriving a
    // fake absolute time from expiryHeight.
    if (record.leftSeconds !== null && record.status !== "spent") {
        return record.leftSeconds / 86_400;
    }
    return null;
}

/**
 * An unspent VTXO is an actual coin entity that has not been spent/settled/
 * unrolled and still carries expiry evidence. `unrolled` means the exit has
 * already started on-chain — the coin is no longer a normal unspent VTXO.
 * `swept` means the operator recovered it — also not an unspent coin.
 * Transaction notifications (entity "transaction") are stream signals, not
 * coins, and never plot here.
 */
function isUnspentVirtual(record: OverviewRecord): boolean {
    return (
        record.entity === "vtxo" &&
        record.status !== "spent" &&
        record.status !== "unrolled" &&
        record.status !== "swept" &&
        (record.expiresAtSeconds !== null || record.leftSeconds !== null)
    );
}

function dotState(record: OverviewRecord): RulerDot["state"] {
    if (record.status === "urgent") return "renew";
    if (record.status === "expired") return "expired";
    if (record.status === "unknown" || record.status === "swept") return "unknown";
    if (record.status === "spent") return "spent"; // consumed — not "settled"
    if (record.status === "unrolled") return "spent"; // exit in progress — not settled
    return "other";
}

const DOT_CLASS: Record<RulerDot["state"], string> = {
    renew: "bg-alert",
    expired: "bg-alert",
    unknown: "bg-warning",
    spent: "bg-faint", // consumed/exit-in-progress — neutral, not ok green
    settled: "bg-ok",
    other: "bg-virt",
};

function satsShort(value: number | null): string {
    if (value === null) return "—";
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} BTC`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k sats`;
    return `${value} sats`;
}

function until(unixSec: number, nowSec: number): string {
    const left = unixSec - nowSec;
    if (left <= 0) return "expired";
    if (left < 3600) return `${Math.max(1, Math.floor(left / 60))}m`;
    if (left < 86_400) return `${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`;
    return `${Math.floor(left / 86_400)}d ${Math.floor((left % 86_400) / 3600)}h`;
}

export function ExitOutlook({
    records,
    yourRecords,
    watchlistCount,
    barkdConnected,
    loading,
    error,
    arkExitSeconds,
    secondExitSeconds,
    nowSec,
    onInspect,
}: {
    /** Activity records (snapshot + live) — the observed universe. */
    records: OverviewRecord[];
    /** Personal records (watchlist + barkd) — the "your coins" subset. */
    yourRecords: OverviewRecord[];
    watchlistCount: number;
    barkdConnected: boolean;
    loading: boolean;
    error: Error | null;
    /** Arkade unilateral exit delay, seconds; null = unknown. */
    arkExitSeconds: number | null;
    /**
     * Second unilateral exit delta in seconds (exitDeltaBlocks × nominal block
     * time). null = unknown — the band is omitted rather than hardcoded.
     */
    secondExitSeconds: number | null;
    nowSec: number;
    onInspect: (recordId: string) => void;
}) {
    const observed = useMemo(() => records.filter((record) => isUnspentVirtual(record)), [records]);

    const dots = useMemo<RulerDot[]>(() => {
        const maxAmt = Math.max(...observed.map((r) => r.amountSat ?? 0), 1);
        return observed.flatMap((record) => {
            const days = daysUntilExpiry(record, nowSec);
            if (days === null || days < 0 || days > RULER_DAYS) return [];
            // √-scaled radius, clamped to [3, 8] px (viewBox units ≈ px at 320w).
            const radius = Math.min(
                8,
                Math.max(3, 3 + 5 * Math.sqrt((record.amountSat ?? 0) / maxAmt)),
            );
            // x(d) = 16 + (d/31)*288 on a 320-wide viewBox → percent of width.
            const x = 16 + (days / RULER_DAYS) * 288;
            return [
                {
                    key: record.id,
                    xPct: (x / 320) * 100,
                    radius,
                    state: dotState(record),
                    record,
                },
            ];
        });
    }, [observed, nowSec]);

    const renews = useMemo(
        () =>
            yourRecords
                .filter(
                    (record) =>
                        record.entity === "vtxo" &&
                        (record.status === "urgent" ||
                            record.status === "expired" ||
                            record.status === "unknown" ||
                            record.status === "swept"),
                )
                .sort(
                    (a, b) =>
                        (a.expiresAtSeconds ?? a.createdAtSeconds ?? 0) -
                        (b.expiresAtSeconds ?? b.createdAtSeconds ?? 0),
                ),
        [yourRecords],
    );

    // ---- folded Your-coins stats ---------------------------------------------
    const coinStats = useMemo(() => {
        const reviewRecords = yourRecords.filter((record) => record.needsReview);
        const coinsTracked = yourRecords.filter((record) => record.entity === "vtxo").length;
        const activeLifetimes = yourRecords.flatMap((record) =>
            record.entity === "vtxo" &&
            record.status !== "spent" &&
            record.status !== "unrolled" &&
            record.status !== "swept" &&
            record.leftSeconds !== null
                ? [record.leftSeconds]
                : [],
        );
        const nearest = activeLifetimes.length > 0 ? Math.min(...activeLifetimes) : null;
        const value = reviewRecords.reduce((sum, record) => sum + (record.amountSat ?? 0), 0);
        const configured = watchlistCount > 0 || barkdConnected;
        const state = !configured
            ? "unconfigured"
            : error
              ? "error"
              : loading
                ? "loading"
                : "ready";
        return {
            state,
            reviewCount: reviewRecords.length,
            nearest,
            coinsTracked,
            value,
            totalRecords: yourRecords.length,
        };
    }, [yourRecords, watchlistCount, barkdConnected, loading, error]);

    const arkExitDays = arkExitSeconds !== null ? arkExitSeconds / 86_400 : null;
    // Second's exit delta is exitDeltaBlocks × nominal 600 s/block — an
    // estimate, not an observed duration. Rendered only when the server info
    // actually reported it; never a hardcoded band.
    const secondExitDays = secondExitSeconds !== null ? secondExitSeconds / 86_400 : null;
    const statCards = [
        {
            label: "Needs review",
            value:
                coinStats.state === "ready"
                    ? String(coinStats.reviewCount)
                    : coinStats.state === "loading"
                      ? "…"
                      : "—",
            detail:
                coinStats.state === "ready"
                    ? `${coinStats.coinsTracked} coins tracked`
                    : coinStats.state === "error"
                      ? "live source error"
                      : coinStats.state === "unconfigured"
                        ? "nothing configured"
                        : "loading…",
            accent: coinStats.state === "ready" && coinStats.reviewCount > 0,
        },
        {
            label: "Nearest expiry",
            value:
                coinStats.state === "ready"
                    ? coinStats.nearest === null
                        ? "—"
                        : coinStats.nearest <= 0
                          ? "Expired"
                          : formatDuration(coinStats.nearest)
                    : coinStats.state === "loading"
                      ? "…"
                      : "—",
            detail:
                coinStats.state === "ready"
                    ? coinStats.nearest === null
                        ? "no active expiry evidence"
                        : "your coins"
                    : "—",
            accent: false,
        },
        {
            label: "Coins tracked",
            value: coinStats.state === "ready" ? String(coinStats.coinsTracked) : "—",
            detail:
                coinStats.state === "ready"
                    ? `${coinStats.totalRecords} total records`
                    : "watchlist + barkd",
            accent: false,
        },
        {
            label: "Value needing review",
            value: coinStats.state === "ready" ? formatSats(coinStats.value) : "—",
            detail: coinStats.state === "ready" ? `across ${coinStats.reviewCount} outputs` : "—",
            accent: coinStats.state === "ready" && coinStats.value > 0,
        },
    ];

    return (
        <Panel
            title="Exit outlook"
            subtitle="Observed unspent VTXOs by expiry · exit window shaded"
            className="self-start"
        >
            <div className="px-4 pb-4 pt-3">
                {/* 31-day ruler: one fixed-geometry SVG (viewBox 320×96).
                    x(d) = 16 + (d/31)·288; axis y=64; dots sit just above it. */}
                {(() => {
                    const X = (d: number) => 16 + (d / RULER_DAYS) * 288;
                    const arkW =
                        arkExitDays !== null ? Math.min(RULER_DAYS, Math.max(0, arkExitDays)) : 0;
                    const secW =
                        secondExitDays !== null
                            ? Math.min(RULER_DAYS, Math.max(0, secondExitDays))
                            : 0;
                    return (
                        <>
                            <div className="relative">
                                <svg
                                    viewBox="0 0 320 96"
                                    className="block h-auto w-full"
                                    role="img"
                                    aria-label="Exit outlook ruler: observed VTXOs by days until expiry"
                                >
                                    <defs>
                                        <pattern
                                            id="exit-hatch"
                                            width={6}
                                            height={6}
                                            patternUnits="userSpaceOnUse"
                                            patternTransform="rotate(45)"
                                        >
                                            <line
                                                x1={3}
                                                x2={3}
                                                y2={6}
                                                stroke="hsl(var(--destructive))"
                                                strokeWidth={1.5}
                                                opacity={0.45}
                                            />
                                        </pattern>
                                    </defs>

                                    {/* Arkade exit window: hatched band + boundary + label */}
                                    {arkExitDays !== null && arkExitDays > 0 && (
                                        <>
                                            <rect
                                                x={X(0)}
                                                y={12}
                                                width={X(arkW) - X(0)}
                                                height={52}
                                                fill="url(#exit-hatch)"
                                            />
                                            <line
                                                x1={X(arkW)}
                                                y1={12}
                                                x2={X(arkW)}
                                                y2={64}
                                                stroke="hsl(var(--destructive))"
                                                strokeOpacity={0.6}
                                                strokeWidth={1}
                                            />
                                            <text
                                                x={X(0) + 4}
                                                y={24}
                                                fontSize={12}
                                                fill="hsl(var(--destructive))"
                                                textAnchor="start"
                                            >
                                                {`exit window ≤${arkExitDays.toFixed(0)} d`}
                                            </text>
                                        </>
                                    )}

                                    {/* Second exit delta: derived from server info,
                                        omitted entirely when unknown — never a
                                        hardcoded 1-day band. */}
                                    {secondExitDays !== null && secondExitDays > 0 && (
                                        <rect
                                            x={X(0)}
                                            y={58}
                                            width={X(secW) - X(0)}
                                            height={6}
                                            fill="hsl(var(--chain))"
                                            fillOpacity={0.5}
                                        />
                                    )}

                                    {/* axis + ticks + day labels */}
                                    <line
                                        x1={X(0)}
                                        y1={64}
                                        x2={X(RULER_DAYS)}
                                        y2={64}
                                        className="stroke-line-strong"
                                        strokeWidth={1}
                                    />
                                    {[0, 7, 14, 21, 28].map((d) => (
                                        <g key={d}>
                                            <line
                                                x1={X(d)}
                                                y1={64}
                                                x2={X(d)}
                                                y2={68}
                                                className="stroke-line-strong"
                                                strokeWidth={1}
                                            />
                                            <text
                                                x={X(d)}
                                                y={80}
                                                fontSize={12}
                                                textAnchor="middle"
                                                className="fill-faint"
                                            >
                                                {d}d
                                            </text>
                                        </g>
                                    ))}

                                    {/* empty state */}
                                    {dots.length === 0 && (
                                        <text
                                            x={160}
                                            y={44}
                                            textAnchor="middle"
                                            fontSize={12}
                                            className="fill-faint"
                                        >
                                            nothing to plot
                                        </text>
                                    )}
                                </svg>

                                {/* dots overlaid on the SVG, clickable */}
                                {dots.map((dot) => {
                                    // cy = 64 − r − 2 in viewBox units → % of 96 height
                                    const cyPct = ((64 - dot.radius - 2) / 96) * 100;
                                    // dot width as % of the 320-wide box (aspect-ratio keeps it square)
                                    const sizePct = ((dot.radius * 2) / 320) * 100;
                                    return (
                                        <button
                                            key={dot.key}
                                            type="button"
                                            onClick={() => onInspect(dot.record.id)}
                                            className={cn(
                                                "absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full opacity-90 transition-transform hover:scale-125",
                                                DOT_CLASS[dot.state],
                                            )}
                                            style={{
                                                left: `${dot.xPct}%`,
                                                top: `${cyPct}%`,
                                                width: `${sizePct}%`,
                                                aspectRatio: "1 / 1",
                                            }}
                                            title={`${dot.record.label} · ${satsShort(dot.record.amountSat)} · ${dot.record.expiresAtSeconds !== null ? `expires in ${until(dot.record.expiresAtSeconds, nowSec)}` : dot.record.leftSeconds !== null ? `≈${formatDuration(dot.record.leftSeconds)} left (height-based)` : "expiry unknown"}`}
                                            aria-label={`${dot.record.label}, ${dot.record.expiresAtSeconds !== null ? `expires in ${until(dot.record.expiresAtSeconds, nowSec)}` : dot.record.leftSeconds !== null ? `approximately ${formatDuration(dot.record.leftSeconds)} left` : "expiry unknown"}`}
                                        />
                                    );
                                })}
                            </div>

                            {/* caption + legend below the SVG */}
                            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-faint">
                                <span>days until expiry →</span>
                                {arkExitDays !== null && arkExitDays > 0 && (
                                    <span
                                        className="inline-flex items-center gap-1 text-alert"
                                        title="Unilateral exit delay from /v1/info — the last stretch of remaining lifetime where an exit may not confirm in time. Not a guarantee of safety."
                                    >
                                        <i className="inline-block h-2 w-3 rounded-sm border border-alert/40 bg-alert/15" />
                                        {`Arkade exit window ≈${arkExitDays.toFixed(0)} d`}
                                    </span>
                                )}
                                {secondExitDays !== null && secondExitDays > 0 ? (
                                    <span
                                        className="inline-flex items-center gap-1 text-chain"
                                        title="Second vtxo_exit_delta in blocks × nominal 600 s/block — an estimate. Second has no public VTXO index."
                                    >
                                        <i className="inline-block h-2 w-3 rounded-sm border border-chain/40 bg-chain/15" />
                                        {`Second exit delta ≈${secondExitDays.toFixed(1)} d · no public VTXO index`}
                                    </span>
                                ) : (
                                    <span className="text-faint">
                                        Second exit delta unknown · no public VTXO index
                                    </span>
                                )}
                            </div>
                        </>
                    );
                })()}

                {/* renew list */}
                <ul className="mt-2 space-y-1">
                    {renews.length === 0 ? (
                        <li className="border-t border-border py-2 text-xs text-faint">
                            {coinStats.state === "unconfigured"
                                ? "No coins configured — add scripts to the watchlist or connect barkd."
                                : "No observed VTXOs in the exit window."}
                        </li>
                    ) : (
                        renews.slice(0, 6).map((record) => (
                            <li
                                key={record.id}
                                className="flex items-center gap-2 border-t border-border py-1.5"
                            >
                                <Tag tone="alert">renew</Tag>
                                <button
                                    type="button"
                                    onClick={() => onInspect(record.id)}
                                    className="min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground hover:text-virt"
                                >
                                    {record.txid.slice(0, 10)}…{record.txid.slice(-6)}
                                </button>
                                <span className="font-mono text-xs text-muted-foreground">
                                    {satsShort(record.amountSat)}
                                </span>
                                <span className="font-mono text-xs text-faint">
                                    {record.expiresAtSeconds !== null
                                        ? until(record.expiresAtSeconds, nowSec)
                                        : record.leftSeconds !== null
                                          ? `≈${formatDuration(record.leftSeconds)}`
                                          : "—"}
                                </span>
                            </li>
                        ))
                    )}
                    {renews.length > 6 && (
                        <li className="pt-1 text-xs text-faint">
                            … and {renews.length - 6} more in the exit window
                        </li>
                    )}
                </ul>

                {/* folded Your-coins stats */}
                <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-3">
                    {statCards.map((card) => (
                        <div key={card.label} className="min-w-0">
                            <MicroLabel>{card.label}</MicroLabel>
                            <p
                                className={cn(
                                    "mt-0.5 truncate text-lg font-semibold tabular-nums",
                                    card.accent ? "text-alert" : "text-foreground",
                                )}
                            >
                                {card.value}
                            </p>
                            <p className="truncate text-xs text-faint">{card.detail}</p>
                        </div>
                    ))}
                </div>
                {coinStats.state === "unconfigured" && (
                    <Link
                        to="/watchlist"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary"
                    >
                        Manage watchlist →
                    </Link>
                )}
            </div>
        </Panel>
    );
}
