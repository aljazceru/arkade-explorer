import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Eye, Plus } from "lucide-react";
import type { VirtualCoin } from "@arkade-os/sdk";
import { indexerClient } from "@/lib/api/indexer";
import { fetchAllPages } from "@/lib/api/fetchAllPages";
import { addressToScriptHex, isHex } from "@/lib/decode";
import { constructArkAddress } from "@/lib/arkAddress";
import { hex } from "@scure/base";
import { PAGINATION } from "@/lib/constants";
import { PageTransition } from "@/components/shared/page-transition";
import { useWatchlist, type WatchedScript } from "@/hooks/use-watchlist";
import { useServerInfo } from "@/providers/server-info-provider";
import { useChainTip, useExitDelays, useNow } from "@/hooks/use-expiry";
import { atlasVtxoState, type AtlasVtxoView } from "@/lib/atlas/vtxo-state";
import { AVG_BLOCK_SECONDS, formatDuration, type RemainingLifetime } from "@/lib/vtxo-display";
import { NeedsExitBadge } from "@/components/shared/expiry-countdown";
import { MoneyDisplay } from "@/components/shared/money-display";
import { BarkdConnect } from "@/components/atlas/watchlist/barkd-connect";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { Term } from "@/components/atlas/term";
import { cn } from "@/lib/utils";

/** States that mean the VTXO is gone for watchlist purposes (spent-side or exited). */
const TERMINAL_STATES: Record<string, true> = {
    spent: true,
    "spent-in-batch": true,
    unfinalized: true,
    unrolled: true,
};

function isActiveView(view: AtlasVtxoView): boolean {
    return !TERMINAL_STATES[view.state];
}

function WatchRow({
    item,
    onRemove,
    tipHeight,
}: {
    item: WatchedScript;
    onRemove: () => void;
    tipHeight: number | null;
}) {
    const { serverInfo } = useServerInfo();
    const { unilateralExitDelay } = useExitDelays();
    const now = useNow();

    const { data, isLoading, error } = useQuery({
        queryKey: ["watchlist-vtxos", item.script],
        queryFn: () =>
            fetchAllPages(
                (opts) =>
                    indexerClient.getVtxos({
                        scripts: [item.script],
                        spendableOnly: true,
                        ...opts,
                    }),
                "vtxos",
                PAGINATION.MAX_PAGE_SIZE,
            ),
        refetchInterval: 60_000,
    });

    const address = useMemo(() => {
        if (!serverInfo) return null;
        try {
            return constructArkAddress(
                hex.decode(item.script),
                serverInfo.signerPubkey,
                serverInfo.network,
            );
        } catch {
            return null;
        }
    }, [item.script, serverInfo]);

    const vtxos = (data?.vtxos ?? []) as VirtualCoin[];
    const hasHeightExpiry = vtxos.some((v) => v.expiresAtHeight != null);

    // One Atlas view per VTXO; "active" = not spent-side.
    const entries = vtxos.map((vtxo) => ({
        vtxo,
        view: atlasVtxoState(vtxo, {
            nowMs: now,
            exitDelay: unilateralExitDelay,
            tipHeight,
        }),
    }));
    const active = entries.filter(({ view }) => isActiveView(view));
    const total = active.reduce((acc, { vtxo }) => acc + Number(vtxo.value), 0);

    // Nearest expiry across active VTXOs. atlasVtxoState already carries the
    // remaining lifetime computed with the chain tip, so height-based expiry is
    // evaluated rather than silently dropped.
    let nearest: { remaining: RemainingLifetime; view: AtlasVtxoView } | null = null;
    for (const { view } of active) {
        if (!view.remaining) continue;
        if (!nearest || view.remaining.seconds < nearest.remaining.seconds) {
            nearest = { remaining: view.remaining, view };
        }
    }
    const urgency = nearest?.view.urgency ?? null;
    const urgent = urgency === "urgent" || urgency === "expired";

    return (
        <tr
            className={cn(
                "border-b border-border/60 transition-colors last:border-b-0 hover:bg-secondary/40",
                urgent && "bg-alert/10",
            )}
            data-testid="watch-row"
            data-expiry-urgency={urgency ?? undefined}
        >
            <td className="px-4 py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                    {item.label && (
                        <span className="truncate text-[13px] font-medium text-foreground">
                            {item.label}
                        </span>
                    )}
                    {address ? (
                        <Link
                            to={`/address/${address}`}
                            className="font-mono text-[11.5px] text-virt underline-offset-2 hover:underline"
                            title={item.script}
                        >
                            {item.script.slice(0, 10)}…{item.script.slice(-8)}
                        </Link>
                    ) : (
                        <span
                            className="font-mono text-[11.5px] text-foreground"
                            title={item.script}
                        >
                            {item.script.slice(0, 10)}…{item.script.slice(-8)}
                        </span>
                    )}
                </div>
            </td>
            <td className="px-4 py-2.5 text-right font-mono text-[12px] text-foreground">
                {isLoading ? (
                    <span className="text-faint">…</span>
                ) : error ? (
                    <span className="text-alert">error</span>
                ) : (
                    active.length.toLocaleString("en-US")
                )}
            </td>
            <td className="px-4 py-2.5 text-right">
                {data && (
                    <MoneyDisplay sats={total} className="justify-end font-mono text-[12px]" />
                )}
            </td>
            <td className="px-4 py-2.5 text-right">
                {isLoading ? (
                    <span className="font-mono text-[11px] text-faint">…</span>
                ) : !nearest ? (
                    <span className="font-mono text-[11px] text-faint">
                        {hasHeightExpiry && tipHeight === null ? "tip unknown" : "no active VTXOs"}
                    </span>
                ) : (
                    <span
                        className={cn(
                            "inline-flex items-center gap-1.5 font-mono text-[11.5px]",
                            urgent ? "font-semibold text-alert" : "text-muted-foreground",
                        )}
                    >
                        {urgent && <NeedsExitBadge expired={urgency === "expired"} />}
                        {nearest.remaining.source === "time" && "~"}
                        {Math.max(0, nearest.remaining.blocks).toLocaleString("en-US")} blk · ~
                        {formatDuration(nearest.remaining.seconds)}
                    </span>
                )}
            </td>
            <td className="px-4 py-2.5 text-right">
                <button
                    type="button"
                    onClick={onRemove}
                    className="rounded p-1 text-faint transition-colors hover:bg-secondary hover:text-alert"
                    aria-label={`Remove ${item.label ?? item.script} from watchlist`}
                    title="Remove from watchlist"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        aria-hidden="true"
                    >
                        <path d="M2.5 3.5h9M5.5 3.5V2.5h3v1M3.5 3.5l.6 8h5.8l.6-8" />
                    </svg>
                </button>
            </td>
        </tr>
    );
}

