import { readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;
type Pass = boolean | "WARN" | "SKIPPED";
type Check = {
    section: string;
    check: string;
    expected: unknown;
    actual?: unknown;
    pass: Pass;
};
type SnapshotVtxo = JsonRecord & {
    txid?: string;
    vout?: number;
    txType?: string;
    amount_sat?: unknown;
    left_seconds?: unknown;
    urgent?: unknown;
    expired?: unknown;
    isSpent?: unknown;
    spentBy?: unknown;
    settledBy?: unknown;
    commitmentTxids?: unknown;
};
type ArkadeSnapshot = JsonRecord & {
    fetched_at?: string;
    info?: JsonRecord;
    vtxos?: SnapshotVtxo[];
    commitments?: Record<string, JsonRecord>;
};
type BarkSnapshot = JsonRecord & {
    info?: JsonRecord;
    next_round_unix?: unknown;
    recent_server_txs?: JsonRecord[];
};
type ArkadeStatus = "terminal" | "expired" | "unknown" | "urgent" | "healthy";
type ClassifiedVtxo = {
    row: SnapshotVtxo;
    status: ArkadeStatus;
    terminal: boolean;
    needsReview: boolean;
    leftSeconds: number | null;
};
type Options = {
    json: boolean;
    live: boolean;
    sample: number;
    tip: number | null;
    indexer: string | null;
    esplora: string;
};

const BLOCK_SECONDS = 600;
const TIMELOCK_SECONDS_THRESHOLD = 512;
const DEFAULT_SAMPLE = 5;
const WORKED_EXAMPLE_TIP = 905000;

function finiteNumber(value: unknown): number | null {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function describeRelativeTimelock(
    raw: unknown,
): { seconds: number; interpretation: string } | null {
    const value = finiteNumber(raw);
    if (value === null) return null;
    if (value >= TIMELOCK_SECONDS_THRESHOLD) {
        return { seconds: value, interpretation: `${value} seconds (raw value >= 512)` };
    }
    return {
        seconds: value * BLOCK_SECONDS,
        interpretation: `${value} blocks × ${BLOCK_SECONDS} seconds/block`,
    };
}

function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function toUnixSeconds(value: unknown): number | null {
    const numeric = finiteNumber(value);
    if (numeric !== null) return numeric > 1e12 ? Math.floor(numeric / 1000) : numeric;
    if (typeof value !== "string") return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function classifyArkadeVtxo(row: SnapshotVtxo, exitSeconds: number | null): ClassifiedVtxo {
    const leftSeconds = finiteNumber(row.left_seconds);
    const expired = row.expired === true || (leftSeconds !== null && leftSeconds <= 0);
    const terminal = row.isSpent === true || Boolean(row.spentBy) || Boolean(row.settledBy);
    const unknownLifetime = leftSeconds === null;
    const urgent =
        !terminal &&
        !expired &&
        leftSeconds !== null &&
        (row.urgent === true || (exitSeconds !== null && leftSeconds <= exitSeconds));
    const needsReview = row.urgent === true || urgent || expired || unknownLifetime;

    let status: ArkadeStatus;
    if (terminal) {
        status = "terminal";
    } else if (expired) {
        status = "expired";
    } else if (unknownLifetime || (exitSeconds === null && row.urgent !== true)) {
        status = "unknown";
    } else if (urgent) {
        status = "urgent";
    } else {
        status = "healthy";
    }

    return {
        row,
        status,
        terminal,
        needsReview,
        leftSeconds,
    };
}

function readOptions(args: string[]): Options {
    const options: Options = {
        json: false,
        live: false,
        sample: DEFAULT_SAMPLE,
        tip: null,
        indexer: process.env.ARK_OBS_INDEXER?.trim() || null,
        esplora: process.env.ARK_OBS_ESPLORA?.trim() || "https://mempool.space/api",
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--json") {
            options.json = true;
        } else if (arg === "--live") {
            options.live = true;
        } else if (arg === "--sample" || arg.startsWith("--sample=")) {
            const raw = arg === "--sample" ? args[++index] : arg.slice("--sample=".length);
            const sample = Number(raw);
            if (!Number.isInteger(sample) || sample < 0) {
                throw new Error("--sample requires a non-negative integer");
            }
            options.sample = sample;
        } else if (arg === "--tip" || arg.startsWith("--tip=")) {
            const raw = arg === "--tip" ? args[++index] : arg.slice("--tip=".length);
            const tip = Number(raw);
            if (!Number.isInteger(tip) || tip < 0) {
                throw new Error("--tip requires a non-negative integer height");
            }
            options.tip = tip;
        } else if (arg === "--indexer" || arg.startsWith("--indexer=")) {
            const raw = arg === "--indexer" ? args[++index] : arg.slice("--indexer=".length);
            if (!raw) throw new Error("--indexer requires an endpoint URL");
            options.indexer = raw;
        } else if (arg === "--esplora" || arg.startsWith("--esplora=")) {
            const raw = arg === "--esplora" ? args[++index] : arg.slice("--esplora=".length);
            if (!raw) throw new Error("--esplora requires an endpoint URL");
            options.esplora = raw;
        } else if (arg === "--help" || arg === "-h") {
            process.stdout.write(
                "Usage: node scripts/validate-numbers.ts [--json] [--live] [--indexer URL] [--esplora URL] [--sample N] [--tip HEIGHT]\n",
            );
            process.exit(0);
        } else {
            throw new Error(`unknown option: ${arg}`);
        }
    }
    return options;
}

function addCheck(
    checks: Check[],
    section: string,
    check: string,
    expected: unknown,
    actual: unknown,
    pass: Pass,
): void {
    checks.push({
        section,
        check,
        expected,
        ...(actual === undefined ? {} : { actual }),
        pass,
    });
}

function sumFinite(values: unknown[]): number {
    return values.reduce<number>((sum, value) => sum + (finiteNumber(value) ?? 0), 0);
}

function summarizeArkade(arkade: ArkadeSnapshot, exitSeconds: number | null) {
    const vtxos = Array.isArray(arkade.vtxos) ? arkade.vtxos : [];
    const classified = vtxos.map((row) => classifyArkadeVtxo(row, exitSeconds));
    const statusCounts: Record<ArkadeStatus, number> = {
        terminal: 0,
        expired: 0,
        unknown: 0,
        urgent: 0,
        healthy: 0,
    };
    for (const row of classified) statusCounts[row.status] += 1;

    const reviewRows = classified.filter((row) => row.needsReview);
    const finiteLeftValues = classified
        .map((row) => row.leftSeconds)
        .filter((value): value is number => value !== null);
    const nearestSeconds = finiteLeftValues.length === 0 ? null : Math.min(...finiteLeftValues);
    const virtualTxids = new Set<string>();
    const commitmentTxids = new Set<string>(Object.keys(arkade.commitments ?? {}));

    for (const row of vtxos) {
        if (typeof row.txid === "string") {
            if (row.txType !== "commitment") virtualTxids.add(row.txid);
            else commitmentTxids.add(row.txid);
        }
        if (Array.isArray(row.commitmentTxids)) {
            for (const txid of row.commitmentTxids) {
                if (typeof txid === "string") commitmentTxids.add(txid);
            }
        }
    }

    const commitments = Object.values(arkade.commitments ?? {});
    const confirmedCommitmentCount = commitments.filter((commitment) => {
        const onchain = commitment._onchain;
        return (
            onchain !== null &&
            typeof onchain === "object" &&
            finiteNumber((onchain as JsonRecord).block_height) !== null
        );
    }).length;
    const statsExpiredCount = vtxos.filter((row) => {
        const leftSeconds = finiteNumber(row.left_seconds);
        return row.expired === true || (leftSeconds !== null && leftSeconds <= 0);
    }).length;
    const statsUnknownCount = reviewRows.filter((item) => item.leftSeconds === null).length;

    return {
        classified,
        statusCounts,
        reviewRows,
        stats: {
            reviewCount: reviewRows.length,
            needsReview: reviewRows.map(({ row }) => `${row.txid ?? "?"}:${row.vout ?? "?"}`),
            nearestSeconds,
            nearestHuman: nearestSeconds === null ? null : formatDuration(nearestSeconds),
            valueSat: sumFinite(reviewRows.map(({ row }) => row.amount_sat)),
            virtualCount: virtualTxids.size,
            commitmentCount: commitmentTxids.size,
            confirmedCommitmentCount,
            expiredCount: statsExpiredCount,
            unknownCount: statsUnknownCount,
            urgentCount: statusCounts.urgent,
        },
    };
}

function addSnapshotConsistencyChecks(
    checks: Check[],
    classified: ClassifiedVtxo[],
    exitSeconds: number | null,
): void {
    for (const item of classified) {
        const id = `${item.row.txid ?? "?"}:${item.row.vout ?? "?"}`;
        const left = item.leftSeconds;
        if (left !== null && typeof item.row.expired === "boolean") {
            const derivedExpired = left <= 0;
            addCheck(
                checks,
                "Snapshot consistency",
                `expired flag ${id}`,
                derivedExpired,
                item.row.expired,
                derivedExpired === item.row.expired,
            );
        }
        if (
            left !== null &&
            exitSeconds !== null &&
            !item.terminal &&
            left > 0 &&
            typeof item.row.urgent === "boolean"
        ) {
            const derivedUrgent = left <= exitSeconds;
            addCheck(
                checks,
                "Snapshot consistency",
                `urgent flag ${id}`,
                derivedUrgent,
                item.row.urgent,
                derivedUrgent === item.row.urgent,
            );
        }
    }
}

function barkOnchainSummary(bark: BarkSnapshot) {
    const rows = Array.isArray(bark.recent_server_txs) ? bark.recent_server_txs : [];
    const confirmed = rows.filter(
        (row) => row.block_height !== undefined && row.block_height !== null,
    );
    const observed = rows.length - confirmed.length;
    return {
        count: rows.length,
        confirmed: confirmed.length,
        observed,
        totalSats: sumFinite(rows.map((row) => row.total_sats)),
    };
}

type BarkdExampleVtxo = {
    id: string;
    expiryHeight: number | null;
    amountSat: number;
};

function summarizeBarkdVtxos(rows: BarkdExampleVtxo[], tip: number | null, exitSeconds: number) {
    const statusCounts = { urgent: 0, expired: 0, unknown: 0, healthy: 0 };
    const urgentIds: string[] = [];
    const nearestValues: number[] = [];
    let reviewValueSat = 0;

    for (const row of rows) {
        const blocksLeft =
            tip === null || row.expiryHeight === null ? null : row.expiryHeight - tip;
        const secondsLeft = blocksLeft === null ? null : blocksLeft * BLOCK_SECONDS;
        let status: keyof typeof statusCounts;
        if (blocksLeft === null) {
            status = "unknown";
        } else if (blocksLeft <= 0) {
            status = "expired";
        } else if (secondsLeft !== null && secondsLeft <= exitSeconds) {
            status = "urgent";
        } else {
            status = "healthy";
        }
        statusCounts[status] += 1;
        if (status === "urgent") urgentIds.push(row.id);
        if (secondsLeft !== null) nearestValues.push(secondsLeft);
        if (status === "urgent" || status === "expired" || status === "unknown") {
            reviewValueSat += row.amountSat;
        }
    }

    const nearestSeconds = nearestValues.length === 0 ? null : Math.min(...nearestValues);
    return {
        statusCounts,
        urgentIds,
        nearestSeconds,
        nearestHuman: nearestSeconds === null ? null : formatDuration(nearestSeconds),
        reviewValueSat,
    };
}

function barkdPolicy(exitSeconds: number, tip: number | null) {
    return {
        tipHeight: tip,
        secondExitSeconds: exitSeconds,
        exitWindowBlocks: exitSeconds / BLOCK_SECONDS,
        urgentExpiryHeightRange:
            tip === null
                ? null
                : {
                      firstHeight: tip + 1,
                      lastHeight: tip + exitSeconds / BLOCK_SECONDS,
                  },
        actualWalletVtxoRows: "not present in either observation snapshot",
        actualUrgentSet: null,
        nearestSeconds: null,
        reviewValueSat: null,
    };
}

function workedBarkdExample(exitSeconds: number) {
    const windowBlocks = exitSeconds / BLOCK_SECONDS;
    const rows: BarkdExampleVtxo[] = [
        { id: "expired-1", expiryHeight: WORKED_EXAMPLE_TIP - 1, amountSat: 1200 },
        { id: "urgent-1", expiryHeight: WORKED_EXAMPLE_TIP + 1, amountSat: 2500 },
        { id: "urgent-boundary", expiryHeight: WORKED_EXAMPLE_TIP + windowBlocks, amountSat: 3500 },
        {
            id: "healthy-boundary-plus-one",
            expiryHeight: WORKED_EXAMPLE_TIP + windowBlocks + 1,
            amountSat: 4800,
        },
        { id: "unknown-expiry", expiryHeight: null, amountSat: 6100 },
    ];
    return {
        tipHeight: WORKED_EXAMPLE_TIP,
        exitWindowBlocks: windowBlocks,
        inputVtxos: rows,
        expected: summarizeBarkdVtxos(rows, WORKED_EXAMPLE_TIP, exitSeconds),
        note: "synthetic worked example; snapshot files do not contain Barkd wallet VTXOs",
    };
}

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

async function fetchWithTimeout(url: string, asText = false): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return asText ? await response.text() : await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function extractLiveVtxo(payload: unknown, outpoint: string): JsonRecord | null {
    if (Array.isArray(payload)) {
        const match = payload.find((row) => {
            if (row === null || typeof row !== "object") return false;
            const record = row as JsonRecord;
            return record.outpoint === outpoint || `${record.txid}:${record.vout}` === outpoint;
        });
        if (match !== undefined) return match as JsonRecord;
        return payload.length === 1 && payload[0] !== null && typeof payload[0] === "object"
            ? (payload[0] as JsonRecord)
            : null;
    }
    if (payload === null || typeof payload !== "object") return null;
    const record = payload as JsonRecord;
    const nested = record.vtxos ?? record.data;
    if (nested !== undefined) {
        const extracted = extractLiveVtxo(nested, outpoint);
        if (extracted !== null) return extracted;
    }
    const byOutpoint = record[outpoint];
    if (byOutpoint !== null && typeof byOutpoint === "object") return byOutpoint as JsonRecord;
    return record;
}

function sameTime(left: unknown, right: unknown): boolean {
    const leftSeconds = toUnixSeconds(left);
    const rightSeconds = toUnixSeconds(right);
    return leftSeconds !== null && rightSeconds !== null && leftSeconds === rightSeconds;
}

function liveField(
    checks: Check[],
    check: string,
    snapshotValue: unknown,
    liveValue: unknown,
    equal: boolean,
    driftPass: Pass,
): void {
    addCheck(
        checks,
        "Live reconciliation",
        check,
        snapshotValue,
        liveValue,
        equal ? true : driftPass,
    );
}

async function runLiveChecks(
    checks: Check[],
    arkade: ArkadeSnapshot,
    bark: BarkSnapshot,
    options: Options,
): Promise<number | null> {
    let liveTip: number | null = null;
    const esploraUrl = options.esplora.replace(/\/+$/, "");
    const snapshotRawExit = arkade.info?.unilateralExitDelay;
    const vtxos = Array.isArray(arkade.vtxos) ? arkade.vtxos : [];
    const confirmedCommitments = Object.entries(arkade.commitments ?? {})
        .filter(([, commitment]) => {
            const onchain = commitment._onchain;
            return (
                onchain !== null &&
                typeof onchain === "object" &&
                finiteNumber((onchain as JsonRecord).block_height) !== null
            );
        })
        .slice(0, 3);

    if (!options.indexer) {
        addCheck(
            checks,
            "Live reconciliation",
            "Ark live section",
            "operator endpoint configured",
            "pass --indexer or set ARK_OBS_INDEXER to reconcile live",
            "SKIPPED",
        );
    } else {
        const indexerUrl = options.indexer.replace(/\/+$/, "");
        try {
            const payload = await fetchWithTimeout(`${indexerUrl}/v1/info`);
            const liveInfo =
                payload !== null && typeof payload === "object" ? (payload as JsonRecord) : {};
            const expected = finiteNumber(snapshotRawExit);
            const actual = finiteNumber(liveInfo.unilateralExitDelay);
            liveField(
                checks,
                "Operator unilateralExitDelay",
                snapshotRawExit ?? null,
                liveInfo.unilateralExitDelay ?? null,
                expected !== null && actual !== null && expected === actual,
                "WARN",
            );
        } catch (error) {
            addCheck(
                checks,
                "Live reconciliation",
                "Operator /v1/info",
                "snapshot unilateralExitDelay",
                {
                    status: "offline",
                    error: errorText(error),
                },
                "SKIPPED",
            );
        }

        const sampledVtxos = vtxos.slice(0, options.sample);
        await Promise.all(
            sampledVtxos.map(async (row) => {
                const outpoint = `${row.txid ?? ""}:${row.vout ?? ""}`;
                const query = new URLSearchParams({ outpoints: outpoint });
                try {
                    const payload = await fetchWithTimeout(
                        `${indexerUrl}/v1/indexer/vtxos?${query.toString()}`,
                    );
                    const liveRow = extractLiveVtxo(payload, outpoint);
                    if (liveRow === null) {
                        addCheck(
                            checks,
                            "Live reconciliation",
                            `VTXO ${outpoint}`,
                            "matching live row",
                            null,
                            "WARN",
                        );
                        return;
                    }

                    const snapshotAmount = finiteNumber(row.amount_sat);
                    const liveAmount = finiteNumber(
                        liveRow.amount_sat ?? liveRow.amountSat ?? liveRow.amount,
                    );
                    liveField(
                        checks,
                        `VTXO amount_sat ${outpoint}`,
                        row.amount_sat ?? null,
                        liveRow.amount_sat ?? liveRow.amountSat ?? liveRow.amount ?? null,
                        snapshotAmount !== null &&
                            liveAmount !== null &&
                            snapshotAmount === liveAmount,
                        snapshotAmount === null || liveAmount === null ? "SKIPPED" : "FAIL",
                    );

                    const snapshotExpiry = row.expiresAt ?? row.expiresAt_unix ?? null;
                    const liveExpiry = liveRow.expiresAt ?? liveRow.expiresAt_unix ?? null;
                    liveField(
                        checks,
                        `VTXO expiresAt ${outpoint}`,
                        snapshotExpiry,
                        liveExpiry,
                        sameTime(snapshotExpiry, liveExpiry),
                        snapshotExpiry === null || liveExpiry === null ? "SKIPPED" : "FAIL",
                    );

                    const snapshotSpent = row.isSpent === true;
                    const liveSpentValue = liveRow.isSpent;
                    const liveSpent = typeof liveSpentValue === "boolean" ? liveSpentValue : null;
                    liveField(
                        checks,
                        `VTXO isSpent ${outpoint}`,
                        row.isSpent ?? null,
                        liveSpentValue ?? null,
                        liveSpent !== null && snapshotSpent === liveSpent,
                        liveSpent === null ? "SKIPPED" : "WARN",
                    );
                } catch (error) {
                    addCheck(
                        checks,
                        "Live reconciliation",
                        `VTXO ${outpoint}`,
                        "live row fields",
                        {
                            status: "offline",
                            error: errorText(error),
                        },
                        "SKIPPED",
                    );
                }
            }),
        );
    }

    await Promise.all(
        confirmedCommitments.map(async ([txid, commitment]) => {
            const onchainValue = commitment._onchain;
            const onchain =
                onchainValue !== null && typeof onchainValue === "object"
                    ? (onchainValue as JsonRecord)
                    : {};
            try {
                const payload = await fetchWithTimeout(`${esploraUrl}/tx/${txid}`);
                const liveTx =
                    payload !== null && typeof payload === "object" ? (payload as JsonRecord) : {};
                const liveStatus =
                    liveTx.status !== null && typeof liveTx.status === "object"
                        ? (liveTx.status as JsonRecord)
                        : {};
                const expectedHeight = finiteNumber(onchain.block_height);
                const actualHeight = finiteNumber(liveStatus.block_height);
                liveField(
                    checks,
                    `Commitment block_height ${txid}`,
                    onchain.block_height ?? null,
                    liveStatus.block_height ?? null,
                    expectedHeight !== null &&
                        actualHeight !== null &&
                        expectedHeight === actualHeight,
                    liveStatus.block_height === undefined ? "SKIPPED" : "WARN",
                );

                const liveOutputs = Array.isArray(liveTx.vout) ? liveTx.vout : [];
                const actualSats = sumFinite(
                    liveOutputs.map((output) => {
                        if (output === null || typeof output !== "object") return null;
                        return (output as JsonRecord).value;
                    }),
                );
                const expectedSats = finiteNumber(onchain.total_sats);
                liveField(
                    checks,
                    `Commitment output sats ${txid}`,
                    onchain.total_sats ?? null,
                    actualSats,
                    expectedSats !== null && expectedSats === actualSats,
                    !Array.isArray(liveTx.vout) || expectedSats === null ? "SKIPPED" : "FAIL",
                );
            } catch (error) {
                addCheck(
                    checks,
                    "Live reconciliation",
                    `Commitment ${txid}`,
                    "Esplora tx status and outputs",
                    {
                        status: "offline",
                        error: errorText(error),
                    },
                    "SKIPPED",
                );
            }
        }),
    );

    try {
        const payload = await fetchWithTimeout(`${esploraUrl}/blocks/tip/height`, true);
        const parsed = Number(String(payload).trim());
        if (!Number.isInteger(parsed) || parsed < 0) throw new Error("invalid tip height response");
        liveTip = parsed;
        addCheck(
            checks,
            "Live reconciliation",
            "Bitcoin tip height",
            "non-negative height",
            parsed,
            true,
        );
    } catch (error) {
        addCheck(
            checks,
            "Live reconciliation",
            "Bitcoin tip height",
            "live Esplora tip",
            {
                status: "offline",
                error: errorText(error),
            },
            "SKIPPED",
        );
    }

    const nextRound = toUnixSeconds(bark.next_round_unix);
    if (nextRound === null) {
        addCheck(
            checks,
            "Live reconciliation",
            "Second next_round_unix",
            "valid Unix timestamp",
            bark.next_round_unix ?? null,
            "SKIPPED",
        );
    } else {
        const now = Math.floor(Date.now() / 1000);
        const ageSeconds = now - nextRound;
        addCheck(
            checks,
            "Live reconciliation",
            "Second next_round_unix freshness",
            "round time in the future for a fresh snapshot",
            { nextRoundUnix: nextRound, ageSeconds, isFuture: nextRound > now },
            nextRound > now ? "PASS" : "WARN",
        );
    }

    return liveTip;
}

function displayValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined) return "—";
    const encoded = JSON.stringify(value);
    return encoded === undefined ? String(value) : encoded;
}

