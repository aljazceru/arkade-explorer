import { describe, it, expect } from "vitest";
import { assetDecimals, formatAssetAmount, normalizeAssetMetadata } from "@/lib/api/indexer";

describe("normalizeAssetMetadata", () => {
    it("coerces non-string known fields so .charAt consumers cannot crash", () => {
        // Regression: a session-cache entry with metadata.ticker = 123 produced
        // `metadata?.ticker?.charAt is not a function` and blanked the app.
        const out = normalizeAssetMetadata({ ticker: 123, name: "Tk", icon: "https://x" });
        expect(typeof out?.ticker).toBe("string");
        expect(out?.ticker).toBe("123");
        expect(out?.name).toBe("Tk");
        expect(out?.icon).toBe("https://x");
    });

    it("drops object-valued known fields instead of keeping them", () => {
        const out = normalizeAssetMetadata({ ticker: { bad: true }, name: ["x"] });
        expect(out?.ticker).toBeUndefined();
        expect(out?.name).toBeUndefined();
    });

    it("returns undefined for non-object metadata", () => {
        expect(normalizeAssetMetadata("deadbeef")).toBeUndefined();
        expect(normalizeAssetMetadata(null)).toBeUndefined();
        expect(normalizeAssetMetadata(42)).toBeUndefined();
    });

    it("preserves valid string fields and unknown keys", () => {
        const out = normalizeAssetMetadata({
            ticker: "TIERO",
            decimals: 0,
            custom: "kept",
        });
        expect(out?.ticker).toBe("TIERO");
        expect(out?.decimals).toBe(0);
        expect(out?.custom).toBe("kept");
    });
});

describe("assetDecimals", () => {
    it("accepts non-negative integers within the render bound", () => {
        expect(assetDecimals({ decimals: 0 })).toBe(0);
        expect(assetDecimals({ decimals: 8 })).toBe(8);
        expect(assetDecimals({ decimals: 40 })).toBe(40);
    });

    it("rejects absent, non-integer, negative, oversized and non-number decimals", () => {
        expect(assetDecimals(undefined)).toBeNull();
        expect(assetDecimals({})).toBeNull();
        expect(assetDecimals({ decimals: 1.5 })).toBeNull();
        expect(assetDecimals({ decimals: -1 })).toBeNull();
        expect(assetDecimals({ decimals: 41 })).toBeNull();
        expect(assetDecimals({ decimals: "6" as unknown as number })).toBeNull();
    });
});

describe("formatAssetAmount", () => {
    it("keeps supplies above 2^53 exact", () => {
        // 2^53 + 1 cannot be represented as a JS number.
        const big = (2n ** 53n + 1n).toString();
        expect(formatAssetAmount(big, 0)).toBe("9,007,199,254,740,993");
        expect(formatAssetAmount(big, null)).toBe("9,007,199,254,740,993");
    });

    it("places decimals without floating-point drift", () => {
        expect(formatAssetAmount("123456789", 6)).toBe("123.456789");
        expect(formatAssetAmount(123456789n, 6)).toBe("123.456789");
        expect(formatAssetAmount("100000000000000", 0)).toBe("100,000,000,000,000");
    });

    it("renders raw grouped units when decimals are invalid", () => {
        expect(formatAssetAmount("1234567", null)).toBe("1,234,567");
        expect(formatAssetAmount("1234567", undefined)).toBe("1,234,567");
    });
});
