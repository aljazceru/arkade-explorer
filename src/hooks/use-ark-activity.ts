import { useEffect, useState } from "react";
import type { OverviewRecord, RecordStatus } from "@/lib/overview-records";
import { arkClient, ARK_URL } from "@/lib/api/indexer";
import { buildArkActivityRecord } from "@/lib/ark-activity";

const STORAGE_KEY = `ark-observer-recent-activity:${ARK_URL}`;
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_RECORDS = 50;
const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

interface StoredRecord {
    record: OverviewRecord;
    storedAt: number;
}

interface ArkActivityState {
    records: OverviewRecord[];
    connected: boolean;
    listening: boolean;
    lastEventAt: number | null;
}

type ActivityListener = (state: ArkActivityState) => void;

const INITIAL_STATE: ArkActivityState = {
    records: [],
    connected: false,
    listening: false,
    lastEventAt: null,
};

const listeners = new Set<ActivityListener>();
let activityState = INITIAL_STATE;
let storedRecords: StoredRecord[] = [];
let storageLoaded = false;
let streamController: AbortController | null = null;
let retryAttempt = 0;

function asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
    return value === null || isFiniteNumber(value);
}

function isRecordStatus(value: unknown): value is RecordStatus {
    return (
        value === "urgent" ||
        value === "expired" ||
        value === "unknown" ||
        value === "spent" ||
        value === "healthy" ||
        value === "confirmed" ||
        value === "observed" ||
        value === "locked"
    );
}

function isOverviewRecord(value: unknown): value is OverviewRecord {
    const record = asObject(value);
    if (!record) return false;

    const recordedAt = record.recordedAt;
    const validRecordedAt =
        recordedAt === null || typeof recordedAt === "string" || isFiniteNumber(recordedAt);
    const validCommitmentTxids =
        Array.isArray(record.commitmentTxids) &&
        record.commitmentTxids.every((txid) => typeof txid === "string");
    const validOptionalFields =
        (record.policyType === undefined ||
            record.policyType === null ||
            typeof record.policyType === "string") &&
        (record.exitDeltaBlocks === undefined || isNullableFiniteNumber(record.exitDeltaBlocks)) &&
        (record.exitDepth === undefined || isNullableFiniteNumber(record.exitDepth)) &&
        (record.chainAnchor === undefined ||
            record.chainAnchor === null ||
            typeof record.chainAnchor === "string") &&
        (record.liveSource === undefined || typeof record.liveSource === "boolean");

    return (
        typeof record.id === "string" &&
        typeof record.txid === "string" &&
        (record.network === "arkade" || record.network === "second") &&
        (record.kind === "virtual" || record.kind === "commitment" || record.kind === "onchain") &&
        typeof record.typeLabel === "string" &&
        record.entity === "transaction" &&
        typeof record.amountLabel === "string" &&
        typeof record.label === "string" &&
        (record.amountSat === null || isFiniteNumber(record.amountSat)) &&
        isRecordStatus(record.status) &&
        typeof record.statusLabel === "string" &&
        typeof record.needsReview === "boolean" &&
        isNullableFiniteNumber(record.leftSeconds) &&
        isNullableFiniteNumber(record.exitSeconds) &&
        isNullableFiniteNumber(record.createdAtSeconds) &&
        isNullableFiniteNumber(record.expiresAtSeconds) &&
        validRecordedAt &&
        typeof record.snapshotFetchedAt === "string" &&
        typeof record.sourceLabel === "string" &&
        validCommitmentTxids &&
        isNullableFiniteNumber(record.blockHeight) &&
        validOptionalFields
    );
}

function loadStoredRecords(): void {
    if (storageLoaded || typeof window === "undefined") return;
    storageLoaded = true;

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

        const now = Date.now();
        storedRecords = parsed
            .flatMap((value): StoredRecord[] => {
                const entry = asObject(value);
                if (
                    !entry ||
                    !isFiniteNumber(entry.storedAt) ||
                    entry.storedAt > now ||
                    now - entry.storedAt >= MAX_AGE_MS ||
                    !isOverviewRecord(entry.record)
                ) {
                    return [];
                }
                return [{ record: entry.record, storedAt: entry.storedAt }];
            })
            .sort((left, right) => right.storedAt - left.storedAt)
            .slice(0, MAX_RECORDS);
        activityState = {
            ...activityState,
            records: storedRecords.map((entry) => entry.record),
        };
    } catch {
        storedRecords = [];
    }
}

function saveStoredRecords(): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedRecords));
    } catch {
        // Storage is optional; stream records remain available in memory.
    }
}

function publish(nextState: ArkActivityState): void {
    activityState = nextState;
    for (const listener of listeners) listener(activityState);
}

function isCurrentController(controller: AbortController): boolean {
    return streamController === controller && !controller.signal.aborted;
}

function updateConnection(
    controller: AbortController,
    connected: boolean,
    listening: boolean,
): void {
    if (!isCurrentController(controller)) return;
    publish({ ...activityState, connected, listening });
}

function appendRecord(
    controller: AbortController,
    record: OverviewRecord,
    eventTime: number,
): void {
    if (!isCurrentController(controller)) return;

    storedRecords = [
        { record, storedAt: eventTime },
        ...storedRecords.filter(
            (entry) => entry.record.id !== record.id && eventTime - entry.storedAt < MAX_AGE_MS,
        ),
    ].slice(0, MAX_RECORDS);
    saveStoredRecords();
    publish({
        ...activityState,
        records: storedRecords.map((entry) => entry.record),
        connected: true,
        listening: true,
        lastEventAt: eventTime,
    });
}

function waitForRetry(signal: AbortSignal, delayMs: number): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }

        const finish = () => {
            window.clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
        };
        const timer = window.setTimeout(finish, delayMs);
        signal.addEventListener("abort", finish, { once: true });
    });
}

async function consumeTransactions(controller: AbortController): Promise<void> {
    while (isCurrentController(controller) && listeners.size > 0) {
        try {
            const eventStream = arkClient.getTransactionsStream(controller.signal);
            if (!isCurrentController(controller)) return;
            // The async iterator is lazy: creation does not prove an open connection.
            updateConnection(controller, false, true);

            for await (const event of eventStream) {
                if (!isCurrentController(controller)) return;
                const eventTime = Date.now();
                const record = buildArkActivityRecord(event, eventTime);
                if (record) {
                    retryAttempt = 0;
                    appendRecord(controller, record, eventTime);
                }
            }
        } catch {
            if (!isCurrentController(controller)) return;
        }

        if (!isCurrentController(controller)) return;
        updateConnection(controller, false, false);
        const exponent = Math.min(retryAttempt, 5);
        const delayMs = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** exponent);
        retryAttempt += 1;
        await waitForRetry(controller.signal, delayMs);
    }
}

function subscribe(listener: ActivityListener): () => void {
    loadStoredRecords();
    listeners.add(listener);
    listener(activityState);

    if (listeners.size === 1 && typeof window !== "undefined") {
        const controller = new AbortController();
        streamController = controller;
        retryAttempt = 0;
        void consumeTransactions(controller);
    }

    return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !streamController) return;

        streamController.abort();
        streamController = null;
        retryAttempt = 0;
        activityState = { ...activityState, connected: false, listening: false };
    };
}

export function useArkActivity(): ArkActivityState {
    const [state, setState] = useState(INITIAL_STATE);

    useEffect(() => subscribe(setState), []);

    return state;
}
