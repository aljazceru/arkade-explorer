import type { TxNotificationEvent } from "@arkade-os/sdk";
import type { OverviewRecord } from "@/lib/overview-records";

/** A stream notification is evidence of an event, not of confirmation or coin ownership. */
export function buildArkActivityRecord(
    event: TxNotificationEvent,
    observedAt: number,
): OverviewRecord | null {
    const notification = event.commitmentTx ?? event.arkTx ?? event.sweepTx;
    if (!notification?.txid) return null;
    const commitment = event.commitmentTx !== undefined;
    const sweep = event.sweepTx !== undefined;
    const outputs = notification.spendableVtxos;
    let amountSat: number | null = outputs.length > 0 ? 0 : null;
    for (const output of outputs) {
        const amount = Number(output.amount);
        if (
            !Number.isSafeInteger(amount) ||
            amount < 0 ||
            amountSat === null ||
            !Number.isSafeInteger(amountSat + amount)
        ) {
            amountSat = null;
            break;
        }
        amountSat += amount;
    }
    const timestamp = new Date(observedAt).toISOString();
    const commitmentTxids = [...new Set(outputs.flatMap((output) => output.commitmentTxids))];
    return {
        id: `ark-stream-${commitment ? "commitment" : sweep ? "sweep" : "transaction"}:${notification.txid}`,
        txid: notification.txid,
        network: "arkade",
        kind: commitment ? "commitment" : sweep ? "onchain" : "virtual",
        entity: "transaction",
        typeLabel: commitment
            ? "Commitment · stream"
            : sweep
              ? "Sweep · stream"
              : "Virtual · stream",
        label: commitment
            ? "Commitment announced"
            : sweep
              ? "Sweep announced"
              : "Virtual transaction announced",
        amountSat,
        amountLabel: "New VTXO outputs (notification)",
        status: "observed",
        statusLabel: "Observed in stream",
        needsReview: false,
        // Notification expiry fields belong to individual outputs; a transaction is not a coin.
        leftSeconds: null,
        exitSeconds: null,
        createdAtSeconds: null,
        expiresAtSeconds: null,
        recordedAt: timestamp,
        snapshotFetchedAt: timestamp,
        sourceLabel: "operator stream · received time, not confirmation time",
        commitmentTxids: commitment ? [] : commitmentTxids,
        blockHeight: null,
        liveSource: true,
    };
}
