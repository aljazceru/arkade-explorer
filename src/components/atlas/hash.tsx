import { Link } from "react-router-dom";
import { CopyButton } from "@/components/shared/copy-button";
import { cn } from "@/lib/utils";

/** `84ee4014…6e170e3b04`: keeps both ends readable, the full value lives in `title`. */
export function middleTruncate(value: string, head = 8, tail = 8): string {
    if (value.length <= head + tail + 1) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * A txid, outpoint, address or script: mono, middle-truncated, optionally
 * linked (internal route or external explorer) and copyable.
 */
export function Hash({
    value,
    to,
    href,
    head = 8,
    tail = 8,
    copy = true,
    label = "id",
    full = false,
    className,
}: {
    value: string;
    /** Internal route. */
    to?: string;
    /** External URL, opened in a new tab and marked ↗. */
    href?: string;
    head?: number;
    tail?: number;
    copy?: boolean;
    /** What the value is, for the copy button's accessible name. */
    label?: string;
    /** Show the whole value, wrapped. */
    full?: boolean;
    className?: string;
}) {
    const text = full ? value : middleTruncate(value, head, tail);
    const textClass = cn("font-mono text-[12px]", full && "break-all");
    const linkClass = "text-virt underline-offset-2 hover:underline";
    return (
        <span className={cn("inline-flex min-w-0 items-center gap-0.5", className)}>
            {to ? (
                <Link to={to} title={value} className={cn(textClass, linkClass)}>
                    {text}
                </Link>
            ) : href ? (
                <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    title={`${value} (opens in a new tab)`}
                    className={cn(textClass, linkClass)}
                >
                    {text}
                    <span aria-hidden="true"> ↗</span>
                </a>
            ) : (
                <span title={value} className={cn(textClass, "text-foreground")}>
                    {text}
                </span>
            )}
            {copy && <CopyButton text={value} label={label} />}
        </span>
    );
}
