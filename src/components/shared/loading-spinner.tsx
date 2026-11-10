import { cn } from "@/lib/utils";

/** Quiet loading state: a small orbit plus an optional mono caption. */
export function LoadingSpinner({ label, className }: { label?: string; className?: string }) {
    return (
        <div
            className={cn("flex items-center justify-center gap-3 py-12", className)}
            role="status"
            aria-live="polite"
        >
            <span className="relative h-4 w-4" aria-hidden="true">
                <span className="absolute inset-0 rounded-full border border-line-strong" />
                <span className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-virt" />
            </span>
            <span className="micro text-faint">{label ?? "Loading"}</span>
        </div>
    );
}
