import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/formatters";

describe("formatRelativeTime", () => {
    const now = Date.UTC(2026, 10, 6, 15, 39, 0);

    it("formats recent timestamps as relative ages", () => {
        expect(formatRelativeTime(now - 30_000, now)).toBe("just now");
        expect(formatRelativeTime(now - 2 * 60_000, now)).toBe("2m ago");
        expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
        expect(formatRelativeTime(now - 5 * 86_400_000, now)).toBe("5d ago");
    });

    it("falls back to a date for older timestamps", () => {
        expect(formatRelativeTime(now - 10 * 86_400_000, now)).toMatch(/^\d/);
    });

    it("treats future and invalid timestamps as just now", () => {
        expect(formatRelativeTime(now + 60_000, now)).toBe("just now");
        expect(formatRelativeTime(Number.NaN, now)).toBe("just now");
    });
});
