import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";
import { CosignerPublicKey, getArkPsbtFields, asset } from "@arkade-os/sdk";
import type { CommitmentTx, VirtualCoin } from "@arkade-os/sdk";

type AssetGroup = asset.AssetGroup;
type AssetPacketInstance = asset.Packet;
import { constructArkAddress, deriveOutputDisplayAddress } from "@/lib/arkAddress";
import { deriveExpiryKind, remainingLifetime } from "@/lib/vtxo-display";

const { Packet: AssetPacket } = asset;

// ---------------------------------------------------------------------------
// Script classification
// ---------------------------------------------------------------------------

/** Check if a script is an ARK extension OP_RETURN */
export function isArkExtension(script: Uint8Array): boolean {
    try {
        const decoded = btc.Script.decode(script);
        if (decoded.length < 2 || decoded[0] !== "RETURN") return false;
        const data = decoded[1];
        if (!(data instanceof Uint8Array)) return false;
        return data.length >= 3 && data[0] === 0x41 && data[1] === 0x52 && data[2] === 0x4b;
    } catch {
        return false;
    }
}

/** Check if a script is a P2A anchor output (OP_1 <0x4e73>). */
export function isAnchorScript(script: Uint8Array): boolean {
    return toHex(script).startsWith("51024e73");
}

/** Known ARK packet extension type IDs (SDK Extension envelope). */
const EXTENSION_NAMES: Record<number, string> = {
    0: "Asset",
    1: "Emulator",
};

export interface ParsedPacketExtension {
    type: number;
    name: string;
}

export interface ParsedPacket {
    assetPacket: AssetPacketInstance | null;
    extensions: ParsedPacketExtension[];
}

/** Parse ARK packet from an OP_RETURN script, returning all detected extensions */
export function parseArkPacket(script: Uint8Array): ParsedPacket | null {
    try {
        const decoded = btc.Script.decode(script);
        if (decoded.length < 2 || decoded[0] !== "RETURN") return null;
        const pushes = decoded.slice(1).filter((x): x is Uint8Array => x instanceof Uint8Array);
        if (pushes.length === 0) return null;
        const totalLen = pushes.reduce((sum, p) => sum + p.length, 0);
        const buf = new Uint8Array(totalLen);
        let offset = 0;
        for (const p of pushes) {
            buf.set(p, offset);
            offset += p.length;
        }
        if (buf.length < 3 || buf[0] !== 0x41 || buf[1] !== 0x52 || buf[2] !== 0x4b) return null;
        let assetPacket: AssetPacketInstance | null = null;
        const extensions: ParsedPacketExtension[] = [];
        let pos = 3;
        while (pos < buf.length) {
            const packetType = buf[pos++];
            let len = 0,
                shift = 0;
            while (pos < buf.length) {
                const b = buf[pos++];
                len |= (b & 0x7f) << shift;
                if ((b & 0x80) === 0) break;
                shift += 7;
            }
            const data = buf.slice(pos, pos + len);
            pos += len;
            extensions.push({
                type: packetType,
                name: EXTENSION_NAMES[packetType] || `Extension #${packetType}`,
            });
            if (packetType === 0) {
                assetPacket = AssetPacket.fromBytes(data);
            }
        }
        if (extensions.length === 0) return null;
        return { assetPacket, extensions };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Transaction decoding
// ---------------------------------------------------------------------------

/** Convert a Uint8Array to lowercase hex string */
export function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Parse indexer virtual txs (hex raw tx or base64 PSBT), skipping undecodable
 * ones. Commitment transactions arrive as raw hex; Arkade virtual transactions
 * as base64-encoded PSBTs.
 */
export function parseVirtualTxs(raws: string[]): btc.Transaction[] {
    return raws.flatMap((raw) => {
        const parsed = parseVirtualTx(raw);
        return parsed ? [parsed] : [];
    });
}

/** Parse a single virtual tx payload (hex or base64 PSBT); null on failure. */
export function parseVirtualTx(raw: string): btc.Transaction | null {
    try {
        return /^[0-9a-fA-F]+$/.test(raw)
            ? btc.Transaction.fromRaw(hex.decode(raw))
            : btc.Transaction.fromPSBT(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)));
    } catch (e) {
        console.error("Failed to decode virtual transaction:", e);
        return null;
    }
}

export function getMempoolUrl(network: string | undefined, txid: string): string {
    if (network === "bitcoin" || network === "mainnet") return `https://mempool.space/tx/${txid}`;
    if (network === "signet") return `https://mempool.space/signet/tx/${txid}`;
    if (network === "testnet") return `https://mempool.space/testnet/tx/${txid}`;
    return `https://mutinynet.com/tx/${txid}`;
}

// ---------------------------------------------------------------------------
// Subtype detection
// ---------------------------------------------------------------------------

