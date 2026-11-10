import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { Search, Clock, ArrowRight, X, Pin, PinOff, Pencil, Check } from "lucide-react";
import { useRecentSearches, type RecentSearch } from "@/hooks/use-recent-searches";
import { isValidTxid, isValidOutpoint, isValidAssetId } from "@/lib/validation";
import { truncateHash, cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Tag } from "@/components/atlas/tag";
import type { AtlasTone } from "@/lib/atlas/tones";

// ---------------------------------------------------------------------------
// Shared search logic
// ---------------------------------------------------------------------------

/** What a typed query looks like, used for the palette hint and recents type. */
type QueryKind = "transaction" | "outpoint" | "address" | "asset" | "unrecognised";

function classifyQuery(q: string): QueryKind {
    if (isValidTxid(q)) return "transaction";
    if (isValidOutpoint(q)) return "outpoint";
    if (q.startsWith("tark1") || q.startsWith("ark1")) return "address";
    if (isValidAssetId(q)) return "asset";
    return "unrecognised";
}

const KIND_META: Record<QueryKind, { label: string; tone: AtlasTone; note: string }> = {
    transaction: { label: "Transaction", tone: "chain", note: "txid · opens /tx/" },
    outpoint: { label: "Outpoint", tone: "chain", note: "txid:vout · opens its tx" },
    address: { label: "Address", tone: "virt", note: "ark1… · opens /address/" },
    asset: { label: "Asset", tone: "cp", note: "68-hex id · opens /asset/" },
    unrecognised: {
        label: "Unrecognised",
        tone: "warning",
        note: "not a txid, outpoint, ark1 address or asset id — opens /tx/",
    },
};

function useSearch() {
    const routerNavigate = useNavigate();
    const { addRecentSearch } = useRecentSearches();

    const navigate = useCallback(
        (query: string) => {
            const q = query.trim();
            if (!q) return;

            const kind = classifyQuery(q);
            switch (kind) {
                case "transaction":
                    addRecentSearch(q, "transaction");
                    routerNavigate(`/tx/${q}`);
                    break;
                case "outpoint":
                    addRecentSearch(q, "transaction");
                    routerNavigate(`/tx/${q.split(":")[0]}`);
                    break;
                case "address":
                    addRecentSearch(q, "address");
                    routerNavigate(`/address/${q}`);
                    break;
                case "asset":
                    addRecentSearch(q, "asset");
                    routerNavigate(`/asset/${q}`);
                    break;
                default:
                    addRecentSearch(q, "transaction");
                    routerNavigate(`/tx/${q}`);
            }
        },
        [routerNavigate, addRecentSearch],
    );

    return { navigate };
}

// ---------------------------------------------------------------------------
// Header variant (compact search in top nav / hero)
// ---------------------------------------------------------------------------

function SearchHeader({ className, placeholder }: { className?: string; placeholder?: string }) {
    const { navigate } = useSearch();
    const [query, setQuery] = useState("");

    const handleSubmit = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            navigate(query);
            setQuery("");
        },
        [query, navigate],
    );

    return (
        <form
            onSubmit={handleSubmit}
            className={cn("relative max-w-md", className)}
            role="search"
            aria-label="Search transactions, addresses, and outpoints"
        >
            <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint"
                aria-hidden="true"
            />
            <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder ?? "Search txid, address, asset, or outpoint..."}
                aria-label="Search by transaction ID, address, or outpoint"
                className="h-9 w-full rounded-md border border-line-strong bg-card pl-9 pr-3 text-[13px] text-foreground placeholder:text-faint focus:border-virt focus:outline-none focus:ring-1 focus:ring-virt/50"
            />
        </form>
    );
}

// ---------------------------------------------------------------------------
// Command-palette overlay (Cmd/Ctrl+K, opened from the top bar)
// ---------------------------------------------------------------------------

