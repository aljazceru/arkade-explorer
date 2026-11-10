import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Error state: a coral marker, the message, and optional follow-up actions. */
export function ErrorMessage({
    message,
    title,
    children,
    className,
}: {
    message: string;
    title?: string;
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center gap-2 py-12 text-center",
                className,
            )}
            role="alert"
        >
            <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                aria-hidden="true"
                className="text-alert"
            >
                <path
                    d="M9 1.5 L16.5 9 L9 16.5 L1.5 9 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                />
                <path d="M9 5.5 V9.8 M9 12.2 V12.4" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            {title && <p className="text-sm font-semibold text-foreground">{title}</p>}
            <p className="max-w-md text-sm text-muted-foreground">{message}</p>
            {children}
        </div>
    );
}
