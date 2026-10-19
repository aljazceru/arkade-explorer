import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Eye, Trash2, Plus } from "lucide-react";
import type { VirtualCoin } from "@arkade-os/sdk";
import { indexerClient } from "@/lib/api/indexer";
import { fetchAllPages } from "@/lib/api/fetchAllPages";
import { addressToScriptHex, isHex } from "@/lib/decode";
import { constructArkAddress } from "@/lib/arkAddress";
import { hex } from "@scure/base";
import { truncateHash } from "@/lib/utils";
import { PAGINATION } from "@/lib/constants";
import { PageTransition } from "@/components/shared/page-transition";
import { useWatchlist, type WatchedScript } from "@/hooks/use-watchlist";
import { useServerInfo } from "@/providers/server-info-provider";
import { useExitDelays, useNow } from "@/hooks/use-expiry";
import {
    deriveExpiryKind,
    deriveExpiryUrgency,
    describeTimelock,
    formatDuration,
    remainingLifetime,
} from "@/lib/vtxo-display";
import { NeedsExitBadge } from "@/components/shared/expiry-countdown";
import { MoneyDisplay } from "@/components/shared/money-display";

function WatchRow({ item, onRemove }: { item: WatchedScript; onRemove: () => void }) {
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

    const active = ((data?.vtxos ?? []) as VirtualCoin[]).filter(
        (v) => deriveExpiryKind(v) === "active",
    );
    const total = active.reduce((acc, v) => acc + Number(v.value), 0);
    const nearest = active
        .map((v) => remainingLifetime(v, now))
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => a.seconds - b.seconds)[0];
    const urgency = nearest ? deriveExpiryUrgency(nearest, unilateralExitDelay) : null;
    const urgent = urgency === "urgent" || urgency === "expired";

    return (
        <tr
            className={`border-b border-border ${urgent ? "bg-red-500/10 border-l-4 border-l-red-600" : ""}`}
            data-testid="watch-row"
        >
            <td className="px-4 py-3">
                <div className="flex flex-col gap-0.5">
                    {item.label && <span className="text-sm text-foreground">{item.label}</span>}
                    {address ? (
                        <Link
                            to={`/address/${address}`}
                            className="font-mono text-xs text-foreground hover:text-primary"
                            title={item.script}
                        >
                            {truncateHash(item.script, 10, 8)}
                        </Link>
                    ) : (
                        <span className="font-mono text-xs" title={item.script}>
                            {truncateHash(item.script, 10, 8)}
                        </span>
                    )}
                </div>
            </td>
            <td className="px-4 py-3 text-right text-xs font-mono">
                {isLoading ? "…" : error ? "error" : active.length}
            </td>
            <td className="px-4 py-3 text-right">
                {data && <MoneyDisplay sats={total} className="font-mono text-xs" />}
            </td>
            <td className="px-4 py-3 text-right">
                {isLoading ? (
                    <span className="text-xs text-muted-foreground">loading…</span>
                ) : !nearest ? (
                    <span className="text-xs text-muted-foreground font-mono">no active VTXOs</span>
                ) : (
                    <span
                        className={`inline-flex items-center gap-2 font-mono text-xs ${urgent ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground"}`}
                        data-expiry-urgency={urgency ?? undefined}
                    >
                        {urgent && <NeedsExitBadge expired={urgency === "expired"} />}~
                        {Math.max(0, nearest.blocks).toLocaleString("en-US")} blk · ~
                        {formatDuration(nearest.seconds)}
                    </span>
                )}
            </td>
            <td className="px-4 py-3 text-right">
                <button
                    onClick={onRemove}
                    className="text-muted-foreground hover:text-red-600"
                    aria-label="Remove from watchlist"
                >
                    <Trash2 className="h-4 w-4" />
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

    return (
        <PageTransition>
            <div className="space-y-6">
                <div>
                    <h1 className="text-xl font-semibold text-foreground inline-flex items-center gap-2">
                        <Eye className="h-5 w-5" /> Watchlist
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Watch script pubkeys (or Arkade addresses) and see their nearest batch
                        expiry. Stored only in this browser (localStorage). No notifications yet.
                        {unilateralExitDelay && (
                            <>
                                {" "}
                                URGENT means the nearest expiry is within the unilateral exit delay
                                ({describeTimelock(unilateralExitDelay)}).
                            </>
                        )}
                    </p>
                </div>

                <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Script pubkey (hex) or ark1… address"
                        className="flex-1 h-9 px-3 rounded-lg bg-secondary border border-border text-sm font-mono"
                        aria-label="Script pubkey or address"
                    />
                    <input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Label (optional)"
                        className="sm:w-48 h-9 px-3 rounded-lg bg-secondary border border-border text-sm"
                        aria-label="Label"
                    />
                    <button
                        type="submit"
                        className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-1"
                    >
                        <Plus className="h-4 w-4" /> Watch
                    </button>
                </form>
                {msg && <p className="text-sm text-red-600">{msg}</p>}

                {items.length === 0 ? (
                    <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                        Nothing watched yet.
                    </div>
                ) : (
                    <div className="rounded-xl border border-border bg-card overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border bg-secondary/30 text-xs uppercase tracking-wide text-muted-foreground">
                                    <th className="text-left px-4 py-3 font-medium">Script</th>
                                    <th className="text-right px-4 py-3 font-medium">
                                        Active VTXOs
                                    </th>
                                    <th className="text-right px-4 py-3 font-medium">Amount</th>
                                    <th className="text-right px-4 py-3 font-medium">
                                        Nearest expiry
                                    </th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => (
                                    <WatchRow
                                        key={item.script}
                                        item={item}
                                        onRemove={() => remove(item.script)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </PageTransition>
    );
}