const SEARCH_TYPE_META: Record<RecentSearch["type"], { label: string; tone: AtlasTone }> = {
    transaction: { label: "Transaction", tone: "chain" },
    "commitment-tx": { label: "Commitment", tone: "chain" },
    address: { label: "Address", tone: "virt" },
    asset: { label: "Asset", tone: "cp" },
};

export function SearchCommandPaletteOverlay({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [showPinned, setShowPinned] = useState(false);
    const [editingLabel, setEditingLabel] = useState<string | null>(null);
    const [labelInput, setLabelInput] = useState("");
    const { navigate } = useSearch();
    const [query, setQuery] = useState("");
    const {
        recentSearches,
        pinnedSearches,
        clearRecentSearches,
        clearPinnedSearches,
        pinSearch,
        unpinSearch,
        updatePinLabel,
        isPinned,
    } = useRecentSearches();

    // Escape closes the palette even when focus sits outside the input.
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onOpenChange(false);
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, onOpenChange]);

    const handleSelect = useCallback(
        (value: string) => {
            navigate(value);
            onOpenChange(false);
            setQuery("");
        },
        [navigate, onOpenChange],
    );

    const handleSubmit = useCallback(() => {
        if (query.trim()) {
            navigate(query.trim());
            onOpenChange(false);
            setQuery("");
        }
    }, [query, navigate, onOpenChange]);

    const trimmed = query.trim();
    const hint = trimmed ? classifyQuery(trimmed) : null;

    const hasRecent = recentSearches.length > 0;
    const hasPinned = pinnedSearches.length > 0;
    const hasBothTabs = hasRecent && hasPinned;
    const activeList = (showPinned && hasPinned) || !hasRecent ? pinnedSearches : recentSearches;

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-4 backdrop-blur-[2px]"
                    style={{ paddingTop: "18vh" }}
                    onClick={() => onOpenChange(false)}
                    role="presentation"
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: -6 }}
                        transition={{ duration: 0.18, ease: [0.165, 0.84, 0.44, 1] }}
                        className="w-full max-w-lg"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Search"
                    >
                        <Command
                            className="overflow-hidden rounded-lg border border-line-strong bg-popover"
                            shouldFilter={false}
                            label="Search"
                        >
                            {/* Input */}
                            <div className="flex items-center gap-2 border-b border-border px-3">
                                <Search
                                    className="h-3.5 w-3.5 shrink-0 text-faint"
                                    aria-hidden="true"
                                />
                                <Command.Input
                                    autoFocus
                                    value={query}
                                    onValueChange={setQuery}
                                    placeholder="txid · txid:vout · ark1… address · asset id"
                                    className="h-11 flex-1 bg-transparent font-mono text-[12.5px] text-foreground placeholder:font-sans placeholder:text-faint focus:outline-none"
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleSubmit();
                                        }
                                    }}
                                />
                                {trimmed && (
                                    <Tag
                                        tone={KIND_META[hint!].tone}
                                        className="hidden sm:inline-flex"
                                    >
                                        {KIND_META[hint!].label}
                                    </Tag>
                                )}
                                <button
                                    onClick={() => onOpenChange(false)}
                                    aria-label="Close search"
                                    className="shrink-0 rounded p-1 text-faint transition-colors hover:text-foreground"
                                >
                                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            </div>

                            {/* Results */}
                            <Command.List className="max-h-80 overflow-y-auto p-1.5">
                                <Command.Empty className="px-3 py-6 text-center text-xs text-muted-foreground">
                                    {trimmed ? KIND_META[hint!].note : "Recent and pinned searches"}
                                </Command.Empty>

                                {/* Direct search action */}
                                {trimmed && (
                                    <Command.Group>
                                        <Command.Item
                                            value={`search:${trimmed}`}
                                            onSelect={() => handleSelect(trimmed)}
                                            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-foreground transition-colors data-[selected=true]:bg-secondary"
                                        >
                                            <ArrowRight
                                                className="h-3.5 w-3.5 shrink-0 text-faint"
                                                aria-hidden="true"
                                            />
                                            <span className="min-w-0 truncate">
                                                Search for{" "}
                                                <span className="font-mono">
                                                    {truncateHash(trimmed, 16, 8)}
                                                </span>
                                            </span>
                                            <span className="micro ml-auto shrink-0 text-faint">
                                                Enter ↵
                                            </span>
                                        </Command.Item>
                                    </Command.Group>
                                )}

                                {/* Recent / Pinned searches */}
                                {(hasRecent || hasPinned) && !trimmed && (
                                    <Command.Group
                                        heading={
                                            <div className="flex items-center justify-between px-2 py-1.5">
                                                {hasBothTabs ? (
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowPinned(false)}
                                                            className={cn(
                                                                "micro rounded px-2 py-1 transition-colors",
                                                                !showPinned
                                                                    ? "bg-secondary text-foreground"
                                                                    : "text-faint hover:text-foreground",
                                                            )}
                                                        >
                                                            Recent ({recentSearches.length})
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowPinned(true)}
                                                            className={cn(
                                                                "micro rounded px-2 py-1 transition-colors",
                                                                showPinned
                                                                    ? "bg-secondary text-foreground"
                                                                    : "text-faint hover:text-foreground",
                                                            )}
                                                        >
                                                            Pinned ({pinnedSearches.length})
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="micro text-faint">
                                                        {hasPinned
                                                            ? "Pinned searches"
                                                            : "Recent searches"}
                                                    </span>
                                                )}

                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (
                                                            showPinned ||
                                                            (hasPinned && !hasRecent)
                                                        ) {
                                                            clearPinnedSearches();
                                                        } else {
                                                            clearRecentSearches();
                                                        }
                                                    }}
                                                    className="micro text-faint transition-colors hover:text-foreground"
                                                >
                                                    Clear{" "}
                                                    {hasBothTabs
                                                        ? showPinned
                                                            ? "pinned"
                                                            : "recent"
                                                        : "all"}
                                                </button>
                                            </div>
                                        }
                                    >
                                        {activeList.slice(0, 10).map((search) => {
                                            const pinned = isPinned(search.value);
                                            const isEditing = editingLabel === search.value;
                                            const typeMeta = SEARCH_TYPE_META[search.type] ?? {
                                                label: search.type,
                                                tone: "neutral" as AtlasTone,
                                            };

                                            return (
                                                <Command.Item
                                                    key={search.value}
                                                    value={search.value}
                                                    onSelect={() => {
                                                        if (!isEditing) handleSelect(search.value);
                                                    }}
                                                    className="flex cursor-pointer flex-col gap-1 rounded-md px-2.5 py-2 text-[13px] transition-colors data-[selected=true]:bg-secondary"
                                                >
                                                    {pinned && isEditing && (
                                                        <div
                                                            className="flex items-center gap-2"
                                                            onClick={(e) => e.stopPropagation()}
                                                            onKeyDown={(e) => e.stopPropagation()}
                                                        >
                                                            <input
                                                                type="text"
                                                                value={labelInput}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === "Enter") {
                                                                        e.preventDefault();
                                                                        updatePinLabel(
                                                                            search.value,
                                                                            labelInput,
                                                                        );
                                                                        setEditingLabel(null);
                                                                    } else if (e.key === "Escape") {
                                                                        e.preventDefault();
                                                                        setEditingLabel(null);
                                                                    }
                                                                }}
                                                                placeholder="Add label…"
                                                                className="h-7 flex-1 rounded border border-line-strong bg-secondary px-2 font-mono text-[11px] text-foreground placeholder:text-faint focus:border-virt focus:outline-none"
                                                                autoFocus
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    updatePinLabel(
                                                                        search.value,
                                                                        labelInput,
                                                                    );
                                                                    setEditingLabel(null);
                                                                }}
                                                                className="rounded p-0.5 text-virt transition-colors hover:text-foreground"
                                                                title="Save label"
                                                                aria-label="Save label"
                                                            >
                                                                <Check className="h-3.5 w-3.5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setEditingLabel(null)
                                                                }
                                                                className="rounded p-0.5 text-faint transition-colors hover:text-foreground"
                                                                title="Cancel"
                                                                aria-label="Cancel"
                                                            >
                                                                <X className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    )}

                                                    {pinned && search.label && !isEditing && (
                                                        <span className="text-xs font-medium text-virt">
                                                            {search.label}
                                                        </span>
                                                    )}

                                                    <div className="flex w-full items-center gap-2.5">
                                                        {pinned ? (
                                                            <Pin
                                                                className="h-3 w-3 shrink-0 text-virt"
                                                                aria-hidden="true"
                                                            />
                                                        ) : (
                                                            <Clock
                                                                className="h-3 w-3 shrink-0 text-faint"
                                                                aria-hidden="true"
                                                            />
                                                        )}
                                                        <span className="min-w-0 truncate font-mono text-[11.5px] text-foreground">
                                                            {truncateHash(search.value, 12, 8)}
                                                        </span>
                                                        <Tag
                                                            tone={typeMeta.tone}
                                                            className="shrink-0"
                                                        >
                                                            {typeMeta.label}
                                                        </Tag>

                                                        <div
                                                            className="ml-auto flex shrink-0 items-center gap-0.5"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            {pinned && !isEditing && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setEditingLabel(
                                                                            search.value,
                                                                        );
                                                                        setLabelInput(
                                                                            search.label || "",
                                                                        );
                                                                    }}
                                                                    className="rounded p-1 text-faint transition-colors hover:text-foreground"
                                                                    title="Edit label"
                                                                    aria-label="Edit label"
                                                                >
                                                                    <Pencil className="h-3 w-3" />
                                                                </button>
                                                            )}

                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (pinned) {
                                                                        unpinSearch(search.value);
                                                                    } else {
                                                                        pinSearch(
                                                                            search.value,
                                                                            search.type,
                                                                        );
                                                                    }
                                                                }}
                                                                className={cn(
                                                                    "rounded p-1 transition-colors",
                                                                    pinned
                                                                        ? "text-virt hover:text-alert"
                                                                        : "text-faint hover:text-virt",
                                                                )}
                                                                title={pinned ? "Unpin" : "Pin"}
                                                                aria-label={
                                                                    pinned ? "Unpin" : "Pin"
                                                                }
                                                            >
                                                                {pinned ? (
                                                                    <PinOff className="h-3 w-3" />
                                                                ) : (
                                                                    <Pin className="h-3 w-3" />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </Command.Item>
                                            );
                                        })}
                                    </Command.Group>
                                )}
                            </Command.List>

                            {/* Footer hint */}
                            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-faint">
                                <div className="flex items-center gap-3">
                                    <span className="flex items-center gap-1">
                                        <kbd className="rounded border border-line-strong bg-secondary px-1 py-px font-mono text-[9.5px]">
                                            Enter
                                        </kbd>
                                        <span>search</span>
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <kbd className="rounded border border-line-strong bg-secondary px-1 py-px font-mono text-[9.5px]">
                                            Esc
                                        </kbd>
                                        <span>close</span>
                                    </span>
                                </div>
                                {hint && (
                                    <span className="font-mono text-[10px] text-faint">
                                        {KIND_META[hint].label.toLowerCase()}
                                    </span>
                                )}
                            </div>
                        </Command>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// ---------------------------------------------------------------------------
// Main component (header variant only — hero/sidebar/command-palette removed)
// ---------------------------------------------------------------------------

export function SearchBar({
    variant: _variant,
    className,
    placeholder,
}: {
    /** Only "header" exists in Atlas; accepted for API compatibility. */
    variant?: "header";
    className?: string;
    placeholder?: string;
}) {
    return <SearchHeader className={className} placeholder={placeholder} />;
}
