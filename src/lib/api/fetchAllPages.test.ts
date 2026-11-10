import { describe, it, expect } from "vitest";
import type { PageResponse, PaginationOptions } from "@arkade-os/sdk";
import { fetchAllPages, hasMorePages } from "@/lib/api/fetchAllPages";

/**
 * Mirrors the live Arkade indexer (arkade.computer, Nov 2026): pages are 1-based,
 * index 0 is served as page 1, `page.size` is capped at 100, `total` counts pages,
 * the last page reports `next === current`, and an empty set reports next 0.
 */
function fakeIndexer(itemCount: number, maxPageSize = 100) {
    const items = Array.from({ length: itemCount }, (_, i) => `vtxo-${i}`);
    const requested: number[] = [];
    const call = async ({ pageIndex = 0, pageSize = 20 }: PaginationOptions) => {
        requested.push(pageIndex);
        const size = Math.min(pageSize, maxPageSize);
        const total = Math.ceil(items.length / size);
        const current = Math.max(1, pageIndex);
        const vtxos = items.slice((current - 1) * size, current * size);
        const page: PageResponse = {
            current,
            next: total === 0 ? 0 : Math.min(current + 1, total),
            total,
        };
        return { vtxos, page };
    };
    return { call, requested };
}

describe("fetchAllPages", () => {
    it("returns every item exactly once, including the last page", async () => {
        const indexer = fakeIndexer(1537);
        const result = await fetchAllPages(indexer.call, "vtxos", 100);
        expect(result.vtxos).toHaveLength(1537);
        expect(new Set(result.vtxos).size).toBe(1537);
        expect(result.vtxos[result.vtxos.length - 1]).toBe("vtxo-1536");
        expect(indexer.requested).toHaveLength(16);
    });

    it("drains a set that exactly fills its pages", async () => {
        const result = await fetchAllPages(fakeIndexer(200).call, "vtxos", 100);
        expect(result.vtxos).toHaveLength(200);
    });

    it("keeps paging when the server caps a larger requested page size", async () => {
        const indexer = fakeIndexer(250);
        const result = await fetchAllPages(indexer.call, "vtxos", 500);
        expect(result.vtxos).toHaveLength(250);
        expect(indexer.requested).toHaveLength(3);
    });

    it("stops after one call for an empty set", async () => {
        const indexer = fakeIndexer(0);
        const result = await fetchAllPages(indexer.call, "vtxos", 100);
        expect(result.vtxos).toEqual([]);
        expect(indexer.requested).toHaveLength(1);
    });

    it("stops when the server points back at a page it already served", async () => {
        let calls = 0;
        const looping = async () => {
            calls++;
            return { vtxos: [`v${calls}`], page: { current: 1, next: 2, total: 0 } };
        };
        const result = await fetchAllPages(looping, "vtxos", 100);
        expect(calls).toBe(2);
        expect(result.vtxos).toEqual(["v1", "v2"]);
    });
});

describe("hasMorePages", () => {
    const page = (current: number, next: number, total: number): PageResponse => ({
        current,
        next,
        total,
    });

    it("is true on the second-to-last page", () => {
        expect(hasMorePages(page(15, 16, 16))).toBe(true);
    });

    it("is false on the last page", () => {
        expect(hasMorePages(page(16, 16, 16))).toBe(false);
    });

    it("is false for an empty set", () => {
        expect(hasMorePages(page(1, 0, 0))).toBe(false);
    });

    it("is false without page metadata", () => {
        expect(hasMorePages(undefined)).toBe(false);
    });
});
