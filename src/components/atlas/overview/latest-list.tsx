import { Glyph, VtxoGlyph } from "@/components/atlas/glyph";
import { middleTruncate } from "@/components/atlas/hash";
import { formatSats } from "@/lib/observation";
import { formatRelativeTime } from "@/lib/formatters";
import { recordTimeSeconds, type OverviewRecord } from "@/lib/overview-records";
import { Panel } from "@/components/atlas/panel";
import { cn } from "@/lib/utils";

/**
 * Latest: the 12 newest activity rows across both lanes. Second rows open
 * mempool.space; Arkade rows open the inspector (which links onward).
 */
export function LatestList({
    records,
    onInspect,
}: {
    records: OverviewRecord[];
    onInspect: (recordId: string) => void;
}) {
    const latest = [...records]
        .sort((a, b) => {
            const ta = recordTimeSeconds(a);
            const tb = recordTimeSeconds(b);
            if (ta === null) return tb === null ? 0 : 1;
            if (tb === null) return -1;
            return tb - ta;
        })
        .slice(0, 12);

    return (
        <Panel title="Latest" subtitle="Newest activity across both lanes" className="self-start">
            <ul className="divide-y divide-border">
                {latest.length === 0 && (
                    <li className="px-4 py-6 text-center text-xs text-faint">No activity yet.</li>
                )}
                {latest.map((record) => {
                    const timeSec = recordTimeSeconds(record);
                    const isSecond = record.network === "second";
                    return (
                        <li key={record.id}>
                            <button
                                type="button"
                                onClick={() => {
                                    if (isSecond) {
                                        window.open(
                                            `https://mempool.space/tx/${record.txid}`,
                                            "_blank",
                                        );
                                    } else {
                                        onInspect(record.id);
                                    }
                                }}
                                className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-secondary/50"
                            >
                                <span className="shrink-0">
                                    {record.entity === "vtxo" ? (
                                        <VtxoGlyph
                                            state={
                                                record.status === "urgent"
                                                    ? "renew"
                                                    : record.status === "expired"
                                                      ? "expired"
                                                      : record.status === "unknown" ||
                                                          record.status === "swept"
                                                        ? "unknown"
                                                        : record.status === "spent"
                                                          ? "spent"
                                                          : record.status === "unrolled"
                                                            ? "unrolled"
                                                            : "preconfirmed"
                                            }
                                            lifetimeLeft={null}
                                            size={14}
                                        />
                                    ) : record.kind === "commitment" ? (
                                        <Glyph kind="commitment" size={14} />
                                    ) : (
                                        <Glyph kind="round" size={14} />
                                    )}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm text-foreground">
                                        {record.typeLabel} ·{" "}
                                        <span className="font-mono text-xs text-faint">
                                            {middleTruncate(record.txid, 9)}
                                        </span>
                                    </span>
                                    <span
                                        className={cn(
                                            "micro",
                                            record.network === "arkade"
                                                ? "text-virt"
                                                : "text-chain",
                                        )}
                                    >
                                        {record.network === "arkade" ? "Arkade" : "Second"}
                                    </span>
                                </span>
                                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                    {record.amountSat !== null
                                        ? formatSats(record.amountSat).replace(/ sats$/, "")
                                        : "—"}
                                </span>
                                <span className="w-16 shrink-0 text-right font-mono text-xs text-faint">
                                    {timeSec !== null ? formatRelativeTime(timeSec * 1000) : "—"}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </Panel>
    );
}
