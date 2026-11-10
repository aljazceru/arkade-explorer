import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Opaque Atlas panel: 1px line, 8px radius, no shadow, no blur. `canvas`
 * panels use the deeper canvas surface and are meant for SVG maps.
 */
export function Panel({
    title,
    subtitle,
    actions,
    children,
    className,
    bodyClassName,
    variant = "panel",
    id,
    "aria-label": ariaLabel,
}: {
    title?: ReactNode;
    subtitle?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
    bodyClassName?: string;
    variant?: "panel" | "canvas";
    id?: string;
    "aria-label"?: string;
}) {
    const hasHeader = title !== undefined || subtitle !== undefined || actions !== undefined;
    return (
        <section
            id={id}
            aria-label={ariaLabel}
            className={cn(
                "min-w-0 overflow-hidden rounded-lg border border-border",
                variant === "canvas" ? "bg-canvas" : "bg-card",
                className,
            )}
        >
            {hasHeader && (
                <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-5 py-3">
                    {title !== undefined && (
                        <h2 className="text-base font-semibold text-foreground">{title}</h2>
                    )}
                    {subtitle !== undefined && (
                        <p className="text-[13px] leading-relaxed text-muted-foreground">
                            {subtitle}
                        </p>
                    )}
                    {actions !== undefined && (
                        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
                    )}
                </header>
            )}
            <div className={cn("min-w-0", bodyClassName)}>{children}</div>
        </section>
    );
}

/** Supporting uppercase label for fact lists and table heads. */
export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={cn("micro text-faint", className)}>{children}</span>;
}
