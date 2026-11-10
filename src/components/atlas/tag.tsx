import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AtlasTone } from "@/lib/atlas/tones";

const TONES: Record<AtlasTone, string> = {
    neutral: "border-line-strong text-muted-foreground",
    virt: "border-virt/40 bg-virt/10 text-virt",
    chain: "border-chain/40 bg-chain/10 text-chain",
    cp: "border-cp/40 bg-cp/10 text-cp",
    ok: "border-ok/40 bg-ok/10 text-ok",
    alert: "border-alert/50 bg-alert/10 text-alert",
    warning: "border-warning/40 bg-warning/10 text-warning",
    faint: "border-border text-faint",
};

/** Small mono state label. Colour is never the only signal: the text names the state. */
export function Tag({
    tone = "neutral",
    dashed = false,
    className,
    title,
    children,
}: {
    tone?: AtlasTone;
    /** Dashed border marks evidence that is missing, e.g. unknown expiry. */
    dashed?: boolean;
    className?: string;
    title?: string;
    children: ReactNode;
}) {
    return (
        <span
            title={title}
            className={cn(
                "micro inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-[2px] leading-none",
                TONES[tone],
                dashed && "border-dashed",
                className,
            )}
        >
            {children}
        </span>
    );
}
