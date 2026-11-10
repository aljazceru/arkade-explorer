import type { VirtualCoin } from "@arkade-os/sdk";

/**
 * A VTXO is "active" (unspent, still spendable off-chain) only when nothing
 * consumed it: not spent off-chain (`spentBy`/`isSpent`), not consumed by a
 * commitment (`settledBy`), not swept (`isSwept`), and not exiting on-chain
 * (`isUnrolled`). Merely finalizing a VTXO into a batch does not consume it.
 */
export function isVtxoActive(vtxo: VirtualCoin): boolean {
    if (vtxo.isUnrolled === true) return false;
    if (vtxo.isSwept === true) return false;
    const spent = vtxo.isSpent === true || !!vtxo.spentBy || !!vtxo.settledBy;
    return !spent;
}

/** Sum of sat value across all given VTXOs (total received). */
export function sumVtxoValue(vtxos: VirtualCoin[]): number {
    return vtxos.reduce((sum, v) => sum + Number(v.value), 0);
}

/** Sum of sat value across active (unspent) VTXOs (spendable balance). */
export function sumActiveVtxoValue(vtxos: VirtualCoin[]): number {
    return vtxos.reduce((sum, v) => (isVtxoActive(v) ? sum + Number(v.value) : sum), 0);
}

export interface AssetBalance {
    active: bigint;
    total: bigint;
}

/** Aggregate per-asset active/total amounts across all given VTXOs. */
export function aggregateAssetBalances(vtxos: VirtualCoin[]): Map<string, AssetBalance> {
    const balances = new Map<string, AssetBalance>();
    for (const v of vtxos) {
        const active = isVtxoActive(v);
        for (const asset of v.assets ?? []) {
            const existing = balances.get(asset.assetId) ?? { active: 0n, total: 0n };
            existing.total += asset.amount;
            if (active) existing.active += asset.amount;
            balances.set(asset.assetId, existing);
        }
    }
    return balances;
}

/**
 * Deduplicate VTXOs by outpoint (`txid:vout`). Paginated indexer reads can
 * overlap as the dataset changes between page fetches; without this the same
 * outpoint would be summed twice. When records disagree, the terminal
 * (non-active) state wins over a stale active one so balances never
 * overstate what is still spendable.
 */
export function uniqueVtxos(vtxos: VirtualCoin[]): VirtualCoin[] {
    const byOutpoint = new Map<string, VirtualCoin>();
    for (const v of vtxos) {
        const key = `${v.txid}:${v.vout}`;
        const existing = byOutpoint.get(key);
        if (!existing) {
            byOutpoint.set(key, v);
        } else if (isVtxoActive(existing) && !isVtxoActive(v)) {
            byOutpoint.set(key, v);
        }
    }
    return [...byOutpoint.values()];
}
