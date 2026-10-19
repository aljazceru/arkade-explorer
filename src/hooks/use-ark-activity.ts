import { useEffect, useState } from "react";
import type { TxNotificationEvent } from "@arkade-os/sdk";
import type { OverviewRecord, RecordStatus } from "@/components/overview/records-table";
import { arkClient } from "@/lib/api/indexer";

const STORAGE_KEY = "ark-observer-recent-activity";
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
type EventKind = "transaction" | "batch" | "vtxo" | "sweep";

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
        value === "settled" ||
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

function toUnixSeconds(value: unknown): number | null {
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp / 1000 : null;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        return value > 1e12 ? value / 1000 : value;
    }
    if (typeof value !== "string" || value.length === 0) return null;

    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric / 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed / 1000;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
}

function getNotificationTxid(notification: Record<string, unknown>): string | null {
    if (typeof notification.txid === "string" && notification.txid.length > 0) {
        return notification.txid;
    }
    const outpoint = asObject(notification.outpoint);
    return typeof outpoint?.txid === "string" && outpoint.txid.length > 0 ? outpoint.txid : null;
}

function makeCommitmentRecord(
    notification: Record<string, unknown>,
    eventTime: number,
): OverviewRecord | null {
    const txid = getNotificationTxid(notification);
    if (!txid) return null;

    const spentCount = Array.isArray(notification.spentVtxos) ? notification.spentVtxos.length : 0;
    const spendableCount = Array.isArray(notification.spendableVtxos)
        ? notification.spendableVtxos.length
        : 0;
    const eventTimeIso = new Date(eventTime).toISOString();

    return {
        id: `ark-stream-commitment:${txid}`,
        txid,
        network: "arkade",
        kind: "commitment",
        typeLabel: "Commitment · live",
        label: `Batch (${spendableCount + spentCount} VTXOs)`,
        amountSat: null,
        status: "confirmed",
        statusLabel: "New commitment",
        needsReview: false,
        leftSeconds: null,
        exitSeconds: null,
        createdAtSeconds: null,
        expiresAtSeconds: null,
        recordedAt: eventTimeIso,
        snapshotFetchedAt: eventTimeIso,
        sourceLabel: "operator stream · live",
        commitmentTxids: [txid],
        blockHeight: null,
        liveSource: true,
    };
}

function makeVirtualRecord(
    notification: Record<string, unknown>,
    eventKind: EventKind,
    eventTime: number,
): OverviewRecord | null {
    const txid = getNotificationTxid(notification);
    if (!txid) return null;

    const eventVtxo = asObject(notification.vtxo) ?? (eventKind === "vtxo" ? notification : null);
    const spendableVtxos = Array.isArray(notification.spendableVtxos)
        ? notification.spendableVtxos
              .map(asObject)
              .filter((vtxo): vtxo is Record<string, unknown> => vtxo !== null)
        : [];
    const expiryValues: unknown[] = [];
    const directExpiry = eventVtxo?.expiresAt ?? notification.expiresAt;
    if (directExpiry !== undefined && directExpiry !== null) expiryValues.push(directExpiry);
    for (const vtxo of spendableVtxos) {
        if (vtxo.expiresAt !== undefined && vtxo.expiresAt !== null) {
            expiryValues.push(vtxo.expiresAt);
        }
    }
    const expiries = expiryValues
        .map(toUnixSeconds)
        .filter((seconds): seconds is number => seconds !== null);
    const expiresAtSeconds = expiries.length > 0 ? Math.min(...expiries) : null;
    const leftSeconds =
        expiresAtSeconds === null ? null : Math.floor(expiresAtSeconds - eventTime / 1000);
    const eventTimeIso = new Date(eventTime).toISOString();
    const createdAtSeconds = toUnixSeconds(eventVtxo?.createdAt ?? notification.createdAt);
    const commitmentTxids = new Set<string>([
        ...readStringArray(notification.commitmentTxids),
        ...readStringArray(eventVtxo?.commitmentTxids),
    ]);
    for (const vtxo of spendableVtxos) {
        for (const commitmentTxid of readStringArray(vtxo.commitmentTxids)) {
            commitmentTxids.add(commitmentTxid);
        }
    }
    const amountSat = spendableVtxos.reduce((sum, vtxo) => {
        const amount = Number(vtxo.amount);
        return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
    const typeLabel =
        eventKind === "batch"
            ? "Batch · live"
            : eventKind === "vtxo"
              ? "VTXO · live"
              : eventKind === "sweep"
                ? "Sweep · live"
                : "Transaction · live";

    return {
        id: `ark-stream-${eventKind}:${txid}`,
        txid,
        network: "arkade",
        kind: "virtual",
        typeLabel,
        label: "New transaction",
        amountSat: amountSat > 0 ? amountSat : null,
        status: "unknown",
        statusLabel: "New transaction",
        needsReview: false,
        leftSeconds,
        exitSeconds: null,
        createdAtSeconds,
        expiresAtSeconds,
        recordedAt: eventTimeIso,
        snapshotFetchedAt: eventTimeIso,
        sourceLabel: "operator stream · live",
        commitmentTxids: [...commitmentTxids],
        blockHeight: null,
        liveSource: true,
    };
}

function parseEvent(event: TxNotificationEvent, eventTime: number): OverviewRecord | null {
    const notificationEvent = event as unknown as Record<string, unknown>;

    const commitmentTx = asObject(notificationEvent.commitmentTx);
    if (commitmentTx) return makeCommitmentRecord(commitmentTx, eventTime);

    const arkTx = asObject(notificationEvent.arkTx);
    if (arkTx) return makeVirtualRecord(arkTx, "transaction", eventTime);

    const round = asObject(notificationEvent.round);
    if (round) return makeVirtualRecord(round, "batch", eventTime);

    const vtxo = asObject(notificationEvent.vtxo);
    if (vtxo) return makeVirtualRecord(notificationEvent, "vtxo", eventTime);

    const sweepTx = asObject(notificationEvent.sweepTx);
    if (sweepTx) return makeVirtualRecord(sweepTx, "sweep", eventTime);

    return null;
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
        ...storedRecords.filter((entry) => entry.record.id !== record.id),
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
            updateConnection(controller, true, true);

            for await (const event of eventStream) {
                if (!isCurrentController(controller)) return;
                const eventTime = Date.now();
                const record = parseEvent(event, eventTime);
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
