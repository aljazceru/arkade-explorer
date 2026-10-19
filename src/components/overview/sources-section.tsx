import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveSecond } from "@/hooks/use-live-second";
import { useBarkd } from "@/hooks/use-barkd";
import { formatSats } from "@/lib/observation";

function SecondSourceStatus({ status }: { status: "live" | "loading" | "error" }) {
    if (status === "loading") return null;
    const isError = status === "error";
    return (
        <span
            className={`inline-flex items-center gap-1.5 text-xs ${isError ? "text-destructive" : "text-success"}`}
        >
            <span
                className={`h-2 w-2 rounded-full ${isError ? "bg-destructive" : "bg-success"}`}
                aria-hidden="true"
            />
            {isError ? "Unavailable" : "Live"}
        </span>
    );
}

function SourceStatus({ status }: { status: "live" | "loading" | "error" }) {
    if (status === "loading") {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Checking
            </span>
        );
    }
    if (status === "error") {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
                <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />
                Unavailable
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-success">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            Live
        </span>
    );
}

function NextRound({ nextRoundAt }: { nextRoundAt: number | null }) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(interval);
    }, []);

    const validNextRoundAt =
        nextRoundAt !== null && Number.isFinite(nextRoundAt) ? nextRoundAt : null;
    const secondsUntil =
        validNextRoundAt === null ? null : Math.max(0, Math.floor(validNextRoundAt - now / 1000));
    const hours = secondsUntil === null ? null : Math.floor(secondsUntil / 3600);
    const minutes = secondsUntil === null ? null : Math.floor((secondsUntil % 3600) / 60);

    return (
        <div className="mt-4 rounded-lg border border-border bg-secondary/50 px-3 py-2">
            <p className="text-sm font-medium text-foreground">
                Next Second round ·{" "}
                {hours === null || minutes === null
                    ? "schedule unavailable"
                    : `in ~${hours}h ${minutes}m`}
            </p>
        </div>
    );
}

export function SourcesSection({
    arkadeConfigured,
    arkadeLoading,
    arkadeError,
    secondLoading,
    secondError,
    serverInfoStatus,
    serverInfoError,
}: {
    arkadeConfigured: boolean;
    arkadeLoading: boolean;
    arkadeError: Error | null;
    secondConfigured: boolean;
    secondLoading: boolean;
    secondError: Error | null;
    serverInfoStatus: "live" | "loading" | "error";
    serverInfoError: Error | null;
}) {
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

    return (
        <section id="sources" aria-labelledby="sources-heading" className="space-y-4">
            <div>
                <h2 id="sources-heading" className="text-xl font-semibold text-foreground">
                    Sources
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Live sources, their coverage, and the limits of the available data.
                </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
                <article className="rounded-xl border border-border bg-card p-5">
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
                        for configured watchlist scripts. No browser-usable global VTXO listing is
                        available.
                    </p>
                    <p className="mt-3 text-xs font-medium text-foreground">
                        {arkadeConfigured
                            ? "Watchlist scripts configured for live VTXO lookup."
                            : "No watchlist scripts configured for live VTXO lookup."}
                    </p>
                    {arkadeError && (
                        <div
                            role="alert"
                            className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                        >
                            <span className="font-medium">Arkade indexer data unavailable.</span>{" "}
                            {arkadeError.message}
                        </div>
                    )}
                    {serverInfoError && (
                        <div
                            role="alert"
                            className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                        >
                            <span className="font-medium">Arkade /v1/info unavailable.</span>{" "}
                            {serverInfoError.message}
                            <p className="mt-1 text-xs">Live exit-delay data is unavailable.</p>
                        </div>
                    )}
                </article>
                <article className="rounded-xl border border-border bg-card p-5">
                    <header className="flex items-center gap-3">
                        <span
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground"
                            aria-hidden="true"
                        >
                            S
                        </span>
                        <h3 className="text-base font-semibold text-foreground">Second</h3>
                        {barkd.connected && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-success">
                                <span
                                    className="h-2 w-2 rounded-full bg-success"
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
                        Server parameters and round timing come from Second gRPC-web. On-chain
                        transactions are fetched from Esplora at the configured server address;
                        these transactions are not individual VTXOs and do not establish
                        spendability.
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                        Server address:{" "}
                        <span className="font-medium text-foreground">
                            {liveSecond.serverAddress ?? "Not configured (VITE_SECOND_SERVER_P2TR)"}
                        </span>
                    </p>
                    {liveInfo && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            Exit delta: {liveInfo.exitDeltaBlocks ?? "—"} blocks · VTXO lifetime:{" "}
                            {liveInfo.vtxoLifetimeBlocks ?? "—"} blocks
                        </p>
                    )}
                    {serverTxs && (
                        <div className="mt-3 space-y-2">
                            <p className="text-xs font-medium text-foreground">
                                Recent on-chain transactions ({serverTxs.length})
                            </p>
                            {serverTxs.slice(0, 3).map((tx) => (
                                <div
                                    key={tx.txid}
                                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
                                >
                                    <span className="font-medium text-foreground">
                                        {tx.direction.replace("_", " ")}
                                    </span>
                                    <code>
                                        {tx.txid.slice(0, 8)}…{tx.txid.slice(-8)}
                                    </code>
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
                            className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
                <article className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold text-foreground">
                        What “needs review” means
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        A VTXO needs review when the live indexer marks it urgent or expired, its
                        remaining time is inside the live unilateral exit window, or remaining
                        expiry is missing. The live exit delay is not always available; unknown
                        expiry evidence never counts as safe.
                    </p>
                </article>
                <article className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold text-foreground">
                        Virtual vs. commitment
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        Virtual outputs live in the protocol. Commitment transactions anchor batches
                        on Bitcoin; confirmation of a commitment does not prove an individual
                        virtual output is spendable.
                    </p>
                </article>
            </div>
            <Link
                to="/observe"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
                Full observation dashboard <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
        </section>
    );
}
