import { RestIndexerProvider, RestOperatorProvider } from "@arkade-os/sdk";
import { resolveOperatorUrl } from "@/providers/operator-settings";

export const INDEXER_URL = resolveOperatorUrl() ?? "";
export const ARK_URL =
    (import.meta.env.VITE_ARK_URL && String(import.meta.env.VITE_ARK_URL)) || INDEXER_URL;
export const OPERATOR_CONFIGURED = INDEXER_URL !== "";

// ---------------------------------------------------------------------------
// Asset metadata types (not yet exported from SDK top-level)
// ---------------------------------------------------------------------------

/** Well-known metadata fields that may appear on an asset. */
export type KnownMetadata = Partial<{
    name: string;
    ticker: string;
    decimals: number;
    icon: string;
}>;

/** Full asset metadata: known fields plus any arbitrary key-value pairs. */
export type AssetMetadata = KnownMetadata & Record<string, unknown>;

/** Details returned by the `/v1/indexer/asset/:assetId` endpoint. */
export type AssetDetails = {
    assetId: string;
    /**
     * Total issued supply in base units, kept as a decimal string: supplies
     * routinely exceed Number.MAX_SAFE_INTEGER (SDK types it `bigint`, which
     * JSON session caches cannot hold).
     */
    supply: string;
    metadata?: AssetMetadata;
    controlAssetId?: string;
};

// ---------------------------------------------------------------------------
// Exported clients
// ---------------------------------------------------------------------------

export const indexerClient = new RestIndexerProvider(INDEXER_URL);
export const arkClient = new RestOperatorProvider(ARK_URL);

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** Validate that an image URL is safe to render in an <img> tag. */
export function isSafeImageUrl(url: string): boolean {
    if (url.startsWith("data:image/")) return true;
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Render-safety bound for asset `decimals` — NOT a protocol limit (arkd treats
 * decimals as free-form metadata with no range check). Larger values would let
 * hostile metadata force a huge `padStart`; they fall back to exact raw units.
 */
const MAX_RENDERABLE_DECIMALS = 40;

/**
 * Validated decimals from asset metadata, or null when absent/invalid.
 * `metadata.decimals` is typed `number` but the SDK can surface non-numeric
 * fallbacks; only a non-negative integer within the render bound is usable.
 * Callers should treat null as "decimals unavailable" and label raw units.
 */
export function assetDecimals(metadata: AssetMetadata | undefined): number | null {
    const d: unknown = metadata?.decimals;
    return typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= MAX_RENDERABLE_DECIMALS
        ? d
        : null;
}

/**
 * Normalize asset metadata known fields at the fetch/cache boundary:
 * name/ticker/icon must be strings — a corrupt entry like `ticker: 123`
 * would otherwise crash `.charAt` consumers downstream. Non-string
 * primitives are coerced; objects/arrays are dropped. `decimals` is
 * validated separately by {@link assetDecimals} at render time.
 */
export function normalizeAssetMetadata(metadata: unknown): AssetMetadata | undefined {
    if (typeof metadata !== "object" || metadata === null) return undefined;
    const out: Record<string, unknown> = { ...(metadata as Record<string, unknown>) };
    for (const key of ["name", "ticker", "icon"] as const) {
        const v = out[key];
        if (v === undefined || v === null || typeof v === "string") continue;
        out[key] = typeof v === "object" ? undefined : String(v);
    }
    return out as AssetMetadata;
}

/** Exact base-unit digits for an asset amount; null when not representable. */
function amountToDigits(amount: number | bigint | string): string | null {
    if (typeof amount === "bigint") return amount.toString();
    if (typeof amount === "string") return /^\d+$/.test(amount) ? amount : null;
    if (!Number.isFinite(amount)) return null;
    try {
        return BigInt(Math.trunc(amount)).toString();
    } catch {
        return null;
    }
}

/**
 * Format an asset amount using string-based decimal placement to avoid
 * floating-point precision loss with large values or high decimal counts.
 * `decimals` should come from {@link assetDecimals}; null/invalid values render
 * the exact raw base units (grouped integer) rather than a guessed scale.
 */
export function formatAssetAmount(
    amount: number | bigint | string,
    decimals: number | null | undefined,
): string {
    const digits = amountToDigits(amount);
    if (digits === null) return String(amount);
    const d =
        typeof decimals === "number" &&
        Number.isInteger(decimals) &&
        decimals >= 0 &&
        decimals <= MAX_RENDERABLE_DECIMALS
            ? decimals
            : 0;
    let intPart = digits;
    let decPart = "";
    if (d > 0) {
        const padded = digits.padStart(d + 1, "0");
        intPart = padded.slice(0, padded.length - d);
        decPart = padded.slice(padded.length - d);
    }
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decPart ? `${grouped}.${decPart}` : grouped;
}

// ---------------------------------------------------------------------------
// Re-exports from SDK for convenience
// ---------------------------------------------------------------------------

export type {
    Outpoint,
    CommitmentTx,
    BatchInfo,
    PageResponse,
    VirtualCoin,
    Asset,
} from "@arkade-os/sdk";

export type { BatchInfo as Batch } from "@arkade-os/sdk";
export type { VirtualCoin as Vtxo } from "@arkade-os/sdk";
