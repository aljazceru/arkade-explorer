import { useState, type FormEvent, type JSX } from "react";
import { checkBarkdConnection, normalizeBarkdBaseUrl } from "@/lib/barkd";
import { useBarkd } from "@/hooks/use-barkd";

export function BarkdConnect(): JSX.Element {
    const { connection, connected, connect, disconnect, vtxos, tipHeight, isLoading, error } =
        useBarkd();
    const [baseUrl, setBaseUrl] = useState("");
    const [token, setToken] = useState("");
    const [isChecking, setIsChecking] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [verifiedTipHeight, setVerifiedTipHeight] = useState<number | null>(null);

    async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setIsChecking(true);
        setFormError(null);
        const nextConnection = {
            baseUrl: normalizeBarkdBaseUrl(baseUrl),
            token,
        };
        const result = await checkBarkdConnection(nextConnection);
        setIsChecking(false);
        if (!result.ok) {
            setFormError(result.error);
            return;
        }

        setVerifiedTipHeight(result.tipHeight);
        setToken("");
        connect(nextConnection);
    }

    const displayedTipHeight = tipHeight ?? verifiedTipHeight;

    return (
        <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-base font-semibold text-foreground">Second: connect your barkd</h2>
            {connected ? (
                <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
                        <span className="text-foreground">
                            Connected
                            {displayedTipHeight !== null
                                ? ` · tip height ${displayedTipHeight}`
                                : ""}
                        </span>
                        <span className="text-muted-foreground">{connection?.baseUrl}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">
                            VTXOs: {vtxos ? vtxos.length : isLoading ? "Loading…" : "—"}
                        </p>
                        <button
                            type="button"
                            onClick={disconnect}
                            className="min-h-9 rounded-md border border-border bg-secondary px-3 text-sm
                                font-medium text-foreground hover:bg-secondary/80 focus-visible:outline-none
                                focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
                                focus-visible:ring-offset-card"
                        >
                            Disconnect
                        </button>
                    </div>
                    {error && (
                        <p className="text-sm text-destructive" role="alert">
                            {error.message}
                        </p>
                    )}
                </div>
            ) : (
                <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
                    <div className="space-y-1.5">
                        <label
                            htmlFor="barkd-base-url"
                            className="text-sm font-medium text-foreground"
                        >
                            Base URL
                        </label>
                        <input
                            id="barkd-base-url"
                            type="text"
                            autoComplete="url"
                            placeholder="http://127.0.0.1:7474"
                            value={baseUrl}
                            onChange={(event) => setBaseUrl(event.target.value)}
                            className="min-h-9 w-full rounded-md border border-border bg-secondary px-3
                                text-sm text-foreground placeholder:text-muted-foreground
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                                focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label
                            htmlFor="barkd-auth-token"
                            className="text-sm font-medium text-foreground"
                        >
                            Auth token
                        </label>
                        <input
                            id="barkd-auth-token"
                            type="password"
                            autoComplete="new-password"
                            value={token}
                            onChange={(event) => setToken(event.target.value)}
                            className="min-h-9 w-full rounded-md border border-border bg-secondary px-3
                                text-sm text-foreground placeholder:text-muted-foreground
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                                focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isChecking || baseUrl.trim().length === 0 || token.length === 0}
                        className="min-h-9 rounded-md border border-border bg-secondary px-3 text-sm
                            font-medium text-foreground hover:bg-secondary/80 focus-visible:outline-none
                            focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
                            focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isChecking ? "Connecting…" : "Connect"}
                    </button>
                    {formError && (
                        <p className="text-sm text-destructive" role="alert">
                            {formError}
                        </p>
                    )}
                </form>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
                Runs on your machine. Read-only endpoints. URL and token stay in this browser&apos;s
                localStorage.
            </p>
        </section>
    );
}
