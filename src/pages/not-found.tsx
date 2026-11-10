import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Glyph } from "@/components/atlas/glyph";
import { Search } from "lucide-react";

/**
 * Atlas 404: a small glyph composition (a commitment diamond that lost its
 * rail), a link home, and a search hint that reuses the palette's navigate.
 */
export function NotFoundPage() {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");

    const onSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const q = query.trim();
        if (!q) return;
        // Mirror the palette's detection order loosely: known prefixes route,
        // anything else falls through to /tx/ like the palette does.
        if (/^[0-9a-fA-F]{64}$/.test(q)) navigate(`/tx/${q}`);
        else if (/^[0-9a-fA-F]{64}:[0-9]+$/.test(q)) navigate(`/tx/${q.split(":")[0]}`);
        else if (q.startsWith("ark1") || q.startsWith("tark1")) navigate(`/address/${q}`);
        else if (/^[0-9a-fA-F]{68}$/.test(q)) navigate(`/asset/${q}`);
        else navigate(`/tx/${q}`);
    };

    return (
        <div className="flex min-h-[55vh] flex-col items-center justify-center px-4 py-16 text-center">
            {/* Glyph composition: a commitment diamond hovering over an empty rail */}
            <div
                className="relative mb-6 flex h-24 w-full max-w-xs items-end justify-center"
                aria-hidden="true"
            >
                <svg
                    className="absolute bottom-4 left-1/2 h-px w-56 -translate-x-1/2"
                    viewBox="0 0 224 1"
                    preserveAspectRatio="none"
                >
                    <line
                        x1="0"
                        y1="0.5"
                        x2="224"
                        y2="0.5"
                        stroke="currentColor"
                        className="text-line-strong"
                        strokeWidth="1"
                    />
                </svg>
                <div className="relative flex items-end gap-3">
                    <Glyph kind="block" size={14} className="mb-1 opacity-40" />
                    <Glyph kind="block" size={14} className="mb-1 opacity-40" />
                    <div className="translate-y-1">
                        <Glyph kind="commitment" size={30} />
                    </div>
                    <Glyph kind="block" size={14} className="mb-1 opacity-40" />
                    <Glyph kind="block" size={14} className="mb-1 opacity-40" />
                </div>
            </div>

            <p className="micro mb-2 text-faint">404 · not on this rail</p>
            <h1 className="text-lg font-semibold text-foreground">Nothing anchored here</h1>
            <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                The page you&apos;re looking for doesn&apos;t exist — the link may be old, or the
                record never landed on-chain.
            </p>

            <form
                onSubmit={onSearch}
                className="mt-5 flex w-full max-w-sm items-center gap-2"
                role="search"
                aria-label="Search instead"
            >
                <div className="relative flex-1">
                    <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
                        aria-hidden="true"
                    />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Try a txid, address, or asset id…"
                        className="h-9 w-full rounded-md border border-line-strong bg-card pl-8 pr-3 font-mono text-[12px] text-foreground placeholder:text-faint focus:border-virt focus:outline-none focus:ring-1 focus:ring-virt/50"
                        aria-label="Search transactions, addresses, and assets"
                    />
                </div>
                <button
                    type="submit"
                    className="h-9 shrink-0 rounded-md border border-line-strong bg-secondary px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent"
                >
                    Search
                </button>
            </form>

            <Link
                to="/"
                className="mt-5 inline-flex h-9 items-center rounded-md border border-line-strong bg-secondary px-4 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent"
            >
                Back to overview
            </Link>
        </div>
    );
}
