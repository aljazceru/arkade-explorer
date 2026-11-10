import { describe, it, expect } from "vitest";
import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";
import {
    isArkExtension,
    isAnchorScript,
    parseVirtualTx,
    parseVirtualTxs,
    toHex,
    getMempoolUrl,
    detectSubtype,
    parseTransaction,
    packetAssetsForIndex,
    aggregateVtxoFacts,
} from "@/lib/tx-parse";
import type { VirtualCoin } from "@arkade-os/sdk";

// ---------------------------------------------------------------------------
// Script helpers
// ---------------------------------------------------------------------------

const P2WPKH_SCRIPT = hex.decode("0014" + "11".repeat(20));
const ANCHOR_SCRIPT = hex.decode("51024e73");
const P2TR_SCRIPT = hex.decode("5120" + "22".repeat(32));

describe("isAnchorScript", () => {
    it("detects P2A anchor outputs", () => {
        expect(isAnchorScript(ANCHOR_SCRIPT)).toBe(true);
        expect(isAnchorScript(P2TR_SCRIPT)).toBe(false);
    });
});

describe("isArkExtension", () => {
    it("detects ARK OP_RETURN packets", () => {
        const data = new Uint8Array([0x41, 0x52, 0x4b, 0x00]);
        const script = new Uint8Array([0x6a, data.length, ...data]);
        expect(isArkExtension(script)).toBe(true);
        expect(isArkExtension(hex.decode("6a02dead"))).toBe(false);
        expect(isArkExtension(new Uint8Array())).toBe(false);
    });
});

describe("toHex", () => {
    it("encodes bytes as lowercase hex", () => {
        expect(toHex(new Uint8Array([0x0a, 0xbb, 0xff]))).toBe("0abbff");
        expect(toHex(new Uint8Array())).toBe("");
    });
});

describe("getMempoolUrl", () => {
    it("maps networks to explorer URLs", () => {
        expect(getMempoolUrl("bitcoin", "abc")).toBe("https://mempool.space/tx/abc");
        expect(getMempoolUrl("mainnet", "abc")).toBe("https://mempool.space/tx/abc");
        expect(getMempoolUrl("signet", "abc")).toBe("https://mempool.space/signet/tx/abc");
        expect(getMempoolUrl("testnet", "abc")).toBe("https://mempool.space/testnet/tx/abc");
        expect(getMempoolUrl("mutinynet", "abc")).toBe("https://mutinynet.com/tx/abc");
        expect(getMempoolUrl(undefined, "abc")).toBe("https://mutinynet.com/tx/abc");
    });
});

// ---------------------------------------------------------------------------
// Transaction parsing
// ---------------------------------------------------------------------------

/** Build a minimal valid PSBT for tests. */
function makePsbt(outputs: Array<{ script: Uint8Array; amount: bigint }>, inputs = 1): string {
    const tx = new btc.Transaction();
    for (let i = 0; i < inputs; i++) {
        tx.addInput({
            txid: new Uint8Array(32).fill(i + 1),
            index: i,
            sequence: 0xfffffffd,
            witnessUtxo: { script: P2WPKH_SCRIPT, amount: BigInt(100000) },
        });
    }
    for (const o of outputs) {
        tx.addOutput({ script: o.script, amount: o.amount });
    }
    return btoa(String.fromCharCode(...tx.toPSBT()));
}

describe("parseVirtualTx", () => {
    it("parses base64 PSBT", () => {
        const psbt = makePsbt([{ script: ANCHOR_SCRIPT, amount: BigInt(0) }]);
        const tx = parseVirtualTx(psbt);
        expect(tx).not.toBeNull();
        expect(tx!.outputsLength).toBe(1);
    });

    it("parses hex raw tx", () => {
        const psbt = makePsbt([{ script: ANCHOR_SCRIPT, amount: BigInt(0) }]);
        const tx0 = parseVirtualTx(psbt)!;
        const rawHex = hex.encode(tx0.toBytes());
        const tx = parseVirtualTx(rawHex);
        expect(tx).not.toBeNull();
    });

    it("returns null on garbage", () => {
        expect(parseVirtualTx("not-valid!!!")).toBeNull();
        expect(parseVirtualTx("")).toBeNull();
    });
});

