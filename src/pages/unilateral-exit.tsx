import { ExitFlow } from "@arkade-os/exit-ui";
import { useEffect } from "react";
import { PageTransition } from "@/components/shared/page-transition";
import { Glyph } from "@/components/atlas/glyph";

/**
 * Self-contained, keyless unilateral-exit executor. Imports a pre-signed exit
 * package and drives it onchain with only an Esplora endpoint. Deliberately
 * NOT linked from the rest of the explorer — reachable directly at
 * /unilateral-exit.
 *
 * This page provides the route chrome, page heading, and Esplora override
 * from Vite's environment. Colours come from the `--color-exit-*` aliases
 * in `globals.css`, which follow the active theme.
 */
export function UnilateralExitPage() {
    useEffect(() => {
        document.title = "Unilateral Exit | ark.observer";
        return () => {
            document.title = "ark.observer";
        };
    }, []);

    return (
        <PageTransition>
            <div className="mx-auto w-full max-w-3xl space-y-5">
                <ExitFlow
                    // Read here rather than in the package, which must not
                    // assume a bundler — the standalone tool passes its own.
                    esploraOverride={import.meta.env.VITE_ESPLORA_URL}
                    header={
                        <div className="flex items-center gap-3">
                            <Glyph kind="leaf" size={22} className="text-chain" />
                            <div>
                                <h1 className="text-[15px] font-semibold text-foreground">
                                    Unilateral exit
                                </h1>
                                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                                    pre-signed package executor · Bitcoin fees and confirmation
                                    delays apply
                                </p>
                            </div>
                        </div>
                    }
                    footer={
                        <p className="border-t border-border pt-4 text-[11px] leading-relaxed text-faint">
                            The session is stored in this browser. Your chosen Esplora endpoint
                            receives transaction-status queries and transactions you choose to
                            broadcast. Use a trusted browser; imported packages can contain secrets.
                        </p>
                    }
                />
            </div>
        </PageTransition>
    );
}
