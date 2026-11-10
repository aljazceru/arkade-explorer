import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Panel, MicroLabel } from "@/components/atlas/panel";
import { AssetBadge } from "@/components/shared/asset-badge";
import { AssetAmountDisplay } from "@/components/shared/asset-amount-display";
import { formatSats } from "@/lib/utils";
import { formatDuration } from "@/lib/vtxo-display";
import type { AddressSummary } from "@/lib/atlas/address-summary";
import type { AssetBalance } from "@/lib/vtxo-aggregation";
import { ATLAS_STATE_META, type AtlasVtxoState } from "@/lib/atlas/vtxo-state";
import { cn } from "@/lib/utils";
import type { AtlasTone } from "@/lib/atlas/tones";

const STATE_ORDER: AtlasVtxoState[] = [
    "renew",
    "expired",
    "unknown",
    "preconfirmed",
    "settled",
    "swept",
    "unfinalized",
    "spent",
    "spent-in-batch",
    "unrolled",
];

const TONE_DOT: Record<AtlasTone, string> = {
    alert: "bg-alert",
    ok: "bg-ok",
    virt: "bg-virt",
    warning: "bg-warning",
    faint: "bg-faint",
    chain: "bg-chain",
    cp: "bg-cp",
    neutral: "bg-muted-foreground",
};

function FactRow({ k, children, alert }: { k: string; children: ReactNode; alert?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-border py-[7px] first:border-t-0">
            <MicroLabel className="shrink-0 pt-px">{k}</MicroLabel>
            <span
                className={cn(
                    "min-w-0 text-right font-mono text-[11.5px] leading-snug text-foreground",
                    alert && "text-alert",
                )}
            >
                {children}
            </span>
        </div>
    );
}

function until(ms: number, now: number): string {
    const s = Math.round((ms - now) / 1000);
    if (s <= 0) return "expired";
    return `in ~${formatDuration(s)}`;
}

