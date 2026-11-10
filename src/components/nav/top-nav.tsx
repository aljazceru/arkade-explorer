import { Link, NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import { Search, Eye, Activity } from "lucide-react";
import { useServerInfo } from "@/providers/server-info-provider";
import { useMoneyDisplay } from "@/providers/money-display-provider";
import { useWatchlist } from "@/hooks/use-watchlist";
import { SearchCommandPaletteOverlay } from "@/components/shared/search-bar";
import { LegendButton } from "@/components/atlas/legend";
import { Segmented } from "@/components/atlas/segmented";
import { cn } from "@/lib/utils";

/** Diamond (a commitment) resting on a horizon (the Bitcoin rail). */
function AtlasMark() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
            <line x1="2" y1="14.5" x2="16" y2="14.5" className="stroke-virt" strokeWidth="1.4" />
            <line x1="9" y1="11.5" x2="9" y2="14.5" className="stroke-chain" strokeWidth="1.4" />
            <path
                d="M9 3 L13.2 7.2 L9 11.4 L4.8 7.2 Z"
                className="fill-background stroke-chain"
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

const navLink = ({ isActive }: { isActive: boolean }) =>
    cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
        isActive
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
    );

export function TopNav() {
    const { serverInfo, isLoading: isServerInfoLoading } = useServerInfo();
    const { unit, setUnit } = useMoneyDisplay();
    const { items: watched } = useWatchlist();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform ?? "");

    // Cmd/Ctrl+K anywhere, or "/" when not typing, opens search.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setPaletteOpen(true);
            } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)) {
                e.preventDefault();
                setPaletteOpen(true);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    const network = serverInfo?.network;
    const networkLabel =
        network === "bitcoin"
            ? "Mainnet"
            : network
              ? `${network.charAt(0).toUpperCase()}${network.slice(1)}`
              : null;

    return (
        <header
            className="sticky top-0 z-40 border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur-sm"
            role="banner"
        >
            <div className="mx-auto flex h-[52px] w-full max-w-[1560px] items-center gap-3 px-4 sm:px-5">
                <Link
                    to="/"
                    className="inline-flex shrink-0 items-center gap-2"
                    aria-label="ark.observer home"
                >
                    <AtlasMark />
                    <span className="text-[15px] font-semibold tracking-tight">ark.observer</span>
                </Link>
                {!isServerInfoLoading && networkLabel && (
                    <span className="micro hidden rounded border border-line-strong px-1.5 py-[3px] text-faint sm:inline-flex">
                        {networkLabel}
                    </span>
                )}

                <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    className="mx-auto hidden h-[34px] w-full max-w-[520px] items-center gap-2 rounded-md border border-line-strong bg-card px-2.5 text-left text-[13px] text-faint transition-colors hover:border-virt/60 hover:text-muted-foreground md:flex"
                    aria-label="Open search"
                    aria-keyshortcuts={isMac ? "Meta+K /" : "Control+K /"}
                >
                    <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="flex-1 truncate">
                        txid · txid:vout · ark1… address · asset
                    </span>
                    <kbd className="rounded border border-line-strong px-1 font-mono text-[10px] text-faint">
                        /
                    </kbd>
                </button>

                <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0">
                    <button
                        type="button"
                        onClick={() => setPaletteOpen(true)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
                        aria-label="Open search"
                    >
                        <Search className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <Segmented
                        ariaLabel="Amount unit"
                        value={unit}
                        onChange={setUnit}
                        options={[
                            { value: "sats", label: "sats" },
                            { value: "btc", label: "BTC" },
                        ]}
                        className="hidden lg:inline-flex"
                    />
                    <span className="hidden lg:inline-flex">
                        <LegendButton />
                    </span>
                    <NavLink to="/observe" className={navLink} aria-label="Observe">
                        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="hidden sm:inline">Observe</span>
                    </NavLink>
                    <NavLink
                        to="/watchlist"
                        className={navLink}
                        aria-label={`Watchlist, ${watched.length} watched`}
                    >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="hidden sm:inline">Watchlist</span>
                        <span className="font-mono text-[10.5px] text-faint">{watched.length}</span>
                    </NavLink>
                </div>

                <SearchCommandPaletteOverlay open={paletteOpen} onOpenChange={setPaletteOpen} />
            </div>
        </header>
    );
}
