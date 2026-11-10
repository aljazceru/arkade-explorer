import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type MoneyUnit = "sats" | "btc";

interface MoneyDisplayContextType {
    unit: MoneyUnit;
    toggleUnit: () => void;
    setUnit: (unit: MoneyUnit) => void;
}

const MoneyDisplayContext = createContext<MoneyDisplayContextType | undefined>(undefined);

const STORAGE_KEY = "arkade-explorer-money-unit";

function readStoredUnit(): MoneyUnit | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === "btc" || stored === "sats" ? stored : null;
    } catch {
        return null;
    }
}

/** Amount unit preference. Atlas reads in sats by default; BTC is one toggle away. */
export function MoneyDisplayProvider({ children }: { children: ReactNode }) {
    const [unit, setUnit] = useState<MoneyUnit>(() => readStoredUnit() ?? "sats");

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, unit);
        } catch {
            // localStorage unavailable: the preference lasts for this session.
        }
    }, [unit]);

    const toggleUnit = () => setUnit((prev) => (prev === "sats" ? "btc" : "sats"));

    return (
        <MoneyDisplayContext.Provider value={{ unit, toggleUnit, setUnit }}>
            {children}
        </MoneyDisplayContext.Provider>
    );
}

export function useMoneyDisplay() {
    const context = useContext(MoneyDisplayContext);
    if (context === undefined) {
        throw new Error("useMoneyDisplay must be used within a MoneyDisplayProvider");
    }
    return context;
}
