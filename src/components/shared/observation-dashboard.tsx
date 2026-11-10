import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import {
    type ArkadeObservation,
    type BarkObservation,
    formatDuration,
    formatSats,
    loadObservation,
    truncateId,
} from "@/lib/observation";
import { describeTimelock, parseRelativeTimelock } from "@/lib/vtxo-display";
import { cn } from "@/lib/utils";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Segmented } from "@/components/atlas/segmented";
import { Tag } from "@/components/atlas/tag";
import { Term } from "@/components/atlas/term";

type Tab = "arkade" | "bark" | "both";

function Stat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <MicroLabel className="block">{label}</MicroLabel>
            <div className="mt-0.5 break-words font-mono text-[12px] text-foreground">{value}</div>
        </div>
    );
}

function DataTable({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12px]">
                <thead>
                    <tr className="border-b border-border">
                        {head.map((h, i) => (
                            <th key={i} className="px-3 py-2 text-left">
                                <MicroLabel>{h}</MicroLabel>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}

function OperatorPanel({ data }: { data: ArkadeObservation }) {
    const info = data.info || {};
    const stats = data.stats_24h || {};
    const urgent = data.vtxos.filter((v) => v.urgent && !v.isSpent);
    const commits = Object.entries(data.commitments || {});
    const delayLabel = (raw: unknown) => {
        try {
            return describeTimelock(parseRelativeTimelock(raw as bigint | number | string));
        } catch {
            return `${raw ?? "—"} (unparsed)`;
        }
    };

    return (
        <div className="space-y-4" data-testid="arkade-panel">
            <Panel
                title="Operator — network health"
                subtitle={data.source?.info || "operator /v1/info"}
            >
                <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3">
                    <Stat label="Version" value={String(info.version ?? "—")} />
                    <Stat label="Network" value={String(info.network ?? "—")} />
                    <Stat
                        label="Signer"
                        value={truncateId(String(info.signerPubkey ?? ""), 10, 8)}
                    />
                    <Stat
                        label={
                            <>
                                Unilateral exit delay{" "}
                                <Term k="exitWindow" side="bottom">
                                    ?
                                </Term>
                            </>
                        }
                        value={delayLabel(info.unilateralExitDelay)}
                    />
                    <Stat label="Boarding exit delay" value={delayLabel(info.boardingExitDelay)} />
                    <Stat
                        label="VTXO min / max"
                        value={`${info.vtxoMinAmount} / ${info.vtxoMaxAmount}`}
                    />
                </div>
                <p className="border-t border-border px-4 py-2.5 text-[11px] text-faint">
                    Snapshot {data.fetched_at}. Parameters and sampled activity were collected from
                    the public operator indexer and archive; these are not live wallet balances.
                </p>
            </Panel>

            <Panel
                title="Archive-reported 24h metrics"
                subtitle={data.source?.stats || "24h stats"}
            >
                <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
                    <Stat label="Virtual txs" value={String(stats.virtualTxCount ?? "—")} />
                    <Stat
                        label="Virtual volume (BTC)"
                        value={String(stats.virtualTxVolume ?? "—")}
                    />
                    <Stat label="Onboarding (BTC)" value={String(stats.onboardingVolume ?? "—")} />
                    <Stat label="Liquidity (BTC)" value={String(stats.networkLiquidity ?? "—")} />
                </div>
            </Panel>

            <Panel
                title={`Sampled VTXOs (${data.vtxos.length}) — ${urgent.length} urgent at collection`}
                subtitle={data.source?.indexer || "indexer"}
            >
                <div className="space-y-3 p-4">
                    {urgent.length > 0 && (
                        <div className="flex items-start gap-2 rounded-md border border-alert/50 bg-alert/10 px-3 py-2 text-[12.5px] text-alert">
                            <AlertTriangle
                                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                aria-hidden="true"
                            />
                            <span>
                                {urgent.length} sampled, apparently unspent{" "}
                                <Term k="vtxo">VTXO</Term>
                                (s) were inside the reported <Term k="exitWindow">
                                    exit window
                                </Term>{" "}
                                at collection. Recheck current status before renewing or exiting.
                            </span>
                        </div>
                    )}
                    <DataTable
                        head={[
                            "Type",
                            "Outpoint",
                            "Amount",
                            "Remaining at collection",
                            "Commitment",
                        ]}
                    >
                        {data.vtxos.map((v) => (
                            <tr
                                key={`${v.txid}:${v.vout}`}
                                className={cn(
                                    "border-b border-border/60 last:border-b-0 hover:bg-secondary/40",
                                    v.urgent && !v.isSpent && "bg-alert/10",
                                )}
                                data-expiry-urgency={
                                    v.expired ? "expired" : v.urgent ? "urgent" : "ok"
                                }
                            >
                                <td className="px-3 py-2">{v.txType || "—"}</td>
                                <td className="px-3 py-2 font-mono">
                                    <a
                                        className="text-virt underline-offset-2 hover:underline"
                                        href={`https://mempool.space/tx/${v.txid}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {truncateId(v.txid)}:{v.vout}
                                    </a>
                                    {v.isSpent && <span className="ml-1 text-faint">spent</span>}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                    {formatSats(v.amount_sat)}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                    {v.urgent && !v.isSpent && (
                                        <Tag tone="alert" className="mr-1">
                                            urgent
                                        </Tag>
                                    )}
                                    {v.expired ? "Expired" : `~${formatDuration(v.left_seconds)}`}
                                </td>
                                <td className="px-3 py-2 font-mono">
                                    {v.commitmentTxids?.[0] ? (
                                        <a
                                            className="inline-flex items-center gap-1 text-virt underline-offset-2 hover:underline"
                                            href={`https://mempool.space/tx/${v.commitmentTxids[0]}`}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            {truncateId(v.commitmentTxids[0], 6, 6)}
                                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                        </a>
                                    ) : (
                                        "—"
                                    )}
                                </td>
                            </tr>
                        ))}
                    </DataTable>
                </div>
            </Panel>

            <Panel
                title={`Commitment batches (${commits.length})`}
                subtitle="indexer + mempool.space"
            >
                <DataTable
                    head={["Commitment tx", "Registered receivers", "Receiver value", "On-chain"]}
                >
                    {commits.map(([txid, c]) => {
                        const on = (c._onchain || {}) as Record<string, unknown>;
                        return (
                            <tr
                                key={txid}
                                className="border-b border-border/60 last:border-b-0 hover:bg-secondary/40"
                            >
                                <td className="px-3 py-2 font-mono">
                                    <a
                                        href={`https://mempool.space/tx/${txid}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-virt underline-offset-2 hover:underline"
                                    >
                                        {truncateId(txid)}
                                    </a>
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                    {String(c.totalOutputVtxos ?? "—")}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                    {formatSats(Number(c.totalOutputAmount ?? 0))}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                    {on.block_height
                                        ? `block ${on.block_height}`
                                        : String(c.error || on.block_height || "—")}
                                </td>
                            </tr>
                        );
                    })}
                </DataTable>
            </Panel>

            <div className="space-y-1 px-1">
                {data.notes?.map((n) => (
                    <p key={n} className="text-[11px] leading-relaxed text-faint">
                        {n}
                    </p>
                ))}
            </div>
        </div>
    );
}

function BarkPanel({ data }: { data: BarkObservation }) {
    const info = data.info || {};
    // Tick every second so the next-round countdown stays live.
    const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        const id = setInterval(() => setNowUnix(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(id);
    }, []);
    // The snapshot's next-round time is a single reported instant. Once it
    // has passed we do NOT project forward by the configured interval — the
    // server may delay, skip, or reschedule rounds (docs allow flexible
    // scheduling), so an interval-derived "next" would be fabricated. Show
    // the reported timestamp and mark it stale instead.
    const nextRoundPassed = data.next_round_unix != null && data.next_round_unix <= nowUnix;

    return (
        <div className="space-y-4" data-testid="bark-panel">
            <Panel title="Second — network health" subtitle="ark.second.tech gRPC-web">
                <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3">
                    <Stat label="Network" value={info.network ?? "—"} />
                    <Stat
                        label="Server pubkey"
                        value={truncateId(info.server_pubkey || "", 10, 8)}
                    />
                    <Stat
                        label="Round interval"
                        value={`${info.round_interval_secs ?? "—"} s (config; schedule not guaranteed)`}
                    />
                    <Stat
                        label="VTXO lifetime"
                        value={`${info.vtxo_lifetime ?? "—"} blocks (≈${formatDuration((info.vtxo_lifetime || 0) * 600)} at ~10 min/blk)`}
                    />
                    <Stat
                        label="Exit delta"
                        value={`${info.vtxo_exit_delta ?? "—"} blocks (≈${formatDuration((info.vtxo_exit_delta || 0) * 600)})`}
                    />
                    <Stat
                        label="Board min / VTXO max"
                        value={`${info.min_board_amount ?? "—"} / ${info.max_vtxo_amount ?? "—"}`}
                    />
                    <Stat
                        label="Next round"
                        value={
                            data.next_round_rome ? (
                                <span>
                                    {data.next_round_rome}{" "}
                                    {nextRoundPassed ? (
                                        <span className="text-faint">
                                            (reported round time passed; current next round
                                            unavailable in this snapshot)
                                        </span>
                                    ) : (
                                        <span className="text-chain">
                                            (≈ in{" "}
                                            {formatDuration(
                                                (data.next_round_unix ?? nowUnix) - nowUnix,
                                            )}
                                            )
                                        </span>
                                    )}
                                </span>
                            ) : (
                                "—"
                            )
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
                                    className="text-virt underline-offset-2 hover:underline"
                                >
                                    second.tech/terms
                                </a>
                            ) : (
                                "—"
                            )
                        }
                    />
                </div>
                <p className="border-t border-border px-4 py-2.5 text-[11px] text-faint">
                    Snapshot {data.fetched_at}. Params from GetArkInfo / NextRoundTime (captaind).
                    Data credited to Second.
                </p>
            </Panel>

            <Panel
                title="24h server-wallet activity at server P2TR"
                subtitle={`${data.source?.server_p2tr ?? "server address"} · all txs touching the address (boards, refreshes, sweeps) — not rounds, not a VTXO index`}
            >
                <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
                    <Stat label="Txs" value={String(data.stats_24h?.tx_count ?? 0)} />
                    <Stat
                        label="Total out value¹"
                        value={formatSats(data.stats_24h?.total_sats_out ?? 0)}
                    />
                    <Stat label="To server" value={String(data.stats_24h?.to_server ?? 0)} />
                    <Stat label="From server" value={String(data.stats_24h?.from_server ?? 0)} />
                </div>
                <DataTable head={["When (Rome)", "Tx", "Dir", "In/Out", "Sats"]}>
                    {data.recent_server_txs.slice(0, 20).map((t) => (
                        <tr
                            key={t.txid}
                            className="border-b border-border/60 last:border-b-0 hover:bg-secondary/40"
                        >
                            <td className="whitespace-nowrap px-3 py-2 font-mono">
                                {t.block_time_rome?.replace("+02:00", "") || "—"}
                            </td>
                            <td className="px-3 py-2 font-mono">
                                <a
                                    href={t.mempool_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-virt underline-offset-2 hover:underline"
                                >
                                    {truncateId(t.txid)}
                                </a>
                            </td>
                            <td className="px-3 py-2">{t.direction}</td>
                            <td className="px-3 py-2 text-right font-mono">
                                {t.vin}/{t.vout}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                                {formatSats(t.total_sats)}
                            </td>
                        </tr>
                    ))}
                </DataTable>
            </Panel>

            <div className="space-y-1 px-1">
                {data.notes?.map((n) => (
                    <p key={n} className="text-[11px] leading-relaxed text-faint">
                        {n}
                    </p>
                ))}
                <p className="text-[11px] leading-relaxed text-faint">
                    Second does not publish a public VTXO-by-address index (privacy).
                    Paste-your-VTXO countdown is skipped for this PoC. ¹Sats = sum of all
                    transaction outputs, not the amount paid to the server address.
                </p>
            </div>
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const dataAsOf = useMemo(() => {
        const times = [arkade?.fetched_at, bark?.fetched_at].filter(Boolean) as string[];
        if (!times.length) return null;
        // Show the older snapshot so the user knows the stalest side
        const sorted = [...times].sort();
        const raw = sorted[0];
        try {
            const d = new Date(raw);
            const label = d.toLocaleString("en-GB", {
                timeZone: "Europe/Rome",
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            });
            return `${label} Rome`;
        } catch {
            return raw;
        }
    }, [arkade, bark]);

    return (
        <div className="space-y-5" data-testid="observation-dashboard">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                    <h1 className="text-[15px] font-semibold text-foreground">Observation</h1>
                    <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                        Side-by-side mainnet view of two Ark implementations — periodic public
                        snapshots, with sampled activity rather than complete network coverage.
                    </p>
                    {dataAsOf && (
                        <p className="mt-1 text-[11.5px] text-faint" data-testid="data-as-of">
                            Data as of <span className="font-mono text-foreground">{dataAsOf}</span>
                            {arkade?.fetched_at &&
                                bark?.fetched_at &&
                                arkade.fetched_at !== bark.fetched_at && (
                                    <span className="text-faint">
                                        {" "}
                                        (Operator {arkade.fetched_at}; Second {bark.fetched_at})
                                    </span>
                                )}
                        </p>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Segmented
                        ariaLabel="Observation source"
                        value={tab}
                        onChange={setTab}
                        options={[
                            { value: "arkade", label: "Operator", testId: "tab-arkade" },
                            { value: "bark", label: "Second", testId: "tab-bark" },
                            { value: "both", label: "Both", testId: "tab-both" },
                        ]}
                    />
                    <button
                        type="button"
                        onClick={() => void reload()}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        aria-label="Reload snapshots"
                        title="Reload snapshots"
                    >
                        <RefreshCw
                            className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                            aria-hidden="true"
                        />
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-md border border-alert/50 bg-alert/10 px-3 py-2 text-[12.5px] text-alert">
                    {error}
                </div>
            )}

            <div className={cn("grid gap-5", tab === "both" ? "lg:grid-cols-2" : "grid-cols-1")}>
                {(tab === "arkade" || tab === "both") && (
                    <div className="min-w-0">
                        {arkade ? (
                            <OperatorPanel data={arkade} />
                        ) : (
                            <Panel>
                                <p className="px-4 py-6 text-[13px] text-muted-foreground">
                                    Loading operator…
                                </p>
                            </Panel>
                        )}
                    </div>
                )}
                {(tab === "bark" || tab === "both") && (
                    <div className="min-w-0">
                        {bark ? (
                            <BarkPanel data={bark} />
                        ) : (
                            <Panel>
                                <p className="px-4 py-6 text-[13px] text-muted-foreground">
                                    Loading Second…
                                </p>
                            </Panel>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
