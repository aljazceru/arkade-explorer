import { useState } from "react";
import { ArrowUpRight, ChevronDown, LoaderCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useLiveSecond } from "@/hooks/use-live-second";
import { useBarkd } from "@/hooks/use-barkd";
import { useNow } from "@/hooks/use-expiry";
import { formatSats } from "@/lib/observation";
import { Panel } from "@/components/atlas/panel";
import { middleTruncate } from "@/components/atlas/hash";
import { cn } from "@/lib/utils";

/**
 * About this data — the old SourcesSection restyled as an Atlas Panel
 * disclosure. Keeps `id="sources"`, the 30s NextRound tick, and the source
 * status dots. Content is ported verbatim where it carries meaning.
 */

function SourceStatus({ status }: { status: "live" | "loading" | "error" }) {
    if (status === "loading") {
        return (
            <span className="micro inline-flex items-center gap-1.5 text-faint">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Checking
            </span>
        );
    }
    if (status === "error") {
        return (
            <span className="micro inline-flex items-center gap-1.5 text-alert">
                <span className="h-2 w-2 rounded-full bg-alert" aria-hidden="true" />
                Unavailable
            </span>
        );
    }
    return (
        <span className="micro inline-flex items-center gap-1.5 text-ok">
            <span className="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
            Live
        </span>
    );
}

function SecondSourceStatus({ status }: { status: "live" | "loading" | "error" }) {
    if (status === "loading") return null;
    const isError = status === "error";
    return (
        <span
            className={cn(
                "micro inline-flex items-center gap-1.5",
                isError ? "text-alert" : "text-ok",
            )}
        >
            <span
                className={cn("h-2 w-2 rounded-full", isError ? "bg-alert" : "bg-ok")}
                aria-hidden="true"
            />
            {isError ? "Unavailable" : "Live"}
        </span>
    );
}

function NextRound({ nextRoundAt }: { nextRoundAt: number | null }) {
    const nowMs = useNow(30_000);
    const valid = nextRoundAt !== null && Number.isFinite(nextRoundAt) ? nextRoundAt : null;
    const rawSeconds = valid === null ? null : Math.floor(valid - nowMs / 1000);
    const secondsUntil = rawSeconds !== null && rawSeconds > 0 ? rawSeconds : null;
    const hours = secondsUntil === null ? null : Math.floor(secondsUntil / 3600);
    const minutes = secondsUntil === null ? null : Math.floor((secondsUntil % 3600) / 60);

    return (
        <div className="mt-4 rounded-lg border border-border bg-secondary/50 px-3 py-2">
            <p className="text-sm font-medium text-foreground">
                Next Second round ·{" "}
                {valid === null
                    ? "schedule unavailable"
                    : secondsUntil === null
                      ? "announced time passed · awaiting update"
                      : `in ~${hours}h ${minutes}m`}
            </p>
            {valid !== null && secondsUntil !== null && (
                <p className="mt-0.5 text-[11px] text-faint">
                    server-announced start · rounds can be delayed or skipped
                </p>
            )}
        </div>
    );
}

function snapshotAgeMinutes(fetchedAt: string | null, now = Date.now()): number | null {
    if (!fetchedAt) return null;
    const timestamp = Date.parse(fetchedAt);
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.floor((now - timestamp) / 60_000));
}

function snapshotAgeLabel(ageMinutes: number): string {
    if (ageMinutes < 1) return "just now";
    const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    if (ageMinutes < 120) return relative.format(-ageMinutes, "minute");
    if (ageMinutes < 2880) return relative.format(-Math.floor(ageMinutes / 60), "hour");
    return relative.format(-Math.floor(ageMinutes / 1440), "day");
}

function DetailsChevron({ open }: { open: boolean }) {
    return (
        <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-180")}
            aria-hidden="true"
        />
    );
}

