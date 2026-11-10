import { Tag } from "@/components/atlas/tag";
import { ATLAS_STATE_META, type AtlasVtxoState } from "@/lib/atlas/vtxo-state";

/** The single state label for a VTXO; the exit-window state carries a ▲. */
export function VtxoStateTag({ state, className }: { state: AtlasVtxoState; className?: string }) {
    const meta = ATLAS_STATE_META[state];
    return (
        <Tag tone={meta.tone} dashed={meta.dashed} title={meta.description} className={className}>
            {state === "renew" && <span aria-hidden="true">▲</span>}
            {meta.label}
        </Tag>
    );
}
