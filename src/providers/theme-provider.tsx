import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { type ThemeName } from "@/themes";

const STORAGE_KEY = "arkade-theme";

interface ThemeContextType {
    theme: ThemeName;
    isDark: boolean;
    setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType>({
    theme: "midnight",
    isDark: true,
    setTheme: () => {},
});

function applyTheme(t: ThemeName) {
    document.documentElement.setAttribute("data-theme", t);
    if (t === "midnight") {
        document.documentElement.classList.add("dark");
        document.documentElement.classList.remove("light");
    } else {
        document.documentElement.classList.remove("dark");
        document.documentElement.classList.add("light");
    }
}

function readStoredTheme(): ThemeName | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === "dawn" || stored === "midnight" ? stored : null;
    } catch {
        return null;
    }
}

/** Atlas is designed dark-first: ink unless the reader chose day explicitly. */
export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<ThemeName>(() => readStoredTheme() ?? "midnight");

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    const setTheme = useCallback((t: ThemeName) => {
        try {
            localStorage.setItem(STORAGE_KEY, t);
        } catch {
            // Preference stays for this session only.
        }
        setThemeState(t);
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, isDark: theme === "midnight", setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
