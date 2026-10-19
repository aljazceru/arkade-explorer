const env = import.meta.env as unknown as Record<string, string | undefined>;

export const SERVER_GRPC = env.VITE_SECOND_GRPC || "https://ark.second.tech";
export const SERVER_P2TR = env.VITE_SECOND_SERVER_P2TR || "";
export const ESPLORA = env.VITE_ESPLORA_URL || "https://mempool.space/api";

const REQUEST_TIMEOUT_MS = 12_000;
const SECOND_DAY_SECONDS = 24 * 60 * 60;

type LiveSecondErrorSource = "grpc" | "esplora";

export class LiveSecondError extends Error {
    constructor(
        message: string,
        readonly source: LiveSecondErrorSource,
    ) {
        super(message);
        this.name = "LiveSecondError";
    }
}

export type SecondInfo = {
    roundIntervalSeconds: number | null;
    vtxoLifetimeBlocks: number | null;
    exitDeltaBlocks: number | null;
};

export type SecondServerTx = {
    txid: string;
    blockHeight: number | null;
    blockTimeSeconds: number | null;
    direction: "to_server" | "from_server" | "other";
    totalSats: number;
};

type ProtoValue = number | Uint8Array;
type ProtoFieldMap = Map<number, ProtoValue[]>;

function readVarint(bytes: Uint8Array, start: number): { value: number; next: number } {
    let value = 0;
    let shift = 0;
    let offset = start;

    while (offset < bytes.length && shift < 70) {
        const byte = bytes[offset];
        offset += 1;
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return { value, next: offset };
        shift += 7;
    }

    throw new LiveSecondError("Malformed protobuf varint.", "grpc");
}

function decodeFields(bytes: Uint8Array): ProtoFieldMap {
    const fields: ProtoFieldMap = new Map();
    let offset = 0;

    function add(fieldNumber: number, value: ProtoValue): void {
        const values = fields.get(fieldNumber);
        if (values) values.push(value);
        else fields.set(fieldNumber, [value]);
    }

    while (offset < bytes.length) {
        const tag = readVarint(bytes, offset);
        offset = tag.next;
        const fieldNumber = Math.floor(tag.value / 8);
        const wireType = tag.value % 8;
        if (fieldNumber === 0) throw new LiveSecondError("Malformed protobuf field tag.", "grpc");

        if (wireType === 0) {
            const value = readVarint(bytes, offset);
            add(fieldNumber, value.value);
            offset = value.next;
        } else if (wireType === 2) {
            const length = readVarint(bytes, offset);
            offset = length.next;
            if (length.value > bytes.length - offset) {
                throw new LiveSecondError("Truncated protobuf length-delimited field.", "grpc");
            }
            add(fieldNumber, bytes.subarray(offset, offset + length.value));
            offset += length.value;
        } else if (wireType === 1) {
            if (bytes.length - offset < 8) {
                throw new LiveSecondError("Truncated protobuf fixed64 field.", "grpc");
            }
            offset += 8;
        } else if (wireType === 5) {
            if (bytes.length - offset < 4) {
                throw new LiveSecondError("Truncated protobuf fixed32 field.", "grpc");
            }
            offset += 4;
        } else {
            throw new LiveSecondError(`Unsupported protobuf wire type ${wireType}.`, "grpc");
        }
    }

    return fields;
}

