import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
    value: T;
    label: ReactNode;
    /** Shown after the label in mono; omit when unknown. */
    count?: number;
    /** Optional data-testid for e2e hooks. */
    testId?: string;
    disabled?: boolean;
}

/** Filter / window toggle group. Each option is a pressed-state button. */
export function Segmented<T extends string>({
    value,
    onChange,
    options,
    ariaLabel,
    className,
}: {
    value: T;
    onChange: (value: T) => void;
    options: ReadonlyArray<SegmentOption<T>>;
    ariaLabel: string;
    className?: string;
}) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className={cn(
                "inline-flex shrink-0 overflow-hidden rounded-md border border-line-strong",
                className,
            )}
        >
            {options.map((option) => {
                const on = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={on}
                        disabled={option.disabled}
                        onClick={() => onChange(option.value)}
                        data-testid={option.testId}
                        className={cn(
                            "inline-flex items-center gap-1.5 whitespace-nowrap border-l border-line-strong px-2.5 py-1 text-xs first:border-l-0 disabled:opacity-40",
                            on
                                ? "bg-secondary text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {option.label}
                        {option.count !== undefined && (
                            <span className="font-mono text-[10.5px] text-faint">
                                {option.count.toLocaleString("en-US")}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