export type TxSubtype = "generic" | "forfeit" | "checkpoint" | "batch-tree" | "connector-tree";

export interface SubtypeContext {
    forfeitPubkey?: string;
    checkpointTapscript?: string;
    network?: string;
    signerPubkey?: string;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
}

/**
 * Detect the protocol role of a transaction. First match wins:
 * forfeit (one non-anchor output paying the operator forfeit script),
 * checkpoint (one input, one non-anchor output whose tapTree holds the
 * checkpoint tapscript), batch-tree (multiple cosigner fields), connector-tree
 * (one cosigner field matching the first output's taproot key), else generic.
 */
export function detectSubtype(tx: btc.Transaction, ctx: SubtypeContext): TxSubtype {
    // --- forfeit ---
    if (ctx.forfeitPubkey) {
        try {
            const pubkeyBytes = Uint8Array.from(
                ctx.forfeitPubkey.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
            );
            const net = ctx.network === "bitcoin" ? btc.NETWORK : btc.TEST_NETWORK;
            const forfeitScriptHex = toHex(btc.p2wpkh(pubkeyBytes, net).script);

            let nonAnchorOutputs = 0;
            let forfeitOutputs = 0;
            for (let i = 0; i < tx.outputsLength; i++) {
                const output = tx.getOutput(i);
                const scriptBytes = output?.script ?? new Uint8Array();
                if (!isAnchorScript(scriptBytes)) {
                    nonAnchorOutputs++;
                    if (toHex(scriptBytes) === forfeitScriptHex) forfeitOutputs++;
                }
            }
            if (nonAnchorOutputs === 1 && forfeitOutputs === 1) return "forfeit";
        } catch (e) {
            console.error("Failed to detect forfeit tx:", e);
        }
    }

    // --- checkpoint ---
    if (ctx.checkpointTapscript) {
        try {
            let nonAnchorCount = 0;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let nonAnchorOutput: any;
            for (let i = 0; i < tx.outputsLength; i++) {
                const output = tx.getOutput(i);
                const scriptBytes = output?.script ?? new Uint8Array();
                if (!isAnchorScript(scriptBytes)) {
                    nonAnchorCount++;
                    nonAnchorOutput = output;
                }
            }
            if (tx.inputsLength === 1 && nonAnchorCount === 1) {
                if (nonAnchorOutput?.tapTree && nonAnchorOutput.tapTree.length > 0) {
                    const checkpointTapscript = hex.decode(ctx.checkpointTapscript);
                    for (const tree of nonAnchorOutput.tapTree) {
                        if (bytesEqual(checkpointTapscript, tree.script)) return "checkpoint";
                    }
                }
            }
        } catch (e) {
            console.error("Failed to detect checkpoint tx:", e);
        }
    }

    // --- batch-tree vs connector-tree ---
    try {
        const cosignerFields = getArkPsbtFields(tx, 0, CosignerPublicKey);
        if (cosignerFields.length > 1) return "batch-tree";
        if (cosignerFields.length === 1) {
            const cosignerPubkey = cosignerFields[0].key.slice(1);
            const firstOutput = tx.getOutput(0);
            if (firstOutput?.script) {
                const decodedOutput = btc.OutScript.decode(firstOutput.script);
                if (
                    "pubkey" in decodedOutput &&
                    decodedOutput.pubkey &&
                    bytesEqual(cosignerPubkey, decodedOutput.pubkey)
                ) {
                    return "connector-tree";
                }
            }
        }
    } catch (e) {
        console.error("Failed to detect tree transaction type:", e);
    }

    return "generic";
}

// ---------------------------------------------------------------------------
// Parsed input/output models
// ---------------------------------------------------------------------------

export interface ParsedInput {
    index: number;
    txid: string;
    vout: number;
    amount: bigint | null;
    scriptHex: string;
    arkAddress: string;
}

export interface ParsedOutput {
    index: number;
    amount: bigint;
    scriptHex: string;
    script: Uint8Array;
    isAnchor: boolean;
    isArkExtension: boolean;
    isForfeit: boolean;
    arkAddress: string;
    vtxo: VirtualCoin | undefined;
    isBatch: boolean;
    batchKey: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batchInfo: any;
}

export interface ParsedTx {
    tx: btc.Transaction;
    subtype: TxSubtype;
    inputs: ParsedInput[];
    outputs: ParsedOutput[];
    assetPacket: AssetPacketInstance | null;
    packetExtensions: ParsedPacketExtension[];
    forfeitAddress: string;
    forfeitScriptHex: string;
}

export interface ParseTxOptions {
    type: "arkade" | "commitment";
    txid: string;
    hex: string; // base64 PSBT for arkade, raw hex for commitment
    vtxoData?: VirtualCoin[];
    commitmentMetadata?: CommitmentTx;
    serverInfo?: SubtypeContext;
}

