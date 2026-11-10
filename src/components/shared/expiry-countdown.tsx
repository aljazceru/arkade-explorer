import { Clock } from "lucide-react";
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
    // An unrolled VTXO already exited on-chain: no batch countdown applies.
    const terminal = kind !== "active" || vtxo.isUnrolled === true;
    const remaining = terminal ? null : remainingLifetime(vtxo, now, tip);
    const urgency: ExpiryUrgency | null = terminal
        ? null
        : deriveExpiryUrgency(remaining, unilateralExitDelay);
    return { kind, remaining, urgency, unilateralExitDelay, unrolled: vtxo.isUnrolled === true };
}

/** Exit-window flag: renew into a new batch or exit on-chain now. */
export function NeedsExitBadge({ expired, className }: { expired?: boolean; className?: string }) {
    return (
        <span
            className={cn(
                "micro inline-flex items-center gap-1 whitespace-nowrap rounded border border-alert/60 bg-alert/15 px-1.5 py-[2px] font-semibold leading-none text-alert",
                className,
            )}
            role="alert"
        >
            <span aria-hidden="true">▲</span>
            {expired ? "Expired" : "Renew or exit"}
        </span>
    );
}

/**
 * Expiry slot for a VTXO row: "Spent in batch"/"Spent" for terminal VTXOs,
 * otherwise a live countdown (blocks + estimated time) and the exit-window flag
 * when the remaining lifetime is at or below the server's unilateral exit delay.
 *
 * `showBadge={false}` (Atlas rows, where VtxoStateTag already carries the state)
 * renders only the countdown time for live VTXOs and "—" otherwise.
 */
export function ExpiryCountdown({
    vtxo,
    compact,
    className,
    showBadge = true,
}: {
    vtxo: VirtualCoin;
    compact?: boolean;
    className?: string;
    showBadge?: boolean;
}) {
    const { kind, remaining, urgency, unilateralExitDelay, unrolled } = useVtxoExpiry(vtxo);
    const label = unrolled && kind === "active" ? "Exit started" : expiryKindLabel(kind);
    if (!showBadge) {
        const quiet = (
            <span className={cn("font-mono text-[11px] text-faint/60", className)}>—</span>
        );
        if (label || !remaining || remaining.seconds <= 0) return quiet;
        const urgent = urgency === "urgent" || urgency === "expired";
        const title =
            `Batch expiry ${new Date(remaining.expiresAtMs).toLocaleString()}` +
            (remaining.source === "time" ? " (blocks estimated at 10 min/block)" : "") +
            (unilateralExitDelay
                ? `. Unilateral exit delay: ${describeTimelock(unilateralExitDelay)}`
                : ". Exit window unknown");
        return (
            <span
                className={cn(
                    "inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px]",
                    compact ? "flex-row" : "flex-col items-end sm:flex-row sm:items-center",
                    urgent ? "font-semibold text-alert" : "text-muted-foreground",
                    className,
                )}
                title={title}
                data-expiry-urgency={urgency ?? undefined}
            >
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    {!urgent && <Clock className="h-3 w-3 text-faint" aria-hidden="true" />}
                    {remaining.source === "time" ? "~" : ""}
                    {`${Math.max(0, remaining.blocks).toLocaleString("en-US")} blk`}
                    <span className="text-faint">·</span>~{formatDuration(remaining.seconds)}
                </span>
            </span>
        );
    }
    if (label) {
        return <span className={cn("font-mono text-[11px] text-faint", className)}>{label}</span>;
    }
    if (!remaining) {
        return (
            <span
                className={cn("font-mono text-[11px] text-warning", className)}
                title="No expiry evidence: unknown is not safe"
            >
                expiry unknown
            </span>
        );
    }

    const urgent = urgency === "urgent" || urgency === "expired";
    const title =
        `Batch expiry ${new Date(remaining.expiresAtMs).toLocaleString()}` +
        (remaining.source === "time" ? " (blocks estimated at 10 min/block)" : "") +
        (unilateralExitDelay
            ? `. Unilateral exit delay: ${describeTimelock(unilateralExitDelay)}`
            : ". Exit window unknown");

    const expired = remaining.seconds <= 0;
    const blocks = `${Math.max(0, remaining.blocks).toLocaleString("en-US")} blk`;
    const time = formatDuration(remaining.seconds);
    const approx = remaining.source === "time" ? "~" : "";

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 font-mono text-[11px]",
                compact ? "flex-row" : "flex-col items-end sm:flex-row sm:items-center",
                urgent ? "font-semibold text-alert" : "text-muted-foreground",
                className,
            )}
            title={title}
            data-expiry-urgency={urgency ?? undefined}
        >
            {urgent && <NeedsExitBadge expired={urgency === "expired"} />}
            {!expired && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    {!urgent && <Clock className="h-3 w-3 text-faint" aria-hidden="true" />}
                    {approx}
                    {blocks}
                    <span className="text-faint">·</span>~{time}
                </span>
            )}
        </span>
    );
}
