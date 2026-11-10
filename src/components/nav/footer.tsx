import { Sun, Moon } from "lucide-react";
import { EXTERNAL_LINKS } from "@/lib/constants";
import { INDEXER_URL } from "@/lib/api/indexer";
import { useTheme } from "@/hooks/use-theme";

export function Footer() {
    const { isDark, setTheme } = useTheme();
    const linkClass = "text-muted-foreground transition-colors hover:text-foreground";

    return (
        <footer className="border-t border-border" role="contentinfo">
            <div className="mx-auto flex w-full max-w-[1560px] flex-col items-start gap-2 px-4 py-4 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-foreground">ark.observer</span>
                    <span className="text-faint">
                        Operator{" "}
                        <a
                            href={INDEXER_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[11px] text-virt hover:underline"
                        >
                            {INDEXER_URL.replace(/^https?:\/\//, "")}
                            <span aria-hidden="true"> ↗</span>
                        </a>
                    </span>
                </div>
                <nav className="flex items-center gap-4" aria-label="Footer links">
                    <a
                        href={EXTERNAL_LINKS.DOCS}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                        aria-label="Documentation (opens in new tab)"
                    >
                        Docs
                    </a>
                    <a
                        href={EXTERNAL_LINKS.GITHUB}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                        aria-label="GitHub repository (opens in new tab)"
                    >
                        GitHub
                    </a>
                    <button
                        type="button"
                        onClick={() => setTheme(isDark ? "dawn" : "midnight")}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2 text-muted-foreground hover:text-foreground"
                        aria-label={isDark ? "Switch to day theme" : "Switch to ink theme"}
                    >
                        {isDark ? (
                            <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                            <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>{isDark ? "Day" : "Ink"}</span>
                    </button>
                </nav>
            </div>
        </footer>
    );
}
