import { AlertTriangle, Clock } from "lucide-react";
import type { VirtualCoin } from "@arkade-os/sdk";
import { cn } from "@/lib/utils";
import {
    deriveExpiryKind,
    deriveExpiryUrgency,
    describeTimelock,
    expiryKindLabel,
    formatDuration,
    remainingLifetime,
    type ExpiryUrgency,
} from "@/lib/vtxo-display";
import { useChainTip, useExitDelays, useNow } from "@/hooks/use-expiry";

/** Live expiry state for one VTXO: kind, remaining lifetime and urgency. */
export function useVtxoExpiry(vtxo: VirtualCoin) {
    const now = useNow();
    const tip = useChainTip(vtxo.expiresAtHeight !== undefined && vtxo.expiresAtHeight !== null);
    const { unilateralExitDelay } = useExitDelays();
    const kind = deriveExpiryKind(vtxo);
    const remaining = kind === "active" ? remainingLifetime(vtxo, now, tip) : null;
    const urgency: ExpiryUrgency | null =
        kind === "active" ? deriveExpiryUrgency(remaining, unilateralExitDelay) : null;
    return { kind, remaining, urgency, unilateralExitDelay };
}

/** Big, unmissable URGENT pill. */
export function NeedsExitBadge({ expired, className }: { expired?: boolean; className?: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                "bg-red-600 text-white ring-2 ring-red-500/40 animate-pulse",
                className,
            )}
            role="alert"
        >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {expired ? "Expired" : "Urgent: needs exit"}
        </span>
    );
}

/**
 * Expiry slot for a VTXO row: "Settled"/"Spent" for terminal VTXOs, otherwise a
 * live countdown (blocks + estimated time) and an URGENT flag when the remaining
 * lifetime is at or below the server's unilateral exit delay.
 */
export function ExpiryCountdown({
    vtxo,
    compact,
    className,
}: {
    vtxo: VirtualCoin;
    compact?: boolean;
    className?: string;
}) {
    const { kind, remaining, urgency, unilateralExitDelay } = useVtxoExpiry(vtxo);
    const label = expiryKindLabel(kind);
    if (label) {
        return (
            <span className={cn("text-xs text-muted-foreground font-mono", className)}>
                {label}
            </span>
        );
    }
    if (!remaining) {
        return <span className={cn("text-xs text-muted-foreground font-mono", className)}>--</span>;
    }

    const urgent = urgency === "urgent" || urgency === "expired";
    const title =
        `Batch expiry ${new Date(remaining.expiresAtMs).toLocaleString()}` +
        (remaining.source === "time" ? " (blocks estimated at 10 min/block)" : "") +
        (unilateralExitDelay
            ? `. Unilateral exit delay: ${describeTimelock(unilateralExitDelay)}`
            : "");

    const blocks = `${Math.max(0, remaining.blocks).toLocaleString("en-US")} blk`;
    const time = remaining.seconds > 0 ? formatDuration(remaining.seconds) : "Expired";

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 font-mono text-xs",
                compact ? "flex-row" : "flex-col items-end sm:flex-row sm:items-center",
                urgent ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground",
                className,
            )}
            title={title}
            data-expiry-urgency={urgency ?? undefined}
        >
            {urgent && <NeedsExitBadge expired={urgency === "expired"} />}
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                {!urgent && <Clock className="h-3 w-3" aria-hidden="true" />}
                {remaining.source === "time" ? "~" : ""}
                {blocks}
                <span className="opacity-60">·</span>
                {remaining.seconds > 0 ? `~${time}` : time}
            </span>
        </span>
    );
}
