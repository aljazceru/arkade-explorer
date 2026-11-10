import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    BARKD_STORAGE_KEY,
    loadBarkdConnection,
    normalizeBarkdBaseUrl,
    saveBarkdConnection,
    validateBarkdBaseUrl,
} from "@/lib/barkd";

// jsdom localStorage is provided by the test environment; if absent, stub it.
const store = new Map<string, string>();
const localStorageMock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
};

beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", localStorageMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("normalizeBarkdBaseUrl", () => {
    it("adds http:// when no scheme is given", () => {
        expect(normalizeBarkdBaseUrl("127.0.0.1:7474")).toBe("http://127.0.0.1:7474");
    });

    it("strips trailing slashes", () => {
        expect(normalizeBarkdBaseUrl("http://localhost:7474///")).toBe("http://localhost:7474");
    });
});

describe("validateBarkdBaseUrl", () => {
    it("accepts loopback http", () => {
        for (const url of [
            "http://127.0.0.1:7474",
            "http://localhost:7474",
            "127.0.0.1:7474",
            "localhost",
            "http://[::1]:7474",
        ]) {
            const r = validateBarkdBaseUrl(url);
            expect(r.ok, url).toBe(true);
        }
    });

    it("accepts https for any host", () => {
        const r = validateBarkdBaseUrl("https://barkd.example.com:7474");
        expect(r.ok).toBe(true);
    });

    it("rejects plaintext http to non-loopback hosts", () => {
        for (const url of [
            "http://barkd.example.com",
            "http://192.168.1.10:7474",
            "192.168.1.10:7474",
            "http://10.0.0.5",
        ]) {
            const r = validateBarkdBaseUrl(url);
            expect(r.ok, url).toBe(false);
            if (!r.ok) expect(r.error).toMatch(/unencrypted|https/);
        }
    });

    it("rejects non-http(s) schemes", () => {
        for (const url of ["ftp://127.0.0.1", "file:///etc/passwd", "ws://localhost:7474"]) {
            const r = validateBarkdBaseUrl(url);
            expect(r.ok, url).toBe(false);
        }
    });

    it("rejects empty input", () => {
        expect(validateBarkdBaseUrl("").ok).toBe(false);
        expect(validateBarkdBaseUrl("   ").ok).toBe(false);
    });
});

describe("loadBarkdConnection", () => {
    it("round-trips a valid connection", () => {
        saveBarkdConnection({ baseUrl: "http://127.0.0.1:7474", token: "t" });
        expect(loadBarkdConnection()).toEqual({
            baseUrl: "http://127.0.0.1:7474",
            token: "t",
        });
    });

    it("drops a stored plaintext non-loopback connection", () => {
        store.set(
            BARKD_STORAGE_KEY,
            JSON.stringify({ baseUrl: "http://barkd.example.com", token: "t" }),
        );
        expect(loadBarkdConnection()).toBeNull();
    });

    it("keeps a stored https connection", () => {
        store.set(
            BARKD_STORAGE_KEY,
            JSON.stringify({ baseUrl: "https://barkd.example.com", token: "t" }),
        );
        expect(loadBarkdConnection()).toEqual({
            baseUrl: "https://barkd.example.com",
            token: "t",
        });
    });
});