export function AboutData({
    arkadeConfigured,
    arkadeLoading,
    arkadeError,
    secondLoading,
    secondError,
    serverInfoStatus,
    serverInfoError,
    snapshotFetchedAt,
}: {
    arkadeConfigured: boolean;
    arkadeLoading: boolean;
    arkadeError: Error | null;
    secondLoading: boolean;
    secondError: Error | null;
    serverInfoStatus: "live" | "loading" | "error";
    serverInfoError: Error | null;
    snapshotFetchedAt: string | null;
}) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const barkd = useBarkd();
    const liveSecond = useLiveSecond();
    const secondErrorToShow = liveSecond.error ?? secondError;
    const arkadeStatus =
        arkadeLoading || serverInfoStatus === "loading"
            ? "loading"
            : arkadeError || serverInfoError || serverInfoStatus === "error"
              ? "error"
              : "live";
    const secondStatus = secondErrorToShow
        ? "error"
        : liveSecond.isLoading || secondLoading
          ? "loading"
          : "live";
    const liveInfo = liveSecond.info;
    const serverTxs = liveSecond.serverTxs;
    const ageMinutes = snapshotAgeMinutes(snapshotFetchedAt);
    const snapshotStale = ageMinutes !== null && ageMinutes > 60;

    return (
        <Panel id="sources" className="overflow-visible" bodyClassName="p-0">
            <details
                className="group"
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50 sm:px-5">
                    <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-foreground">
                            About this data
                        </span>
                        <span
                            className={cn(
                                "micro mt-1 inline-flex items-center rounded-full border px-2 py-0.5",
                                snapshotStale
                                    ? "border-warning/40 bg-warning/10 text-warning"
                                    : "border-border bg-secondary/50 text-muted-foreground",
                            )}
                        >
                            {ageMinutes === null
                                ? "Snapshot unavailable"
                                : `Snapshot updated ${snapshotAgeLabel(ageMinutes)}`}
                        </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                        <span
                            className={cn(
                                "h-2 w-2 rounded-full",
                                arkadeStatus === "live"
                                    ? "bg-ok"
                                    : arkadeStatus === "error"
                                      ? "bg-alert"
                                      : "bg-faint",
                            )}
                            role="img"
                            aria-label={`Arkade source ${arkadeStatus}`}
                        />
                        <span
                            className={cn(
                                "h-2 w-2 rounded-full",
                                secondStatus === "live"
                                    ? "bg-ok"
                                    : secondStatus === "error"
                                      ? "bg-alert"
                                      : "bg-faint",
                            )}
                            role="img"
                            aria-label={`Second source ${secondStatus}`}
                        />
                        <DetailsChevron open={detailsOpen} />
                    </span>
                </summary>
                <div className="space-y-4 border-t border-border px-4 py-4 sm:px-5">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        Network stats and the Arkade activity backfill come from a periodic
                        snapshot; its age is shown above. Operator parameters and Second round
                        timing are fetched live.
                    </p>
                    <div className="grid gap-3 lg:grid-cols-2">
                        <article className="rounded-lg border border-border bg-card p-4">
                            <header className="flex items-center gap-3">
                                <span
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground"
                                    aria-hidden="true"
                                >
                                    A
                                </span>
                                <h3 className="text-base font-semibold text-foreground">Arkade</h3>
                                <div className="ml-auto">
                                    <SourceStatus status={arkadeStatus} />
                                </div>
                            </header>
                            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                Operator parameters come from live{" "}
                                <code className="rounded bg-secondary px-1 py-0.5 text-foreground">
                                    /v1/info
                                </code>
                                ; VTXO data is queried from{" "}
                                <code className="rounded bg-secondary px-1 py-0.5 text-foreground">
                                    /v1/indexer/vtxos
                                </code>{" "}
                                for configured watchlist scripts. No browser-usable global VTXO
                                listing is available.
                            </p>
                            <p className="mt-3 text-xs font-medium text-foreground">
                                {arkadeConfigured
                                    ? "Watchlist scripts configured for live VTXO lookup."
                                    : "No watchlist scripts configured for live VTXO lookup."}
                            </p>
                            {arkadeError && (
                                <div
                                    role="alert"
                                    className="mt-3 rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
                                >
                                    <span className="font-medium">
                                        Arkade activity source unavailable.
                                    </span>{" "}
                                    {arkadeError.message}
                                </div>
                            )}
                            {serverInfoError && (
                                <div
                                    role="alert"
                                    className="mt-3 rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
                                >
                                    <span className="font-medium">
                                        Arkade /v1/info unavailable.
                                    </span>{" "}
                                    {serverInfoError.message}
                                    <p className="mt-1 text-xs">
                                        Live exit-delay data is unavailable.
                                    </p>
                                </div>
                            )}
                        </article>
                        <article className="rounded-lg border border-border bg-card p-4">
                            <header className="flex items-center gap-3">
                                <span
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground"
                                    aria-hidden="true"
                                >
                                    S
                                </span>
                                <h3 className="text-base font-semibold text-foreground">Second</h3>
                                {barkd.connected && (
                                    <span className="micro inline-flex items-center gap-1.5 text-ok">
                                        <span
                                            className="h-2 w-2 rounded-full bg-ok"
                                            aria-hidden="true"
                                        />
                                        barkd connected · live VTXOs
                                    </span>
                                )}
                                <div className="ml-auto">
                                    <SecondSourceStatus status={secondStatus} />
                                </div>
                            </header>
                            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                Server parameters and round timing come from Second gRPC-web.
                                On-chain transactions are fetched from Esplora at the configured
                                server address; these transactions are not individual VTXOs and do
                                not establish spendability.
                            </p>
                            <p className="mt-3 text-xs text-muted-foreground">
                                Server wallet address (derived from server_pubkey):{" "}
                                <span className="font-medium text-foreground">
                                    {liveSecond.serverAddress ?? "Not configured"}
                                </span>
                            </p>
                            {liveInfo && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                    Exit delta:{" "}
                                    {liveInfo.exitDeltaBlocks !== null
                                        ? `${liveInfo.exitDeltaBlocks} blocks (≈${Math.round((liveInfo.exitDeltaBlocks * 600) / 3600)}h at nominal 600s/block)`
                                        : "unknown"}{" "}
                                    · VTXO lifetime:{" "}
                                    {liveInfo.vtxoLifetimeBlocks !== null
                                        ? `${liveInfo.vtxoLifetimeBlocks} blocks (≈${((liveInfo.vtxoLifetimeBlocks * 600) / 86400).toFixed(0)}d nominal)`
                                        : "unknown"}
                                </p>
                            )}
                            {serverTxs && (
                                <div className="mt-3 space-y-2">
                                    <p className="text-xs font-medium text-foreground">
                                        Recent server-wallet transactions ({serverTxs.length})
                                    </p>
                                    {serverTxs.slice(0, 3).map((tx) => (
                                        <div
                                            key={tx.txid}
                                            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                                        >
                                            <span className="font-medium text-foreground">
                                                {tx.direction === "to_server"
                                                    ? "→ server addr"
                                                    : tx.direction === "from_server"
                                                      ? "← server addr"
                                                      : "server addr"}
                                            </span>
                                            <code>{middleTruncate(tx.txid, 8, 8)}</code>
                                            <span>{formatSats(tx.totalSats)}</span>
                                        </div>
                                    ))}
                                    {serverTxs.length === 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            No recent server transactions found.
                                        </p>
                                    )}
                                </div>
                            )}
                            <NextRound nextRoundAt={liveSecond.nextRoundAt} />
                            {secondErrorToShow && (
                                <div
                                    role="alert"
                                    className="mt-3 rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
                                >
                                    <span className="font-medium">
                                        Some live Second data is unavailable.
                                    </span>{" "}
                                    {secondErrorToShow.message}
                                </div>
                            )}
                        </article>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                        <article className="rounded-lg border border-border bg-card p-4">
                            <h3 className="text-sm font-semibold text-foreground">
                                What “needs review” means
                            </h3>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                Review flags are derived from expiry evidence and the reported exit
                                delay; they are not a verdict from the indexer. Missing expiry or
                                exit-delay evidence stays unknown, and swept outputs require
                                operator cooperation. These warnings do not guarantee there is
                                enough time or funding to complete an exit.
                            </p>
                        </article>
                        <article className="rounded-lg border border-border bg-card p-4">
                            <h3 className="text-sm font-semibold text-foreground">
                                Virtual outputs vs. batch commitments
                            </h3>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                Commitment transactions anchor batches on Bitcoin. The displayed
                                batch amount covers registered off-chain receivers, not all tree
                                outputs, operator fees or Bitcoin change. Confirmation of a
                                commitment does not prove an individual output is spendable.
                            </p>
                        </article>
                    </div>
                    <Link
                        to="/observe"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-virt hover:underline"
                    >
                        Full observation dashboard{" "}
                        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                </div>
            </details>
        </Panel>
    );
}
