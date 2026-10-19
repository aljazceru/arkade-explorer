import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { Search, Eye, Activity } from "lucide-react";
import { useServerInfo } from "@/providers/server-info-provider";
import { SearchCommandPaletteOverlay } from "@/components/shared/search-bar";
export function TopNav() {
    const { serverInfo, isLoading: isServerInfoLoading } = useServerInfo();
    const [isMac, setIsMac] = useState(true);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

    useEffect(() => {
        setIsMac(navigator.platform?.toLowerCase().includes("mac") ?? true);
    }, []);

    // Cmd+K opens command palette on all screen sizes
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                setCommandPaletteOpen(true);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    return (
        <header
            className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm"
            role="banner"
        >
            <div className="max-w-[1480px] mx-auto flex items-center justify-between h-14 w-full px-4 sm:px-6 lg:px-8">
                <div className="flex items-center gap-3 shrink-0">
                    <Link
                        to="/"
                        className="inline-flex shrink-0 items-center gap-2"
                        aria-label="ark.observer home"
                    >
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="shrink-0 text-muted-foreground"
                            aria-hidden="true"
                        >
                            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1" />
                            <circle cx="8" cy="8" r="2.5" fill="currentColor" />
                        </svg>
                        <span className="font-semibold tracking-tight">ark.observer</span>
                    </Link>
                    {!isServerInfoLoading && serverInfo?.network && (
                        <span className="hidden sm:inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground whitespace-nowrap">
                            {serverInfo.network === "bitcoin"
                                ? "Mainnet"
                                : `${serverInfo.network.charAt(0).toUpperCase()}${serverInfo.network.slice(1)}`}
                        </span>
                    )}
                </div>

                {/* Mobile search icon */}
                <button
                    onClick={() => setCommandPaletteOpen(true)}
                    className="sm:hidden p-2 -mr-1 text-muted-foreground hover:text-foreground transition-colors duration-200"
                    aria-label="Open search"
                >
                    <Search className="h-5 w-5" aria-hidden="true" />
                </button>

                {/* Mobile command palette overlay */}
                <SearchCommandPaletteOverlay
                    open={commandPaletteOpen}
                    onOpenChange={setCommandPaletteOpen}
                />

                <button
                    onClick={() => setCommandPaletteOpen(true)}
                    className="hidden sm:flex items-center flex-1 max-w-xl mx-6 h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors duration-200 cursor-text"
                    aria-label="Open search (Cmd+K)"
                >
                    <Search className="h-4 w-4 shrink-0 mr-2" aria-hidden="true" />
                    <span className="flex-1 text-left">Search txid, address, or outpoint...</span>
                    <kbd className="ml-auto inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {isMac ? "\u2318" : "Ctrl+"}K
                    </kbd>
                </button>

                <div className="flex items-center gap-3 shrink-0">
                    <Link
                        to="/observe"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
                        aria-label="Observation"
                    >
                        <Activity className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden md:inline">Observe</span>
                    </Link>
                    <Link
                        to="/watchlist"
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
                        aria-label="Watchlist"
                    >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden md:inline">Watchlist</span>
                    </Link>
                </div>
            </div>
        </header>
    );
}
