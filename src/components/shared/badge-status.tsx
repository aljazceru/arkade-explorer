import { Tag } from "@/components/atlas/tag";
import type { AtlasTone } from "@/lib/atlas/tones";
import type { SpentStatus } from "@/lib/vtxo-status";

const SPENT_TONES: Record<SpentStatus, AtlasTone> = {
    spendable: "ok",
    spent: "faint",
    unfinalized: "warning",
};

const SPENT_LABELS: Record<SpentStatus, string> = {
    spendable: "Unspent",
    spent: "Spent",
    unfinalized: "Unfinalized Spend",
};

export function BadgeStatus({ status, className }: { status: SpentStatus; className?: string }) {
    return (
        <Tag tone={SPENT_TONES[status]} className={className}>
            {SPENT_LABELS[status]}
        </Tag>
    );
}

export function BadgeRecoverable({ className }: { className?: string }) {
    return (
        <Tag
            tone="warning"
            className={className}
            title="Swept or past expiry: recovery requires operator cooperation"
        >
            Recoverable
        </Tag>
    );
}