function printHuman(checks: Check[]): void {
    let currentSection = "";
    for (const check of checks) {
        if (check.section !== currentSection) {
            currentSection = check.section;
            process.stdout.write(`\n${currentSection}\n`);
            process.stdout.write(
                `${"CHECK".padEnd(47)} | ${"EXPECTED".padEnd(48)} | ${"ACTUAL".padEnd(42)} | RESULT\n`,
            );
            process.stdout.write(
                `${"-".repeat(47)}-+-${"-".repeat(48)}-+-${"-".repeat(42)}-+--------\n`,
            );
        }
        const result = check.pass === true ? "PASS" : check.pass === false ? "FAIL" : check.pass;
        process.stdout.write(
            `${check.check.padEnd(47)} | ${displayValue(check.expected).padEnd(48)} | ${displayValue(check.actual).padEnd(42)} | ${result}\n`,
        );
    }
}

async function main(): Promise<void> {
    let options: Options;
    try {
        options = readOptions(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${errorText(error)}\n`);
        process.stderr.write(
            "Usage: node scripts/validate-numbers.ts [--json] [--live] [--indexer URL] [--esplora URL] [--sample N] [--tip HEIGHT]\n",
        );
        process.exitCode = 2;
        return;
    }

    const checks: Check[] = [];
    try {
        const root = join(import.meta.dirname, "..");
        const arkade = JSON.parse(
            readFileSync(join(root, "public/observation/arkade.json"), "utf8"),
        ) as ArkadeSnapshot;
        const bark = JSON.parse(
            readFileSync(join(root, "public/observation/bark.json"), "utf8"),
        ) as BarkSnapshot;
        const arkadeDelay = describeRelativeTimelock(arkade.info?.unilateralExitDelay);
        const secondExitDelta = finiteNumber(bark.info?.vtxo_exit_delta);
        const secondExitSeconds = secondExitDelta === null ? null : secondExitDelta * BLOCK_SECONDS;
        const arkadeSummary = summarizeArkade(arkade, arkadeDelay?.seconds ?? null);
        const secondSummary = barkOnchainSummary(bark);

        addCheck(
            checks,
            "Exit parameters",
            "Arkade unilateral exit delay",
            arkadeDelay === null
                ? null
                : { seconds: arkadeDelay.seconds, interpretation: arkadeDelay.interpretation },
            arkade.info?.unilateralExitDelay ?? null,
            arkadeDelay !== null,
        );
        addCheck(
            checks,
            "Exit parameters",
            "Second VTXO exit delay",
            secondExitDelta === null
                ? null
                : { blocks: secondExitDelta, seconds: secondExitSeconds },
            bark.info?.vtxo_exit_delta ?? null,
            secondExitSeconds !== null,
        );
        addCheck(
            checks,
            "Arkade VTXO status",
            "Per-status counts (terminal includes settled outputs)",
            arkadeSummary.statusCounts,
            undefined,
            true,
        );
        for (const item of arkadeSummary.classified) {
            const id = `${item.row.txid ?? "?"}:${item.row.vout ?? "?"}`;
            addCheck(
                checks,
                "Arkade VTXO rows",
                id,
                {
                    status: item.status,
                    terminal: item.terminal,
                    expired: item.expired,
                    unknown: item.status === "unknown",
                    urgent: item.status === "urgent",
                    healthy: item.status === "healthy",
                    leftSeconds: item.leftSeconds,
                    leftHuman: item.leftSeconds === null ? null : formatDuration(item.leftSeconds),
                    amountSat: finiteNumber(item.row.amount_sat),
                    needsReview: item.needsReview,
                },
                undefined,
                true,
            );
        }
        addCheck(
            checks,
            "Arkade Overview stats",
            "Review, expiry, value, and record counts",
            arkadeSummary.stats,
            undefined,
            true,
        );
        addCheck(
            checks,
            "Second on-chain activity",
            "Transaction split and total sats",
            secondSummary,
            undefined,
            true,
        );

        addSnapshotConsistencyChecks(
            checks,
            arkadeSummary.classified,
            arkadeDelay?.seconds ?? null,
        );

        const initialTip = options.tip;
        let liveTip: number | null = null;
        if (options.live) liveTip = await runLiveChecks(checks, arkade, bark, options);
        const effectiveTip = options.tip ?? liveTip;
        if (secondExitSeconds === null) {
            addCheck(
                checks,
                "Barkd-mode expectations",
                "Tip-based wallet expectation",
                "valid Second exit delay",
                null,
                "SKIPPED",
            );
            addCheck(
                checks,
                "Barkd-mode expectations",
                "Tip 905000 worked example",
                "valid Second exit delay",
                null,
                "SKIPPED",
            );
        } else {
            addCheck(
                checks,
                "Barkd-mode expectations",
                "Tip-based wallet expectation",
                barkdPolicy(secondExitSeconds, effectiveTip),
                effectiveTip === null
                    ? "tip unavailable; use --tip HEIGHT or --live"
                    : {
                          tipHeight: effectiveTip,
                          source: options.tip !== null ? "--tip override" : "mempool live tip",
                      },
                "SKIPPED",
            );
            addCheck(
                checks,
                "Barkd-mode expectations",
                "Tip 905000 worked example",
                workedBarkdExample(secondExitSeconds),
                undefined,
                true,
            );
        }

        if (options.json) {
            process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
        } else {
            process.stdout.write(
                "Independent Overview number oracle (snapshot-derived expected values)\n",
            );
            if (initialTip !== null) process.stdout.write(`Barkd tip override: ${initialTip}\n`);
            printHuman(checks);
        }
        process.exitCode = checks.some((check) => check.pass === false) ? 1 : 0;
    } catch (error) {
        const failed: Check = {
            section: "Input",
            check: "Load snapshots and derive Overview numbers",
            expected: "valid public/observation/arkade.json and bark.json",
            actual: errorText(error),
            pass: false,
        };
        if (options.json) process.stdout.write(`${JSON.stringify([...checks, failed], null, 2)}\n`);
        else {
            process.stderr.write(`${errorText(error)}\n`);
            printHuman([...checks, failed]);
        }
        process.exitCode = 1;
    }
}

await main();
