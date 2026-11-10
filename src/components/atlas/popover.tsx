import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Click-to-open popover anchored to its trigger. Closes on outside pointer
 * down and on Escape (focus returns to the trigger). Used for glossary terms
 * and the legend; keep content short.
 */
export function Popover({
    trigger,
    triggerClassName,
    triggerLabel,
    children,
    side = "bottom",
    align = "center",
    panelClassName,
}: {
    trigger: ReactNode;
    triggerClassName?: string;
    /** Accessible name of the trigger when its content is not text. */
    triggerLabel?: string;
    children: ReactNode;
    side?: "top" | "bottom";
    align?: "start" | "center" | "end";
    panelClassName?: string;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLSpanElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const id = useId();

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
                buttonRef.current?.focus();
            }
        };
        document.addEventListener("pointerdown", onPointer);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onPointer);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <span ref={rootRef} className="relative inline-flex">
            <button
                ref={buttonRef}
                type="button"
                aria-expanded={open}
                aria-controls={id}
                aria-label={triggerLabel}
                onClick={() => setOpen((value) => !value)}
                className={triggerClassName}
            >
                {trigger}
            </button>
            {open && (
                <span
                    id={id}
                    role="dialog"
                    className={cn(
                        "absolute z-50 w-64 rounded-lg border border-line-strong bg-popover p-3 text-left text-xs leading-relaxed text-muted-foreground shadow-[0_12px_32px_rgb(0_0_0/0.45)]",
                        side === "top" ? "bottom-full mb-2" : "top-full mt-2",
                        align === "center" && "left-1/2 -translate-x-1/2",
                        align === "start" && "left-0",
                        align === "end" && "right-0",
                        panelClassName,
                    )}
                >
                    {children}
                </span>
            )}
        </span>
    );
}
