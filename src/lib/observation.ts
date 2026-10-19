/** Types + formatters for the Arkade | Second observation dashboard. */

export type ArkadeVtxoRow = {
    txType?: string;
    txid: string;
    vout: number;
    amount_sat: number;
    createdAt?: string;
    expiresAt?: string;
    expiresAt_unix?: number | null;
    left_seconds?: number | null;
    urgent?: boolean;
    expired?: boolean;
    isSpent?: boolean;
    spentBy?: string;
    settledBy?: string;
    commitmentTxids?: string[];
    script?: string;
    error?: string;
};

export type ArkadeObservation = {
    fetched_at: string;
    info: Record<string, unknown>;
    stats_24h: Record<string, unknown>;
    trends: unknown[];
    recent_activity: { txid: string; createdAt: number; txType: string }[];
    vtxos: ArkadeVtxoRow[];
    commitments: Record<string, Record<string, unknown>>;
    notes: string[];
    source: Record<string, string>;
};

export type BarkObservation = {
    fetched_at: string;
    info: {
        network?: string;
        server_pubkey?: string;
        round_interval_secs?: number;
        vtxo_lifetime?: number;
        vtxo_exit_delta?: number;
        max_vtxo_amount?: number;
        min_board_amount?: number;
        required_board_confirmations?: number;
        tos_link?: string;
        [k: string]: unknown;
    };
    next_round_unix?: number | null;
    next_round_rome?: string | null;
    last_round_event?: { kind?: string; round_seq?: number; funding_txid?: string } | null;
    recent_server_txs: {
        txid: string;
        block_height?: number;
        block_time_rome?: string;
        vin: number;
        vout: number;
        total_sats: number;
        direction: string;
        mempool_url: string;
    }[];
    stats_24h: Record<string, number>;
    server_address_stats?: Record<string, unknown>;
    notes: string[];
    source: Record<string, string>;
};

export function observationUrl(name: "arkade" | "bark" | "summary"): string {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    return `${base}observation/${name}.json`;
}

export async function loadObservation<T>(name: "arkade" | "bark" | "summary"): Promise<T> {
    const res = await fetch(observationUrl(name), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${name}`);
    return res.json() as Promise<T>;
}

export function formatSats(n: number | string | undefined | null): string {
    const v = typeof n === "string" ? Number(n) : (n ?? 0);
    return `${Math.round(v).toLocaleString("en-US")} sats`;
}

export function formatBtc(sats: number): string {
    return (sats / 1e8).toFixed(8) + " BTC";
}

export function formatDuration(secs: number | null | undefined): string {
    if (secs === null || secs === undefined || Number.isNaN(secs)) return "—";
    const s = Math.max(0, Math.floor(secs));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export function truncateId(id: string, a = 8, b = 8): string {
    if (!id || id.length <= a + b + 1) return id || "";
    return `${id.slice(0, a)}…${id.slice(-b)}`;
}
