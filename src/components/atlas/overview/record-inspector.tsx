import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import { formatBtc, formatDuration, formatSats, truncateId } from "@/lib/observation";
import { formatRecordTime, formatSnapshotLabel, type OverviewRecord } from "@/lib/overview-records";
import { Tag } from "@/components/atlas/tag";
import type { AtlasTone } from "@/lib/atlas/tones";
import { cn } from "@/lib/utils";

/**
 * Record inspector: the old RecordDetail drawer, restyled with Atlas tokens.
 * One Radix Dialog serves both breakpoints — a non-modal right drawer on wide
 * screens, a bottom sheet (right drawer ≥641px) on narrow ones. `block:<height>`
 * ids resolve to synthetic block records built by the page.
 */

/** Status → Atlas tag tone. Colour never carries meaning alone: the label does. */
const STATUS_TONES: Record<OverviewRecord["status"], AtlasTone> = {
    urgent: "warning",
    expired: "alert",
    unknown: "warning",
    spent: "faint",
    swept: "warning",
    unrolled: "chain",
    healthy: "virt",
    confirmed: "chain",
    observed: "neutral",
    locked: "faint",
};

export function RecordStatusTag({ record }: { record: OverviewRecord }) {
    // A live source tag must never mask a risk state: only healthy/observed/
    // confirmed/locked live rows collapse to "Live". urgent/expired/unknown/
    // spent always surface their real status.
    const SAFE_LIVE = new Set<OverviewRecord["status"]>([
        "healthy",
        "observed",
        "confirmed",
        "locked",
    ]);
    if (record.liveSource === true && SAFE_LIVE.has(record.status)) {
        return <Tag tone="neutral">Live</Tag>;
    }
    return (
        <Tag tone={STATUS_TONES[record.status]} dashed={record.status === "unknown"}>
            {record.statusLabel}
        </Tag>
    );
}

