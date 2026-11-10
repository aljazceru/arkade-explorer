import { useMemo, type JSX, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import {
    formatSats,
    loadObservation,
    type ArkadeObservation,
    type BarkObservation,
} from "@/lib/observation";
import { formatSnapshotLabel } from "@/lib/overview-records";
import type { OperatorInfo } from "@arkade-os/sdk";
import {
    parseRelativeTimelock,
    timelockToSecondsAndBlocks,
    type RelativeTimelock,
} from "@/lib/vtxo-display";
import { useLiveSecond } from "@/hooks/use-live-second";
import type { SecondInfo } from "@/lib/live-second";
import { useNow } from "@/hooks/use-expiry";
import { useServerInfo } from "@/providers/server-info-provider";
import { medianBatchLifetimeSeconds } from "@/lib/atlas/ark-layer-data";
import { ARK_URL } from "@/lib/api/indexer";
import { Panel } from "@/components/atlas/panel";
import { cn } from "@/lib/utils";

/**
 * Operators panel: sampled/configured lifetime versus the reported exit delay,
 * plus operator parameters. This comparison is not a safe-exit guarantee.
 * Arkade lifetime comes from median batch (expiresAt − endedAt) across the
 * observation snapshot; Second lifetime/exit are block counts converted at the
 * nominal 600 s/block with the observed mean noted.
 */

type SourceMode = "live" | "snapshot" | "loading" | "unavailable";

function SourcePill({ mode, label }: { mode: SourceMode; label: string }) {
    const cls =
        mode === "live"
            ? "text-ok"
            : mode === "snapshot"
              ? "text-warning"
              : mode === "loading"
                ? "text-faint"
                : "text-alert";
    const dot =
        mode === "live"
            ? "bg-ok"
            : mode === "snapshot"
              ? "bg-warning"
              : mode === "loading"
                ? "bg-faint"
                : "bg-alert";
    return (
        <span className={cn("micro inline-flex items-center gap-1.5", cls)}>
            {mode === "loading" ? (
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
                <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden="true" />
            )}
            {label}
        </span>
    );
}

function Stat({
    label,
    value,
    mono = false,
    className,
    title,
}: {
    label: string;
    value: ReactNode;
    mono?: boolean;
    className?: string;
    title?: string;
}) {
    return (
        <div className={cn("min-w-0", className)} title={title}>
            <dt className="text-[11px] text-faint">{label}</dt>
            <dd
                className={cn(
                    "mt-0.5 break-words text-[12px] text-foreground",
                    mono && "font-mono",
                )}
            >
                {value}
            </dd>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Defensive value helpers — snapshot fields are `unknown`, live fields are bigint
// (ported verbatim from the old operator-cards).
// ---------------------------------------------------------------------------

function asBigIntSafe(value: unknown): bigint | null {
    if (value === null || value === undefined || value === "") return null;
    try {
        return BigInt(value as bigint | string | number);
    } catch {
        return null;
    }
}

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function formatSatsValue(value: unknown): string {
    const n = asBigIntSafe(value);
    if (n === null) return "—";
    if (n < 0n) return "unlimited";
    return formatSats(Number(n));
}

function parseTimelockSafe(raw: unknown): RelativeTimelock | null {
    if (raw === null || raw === undefined || raw === "") return null;
    try {
        return parseRelativeTimelock(raw as bigint);
    } catch {
        return null;
    }
}

type TimelockStat = { value: ReactNode; title?: string };

function timelockWithRaw(t: RelativeTimelock | null, raw: unknown): TimelockStat {
    if (!t) return { value: "—" };
    const n = asBigIntSafe(raw);
    const { seconds, blocks } = timelockToSecondsAndBlocks(t);
    const secondsLabel = humanDuration(seconds);
    const blocksLabel = `${blocks.toLocaleString("en-US")} blocks`;
    if (t.type === "seconds") {
        const rawStr = n !== null ? `${n.toLocaleString("en-US")} s` : String(raw);
        return {
            value: secondsLabel,
            title: `${rawStr} ≈ ${secondsLabel}, ~${blocksLabel}`,
        };
    }
    const rawStr = n !== null ? `${n.toLocaleString("en-US")} blocks` : String(raw);
    return {
        value: secondsLabel,
        title: `${rawStr} ≈ ${secondsLabel}, ~${blocksLabel}`,
    };
}

/** Compact sats for single-line stats: "330", "50M", "1.2k". */
function formatSatsCompact(value: unknown): string {
    const n = asBigIntSafe(value);
    if (n === null) return "—";
    if (n < 0n) return "unlimited";
    const v = Number(n);
    if (v >= 1_000_000)
        return `${(v / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
    if (v >= 1_000) return `${(v / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
    return v.toLocaleString("en-US");
}

function secondsToHuman(value: unknown): string {
    const n = toFiniteNumber(value);
    if (n === null) {
        const b = asBigIntSafe(value);
        if (b === null) return "—";
        return humanDuration(Number(b));
    }
    return humanDuration(n);
}

/**
 * Compact human duration: "~7 days" for multi-day values (no trailing zero
 * units), hours/minutes below a day, singularized. Negative/zero → "0 seconds".
 */
function humanDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"}`;
    if (days >= 1) return `~${unit(days, "day")}`;
    if (hours >= 1) {
        return minutes >= 1
            ? `${unit(hours, "hour")} ${unit(minutes, "minute")}`
            : unit(hours, "hour");
    }
    if (minutes >= 1) return unit(minutes, "minute");
    return unit(s, "second");
}

/** Compact "28 d" / "5 h" for single-line stat values (caller adds ≈). */
function compactDays(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(s / 86400);
    if (days >= 1) return `${days}d`;
    const hours = Math.floor(s / 3600);
    if (hours >= 1) return `${hours}h`;
    const minutes = Math.floor(s / 60);
    if (minutes >= 1) return `${minutes}m`;
    return `${s}s`;
}

type FeeEntry = { key: string; label: string; value: ReactNode };

const INTENT_FEE_LABELS: Record<string, string> = {
    offchainInput: "off-chain input",
    offchainOutput: "off-chain output",
    onchainInput: "on-chain input",
    onchainOutput: "on-chain output",
};

/**
 * Fee values may be CEL expressions rather than plain numbers. Numbers render
 * as sats; non-numeric renders "Conditional" with the raw expression behind a
 * `<details>` disclosure. Zero fees are omitted.
 */
function conditionalFeeValue(raw: unknown): ReactNode {
    const n = toFiniteNumber(raw);
    if (n === null) {
        const expression = String(raw);
        return (
            <details className="mt-0.5">
                <summary className="cursor-pointer text-xs text-faint">Conditional</summary>
                <code className="mt-1 block break-all text-xs font-mono text-faint">
                    {expression}
                </code>
            </details>
        );
    }
    return formatSats(n);
}

function feeEntriesFrom(fees: unknown): FeeEntry[] {
    const out: FeeEntry[] = [];
    if (fees === null || typeof fees !== "object") return out;
    const f = fees as Record<string, unknown>;
    const intent = (f.intentFee ?? {}) as Record<string, unknown>;
    for (const [key, label] of Object.entries(INTENT_FEE_LABELS)) {
        const raw = intent[key];
        if (raw === undefined || raw === null || raw === "") continue;
        const n = toFiniteNumber(raw);
        if (n === 0) continue;
        out.push({ key: `intent-${key}`, label, value: conditionalFeeValue(raw) });
    }
    const txFeeRate = f.txFeeRate;
    if (txFeeRate !== undefined && txFeeRate !== null && txFeeRate !== "") {
        const n = toFiniteNumber(txFeeRate);
        if (n !== 0) {
            out.push({ key: "tx-fee-rate", label: "tx fee rate", value: String(txFeeRate) });
        }
    }
    return out;
}

function snapshotAgeLabel(fetchedAt: string | null | undefined): string | null {
    if (!fetchedAt) return null;
    return formatSnapshotLabel(fetchedAt);
}

/** Arkade's off-chain input fee CEL → one readable sentence. */
function feeHuman(expr: unknown): string {
    if (!expr || typeof expr !== "string") return "no off-chain input fee";
    const m = expr.match(/expiry - now\(\) > ([\d.]+).*amount \* ([\d.]+) : 0\.0/);
    if (m) {
        const pct = parseFloat(m[2]) * 100;
        const pctStr =
            pct >= 1
                ? pct.toFixed(pct >= 10 ? 0 : 1).replace(/\.0$/, "") + "%"
                : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "%";
        const threshold = humanDuration(parseFloat(m[1]));
        return `${pctStr} of input when VTXO has > ${threshold} left, else free`;
    }
    return expr;
}

// ---------------------------------------------------------------------------
// Lifetime bar
// ---------------------------------------------------------------------------

function LifeBar({
    totalSec,
    exitSec,
    label,
}: {
    totalSec: number;
    exitSec: number;
    label: string;
}) {
    const exitPct = Math.min(100, (exitSec / totalSec) * 100);
    return (
        <div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-sm bg-secondary">
                <div
                    className="absolute inset-y-0 left-0 bg-virt/30"
                    style={{ width: `${100 - exitPct}%` }}
                />
                <div
                    className="absolute inset-y-0 right-0 bg-alert/80"
                    style={{ width: `${exitPct}%` }}
                />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                <span>0</span>
                <span>{label}</span>
                <span>{humanDuration(totalSec)}</span>
            </div>
        </div>
    );
}

function LegendSwatch({ tone, label }: { tone: "virt" | "alert"; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <i
                className={cn(
                    "inline-block h-2 w-2 rounded-sm",
                    tone === "virt" ? "bg-virt/30" : "bg-alert",
                )}
                aria-hidden="true"
            />
            {label}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Arkade block
// ---------------------------------------------------------------------------

function ArkadeBlock({
    serverInfo,
    serverInfoLoading,
    liveError,
    snapshot,
    snapshotLoading,
    snapshotError,
}: {
    serverInfo: OperatorInfo | null;
    serverInfoLoading: boolean;
    liveError: Error | null;
    snapshot: ArkadeObservation | null | undefined;
    snapshotLoading: boolean;
    snapshotError: Error | null;
}) {
    const useLive = serverInfo !== null;
    const useSnapshot = !useLive && snapshot != null;

    const info: Record<string, unknown> | null = useMemo(() => {
        if (useLive && serverInfo) return serverInfo as unknown as Record<string, unknown>;
        if (useSnapshot && snapshot) return snapshot.info ?? {};
        return null;
    }, [useLive, useSnapshot, serverInfo, snapshot]);

    const mode: SourceMode = useLive
        ? "live"
        : useSnapshot
          ? "snapshot"
          : snapshotLoading || serverInfoLoading
            ? "loading"
            : "unavailable";

    const pillLabel =
        mode === "live"
            ? "Live"
            : mode === "snapshot"
              ? "Snapshot"
              : mode === "loading"
                ? "Checking"
                : "Unavailable";

    const fetchedAt = snapshot?.fetched_at ?? null;
    const freshness = mode === "snapshot" ? snapshotAgeLabel(fetchedAt) : null;
    const hasError = liveError !== null || (!useLive && snapshotError !== null);
    const sourceText = liveError
        ? "Operator refresh failed · displayed parameters may be cached"
        : mode === "live"
          ? "Live · operator /v1/info"
          : mode === "snapshot"
            ? `Snapshot · ${freshness ?? "time unavailable"}`
            : mode === "loading"
              ? "Checking…"
              : "Unavailable";

    const version = info?.version != null ? String(info.version) : "—";
    const network = info?.network != null ? String(info.network) : "—";

    const exitRaw = info?.unilateralExitDelay;
    const exitTl = parseTimelockSafe(exitRaw);
    const boardingRaw = info?.boardingExitDelay;
    const boardingTl = parseTimelockSafe(boardingRaw);
    const exitStat = timelockWithRaw(exitTl, exitRaw);
    const boardingStat = timelockWithRaw(boardingTl, boardingRaw);
    const sessionRaw = info?.sessionDuration;
    const vtxoMin = info?.vtxoMinAmount;
    const vtxoMax = info?.vtxoMaxAmount;
    const fees = feeEntriesFrom(info?.fees);
    const feesObj =
        info?.fees !== null && typeof info?.fees === "object"
            ? (info.fees as Record<string, unknown>)
            : null;
    const intentFees = feesObj !== null && "intentFee" in feesObj ? feesObj.intentFee : undefined;
    const intentFeesObj =
        intentFees !== null && typeof intentFees === "object"
            ? (intentFees as Record<string, unknown>)
            : null;
    const offchainInputExpr = intentFeesObj?.offchainInput;

    // This is a sample of batch lifetimes, not a guaranteed lifetime for every VTXO.
    const { seconds: lifeSec, sampleCount } = medianBatchLifetimeSeconds(snapshot ?? null);
    const lifeLabel =
        lifeSec !== null ? `sampled batch exp − ended · n=${sampleCount}` : "unavailable";
    const exitSec = exitTl ? timelockToSecondsAndBlocks(exitTl).seconds : null;

    return (
        <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold text-foreground">Arkade</span>
                <span className="font-mono text-[10.5px] text-faint">{version}</span>
                <span className="ml-auto">
                    <SourcePill
                        mode={liveError ? "unavailable" : mode}
                        label={liveError ? "Refresh failed" : pillLabel}
                    />
                </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">
                {ARK_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")} · {network}
            </p>

            {lifeSec !== null && lifeSec > 0 && exitSec !== null ? (
                <div className="mt-3">
                    <LifeBar totalSec={lifeSec} exitSec={exitSec} label="Sampled batch lifetime" />
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <LegendSwatch
                            tone="virt"
                            label={`nominal remainder ${humanDuration(Math.max(0, lifeSec - exitSec))}`}
                        />
                        <LegendSwatch tone="alert" label={`exit delay ${humanDuration(exitSec)}`} />
                    </div>
                    <p className="mt-1 text-[10px] text-faint">
                        {snapshotAgeLabel(snapshot?.fetched_at)}
                    </p>
                </div>
            ) : (
                <p className="mt-3 text-[11px] text-faint">
                    Batch lifetime or exit delay unavailable.
                </p>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <Stat label="cadence" value={`session ${secondsToHuman(sessionRaw)}`} mono />
                <Stat
                    label="VTXO range"
                    value={`${formatSatsCompact(vtxoMin)} – ${formatSatsCompact(vtxoMax)}${formatSatsCompact(vtxoMax) === "unlimited" ? "" : " sats"}`}
                    mono
                    title={`${formatSatsValue(vtxoMin)} – ${formatSatsValue(vtxoMax)}`}
                />
                <Stat
                    label="board exit"
                    value={boardingStat.value}
                    title={boardingStat.title}
                    mono
                />
                <Stat label="exit delay" value={exitStat.value} title={exitStat.title} mono />
                {fees.length === 0 ? (
                    <Stat label="Fees" value="—" />
                ) : (
                    fees.map((fee) => (
                        <Stat key={fee.key} label={`Fee · ${fee.label}`} value={fee.value} mono />
                    ))
                )}
                <Stat label="life basis" value={lifeLabel} />
            </dl>
            <p
                className="mt-2 truncate text-[11px] text-faint"
                title={
                    typeof feesObj === "object" && feesObj !== null
                        ? JSON.stringify(feesObj)
                        : undefined
                }
            >
                fee · {feeHuman(offchainInputExpr)}
            </p>
            <p className="mt-2 text-[10.5px] text-faint">
                {sourceText}
                {hasError && <span className="text-alert"> — check connection</span>}
            </p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Second block
// ---------------------------------------------------------------------------

function SecondBlock({
    liveInfo,
    liveLoading,
    liveError,
    liveNextRoundAt,
    snapshot,
    snapshotLoading,
    snapshotError,
    meanBlockSec,
}: {
    liveInfo: SecondInfo | null;
    liveLoading: boolean;
    liveError: Error | null;
    liveNextRoundAt: number | null;
    snapshot: BarkObservation | null | undefined;
    snapshotLoading: boolean;
    snapshotError: Error | null;
    meanBlockSec: number | null;
}) {
    const info = snapshot?.info ?? {};
    const useLive =
        liveInfo !== null &&
        (liveInfo.exitDeltaBlocks !== null || liveInfo.vtxoLifetimeBlocks !== null);
    const useSnapshot = !useLive && snapshot != null;

    const mode: SourceMode = useLive
        ? "live"
        : useSnapshot
          ? "snapshot"
          : snapshotLoading || liveLoading
            ? "loading"
            : "unavailable";

    const pillLabel =
        mode === "live"
            ? "Live"
            : mode === "snapshot"
              ? "Snapshot"
              : mode === "loading"
                ? "Checking"
                : "Unavailable";

    const fetchedAt = snapshot?.fetched_at ?? null;
    const freshness = snapshotAgeLabel(fetchedAt);
    const hasError = liveError !== null || (!useLive && snapshotError !== null);
    const sourceText = liveError
        ? "Source refresh failed · displayed parameters may be cached"
        : mode === "live"
          ? freshness
              ? `Live gRPC · snapshot ${freshness.replace("Snapshot ", "")}`
              : "Live gRPC"
          : mode === "snapshot"
            ? `Snapshot · ${freshness ?? "time unavailable"}`
            : mode === "loading"
              ? "Checking…"
              : "Unavailable";

    const NOM = 600;
    const exitDelta = liveInfo?.exitDeltaBlocks ?? toFiniteNumber(info.vtxo_exit_delta);
    const lifetime = liveInfo?.vtxoLifetimeBlocks ?? toFiniteNumber(info.vtxo_lifetime);
    const lifetimeSec = lifetime !== null ? lifetime * NOM : null;
    const exitSec = exitDelta !== null ? exitDelta * NOM : null;
    const meanNoteText =
        meanBlockSec !== null && Math.round(meanBlockSec) !== NOM
            ? `block interval observed ≈${Math.round(meanBlockSec)} s (nominal 600 s)`
            : null;

    const roundSecs = toFiniteNumber(info.round_interval_secs);
    const maxVtxo = toFiniteNumber(info.max_vtxo_amount);
    const minBoard = toFiniteNumber(info.min_board_amount);
    const reqConf = toFiniteNumber(info.required_board_confirmations);
    const network = info.network != null ? String(info.network) : "—";

    const lastEvent = snapshot?.last_round_event ?? null;
    const lastEventFailed = lastEvent?.kind === "failed";
    const lastEventLabel = lastEvent
        ? `${lastEvent.kind ?? "unknown"}${lastEvent.round_seq != null ? ` #${lastEvent.round_seq}` : ""}`
        : "—";

    return (
        <div className="min-w-0 border-t border-border pt-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold text-foreground">Second</span>
                <span className="font-mono text-[10.5px] text-faint">grpc</span>
                <span className="ml-auto">
                    <SourcePill
                        mode={liveError ? "unavailable" : mode}
                        label={liveError ? "Refresh failed" : pillLabel}
                    />
                </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">
                ark.second.tech · {network}
            </p>

            {lifetimeSec !== null && lifetimeSec > 0 && exitSec !== null ? (
                <div className="mt-3">
                    <LifeBar
                        totalSec={lifetimeSec}
                        exitSec={exitSec}
                        label="Configured lifetime (nominal)"
                    />
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <LegendSwatch
                            tone="virt"
                            label={`nominal remainder ${humanDuration(Math.max(0, lifetimeSec - exitSec))}`}
                        />
                        <LegendSwatch tone="alert" label={`exit delay ${humanDuration(exitSec)}`} />
                    </div>
                </div>
            ) : (
                <p className="mt-3 text-[11px] text-faint">
                    Lifetime parameters {mode === "loading" ? "loading…" : "unavailable"}.
                </p>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <Stat
                    label="round interval"
                    value={roundSecs !== null ? `nominal ${humanDuration(roundSecs)}` : "—"}
                    mono
                />
                <Stat
                    label="VTXO life"
                    value={
                        lifetime !== null
                            ? `${lifetime.toLocaleString("en-US")} blk ≈ ${compactDays(lifetimeSec ?? 0)}`
                            : "—"
                    }
                    mono
                />
                <Stat
                    label="exit delta"
                    value={
                        exitDelta !== null
                            ? `${exitDelta.toLocaleString("en-US")} blk ≈ ${compactDays(exitSec ?? 0)}`
                            : "—"
                    }
                    mono
                />
                <Stat
                    label="max exit depth"
                    value={
                        toFiniteNumber(info.max_vtxo_exit_depth) !== null
                            ? String(info.max_vtxo_exit_depth)
                            : "—"
                    }
                    mono
                />
                <Stat
                    label="board conf"
                    value={reqConf !== null ? `${reqConf} blocks` : "—"}
                    mono
                />
                <Stat label="max VTXO" value={maxVtxo !== null ? formatSats(maxVtxo) : "—"} mono />
                <Stat
                    label="min board"
                    value={minBoard !== null ? formatSats(minBoard) : "—"}
                    mono
                />
                <Stat
                    label="last round"
                    value={
                        <span className={cn(lastEventFailed && "text-warning")}>
                            {lastEventLabel}
                        </span>
                    }
                    mono
                />
            </dl>
            <NextRoundInline nextRoundAt={liveNextRoundAt} />
            <p className="mt-2 text-[10.5px] text-faint">
                {sourceText}
                {hasError && <span className="text-alert"> — check connection</span>}
            </p>
            {meanNoteText && <p className="mt-1 text-[10px] text-faint/80">{meanNoteText}</p>}
        </div>
    );
}

function NextRoundInline({ nextRoundAt }: { nextRoundAt: number | null }) {
    const nowMs = useNow(30_000);
    if (nextRoundAt === null) return null;
    const left = nextRoundAt - nowMs / 1000;
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    return (
        <p className="mt-2 rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            {left <= 0
                ? "Reported round time passed · awaiting update"
                : `Server-announced round · in ≈${h}h ${m}m`}
        </p>
    );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function OperatorsPanel({
    meanBlockSec = null,
}: {
    meanBlockSec?: number | null;
}): JSX.Element {
    const { serverInfo, isLoading: serverInfoLoading, error: serverInfoError } = useServerInfo();
    const liveSecond = useLiveSecond();

    const arkadeSnapshotQuery = useQuery({
        // Same key + same source check as HomePage so the two cannot diverge:
        // a snapshot collected for a different operator must never render here.
        queryKey: ["observation", "arkade", ARK_URL],
        queryFn: async () => {
            const snapshot = await loadObservation<ArkadeObservation>("arkade");
            if (
                snapshot.source?.info?.replace(/\/+$/, "") !==
                `${ARK_URL.replace(/\/+$/, "")}/v1/info`
            ) {
                throw new Error(
                    "Arkade history snapshot does not identify the configured operator.",
                );
            }
            return snapshot;
        },
        staleTime: 15 * 60_000,
    });
    const barkSnapshotQuery = useQuery({
        queryKey: ["observation", "bark"],
        queryFn: () => loadObservation<BarkObservation>("bark"),
        staleTime: 15 * 60_000,
    });

    return (
        <Panel
            title="Operators"
            subtitle="Lifetime vs. exit delay — not a safe-exit guarantee"
            actions={
                <Link
                    to="/observe"
                    className="micro inline-flex items-center gap-1 text-virt hover:underline"
                >
                    Full operator details <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </Link>
            }
        >
            <div className="grid gap-5 px-4 py-4">
                <ArkadeBlock
                    serverInfo={serverInfo}
                    serverInfoLoading={serverInfoLoading}
                    liveError={serverInfoError}
                    snapshot={arkadeSnapshotQuery.data}
                    snapshotLoading={arkadeSnapshotQuery.isLoading}
                    snapshotError={
                        arkadeSnapshotQuery.error instanceof Error
                            ? arkadeSnapshotQuery.error
                            : null
                    }
                />
                <SecondBlock
                    liveInfo={liveSecond.info}
                    liveLoading={liveSecond.isLoading}
                    liveError={liveSecond.error}
                    liveNextRoundAt={liveSecond.nextRoundAt}
                    snapshot={barkSnapshotQuery.data}
                    snapshotLoading={barkSnapshotQuery.isLoading}
                    snapshotError={
                        barkSnapshotQuery.error instanceof Error ? barkSnapshotQuery.error : null
                    }
                    meanBlockSec={meanBlockSec}
                />
            </div>
        </Panel>
    );
}
