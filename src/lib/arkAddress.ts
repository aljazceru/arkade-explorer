import { ArkAddress } from "@arkade-os/sdk";
import { hex } from "@scure/base";
import * as btc from "@scure/btc-signer";

export function constructArkAddress(
    scriptPubkey: Uint8Array,
    operatorPubkeyHex: string,
    network: string = "bitcoin",
): string | null {
    try {
        let operatorPubkey = hex.decode(operatorPubkeyHex);
        if (operatorPubkey.length === 33) {
            operatorPubkey = operatorPubkey.slice(1);
        }

        let witnessProgram: Uint8Array | null = null;

        if (scriptPubkey.length >= 2 && scriptPubkey[0] === 0x6a) {
            if (scriptPubkey.length === 34 && scriptPubkey[1] === 0x20) {
                witnessProgram = new Uint8Array(
                    scriptPubkey.buffer,
                    scriptPubkey.byteOffset + 2,
                    32,
                );
            } else if (scriptPubkey.length === 33) {
                witnessProgram = new Uint8Array(
                    scriptPubkey.buffer,
                    scriptPubkey.byteOffset + 1,
                    32,
                );
            }
        } else if (
            scriptPubkey.length === 34 &&
            scriptPubkey[0] === 0x51 &&
            scriptPubkey[1] === 0x20
        ) {
            witnessProgram = new Uint8Array(scriptPubkey.buffer, scriptPubkey.byteOffset + 2, 32);
        }

        if (!witnessProgram) return null;

        const arkAddress = new ArkAddress(
            operatorPubkey,
            witnessProgram,
            network === "bitcoin" ? "ark" : "tark",
        );
        return arkAddress.encode();
    } catch (e) {
        console.error("Failed to construct Arkade address:", e);
        return null;
    }
}

export function decodeArkAddress(arkAddressStr: string): ArkAddress | null {
    try {
        return ArkAddress.decode(arkAddressStr);
    } catch (e) {
        console.error("Failed to decode Arkade address:", e);
        return null;
    }
}

/**
 * Display address for a parsed transaction output.
 *
 * On-chain-style outputs — every output of a commitment tx, connector-tree
 * outputs, and forfeit outputs (the operator's P2WPKH reclaim address) —
 * decode to a Bitcoin address (bc1…/tb1…). Everything else is encoded as an
 * Arkade address (ark1…/tark1…): that is an *address encoding* of the output
 * script keyed by the operator pubkey, NOT a claim that the output is a
 * spendable VTXO — VTXO status only comes from indexer records.
 */
export function deriveOutputDisplayAddress(
    script: Uint8Array,
    opts: {
        type: "arkade" | "commitment";
        subtype: "generic" | "forfeit" | "checkpoint" | "batch-tree" | "connector-tree";
        network: string;
        signerPubkey?: string;
    },
): string {
    const onchain =
        opts.type === "commitment" ||
        opts.subtype === "connector-tree" ||
        opts.subtype === "forfeit";
    if (onchain) {
        try {
            const net = opts.network === "bitcoin" ? btc.NETWORK : btc.TEST_NETWORK;
            return btc.Address(net).encode(btc.OutScript.decode(script));
        } catch {
            return "";
        }
    }
    if (opts.signerPubkey) {
        try {
            return constructArkAddress(script, opts.signerPubkey, opts.network) ?? "";
        } catch {
            return "";
        }
    }
    return "";
}