export function WatchlistPage() {
    const { items, add, remove } = useWatchlist();
    const { unilateralExitDelay } = useExitDelays();
    const [input, setInput] = useState("");
    const [label, setLabel] = useState("");
    const [msg, setMsg] = useState<string | null>(null);

    // Chain tip so height-based expiry is evaluated instead of dropped.
    const tipHeight = useChainTip(items.length > 0);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const v = input.trim();
        if (!v) return;
        let script: string;
        try {
            script = addressToScriptHex(v);
        } catch {
            setMsg("Not a valid script pubkey (hex) or Arkade address.");
            return;
        }
        if (!isHex(script) || script.length < 4) {
            setMsg("Not a valid script pubkey (hex).");
            return;
        }
        setMsg(add(script, label.trim()) ? null : "Already on the watchlist.");
        setInput("");
        setLabel("");
    };

    const inputClass =
        "h-9 rounded-md border border-line-strong bg-secondary px-2.5 text-[13px] text-foreground " +
        "placeholder:text-faint focus:border-virt focus:outline-none focus:ring-1 focus:ring-virt/50";

    return (
        <PageTransition>
            <div className="space-y-5">
                <div>
                    <h1 className="inline-flex items-center gap-2 text-[15px] font-semibold text-foreground">
                        <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        Watchlist
                    </h1>
                    <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                        Watch script pubkeys (or Arkade addresses) and see their nearest batch
                        expiry. Stored only in this browser — no notifications yet. The{" "}
                        <Term k="exitWindow">exit window</Term> is the final stretch before expiry,
                        as long as the operator&apos;s unilateral exit delay
                        {unilateralExitDelay ? (
                            <>
                                {" "}
                                (
                                <span className="font-mono text-[12px] text-foreground">
                                    ≈
                                    {formatDuration(
                                        unilateralExitDelay.type === "blocks"
                                            ? unilateralExitDelay.value * AVG_BLOCK_SECONDS
                                            : unilateralExitDelay.value,
                                    )}{" "}
                                    ({unilateralExitDelay.value.toLocaleString("en-US")}{" "}
                                    {unilateralExitDelay.type === "blocks" ? "blk" : "s"})
                                </span>
                                ). Inside it, renew or exit on-chain.
                            </>
                        ) : (
                            " — currently unknown from the operator."
                        )}
                    </p>
                </div>

                <Panel title="Watch a script">
                    <form onSubmit={submit} className="flex flex-col gap-2 p-4 sm:flex-row">
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Script pubkey (hex) or ark1… address"
                            className={cn(inputClass, "flex-1 font-mono text-[12px]")}
                            aria-label="Script pubkey or address"
                        />
                        <input
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            placeholder="Label (optional)"
                            className={cn(inputClass, "sm:w-52")}
                            aria-label="Label"
                        />
                        <button
                            type="submit"
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-secondary px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Watch
                        </button>
                    </form>
                    {msg && (
                        <p className="px-4 pb-3 text-[12.5px] text-alert" role="alert">
                            {msg}
                        </p>
                    )}
                </Panel>

                {items.length === 0 ? (
                    <Panel>
                        <div className="px-4 py-10 text-center">
                            <p className="text-[13px] text-muted-foreground">
                                Nothing watched yet.
                            </p>
                            <p className="mt-1 text-[11.5px] text-faint">
                                Paste a script pubkey or an Arkade address above.
                            </p>
                        </div>
                    </Panel>
                ) : (
                    <Panel>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] text-[13px]">
                                <thead>
                                    <tr className="border-b border-border">
                                        <th className="px-4 py-2 text-left">
                                            <MicroLabel>Script</MicroLabel>
                                        </th>
                                        <th className="px-4 py-2 text-right">
                                            <MicroLabel>Active VTXOs</MicroLabel>
                                        </th>
                                        <th className="px-4 py-2 text-right">
                                            <MicroLabel>Amount</MicroLabel>
                                        </th>
                                        <th className="px-4 py-2 text-right">
                                            <MicroLabel>Nearest expiry</MicroLabel>
                                        </th>
                                        <th className="w-10 px-4 py-2" aria-label="Actions" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item) => (
                                        <WatchRow
                                            key={item.script}
                                            item={item}
                                            tipHeight={tipHeight}
                                            onRemove={() => remove(item.script)}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Panel>
                )}

                <BarkdConnect />
            </div>
        </PageTransition>
    );
}