function firstVarint(fields: ProtoFieldMap, fieldNumber: number): number | null {
    const value = fields.get(fieldNumber)?.[0];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unpackGrpcWebFrames(response: Uint8Array): Uint8Array {
    const dataFrames: Uint8Array[] = [];
    let dataLength = 0;
    let trailer: string | null = null;
    let offset = 0;

    while (offset < response.length) {
        if (response.length - offset < 5) {
            throw new LiveSecondError("Truncated gRPC-web frame header.", "grpc");
        }
        const flag = response[offset];
        const length =
            response[offset + 1] * 0x1000000 +
            response[offset + 2] * 0x10000 +
            response[offset + 3] * 0x100 +
            response[offset + 4];
        offset += 5;
        if (length > response.length - offset) {
            throw new LiveSecondError("Truncated gRPC-web frame body.", "grpc");
        }
        const chunk = response.subarray(offset, offset + length);
        offset += length;

        if (flag === 0x00) {
            dataFrames.push(chunk);
            dataLength += chunk.length;
        } else if (flag === 0x80) {
            trailer = new TextDecoder().decode(chunk);
        } else {
            throw new LiveSecondError(`Unsupported gRPC-web frame flag ${flag}.`, "grpc");
        }
    }

    if (trailer) {
        const grpcStatus = trailer.match(/(?:^|\r?\n)grpc-status:\s*(\d+)/i)?.[1];
        if (grpcStatus && grpcStatus !== "0") {
            const grpcMessage = trailer.match(/(?:^|\r?\n)grpc-message:\s*([^\r\n]+)/i)?.[1];
            throw new LiveSecondError(grpcMessage || `gRPC status ${grpcStatus}.`, "grpc");
        }
    }

    const result = new Uint8Array(dataLength);
    let resultOffset = 0;
    for (const frame of dataFrames) {
        result.set(frame, resultOffset);
        resultOffset += frame.length;
    }
    return result;
}

export async function grpcWebCall(
    method: string,
    payloadBytes: Uint8Array,
    signal: AbortSignal,
): Promise<Uint8Array> {
    const body = new Uint8Array(5 + payloadBytes.length);
    body[0] = 0;
    new DataView(body.buffer).setUint32(1, payloadBytes.length, false);
    body.set(payloadBytes, 5);

    try {
        const response = await fetch(`${SERVER_GRPC}/bark_server.ArkService/${method}`, {
            method: "POST",
            headers: {
                "content-type": "application/grpc-web+proto",
                "x-grpc-web": "1",
            },
            body,
            signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        if (!response.ok) {
            throw new LiveSecondError(`HTTP ${response.status} from Second gRPC-web.`, "grpc");
        }
        return unpackGrpcWebFrames(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof LiveSecondError) throw error;
        throw new LiveSecondError(
            error instanceof Error ? error.message : "Second gRPC-web request failed.",
            "grpc",
        );
    }
}

export async function fetchSecondInfo(signal: AbortSignal): Promise<SecondInfo> {
    try {
        const response = await grpcWebCall("GetArkInfo", new Uint8Array(0), signal);
        const fields = decodeFields(response);
        return {
            roundIntervalSeconds: null,
            vtxoLifetimeBlocks: firstVarint(fields, 21) || firstVarint(fields, 6),
            exitDeltaBlocks: firstVarint(fields, 5),
        };
    } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof LiveSecondError) throw error;
        throw new LiveSecondError(
            error instanceof Error ? error.message : "Could not read Second server info.",
            "grpc",
        );
    }
}

export async function fetchNextRoundAt(signal: AbortSignal): Promise<number | null> {
    try {
        const response = await grpcWebCall("NextRoundTime", new Uint8Array(0), signal);
        const fields = decodeFields(response);
        const now = Math.floor(Date.now() / 1000);
        const latestPlausibleTime = now + SECOND_DAY_SECONDS;
        let nextRoundAt: number | null = null;

        function consider(value: ProtoValue): void {
            if (
                typeof value === "number" &&
                value >= now &&
                value <= latestPlausibleTime &&
                (nextRoundAt === null || value < nextRoundAt)
            ) {
                nextRoundAt = value;
            }
        }

        for (const values of fields.values()) {
            for (const value of values) {
                if (typeof value === "number") {
                    consider(value);
                    continue;
                }
                try {
                    for (const nestedValues of decodeFields(value).values()) {
                        for (const nestedValue of nestedValues) consider(nestedValue);
                    }
                } catch {
                    // Non-message length-delimited fields cannot contain a timestamp candidate.
                }
            }
        }

        return nextRoundAt;
    } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof LiveSecondError) throw error;
        throw new LiveSecondError(
            error instanceof Error ? error.message : "Could not read the next Second round time.",
            "grpc",
        );
    }
}

function numberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchServerTxs(signal: AbortSignal): Promise<SecondServerTx[] | null> {
    if (!SERVER_P2TR) return null;

    try {
        const response = await fetch(`${ESPLORA}/address/${SERVER_P2TR}/txs`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        if (!response.ok) {
            throw new LiveSecondError(`HTTP ${response.status} from Esplora.`, "esplora");
        }
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) {
            throw new LiveSecondError("Unexpected Esplora transaction response.", "esplora");
        }

        return payload.slice(0, 40).flatMap((item: unknown): SecondServerTx[] => {
            if (!item || typeof item !== "object") return [];
            const tx = item as {
                txid?: unknown;
                status?: { block_height?: unknown; block_time?: unknown } | null;
                vin?: Array<{ prevout?: { scriptpubkey_address?: unknown } | null }>;
                vout?: Array<{ scriptpubkey_address?: unknown; value?: unknown }>;
            };
            if (typeof tx.txid !== "string") return [];
            const paysTo = (tx.vout ?? []).some(
                (output) => output?.scriptpubkey_address === SERVER_P2TR,
            );
            const spendsFrom = (tx.vin ?? []).some(
                (input) => input?.prevout?.scriptpubkey_address === SERVER_P2TR,
            );
            const direction =
                paysTo && !spendsFrom
                    ? "to_server"
                    : spendsFrom && !paysTo
                      ? "from_server"
                      : "other";
            const totalSats = (tx.vout ?? []).reduce(
                (total, output) => total + (numberOrNull(output?.value) ?? 0),
                0,
            );

            return [
                {
                    txid: tx.txid,
                    blockHeight: numberOrNull(tx.status?.block_height),
                    blockTimeSeconds: numberOrNull(tx.status?.block_time),
                    direction,
                    totalSats,
                },
            ];
        });
    } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof LiveSecondError) throw error;
        throw new LiveSecondError(
            error instanceof Error ? error.message : "Could not read Second server transactions.",
            "esplora",
        );
    }
}
