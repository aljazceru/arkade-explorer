import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ark-observer:watchlist";
/** Same-window change event: `storage` only fires in *other* tabs. */
const CHANGE_EVENT = "ark-observer:watchlist-change";

export type WatchedScript = { script: string; label?: string; addedAt: number };

function read(): WatchedScript[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((w) => w && typeof w.script === "string") : [];
    } catch {
        return [];
    }
}

/** Local-only watchlist of script pubkeys (hex). Nothing leaves the browser except indexer lookups. */
export function useWatchlist() {
    const [items, setItems] = useState<WatchedScript[]>(read);

    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) setItems(read());
        };
        const onChange = () => setItems(read());
        window.addEventListener("storage", onStorage);
        window.addEventListener(CHANGE_EVENT, onChange);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener(CHANGE_EVENT, onChange);
        };
    }, []);

    const persist = useCallback((next: WatchedScript[]) => {
        setItems(next);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // storage full/blocked: keep in memory only
        }
        window.dispatchEvent(new Event(CHANGE_EVENT));
    }, []);

    const add = useCallback(
        (script: string, label?: string) => {
            const s = script.toLowerCase();
            const current = read();
            if (current.some((w) => w.script === s)) return false;
            persist([...current, { script: s, label: label || undefined, addedAt: Date.now() }]);
            return true;
        },
        [persist],
    );

    const remove = useCallback(
        (script: string) => persist(read().filter((w) => w.script !== script.toLowerCase())),
        [persist],
    );

    const has = useCallback(
        (script: string) => items.some((w) => w.script === script.toLowerCase()),
        [items],
    );

    return { items, add, remove, has };
}