/** "25 Nov 2026, 04:52" — compact fact-row date; full ISO lives in `title`. */
function factDate(ms: number): string {
    return new Date(ms).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

interface FactsProps {
    summary: AddressSummary;
    now: number;
    hasAssets: boolean;
    assetBalances: [string, AssetBalance][];
    isDraining?: boolean;
}

/** Right-hand facts column: unspent hero, breakdown, needs-action, states, assets. */
export function AddressFacts({ summary, now, hasAssets, assetBalances, isDraining }: FactsProps) {
    const b = summary.buckets;
    const needs = summary.needsAction;

    return (
        <div className="flex flex-col gap-3">
            <Panel title="Facts" bodyClassName="px-4 py-3">
                {/* Unspent hero */}
                <div className="pb-3">
                    <div className="font-mono text-[26px] font-medium leading-none tracking-tight text-foreground">
                        {formatSats(summary.unspentSats)}
                        <span className="ml-1.5 text-[13px] font-normal text-faint">sats</span>
                    </div>
                    <MicroLabel className="mt-1.5 block">
                        {isDraining ? "loaded unspent (partial)" : "unspent"} ·{" "}
                        {summary.unspentCount.toLocaleString("en-US")} vtxos
                    </MicroLabel>
                </div>

                <FactRow k={isDraining ? "loaded output value" : "received output value"}>
                    {formatSats(summary.receivedSats)} sats
                </FactRow>
                <FactRow k="vtxos">
                    {summary.totalVtxos.toLocaleString("en-US")}
                    {isDraining && <span className="text-warning"> · partial</span>}
                </FactRow>
                <FactRow k="spent">{summary.spentCount.toLocaleString("en-US")}</FactRow>

                <div className="micro mb-1 mt-3 block text-faint">unspent breakdown</div>
                <FactRow k="healthy">
                    <span className="text-ok">
                        {formatSats(b.healthy.sats)} sats · {b.healthy.count}
                    </span>
                </FactRow>
                <FactRow k="exit window" alert={b.exitWindow.count > 0}>
                    {b.exitWindow.count > 0
                        ? `${formatSats(b.exitWindow.sats)} sats · ${b.exitWindow.count}`
                        : "0"}
                </FactRow>
                <FactRow k="expired" alert={b.expired.count > 0}>
                    {b.expired.count > 0
                        ? `${formatSats(b.expired.sats)} sats · ${b.expired.count}`
                        : "0"}
                </FactRow>
                <FactRow k="swept-recoverable">
                    {b.swept.count > 0
                        ? `${formatSats(b.swept.sats)} sats · ${b.swept.count}`
                        : "0"}
                </FactRow>
                {(summary.unrolledCount > 0 || summary.unrolledSats > 0) && (
                    <FactRow k="exit started">
                        <span className="text-chain">
                            {formatSats(summary.unrolledSats)} sats · {summary.unrolledCount}
                        </span>
                    </FactRow>
                )}
                <FactRow k="expiry unknown">
                    <span className={b.unknown.count > 0 ? "text-warning" : undefined}>
                        {b.unknown.count > 0
                            ? `${formatSats(b.unknown.sats)} sats · ${b.unknown.count}`
                            : "0"}
                    </span>
                </FactRow>

                {summary.nearestExpiryMs !== null && (
                    <FactRow
                        k="nearest expiry"
                        alert={summary.nearestExpiryMs - now < 7 * 86_400_000}
                    >
                        <span title={new Date(summary.nearestExpiryMs).toISOString()}>
                            {factDate(summary.nearestExpiryMs)}
                        </span>{" "}
                        · {until(summary.nearestExpiryMs, now)}
                    </FactRow>
                )}
            </Panel>

            {/* Needs action */}
            {needs.count > 0 && (
                <div className="rounded-lg border border-alert/50 bg-alert/10 px-4 py-3">
                    <div className="micro text-alert">▲ needs action</div>
                    <div className="mt-1 text-[13px] text-foreground">
                        {needs.count} VTXO{needs.count === 1 ? "" : "s"} · {formatSats(needs.sats)}{" "}
                        sats — renew or exit before{" "}
                        {needs.nearestExpiryMs !== null ? (
                            <span title={new Date(needs.nearestExpiryMs).toISOString()}>
                                {factDate(needs.nearestExpiryMs)}
                            </span>
                        ) : (
                            "expiry"
                        )}
                    </div>
                    {needs.nearestExpiryMs !== null && (
                        <div className="mt-1 font-mono text-[11px] text-alert">
                            nearest expiry {until(needs.nearestExpiryMs, now)}
                        </div>
                    )}
                </div>
            )}

            {/* State counts */}
            <Panel title="By state" bodyClassName="px-4 py-2">
                {STATE_ORDER.filter((s) => summary.stateCounts[s] > 0).map((s) => {
                    const meta = ATLAS_STATE_META[s];
                    return (
                        <FactRow key={s} k={meta.label}>
                            <span className="inline-flex items-center gap-1.5">
                                <span
                                    className={cn(
                                        "inline-block h-1.5 w-1.5 rounded-full",
                                        TONE_DOT[meta.tone],
                                    )}
                                    aria-hidden="true"
                                />
                                {summary.stateCounts[s].toLocaleString("en-US")}
                            </span>
                        </FactRow>
                    );
                })}
            </Panel>

            {/* Asset balances (virtualized rows) */}
            {hasAssets && assetBalances.length > 0 && (
                <Panel title="Asset balances" bodyClassName="px-4 py-2">
                    <AssetRowsVirtualized assetEntries={assetBalances} />
                </Panel>
            )}
        </div>
    );
}

function AssetRowsVirtualized({ assetEntries }: { assetEntries: [string, AssetBalance][] }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: assetEntries.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 34,
        overscan: 10,
        getItemKey: (index) => assetEntries[index][0],
    });

    return (
        <div ref={scrollRef} className="max-h-56 overflow-y-auto overflow-x-hidden">
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: "relative",
                    width: "100%",
                }}
            >
                {virtualizer.getVirtualItems().map((item) => {
                    const [assetId, balances] = assetEntries[item.index];
                    return (
                        <div
                            key={item.key}
                            data-index={item.index}
                            ref={virtualizer.measureElement}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                transform: `translateY(${item.start}px)`,
                            }}
                            className="flex items-center justify-between gap-2 border-t border-dashed border-border py-1.5 first:border-t-0"
                        >
                            <AssetBadge assetId={assetId} />
                            <span className="flex items-center gap-2 font-mono text-[11px]">
                                <AssetAmountDisplay
                                    amount={balances.active}
                                    assetId={assetId}
                                    hideUnit
                                    valueClassName="text-foreground"
                                />
                                <span className="text-faint">/</span>
                                <AssetAmountDisplay
                                    amount={balances.total}
                                    assetId={assetId}
                                    hideUnit
                                    valueClassName="text-faint"
                                />
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