/**
 * Decode a transaction payload into the display model: subtype detection,
 * labelled inputs/outputs, asset packet and forfeit address.
 */
export function parseTransaction(opts: ParseTxOptions): ParsedTx | null {
    const { type, hex: hexData, vtxoData, commitmentMetadata, serverInfo } = opts;

    let parsed: btc.Transaction | null = null;
    if (type === "arkade" && hexData) {
        try {
            const psbtBytes = Uint8Array.from(atob(hexData), (c) => c.charCodeAt(0));
            parsed = btc.Transaction.fromPSBT(psbtBytes);
        } catch (e) {
            console.error("Failed to parse PSBT:", e);
        }
    }
    if (type === "commitment" && hexData) {
        try {
            parsed = btc.Transaction.fromRaw(hex.decode(hexData));
        } catch (e) {
            console.error("Failed to parse commitment transaction hex:", e);
        }
    }
    if (!parsed) return null;

    const subtype = detectSubtype(parsed, serverInfo ?? {});

    // Forfeit script/address (needed to label the forfeit output)
    let forfeitScriptHex = "";
    let forfeitAddress = "";
    if (serverInfo?.forfeitPubkey) {
        try {
            const pubkeyBytes = Uint8Array.from(
                serverInfo.forfeitPubkey.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) || [],
            );
            const net = serverInfo.network === "bitcoin" ? btc.NETWORK : btc.TEST_NETWORK;
            const p2wpkhOutput = btc.p2wpkh(pubkeyBytes, net);
            forfeitScriptHex = toHex(p2wpkhOutput.script);
            forfeitAddress = p2wpkhOutput.address || "";
        } catch (e) {
            console.error("Failed to generate forfeit script:", e);
        }
    }

    // Asset packet from the first ARK extension OP_RETURN
    let detectedPacket: ParsedPacket | null = null;
    for (let i = 0; i < parsed.outputsLength; i++) {
        const output = parsed.getOutput(i);
        if (output?.script && isArkExtension(output.script)) {
            detectedPacket = parseArkPacket(output.script);
            break;
        }
    }

    // Inputs
    const inputs: ParsedInput[] = [];
    for (let i = 0; i < parsed.inputsLength; i++) {
        const input = parsed.getInput(i);
        const inputTxid = input?.txid ? toHex(input.txid) : "";
        let inputAmount: bigint | null = null;
        let inputScriptHex = "";
        let inputArkAddress = "";

        if (input?.witnessUtxo) {
            inputAmount = input.witnessUtxo.amount;
            if (input.witnessUtxo.script) {
                inputScriptHex = hex.encode(input.witnessUtxo.script);
            }
            // Arkade addresses only for batch tree inputs
            if (
                subtype === "batch-tree" &&
                input.witnessUtxo.script &&
                serverInfo?.signerPubkey &&
                serverInfo?.network
            ) {
                try {
                    const addr = constructArkAddress(
                        input.witnessUtxo.script,
                        serverInfo.signerPubkey,
                        serverInfo.network,
                    );
                    if (addr) inputArkAddress = addr;
                } catch (e) {
                    console.error("Failed to construct Arkade address for input:", e);
                }
            }
        }

        inputs.push({
            index: i,
            txid: inputTxid,
            vout: input?.index ?? 0,
            amount: inputAmount,
            scriptHex: inputScriptHex,
            arkAddress: inputArkAddress,
        });
    }

    // Outputs
    const outputs: ParsedOutput[] = [];
    for (let i = 0; i < parsed.outputsLength; i++) {
        const output = parsed.getOutput(i);
        const amount = output?.amount || BigInt(0);
        const scriptBytes = output?.script ?? new Uint8Array();
        const scriptH = toHex(scriptBytes);
        const isAnchor = isAnchorScript(scriptBytes);
        const isExt = output?.script ? isArkExtension(output.script) : false;
        const isForfeitOutput = subtype === "forfeit" && scriptH === forfeitScriptHex;

        const vtxo = vtxoData?.find((v) => v.vout === i);

        let arkAddress = "";
        if (!isAnchor && !isExt && !isForfeitOutput && output?.script && serverInfo?.network) {
            arkAddress = deriveOutputDisplayAddress(output.script, {
                type,
                subtype,
                network: serverInfo.network,
                signerPubkey: serverInfo.signerPubkey,
            });
        }

        const batchKey = i.toString();
        const batchInfo = type === "commitment" ? commitmentMetadata?.batches?.[batchKey] : null;
        const isBatch =
            !!batchInfo &&
            parseInt((batchInfo as { totalOutputAmount?: string }).totalOutputAmount || "0") > 0;

        outputs.push({
            index: i,
            amount,
            scriptHex: scriptH,
            script: scriptBytes,
            isAnchor,
            isArkExtension: isExt,
            isForfeit: isForfeitOutput,
            arkAddress,
            vtxo,
            isBatch,
            batchKey,
            batchInfo,
        });
    }

    return {
        tx: parsed,
        subtype,
        inputs,
        outputs,
        assetPacket: detectedPacket?.assetPacket ?? null,
        packetExtensions: detectedPacket?.extensions ?? [],
        forfeitAddress,
        forfeitScriptHex,
    };
}

