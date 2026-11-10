import { Glyph, GLYPH_LABELS, VtxoGlyph, type GlyphKind } from "@/components/atlas/glyph";
import { Popover } from "@/components/atlas/popover";

const SHAPES: Array<{ kind: GlyphKind; note: string }> = [
    { kind: "block", note: "a tick on the rail, at its time" },
    { kind: "commitment", note: "anchored on its block" },
    { kind: "round", note: "on-chain tx at Second's server" },
    { kind: "ark", note: "off-chain, cosigned by the operator" },
    { kind: "checkpoint", note: "hop between a VTXO and its spender" },
    { kind: "tree", note: "branch from batch output to leaf" },
    { kind: "leaf", note: "onboard or refresh output" },
    { kind: "anchor", note: "zero-value fee-bump output" },
];

const COLOURS: Array<{ className: string; name: string; meaning: string }> = [
    { className: "bg-chain", name: "Amber", meaning: "on-chain, Bitcoin" },
    { className: "bg-virt", name: "Ice", meaning: "virtual (off-chain) layer" },
    { className: "bg-cp", name: "Indigo", meaning: "checkpoints" },
    { className: "bg-alert", name: "Coral", meaning: "exit window, expired" },
    { className: "bg-ok", name: "Mint", meaning: "settled, healthy" },
];

/** Shapes and colours of every Atlas map. Colour encodes layer, never vendor. */
export function LegendButton() {
    return (
        <Popover
            align="end"
            triggerClassName="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground aria-expanded:border-virt aria-expanded:text-foreground"
            trigger={
                <>
                    <Glyph kind="commitment" size={12} />
                    <span>Legend</span>
                </>
            }
            panelClassName="w-72"
        >
            <span className="micro mb-2 block text-faint">Shapes</span>
            {SHAPES.map(({ kind, note }) => (
                <span key={kind} className="flex items-center gap-2 py-[3px]">
                    <Glyph kind={kind} />
                    <span className="text-foreground">{GLYPH_LABELS[kind]}</span>
                    <span className="ml-auto text-right text-faint">{note}</span>
                </span>
            ))}
            <span className="flex items-center gap-2 py-[3px]">
                <VtxoGlyph state="settled" lifetimeLeft={0.65} />
                <span className="text-foreground">VTXO</span>
                <span className="ml-auto text-right text-faint">ring = lifetime left</span>
            </span>
            <span className="micro mb-2 mt-3 block text-faint">Colour = layer</span>
            {COLOURS.map(({ className, name, meaning }) => (
                <span key={name} className="flex items-center gap-2 py-[3px]">
                    <span className={`h-2.5 w-2.5 rounded-sm ${className}`} aria-hidden="true" />
                    <span className="text-foreground">{name}</span>
                    <span className="ml-auto text-faint">{meaning}</span>
                </span>
            ))}
        </Popover>
    );
}
