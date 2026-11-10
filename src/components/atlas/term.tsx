import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/atlas/glossary";
import { Popover } from "@/components/atlas/popover";

/** Jargon with a one-sentence definition on click: `<Term k="vtxo" />`. */
export function Term({
    k,
    children,
    side = "top",
}: {
    k: GlossaryKey;
    children?: ReactNode;
    side?: "top" | "bottom";
}) {
    const entry = GLOSSARY[k];
    return (
        <Popover
            side={side}
            trigger={children ?? entry.term}
            triggerLabel={`What is ${entry.term}?`}
            triggerClassName="cursor-help border-b border-dotted border-virt/70 leading-tight text-inherit hover:text-virt"
        >
            <span className="mb-1 block font-semibold text-foreground">{entry.term}</span>
            {entry.text}
        </Popover>
    );
}
