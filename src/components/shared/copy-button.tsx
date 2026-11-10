import { useEffect, useRef, useState } from "react";
import { Copy, Check, X } from "lucide-react";
import { copyToClipboard, cn } from "@/lib/utils";

interface CopyButtonProps {
    text: string;
    className?: string;
    /** Accessible name of the copied value, e.g. "transaction id". */
    label?: string;
}

type CopyState = "idle" | "copied" | "failed";

export function CopyButton({ text, className, label = "value" }: CopyButtonProps) {
    const [state, setState] = useState<CopyState>("idle");
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => () => clearTimeout(timer.current), []);

    const handleCopy = () => {
        copyToClipboard(text).then(
            () => setState("copied"),
            () => setState("failed"),
        );
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState("idle"), 2000);
    };

    const name =
        state === "copied"
            ? `Copied ${label}`
            : state === "failed"
              ? `Could not copy ${label}`
              : `Copy ${label}`;

    return (
        <button
            type="button"
            onClick={handleCopy}
            className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-secondary hover:text-foreground",
                className,
            )}
            title={name}
            aria-label={name}
        >
            {state === "copied" ? (
                <Check size={13} className="text-ok" aria-hidden="true" />
            ) : state === "failed" ? (
                <X size={13} className="text-alert" aria-hidden="true" />
            ) : (
                <Copy size={13} aria-hidden="true" />
            )}
        </button>
    );
}