function ExpiryMeter({ record }: { record: OverviewRecord }) {
    const live = record.liveSource === true;
    const sourceName = liveSourceName(record);
    if (record.leftSeconds === null) {
        return (
            <section
                className="space-y-3 border-t border-border pt-4"
                aria-labelledby="expiry-meter-title"
            >
                <div className="flex items-center justify-between gap-3">
                    <h4 id="expiry-meter-title" className="text-sm font-medium text-foreground">
                        Time to expiry
                    </h4>
                    <span className="text-xs text-warning">Unknown</span>
                </div>
                <div
                    className="h-3 rounded-full border border-dashed border-warning/50 bg-warning/5"
                    role="img"
                    aria-label={
                        live
                            ? `Expiry unknown in live ${sourceName} data`
                            : "Expiry unknown in this snapshot"
                    }
                />
                <p className="text-xs text-muted-foreground">
                    {live
                        ? `No expiry evidence in this live ${sourceName} data`
                        : "No expiry evidence in this snapshot"}
                </p>
            </section>
        );
    }

    const leftSeconds = record.leftSeconds;
    const lifetimeFromDates =
        record.createdAtSeconds !== null && record.expiresAtSeconds !== null
            ? record.expiresAtSeconds - record.createdAtSeconds
            : null;
    const hasRecordedLifetime = lifetimeFromDates !== null && lifetimeFromDates > 0;
    const fallbackLifetime = Math.max(leftSeconds, record.exitSeconds ?? 0, 1);
    const lifetimeSeconds = hasRecordedLifetime ? lifetimeFromDates : fallbackLifetime;
    const exitWidth =
        record.exitSeconds === null
            ? 0
            : Math.min(100, (record.exitSeconds / lifetimeSeconds) * 100);
    const fillWidth = Math.max(0, Math.min(100, (leftSeconds / lifetimeSeconds) * 100));
    const insideExitWindow = record.exitSeconds !== null && leftSeconds <= record.exitSeconds;
    const lifetimeLabel = hasRecordedLifetime
        ? `Lifetime · ${formatDuration(lifetimeSeconds)}`
        : record.exitSeconds === null
          ? "Exit window unavailable"
          : "Scale relative to exit window";

    return (
        <section
            className="space-y-3 border-t border-border pt-4"
            aria-labelledby="expiry-meter-title"
        >
            <div className="flex items-center justify-between gap-3">
                <h4 id="expiry-meter-title" className="text-sm font-medium text-foreground">
                    Time to expiry
                </h4>
                <span
                    className={cn(
                        "text-xs",
                        insideExitWindow ? "font-medium text-alert" : "text-muted-foreground",
                    )}
                >
                    {leftSeconds <= 0 ? "Expired" : `${formatDuration(leftSeconds)} left`}
                </span>
            </div>
            <div
                className="relative h-3 overflow-hidden rounded-full bg-secondary"
                role="img"
                aria-label={`${formatDuration(leftSeconds)} remaining; ${lifetimeLabel}${record.exitSeconds === null ? "; unilateral exit window unavailable" : `; exit window ${formatDuration(record.exitSeconds)}`}`}
            >
                <span
                    className={cn(
                        "absolute inset-y-0 left-0 rounded-full",
                        insideExitWindow ? "bg-alert" : "bg-virt",
                    )}
                    style={{ width: `${fillWidth}%` }}
                />
                {exitWidth > 0 && (
                    <span
                        className="absolute inset-y-0 left-0 bg-alert/20"
                        style={{ width: `${exitWidth}%` }}
                    />
                )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-alert/40" aria-hidden="true" />
                    Exit window
                    {record.exitSeconds !== null && ` · ${formatDuration(record.exitSeconds)}`}
                </span>
                <span>{lifetimeLabel}</span>
            </div>
        </section>
    );
}

function liveSourceKind(record: OverviewRecord): "barkd" | "operator" | "on-chain" | "other" {
    const sourceLabel = record.sourceLabel.toLowerCase();
    if (sourceLabel.includes("barkd")) return "barkd";
    if (sourceLabel.includes("operator indexer")) return "operator";
    if (
        sourceLabel.includes("mempool") ||
        sourceLabel.includes("on-chain") ||
        record.network === "second"
    ) {
        return "on-chain";
    }
    return "other";
}

function liveSourceName(record: OverviewRecord): string {
    switch (liveSourceKind(record)) {
        case "barkd":
            return "barkd";
        case "operator":
            return "configured operator indexer";
        case "on-chain":
            return record.sourceLabel.toLowerCase().includes("mempool")
                ? "mempool"
                : "block explorer";
        default:
            return "live source";
    }
}

function liveFootnoteFor(record: OverviewRecord, panel: boolean): string {
    switch (liveSourceKind(record)) {
        case "barkd":
            return panel
                ? "Live barkd data only · no funds moved"
                : "Live barkd data only · this explorer cannot move funds.";
        case "operator":
            return panel
                ? "Fetched live from the configured operator · no funds moved"
                : "This record is fetched live from the configured operator · this explorer cannot move funds.";
        case "on-chain":
            return panel
                ? "Live on-chain data from the block explorer · on-chain confirmation does not prove off-chain spendability"
                : "Live on-chain data from the block explorer · on-chain confirmation does not prove off-chain spendability.";
        default:
            return panel
                ? `Live data from ${record.sourceLabel} · no funds moved`
                : `Live data from ${record.sourceLabel} · this explorer cannot move funds.`;
    }
}

function calloutFor(record: OverviewRecord): { title: string; note: string; warning: boolean } {
    // Risk states outrank the live-source banner: a live VTXO with unknown or
    // urgent expiry must surface the warning, not a benign "Live" note.
    const riskStatus =
        record.entity === "vtxo" &&
        (record.status === "urgent" ||
            record.status === "expired" ||
            record.status === "unknown" ||
            record.status === "spent" ||
            record.status === "swept" ||
            record.status === "unrolled");
    if (record.liveSource === true && !riskStatus) {
        switch (liveSourceKind(record)) {
            case "barkd":
                return {
                    title: "Live via barkd",
                    note:
                        "This VTXO is reported by your connected barkd instance. " +
                        "The explorer cannot move funds.",
                    warning: false,
                };
            case "operator":
                return {
                    title: "Live via operator indexer",
                    note:
                        "This record is fetched live from the configured operator. " +
                        "The explorer cannot move funds.",
                    warning: false,
                };
            case "on-chain":
                return {
                    title: "Live on-chain data",
                    note:
                        "This is live on-chain data from the block explorer. " +
                        "On-chain confirmation does not prove off-chain spendability.",
                    warning: false,
                };
            default:
                return {
                    title: "Live data",
                    note: `This record is reported by ${record.sourceLabel}. The explorer cannot move funds.`,
                    warning: false,
                };
        }
    }
    if (record.status === "urgent") {
        return {
            title: "Inside the exit window",
            note: "The snapshot places this VTXO inside or at the unilateral exit window. Expiry has not been re-verified against a live chain tip.",
            warning: true,
        };
    }
    if (record.status === "expired") {
        return {
            title: "Expired in the snapshot",
            note: "The snapshot reports this VTXO expired. This page cannot execute a sweep or verify current chain state.",
            warning: true,
        };
    }
    if (record.status === "unknown") {
        if (record.network === "arkade" && record.leftSeconds !== null) {
            return {
                title: "Exit window unavailable",
                note: "A remaining time is present in the snapshot, but the live unilateral exit delay is unavailable. Review the expiry evidence without treating this as safe.",
                warning: true,
            };
        }
        return {
            title: "No expiry evidence",
            note: "No expiry evidence is present in this snapshot. Unknown does not mean safe.",
            warning: true,
        };
    }
    if (record.status === "healthy") {
        return {
            title: "Outside the exit window in the snapshot",
            note: "The snapshot reports more time remaining than the configured unilateral exit delay. Current expiry is not live-verified.",
            warning: false,
        };
    }
    if (record.status === "spent") {
        return {
            title: "Spent",
            note: "This output is reported spent by the source. A spent VTXO is not a live coin; its sats moved to a successor output.",
            warning: false,
        };
    }
    if (record.status === "swept") {
        return {
            title: "Swept · operator recovery required",
            note: "The operator has swept this VTXO. Recovery may be possible through the operator's exit flow — this is not a safe unspent coin.",
            warning: true,
        };
    }
    if (record.status === "unrolled") {
        return {
            title: "Exit started",
            note: "A unilateral exit has been initiated for this VTXO. It is no longer a normal unspent coin; the exit transaction is propagating on-chain.",
            warning: false,
        };
    }
    if (record.network === "second") {
        return {
            title: "On-chain transaction observed",
            note: "This is an on-chain transaction observed at the Second server address. It does not reveal individual VTXOs or prove spendability.",
            warning: false,
        };
    }
    return {
        title: record.status === "confirmed" ? "On-chain commitment" : "Commitment observed",
        note: "A commitment transaction anchors a batch on Bitcoin. Confirmation does not prove that a virtual output is currently spendable.",
        warning: false,
    };
}

function RecordContent({ record }: { record: OverviewRecord }) {
    const [copyMessage, setCopyMessage] = useState("");
    const live = record.liveSource === true;
    const chainAnchor = record.chainAnchor ?? null;
    const chainAnchorTxid = chainAnchor?.split(":")[0];
    const callout = calloutFor(record);
    const transactionHref =
        record.network === "second"
            ? `https://mempool.space/tx/${record.txid}`
            : record.kind === "commitment"
              ? `/commitment-tx/${record.txid}`
              : `/tx/${record.txid}`;
    const isBlockRecord = record.id.startsWith("block:");

    async function copyTransactionId() {
        try {
            await navigator.clipboard.writeText(record.txid);
            setCopyMessage("Transaction ID copied");
        } catch {
            setCopyMessage("Clipboard unavailable. Select the transaction ID to copy it.");
        }
    }

    async function copyJson() {
        try {
            await navigator.clipboard.writeText(JSON.stringify(record, null, 2));
            setCopyMessage("JSON copied");
        } catch {
            setCopyMessage("Clipboard unavailable. Select the content to copy it.");
        }
    }

    return (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isBlockRecord ? (
                    <span>Bitcoin · block</span>
                ) : (
                    <>
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-secondary text-foreground">
                            {record.network === "arkade" ? "A" : "S"}
                        </span>
                        {record.network === "arkade" ? "Arkade" : "Second"} · {record.typeLabel}
                    </>
                )}
            </div>
            <div>
                <h3 className="break-words text-lg font-semibold text-foreground">
                    {record.label}
                </h3>
                <div className="mt-3">
                    <RecordStatusTag record={record} />
                </div>
            </div>
            <div>
                {record.amountSat === null ? (
                    <p className="text-3xl font-semibold tracking-tight text-muted-foreground">
                        {isBlockRecord ? record.label : "Amount unavailable"}
                    </p>
                ) : (
                    <>
                        <p className="text-3xl font-semibold tracking-tight text-foreground">
                            {formatSats(record.amountSat).replace(/ sats$/, "")}{" "}
                            <span className="text-base font-medium text-muted-foreground">
                                sats
                            </span>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            ≈ {formatBtc(record.amountSat)}
                            {record.amountLabel ? ` · ${record.amountLabel}` : ""}
                        </p>
                    </>
                )}
                {record.amountSat === null && record.amountLabel && !isBlockRecord && (
                    <p className="mt-1 text-xs text-faint">{record.amountLabel}</p>
                )}
            </div>

            {(record.entity === "vtxo" ||
                (record.network === "arkade" && record.status === "unknown")) && (
                <ExpiryMeter record={record} />
            )}

            <dl className="divide-y divide-border border-y border-border">
                <div className="flex justify-between gap-4 py-3 text-sm">
                    <dt className="shrink-0 text-muted-foreground">Recorded</dt>
                    <dd className="text-right text-foreground">
                        {live && record.recordedAt == null
                            ? `Not reported by ${liveSourceName(record)}`
                            : formatRecordTime(record.recordedAt)}
                    </dd>
                </div>
                <div className="flex justify-between gap-4 py-3 text-sm">
                    <dt className="shrink-0 text-muted-foreground">Source</dt>
                    <dd className="text-right text-foreground">{record.sourceLabel}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3 text-sm">
                    <dt className="shrink-0 text-muted-foreground">Freshness</dt>
                    <dd className="text-right text-foreground">
                        {live
                            ? record.sourceLabel.toLowerCase().includes("live")
                                ? record.sourceLabel
                                : `Live · ${record.sourceLabel}`
                            : formatSnapshotLabel(record.snapshotFetchedAt)}
                    </dd>
                </div>
                <div className="flex justify-between gap-4 py-3 text-sm">
                    <dt className="shrink-0 text-muted-foreground">Data</dt>
                    <dd className="text-right text-foreground">{live ? "Live" : "Snapshot"}</dd>
                </div>
                {record.policyType != null && (
                    <div className="flex justify-between gap-4 py-3 text-sm">
                        <dt className="shrink-0 text-muted-foreground">Policy</dt>
                        <dd className="text-right text-foreground">{record.policyType}</dd>
                    </div>
                )}
                {record.exitDeltaBlocks != null && (
                    <div className="flex justify-between gap-4 py-3 text-sm">
                        <dt className="shrink-0 text-muted-foreground">Exit delta</dt>
                        <dd className="text-right text-foreground">
                            {record.exitDeltaBlocks} blocks · ≈
                            {formatDuration(record.exitDeltaBlocks * 600)} (nominal)
                        </dd>
                    </div>
                )}
                {record.expiryHeight != null && (
                    <div className="flex justify-between gap-4 py-3 text-sm">
                        <dt className="shrink-0 text-muted-foreground">Expiry height</dt>
                        <dd className="text-right text-foreground">
                            {record.expiryHeight.toLocaleString("en-US")}
                        </dd>
                    </div>
                )}
                {record.exitDepth != null && (
                    <div className="flex justify-between gap-4 py-3 text-sm">
                        <dt className="shrink-0 text-muted-foreground">Exit depth</dt>
                        <dd className="text-right text-foreground">
                            {record.exitDepth} transaction{record.exitDepth === 1 ? "" : "s"} to
                            exit
                        </dd>
                    </div>
                )}
                {chainAnchor != null && chainAnchorTxid && (
                    <div className="flex justify-between gap-4 py-3 text-sm">
                        <dt className="shrink-0 text-muted-foreground">Chain anchor</dt>
                        <dd className="min-w-0 text-right">
                            <a
                                href={`https://mempool.space/tx/${chainAnchorTxid}`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open chain anchor ${chainAnchorTxid} (External link)`}
                                className="inline-flex max-w-full items-center gap-1 text-virt hover:underline"
                            >
                                <span className="truncate font-mono" title={chainAnchor}>
                                    {truncateId(chainAnchor)}
                                </span>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            </a>
                        </dd>
                    </div>
                )}
            </dl>

            {!isBlockRecord && (
                <section className="space-y-2" aria-labelledby="transaction-id-title">
                    <div className="flex items-center justify-between gap-3">
                        <h4
                            id="transaction-id-title"
                            className="text-sm font-medium text-foreground"
                        >
                            Transaction ID
                        </h4>
                        <button
                            type="button"
                            onClick={copyJson}
                            aria-label={copyMessage === "JSON copied" ? "JSON copied" : "Copy JSON"}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                            {copyMessage === "JSON copied" ? (
                                <>
                                    <Check className="h-3.5 w-3.5 text-ok" aria-hidden="true" />
                                    Copied
                                </>
                            ) : (
                                <>
                                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                    Copy JSON
                                </>
                            )}
                        </button>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-secondary/50 p-2">
                        <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                            {record.txid}
                        </code>
                        <button
                            type="button"
                            onClick={copyTransactionId}
                            aria-label={
                                copyMessage === "Transaction ID copied"
                                    ? "Transaction ID copied"
                                    : "Copy transaction ID"
                            }
                            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                            {copyMessage === "Transaction ID copied" ? (
                                <Check className="h-4 w-4 text-ok" />
                            ) : (
                                <Copy className="h-4 w-4" />
                            )}
                        </button>
                    </div>
                    <p className="sr-only" aria-live="polite">
                        {copyMessage}
                    </p>
                    {(!live || record.entity !== "vtxo") &&
                        (record.network === "second" ? (
                            <a
                                href={transactionHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open transaction (External link)"
                                className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
                            >
                                Open transaction
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                        ) : (
                            <Link
                                to={transactionHref}
                                className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
                            >
                                Open transaction
                            </Link>
                        ))}
                </section>
            )}

            {record.commitmentTxids.length > 0 && (
                <section className="space-y-2" aria-labelledby="related-commitments-title">
                    <h4
                        id="related-commitments-title"
                        className="text-sm font-medium text-foreground"
                    >
                        Related commitments
                    </h4>
                    <ul className="space-y-1">
                        {record.commitmentTxids.map((txid) => (
                            <li key={txid}>
                                <Link
                                    to={`/commitment-tx/${txid}`}
                                    className="font-mono text-xs text-virt hover:underline"
                                >
                                    {truncateId(txid)}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div
                className={cn(
                    "rounded-lg border p-3",
                    callout.warning
                        ? "border-warning/40 bg-warning/10"
                        : "border-border bg-secondary/50",
                )}
            >
                <h4
                    className={cn(
                        "text-sm font-semibold",
                        callout.warning ? "text-warning" : "text-foreground",
                    )}
                >
                    {callout.title}
                </h4>
                <p className="mt-1 text-sm text-muted-foreground">{callout.note}</p>
            </div>
            <p className="text-xs text-muted-foreground">
                {live
                    ? liveFootnoteFor(record, false)
                    : "Snapshot evidence only · this explorer cannot move funds."}
            </p>
        </div>
    );
}

export function RecordInspector({
    record,
    onClose,
}: {
    record: OverviewRecord | null;
    onClose: () => void;
}) {
    const lastSelectedId = useRef<string | null>(null);

    useEffect(() => {
        if (record) lastSelectedId.current = record.id;
    }, [record]);
    return (
        <Dialog.Root
            open={record !== null}
            onOpenChange={(open) => {
                if (!open) {
                    if (record) lastSelectedId.current = record.id;
                    onClose();
                }
            }}
        >
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm" />
                <Dialog.Content
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        const selectedId = lastSelectedId.current;
                        if (selectedId) {
                            Array.from(document.querySelectorAll<HTMLElement>("[data-record-id]"))
                                .find((element) => element.dataset.recordId === selectedId)
                                ?.focus();
                        }
                    }}
                    className="fixed inset-x-0 bottom-0 z-50 flex h-[min(90dvh,48rem)] max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl focus:outline-none min-[641px]:inset-y-0 min-[641px]:left-auto min-[641px]:right-0 min-[641px]:h-dvh min-[641px]:max-h-dvh min-[641px]:w-[min(30rem,92vw)] min-[641px]:rounded-l-2xl min-[641px]:rounded-r-none min-[641px]:border-y-0 min-[641px]:border-l"
                >
                    <div className="flex items-center justify-between border-b border-border px-5 py-4">
                        <Dialog.Title className="text-base font-semibold text-foreground">
                            Transaction details
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label="Close details"
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            >
                                <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="sr-only">
                        {record !== null && record.liveSource === true
                            ? `Live details from ${liveSourceName(record)} for the selected transaction.`
                            : "Snapshot details for the selected transaction."}
                    </Dialog.Description>
                    {record && <RecordContent key={record.id} record={record} />}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
