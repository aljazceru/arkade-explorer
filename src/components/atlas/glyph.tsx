import type { AtlasVtxoState } from "@/lib/atlas/vtxo-state";
import { cn } from "@/lib/utils";

/**
 * The Atlas shape vocabulary. The same shapes are used on canvases, in tables
 * and in the legend, so a reader learns them once:
 * block = tick on the rail, commitment = diamond, ark tx = pill,
 * checkpoint = indigo ring, tree/leaf = branch, anchor = hollow square,
 * Second round or server tx = hollow diamond.
 */
export type GlyphKind =
    "block" | "commitment" | "round" | "ark" | "leaf" | "checkpoint" | "tree" | "anchor";

export const GLYPH_LABELS: Record<GlyphKind, string> = {
    block: "Bitcoin block",
    commitment: "Commitment",
    round: "Second round",
    ark: "Arkade transaction",
    leaf: "Batch leaf",
    checkpoint: "Checkpoint",
    tree: "Tree transaction",
    anchor: "Anchor output",
};

export function Glyph({
    kind,
    size = 14,
    className,
    title,
}: {
    kind: GlyphKind;
    size?: number;
    className?: string;
    /** Accessible name; omit when adjacent text already names the kind. */
    title?: string;
}) {
    const a11y = title
        ? { role: "img" as const, "aria-label": title }
        : { "aria-hidden": true as const };
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 14 14"
            className={cn("shrink-0", className)}
            {...a11y}
        >
            {title && <title>{title}</title>}
            {kind === "block" && (
                <>
                    <rect x="5.5" y="2" width="3" height="8.5" className="fill-line-strong" />
                    <rect x="3" y="11" width="8" height="2" className="fill-faint" />
                </>
            )}
            {kind === "commitment" && (
                <path
                    d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z"
                    className="fill-canvas stroke-chain"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                />
            )}
            {kind === "round" && (
                <rect
                    x="3.2"
                    y="3.2"
                    width="7.6"
                    height="7.6"
                    transform="rotate(45 7 7)"
                    className="fill-none stroke-chain"
                    strokeWidth="1.3"
                    strokeDasharray="2 1.4"
                />
            )}
            {kind === "ark" && (
                <rect
                    x="1.5"
                    y="3.75"
                    width="11"
                    height="6.5"
                    rx="3.25"
                    className="fill-none stroke-virt"
                    strokeWidth="1.3"
                />
            )}
            {kind === "leaf" && (
                <>
                    <circle
                        cx="7"
                        cy="7"
                        r="4.2"
                        className="fill-none stroke-virt"
                        strokeWidth="1.3"
                    />
                    <circle cx="7" cy="7" r="1.5" className="fill-virt" />
                </>
            )}
            {kind === "checkpoint" && (
                <>
                    <circle
                        cx="7"
                        cy="7"
                        r="4.2"
                        className="fill-none stroke-cp"
                        strokeWidth="1.3"
                    />
                    <circle cx="7" cy="7" r="1.3" className="fill-cp" />
                </>
            )}
            {kind === "tree" && (
                <>
                    <path
                        d="M7 2.5 V6.5 M7 6.5 L3.5 11 M7 6.5 L10.5 11"
                        className="fill-none stroke-virt"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                    />
                    <circle cx="7" cy="2.5" r="1.4" className="fill-virt" />
                </>
            )}
            {kind === "anchor" && (
                <rect
                    x="4"
                    y="4"
                    width="6"
                    height="6"
                    className="fill-none stroke-faint"
                    strokeWidth="1.2"
                />
            )}
        </svg>
    );
}

const RING_CLASS: Record<AtlasVtxoState, string> = {
    renew: "stroke-alert",
    expired: "stroke-alert",
    unknown: "stroke-warning",
    preconfirmed: "stroke-virt",
    settled: "stroke-ok",
    swept: "stroke-warning",
    unfinalized: "stroke-warning",
    spent: "stroke-faint",
    "spent-in-batch": "stroke-faint",
    unrolled: "stroke-chain",
};

/**
 * A VTXO: a circle whose outer ring arc is the share of lifetime left, coloured
 * by state. Missing lifetime draws a dashed ring; spent VTXOs are a faint outline.
 */
export function VtxoGlyph({
    state,
    lifetimeLeft,
    size = 14,
    className,
    title,
}: {
    state: AtlasVtxoState;
    lifetimeLeft: number | null;
    size?: number;
    className?: string;
    title?: string;
}) {
    const r = 5.6;
    const circumference = 2 * Math.PI * r;
    const terminal = state === "spent" || state === "spent-in-batch" || state === "unrolled";
    const fraction = lifetimeLeft === null ? 1 : Math.max(0.02, lifetimeLeft);
    const a11y = title
        ? { role: "img" as const, "aria-label": title }
        : { "aria-hidden": true as const };
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 14 14"
            className={cn("shrink-0", className)}
            {...a11y}
        >
            {title && <title>{title}</title>}
            <circle
                cx="7"
                cy="7"
                r={r}
                className="fill-none stroke-line-strong"
                strokeWidth="1.2"
            />
            {!terminal && (
                <circle
                    cx="7"
                    cy="7"
                    r={r}
                    className={cn("fill-none", RING_CLASS[state])}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeDasharray={
                        lifetimeLeft === null
                            ? "2 2"
                            : `${fraction * circumference} ${circumference}`
                    }
                    transform="rotate(-90 7 7)"
                />
            )}
            <circle
                cx="7"
                cy="7"
                r="2.4"
                className={terminal ? "fill-none stroke-faint" : "fill-foreground"}
                strokeWidth={terminal ? 1 : undefined}
            />
        </svg>
    );
}
