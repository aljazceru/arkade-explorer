import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import {
    type ArkadeObservation,
    type BarkObservation,
    formatDuration,
    formatSats,
    loadObservation,
    truncateId,
} from "@/lib/observation";
import { cn } from "@/lib/utils";

type Tab = "arkade" | "bark" | "both";

function Card({
    title,
    subtitle,
    children,
    className,
}: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}
        >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                {subtitle && (
                    <span className="text-[11px] text-muted-foreground font-mono truncate">
                        {subtitle}
                    </span>
                )}
            </div>
            <div className="p-4">{children}</div>
        </section>
    );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-sm font-mono text-foreground break-all mt-0.5">{value}</div>
        </div>
    );
}

function ArkadePanel({ data }: { data: ArkadeObservation }) {
    const info = data.info || {};
    const stats = data.stats_24h || {};
    const urgent = data.vtxos.filter((v) => v.urgent && !v.isSpent);
    const commits = Object.entries(data.commitments || {});

    return (
        <div className="space-y-4" data-testid="arkade-panel">
            <Card title="Arkade — network health" subtitle="arkade.computer/v1/info">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Stat label="Version" value={String(info.version ?? "—")} />
                    <Stat label="Network" value={String(info.network ?? "—")} />
                    <Stat
                        label="Signer"
                        value={truncateId(String(info.signerPubkey ?? ""), 10, 8)}
                    />
                    <Stat
                        label="Unilateral exit delay"
                        value={`${info.unilateralExitDelay} s (~${formatDuration(Number(info.unilateralExitDelay))})`}
                    />
                    <Stat label="Boarding exit delay" value={`${info.boardingExitDelay} s`} />
                    <Stat
                        label="VTXO min / max"
                        value={`${info.vtxoMinAmount} / ${info.vtxoMaxAmount}`}
                    />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                    Snapshot {data.fetched_at}. Live operator params; activity enriched via public
                    indexer + Blockonomics SSE archive.
                </p>
            </Card>

            <Card title="24h network stats" subtitle="arkexplorer.blockonomics.co/api/stats">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Virtual txs" value={String(stats.virtualTxCount ?? "—")} />
                    <Stat
                        label="Virtual volume (BTC)"
                        value={String(stats.virtualTxVolume ?? "—")}
                    />
                    <Stat label="Onboarding (BTC)" value={String(stats.onboardingVolume ?? "—")} />
                    <Stat label="Liquidity (BTC)" value={String(stats.networkLiquidity ?? "—")} />
                </div>
            </Card>

            <Card
                title={`Live VTXOs (${data.vtxos.length}) — ${urgent.length} URGENT`}
                subtitle="arkade.computer/v1/indexer/vtxos"
            >
                {urgent.length > 0 && (
                    <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-600/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>
                            {urgent.length} spendable VTXO(s) within the unilateral exit delay
                            window. Renew or exit on-chain.
                        </span>
                    </div>
                )}
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                                <th className="py-2 pr-2">Type</th>
                                <th className="py-2 pr-2">Outpoint</th>
                                <th className="py-2 pr-2 text-right">Amount</th>
                                <th className="py-2 pr-2 text-right">Time left</th>
                                <th className="py-2">Commitment</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.vtxos.map((v) => (
                                <tr
                                    key={`${v.txid}:${v.vout}`}
                                    className={cn(
                                        "border-b border-border/60",
                                        v.urgent && !v.isSpent && "bg-red-500/10",
                                    )}
                                    data-expiry-urgency={
                                        v.expired ? "expired" : v.urgent ? "urgent" : "ok"
                                    }
                                >
                                    <td className="py-2 pr-2">{v.txType || "—"}</td>
                                    <td className="py-2 pr-2 font-mono">
                                        <a
                                            className="hover:text-primary"
                                            href={`https://mempool.space/tx/${v.txid}`}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {truncateId(v.txid)}:{v.vout}
                                        </a>
                                        {v.isSpent && (
                                            <span className="ml-1 text-muted-foreground">
                                                spent
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-2 pr-2 text-right font-mono">
                                        {formatSats(v.amount_sat)}
                                    </td>
                                    <td className="py-2 pr-2 text-right font-mono">
                                        {v.urgent && !v.isSpent && (
                                            <span className="mr-1 inline-flex items-center rounded bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 uppercase">
                                                Urgent
                                            </span>
                                        )}
                                        {v.expired
                                            ? "Expired"
                                            : `~${formatDuration(v.left_seconds)}`}
                                    </td>
                                    <td className="py-2 font-mono">
                                        {v.commitmentTxids?.[0] ? (
                                            <a
                                                className="hover:text-primary inline-flex items-center gap-1"
                                                href={`https://mempool.space/tx/${v.commitmentTxids[0]}`}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                {truncateId(v.commitmentTxids[0], 6, 6)}
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        ) : (
                                            "—"
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <Card
                title={`Commitment batches (${commits.length})`}
                subtitle="indexer + mempool.space"
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                                <th className="py-2 pr-2">Commitment tx</th>
                                <th className="py-2 pr-2 text-right">Out VTXOs</th>
                                <th className="py-2 pr-2 text-right">Out amount</th>
                                <th className="py-2 pr-2 text-right">On-chain</th>
                            </tr>
                        </thead>
                        <tbody>
                            {commits.map(([txid, c]) => {
                                const on = (c._onchain || {}) as Record<string, unknown>;
                                return (
                                    <tr key={txid} className="border-b border-border/60">
                                        <td className="py-2 pr-2 font-mono">
                                            <a
                                                href={`https://mempool.space/tx/${txid}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="hover:text-primary"
                                            >
                                                {truncateId(txid)}
                                            </a>
                                        </td>
                                        <td className="py-2 pr-2 text-right font-mono">
                                            {String(c.totalOutputVtxos ?? "—")}
                                        </td>
                                        <td className="py-2 pr-2 text-right font-mono">
                                            {formatSats(Number(c.totalOutputAmount ?? 0))}
                                        </td>
                                        <td className="py-2 pr-2 text-right font-mono">
                                            {on.block_height
                                                ? `block ${on.block_height}`
                                                : String(c.error || on.block_height || "—")}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>

            <p className="text-[11px] text-muted-foreground space-y-1">
                {data.notes?.map((n) => (
                    <span key={n} className="block">
                        {n}
                    </span>
                ))}
            </p>
        </div>
    );
}

function BarkPanel({ data }: { data: BarkObservation }) {
    const info = data.info || {};
    const nextIn =
        data.next_round_unix != null ? data.next_round_unix - Math.floor(Date.now() / 1000) : null;

    return (
        <div className="space-y-4" data-testid="bark-panel">
            <Card
                title="Second (bark/captaind) — network health"
                subtitle="ark.second.tech gRPC-web"
            >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Stat label="Network" value={info.network ?? "—"} />
                    <Stat
                        label="Server pubkey"
                        value={truncateId(info.server_pubkey || "", 10, 8)}
                    />
                    <Stat label="Round interval" value={`${info.round_interval_secs ?? "—"} s`} />
                    <Stat
                        label="VTXO lifetime"
                        value={`${info.vtxo_lifetime ?? "—"} blocks (~${formatDuration((info.vtxo_lifetime || 0) * 600)})`}
                    />
                    <Stat label="Exit delta" value={`${info.vtxo_exit_delta ?? "—"} blocks`} />
                    <Stat
                        label="Board min / VTXO max"
                        value={`${info.min_board_amount ?? "—"} / ${info.max_vtxo_amount ?? "—"}`}
                    />
                    <Stat
                        label="Next round"
                        value={
                            data.next_round_rome
                                ? `${data.next_round_rome} (in ${formatDuration(nextIn)})`
                                : "—"
                        }
                    />
                    <Stat
                        label="Last round event"
                        value={
                            data.last_round_event
                                ? `${data.last_round_event.kind}${data.last_round_event.round_seq != null ? ` #${data.last_round_event.round_seq}` : ""}`
                                : "—"
                        }
                    />
                    <Stat
                        label="ToS"
                        value={
                            info.tos_link ? (
                                <a
                                    href={String(info.tos_link)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary"
                                >
                                    second.tech/terms
                                </a>
                            ) : (
                                "—"
                            )
                        }
                    />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                    Snapshot {data.fetched_at}. Params from GetArkInfo / NextRoundTime (captaind).
                    Data credited to Second.
                </p>
            </Card>

            <Card title="24h on-chain activity at server P2TR" subtitle={data.source?.server_p2tr}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <Stat label="Txs" value={String(data.stats_24h?.tx_count ?? 0)} />
                    <Stat
                        label="Total out value"
                        value={formatSats(data.stats_24h?.total_sats_out ?? 0)}
                    />
                    <Stat label="To server" value={String(data.stats_24h?.to_server ?? 0)} />
                    <Stat label="From server" value={String(data.stats_24h?.from_server ?? 0)} />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                                <th className="py-2 pr-2">When (Rome)</th>
                                <th className="py-2 pr-2">Tx</th>
                                <th className="py-2 pr-2">Dir</th>
                                <th className="py-2 pr-2 text-right">In/Out</th>
                                <th className="py-2 text-right">Sats</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.recent_server_txs.slice(0, 20).map((t) => (
                                <tr key={t.txid} className="border-b border-border/60">
                                    <td className="py-2 pr-2 font-mono whitespace-nowrap">
                                        {t.block_time_rome?.replace("+02:00", "") || "—"}
                                    </td>
                                    <td className="py-2 pr-2 font-mono">
                                        <a
                                            href={t.mempool_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="hover:text-primary"
                                        >
                                            {truncateId(t.txid)}
                                        </a>
                                    </td>
                                    <td className="py-2 pr-2">{t.direction}</td>
                                    <td className="py-2 pr-2 text-right font-mono">
                                        {t.vin}/{t.vout}
                                    </td>
                                    <td className="py-2 text-right font-mono">
                                        {formatSats(t.total_sats)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <p className="text-[11px] text-muted-foreground space-y-1">
                {data.notes?.map((n) => (
                    <span key={n} className="block">
                        {n}
                    </span>
                ))}
                <span className="block">
                    Second does not publish a public VTXO-by-address index (privacy).
                    Paste-your-VTXO countdown is skipped for this PoC.
                </span>
            </p>
        </div>
    );
}

export function ObservationDashboard() {
    const [tab, setTab] = useState<Tab>("both");
    const [arkade, setArkade] = useState<ArkadeObservation | null>(null);
    const [bark, setBark] = useState<BarkObservation | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const reload = async () => {
        setLoading(true);
        setError(null);
        try {
            const [a, b] = await Promise.all([
                loadObservation<ArkadeObservation>("arkade"),
                loadObservation<BarkObservation>("bark"),
            ]);
            setArkade(a);
            setBark(b);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    const subtitle = useMemo(() => {
        if (!arkade && !bark) return "";
        return `Arkade ${arkade?.fetched_at ?? "—"} · Second ${bark?.fetched_at ?? "—"}`;
    }, [arkade, bark]);

    return (
        <div className="space-y-4" data-testid="observation-dashboard">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold inline-flex items-center gap-2">
                        <Activity className="h-5 w-5" /> Observation
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Side-by-side mainnet view of Arkade and Second&apos;s bark/captaind — live
                        public data only.
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-1">{subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                    {(["arkade", "bark", "both"] as Tab[]).map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setTab(t)}
                            className={cn(
                                "px-3 py-1.5 rounded-lg text-sm border border-border",
                                tab === t
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-secondary text-foreground hover:bg-secondary/80",
                            )}
                            data-testid={`tab-${t}`}
                        >
                            {t === "both" ? "Both" : t === "arkade" ? "Arkade" : "Second (bark)"}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => void reload()}
                        className="p-2 rounded-lg border border-border hover:bg-secondary"
                        aria-label="Reload snapshots"
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-lg border border-red-600/40 bg-red-500/10 px-3 py-2 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className={cn("grid gap-6", tab === "both" ? "lg:grid-cols-2" : "grid-cols-1")}>
                {(tab === "arkade" || tab === "both") && (
                    <div>
                        {arkade ? (
                            <ArkadePanel data={arkade} />
                        ) : (
                            <p className="text-sm">Loading Arkade…</p>
                        )}
                    </div>
                )}
                {(tab === "bark" || tab === "both") && (
                    <div>
                        {bark ? (
                            <BarkPanel data={bark} />
                        ) : (
                            <p className="text-sm">Loading Second…</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