describe("parseVirtualTxs", () => {
    it("skips undecodable entries", () => {
        const psbt = makePsbt([{ script: ANCHOR_SCRIPT, amount: BigInt(0) }]);
        const txs = parseVirtualTxs([psbt, "garbage!!!", psbt]);
        expect(txs).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Subtype detection
// ---------------------------------------------------------------------------

describe("detectSubtype", () => {
    it("returns generic for a plain tx", () => {
        const psbt = makePsbt([{ script: P2WPKH_SCRIPT, amount: BigInt(5000) }]);
        const tx = parseVirtualTx(psbt)!;
        expect(detectSubtype(tx, {})).toBe("generic");
    });

    it("detects forfeit when the single non-anchor output pays the forfeit script", () => {
        const forfeitPubkey = "02" + "22".repeat(32);
        const pubkeyBytes = hex.decode(forfeitPubkey);
        const net = btc.TEST_NETWORK;
        const forfeitScript = btc.p2wpkh(pubkeyBytes, net).script;
        const psbt = makePsbt([
            { script: forfeitScript, amount: BigInt(1000) },
            { script: ANCHOR_SCRIPT, amount: BigInt(0) },
        ]);
        const tx = parseVirtualTx(psbt)!;
        expect(detectSubtype(tx, { forfeitPubkey, network: "testnet" })).toBe("forfeit");
    });

    it("detects forfeit even without anchor output", () => {
        const forfeitPubkey = "03" + "33".repeat(32);
        const pubkeyBytes = hex.decode(forfeitPubkey);
        const forfeitScript = btc.p2wpkh(pubkeyBytes, btc.NETWORK).script;
        const psbt = makePsbt([{ script: forfeitScript, amount: BigInt(1000) }]);
        const tx = parseVirtualTx(psbt)!;
        expect(detectSubtype(tx, { forfeitPubkey, network: "bitcoin" })).toBe("forfeit");
    });
});

// ---------------------------------------------------------------------------
// parseTransaction
// ---------------------------------------------------------------------------

describe("parseTransaction", () => {
    it("returns null for empty hex", () => {
        expect(parseTransaction({ type: "arkade", txid: "x", hex: "" })).toBeNull();
    });

    it("parses a PSBT into inputs/outputs", () => {
        const psbt = makePsbt([
            { script: ANCHOR_SCRIPT, amount: BigInt(0) },
            { script: P2WPKH_SCRIPT, amount: BigInt(5000) },
        ]);
        const result = parseTransaction({
            type: "arkade",
            txid: "deadbeef",
            hex: psbt,
        });
        expect(result).not.toBeNull();
        expect(result!.inputs).toHaveLength(1);
        expect(result!.outputs).toHaveLength(2);
        expect(result!.outputs[0].isAnchor).toBe(true);
        expect(result!.outputs[1].isAnchor).toBe(false);
        expect(result!.subtype).toBe("generic");
    });

    it("labels batch outputs on commitment txs", () => {
        // Commitment tx: raw hex, 2 outputs where output 0 is a batch
        const tx = new btc.Transaction();
        tx.addInput({
            txid: new Uint8Array(32).fill(9),
            index: 0,
            sequence: 0xfffffffd,
            witnessUtxo: { script: P2WPKH_SCRIPT, amount: BigInt(50000) },
        });
        tx.addOutput({ script: P2TR_SCRIPT, amount: BigInt(40000) });
        tx.addOutput({ script: ANCHOR_SCRIPT, amount: BigInt(0) });
        const rawHex = hex.encode(tx.toBytes());

        const result = parseTransaction({
            type: "commitment",
            txid: "commit1",
            hex: rawHex,
            commitmentMetadata: {
                startedAt: "1700000000",
                endedAt: "1700000600",
                batches: {
                    "0": {
                        totalOutputAmount: "40000",
                        totalOutputVtxos: 2,
                        expiresAt: "1700600000",
                        swept: false,
                    },
                },
                totalInputAmount: "50000",
                totalInputVtxos: 1,
                totalOutputAmount: "40000",
                totalOutputVtxos: 2,
            },
        });
        expect(result).not.toBeNull();
        expect(result!.outputs[0].isBatch).toBe(true);
        expect(result!.outputs[0].batchKey).toBe("0");
        expect(result!.outputs[1].isBatch).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// packetAssetsForIndex
// ---------------------------------------------------------------------------

describe("packetAssetsForIndex", () => {
    it("returns empty for null packet", () => {
        expect(packetAssetsForIndex(null, "txid", "inputs", 0)).toEqual([]);
        expect(packetAssetsForIndex(null, "txid", "outputs", 0)).toEqual([]);
    });

    it("derives issuance asset ids with little-endian group index", () => {
        // arkd asset_id.go: asset id = genesis txid + uint16 LE group index.
        // Big-endian encoding would produce "0001" for group 1; correct is "0100".
        const txid = "ab".repeat(32);
        const group = () =>
            ({
                assetId: null,
                inputs: [],
                outputs: [{ vout: 0, amount: 5n }],
                isIssuance: () => true,
            }) as never;
        const packet = { groups: [group(), group()] } as unknown as Parameters<
            typeof packetAssetsForIndex
        >[0];
        const assets = packetAssetsForIndex(packet, txid, "outputs", 0);
        expect(assets.map((a) => a.assetId)).toEqual([`${txid}0000`, `${txid}0100`]);
    });
});

// ---------------------------------------------------------------------------
// aggregateVtxoFacts
// ---------------------------------------------------------------------------

function makeVtxo(overrides: Partial<VirtualCoin>): VirtualCoin {
    return {
        txid: "a".repeat(64),
        vout: 0,
        value: 1000,
        status: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
        expiresAt: new Date("2026-01-08T00:00:00Z"),
        amount: "1000",
        script: "00",
        isPreconfirmed: false,
        isSwept: false,
        isUnrolled: false,
        isSpent: false,
        spentBy: "",
        commitmentTxids: [],
        ...overrides,
    } as VirtualCoin;
}

describe("aggregateVtxoFacts", () => {
    it("returns active defaults for empty input", () => {
        const r = aggregateVtxoFacts(undefined);
        expect(r.aggregateKind).toBe("active");
        expect(r.earliestCreatedAt).toBeNull();
    });
    it("marks aggregate as active when any vtxo is live", () => {
        const vtxos = [
            makeVtxo({ isSpent: true, spentBy: "b".repeat(64) }),
            makeVtxo({}), // unspent, no settledBy → active
        ];
        const r = aggregateVtxoFacts(vtxos);
        expect(r.aggregateKind).toBe("active");
    });

    it("settled takes precedence over spent when nothing is active", () => {
        const vtxos = [
            makeVtxo({ isSpent: true, spentBy: "b".repeat(64) }),
            makeVtxo({ settledBy: "c".repeat(64), isSpent: true, spentBy: "d".repeat(64) }),
        ];
        const r = aggregateVtxoFacts(vtxos);
        expect(r.aggregateKind).toBe("settled");
    });

    it("spent when all are spent and none settled", () => {
        const vtxos = [makeVtxo({ isSpent: true, spentBy: "b".repeat(64) })];
        const r = aggregateVtxoFacts(vtxos);
        expect(r.aggregateKind).toBe("spent");
    });

    it("unrolled when every live output already exited on-chain", () => {
        const vtxos = [
            makeVtxo({ isUnrolled: true }),
            makeVtxo({ isUnrolled: true, isSpent: true, spentBy: "b".repeat(64) }),
        ];
        const r = aggregateVtxoFacts(vtxos);
        // spent wins over unrolled; the remaining unrolled output yields "unrolled"
        expect(r.aggregateKind).toBe("unrolled");
    });
});