// ---------------------------------------------------------------------------
// Asset packet helpers
// ---------------------------------------------------------------------------

export interface PacketAssetAmount {
    assetId: string;
    /** Base units; bigint because supplies exceed Number.MAX_SAFE_INTEGER. */
    amount: bigint;
}

function packetAssetId(group: AssetGroup, txid: string, gi: number): string | null {
    const aid = group.assetId?.toString();
    if (aid) return aid;
    if (group.isIssuance()) {
        // Issuance asset id = genesis txid + 2-byte group index in
        // LITTLE-endian hex (arkd asset_id.go serializeUint16 →
        // binary.LittleEndian; TS SDK AssetId.serializeTo → writeUint16LE).
        // Big-endian padStart would byte-swap every index except 0.
        const lo = gi & 0xff;
        const hi = (gi >> 8) & 0xff;
        return txid + lo.toString(16).padStart(2, "0") + hi.toString(16).padStart(2, "0");
    }
    return null;
}

/**
 * Asset amounts a packet group attributes to one transaction input (`vin`) or
 * output (`vout`). Issuance asset ids are `txid` + groupIndex as 2-byte LE hex.
 */
export function packetAssetsForIndex(
    assetPacket: AssetPacketInstance | null,
    txid: string,
    field: "inputs" | "outputs",
    index: number,
): PacketAssetAmount[] {
    const result: PacketAssetAmount[] = [];
    if (!assetPacket) return result;
    assetPacket.groups.forEach((group, gi) => {
        const entries =
            field === "inputs"
                ? group.inputs.map((input) => ({ key: input.vin, amount: input.amount }))
                : group.outputs.map((output) => ({ key: output.vout, amount: output.amount }));
        const match = entries.find((entry) => entry.key === index);
        if (!match) return;
        const aid = packetAssetId(group, txid, gi);
        if (aid) result.push({ assetId: aid, amount: match.amount });
    });
    return result;
}

// ---------------------------------------------------------------------------
// Aggregate facts
// ---------------------------------------------------------------------------

export interface TxAggregate {
    earliestCreatedAt: number | null;
    earliestExpiry: number | null;
    /** "active" while any output VTXO is live; "unrolled" when all have started exiting;
     *  else "settled"/"spent". */
    aggregateKind: "active" | "settled" | "spent" | "unrolled";
}

/**
 * Earliest creation/expiry across the output VTXOs and the dominant lifecycle
 * kind. Settled takes precedence over spent when nothing is still active.
 */
export function aggregateVtxoFacts(vtxos: VirtualCoin[] | undefined): TxAggregate {
    if (!vtxos || vtxos.length === 0) {
        return { earliestCreatedAt: null, earliestExpiry: null, aggregateKind: "active" };
    }

    let minCreated: number | null = null;
    let minExpiry: number | null = null;
    let anyActive = false;
    let anySettled = false;
    let anyUnrolled = false;
    for (const vtxo of vtxos) {
        if (vtxo.createdAt) {
            const ts =
                vtxo.createdAt instanceof Date ? vtxo.createdAt.getTime() : Number(vtxo.createdAt);
            if (!isNaN(ts) && (minCreated === null || ts < minCreated)) minCreated = ts;
        }
        // Height expiry is not an absolute time without a chain tip.
        const remaining = remainingLifetime(vtxo, 0);
        const expiryMs = remaining?.source === "time" ? remaining.expiresAtMs : null;
        if (expiryMs !== null && Number.isFinite(expiryMs)) {
            if (minExpiry === null || expiryMs < minExpiry) minExpiry = expiryMs;
        }
        const kind = deriveExpiryKind(vtxo);
        // Unrolled outputs have begun an on-chain exit, not necessarily completed it.
        if (vtxo.isUnrolled === true && kind === "active") {
            anyUnrolled = true;
            continue;
        }
        if (kind === "active") anyActive = true;
        else if (kind === "settled") anySettled = true;
    }

    const aggregateKind = anyActive
        ? "active"
        : anyUnrolled
          ? "unrolled"
          : anySettled
            ? "settled"
            : "spent";

    return {
        earliestCreatedAt: minCreated,
        earliestExpiry: minExpiry,
        aggregateKind,
    };
}
