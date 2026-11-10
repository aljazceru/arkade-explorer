import { useState, type FormEvent, type JSX } from "react";
import { checkBarkdConnection, validateBarkdBaseUrl } from "@/lib/barkd";
import { useBarkd } from "@/hooks/use-barkd";
import { Panel } from "@/components/atlas/panel";
import { Tag } from "@/components/atlas/tag";
import { Term } from "@/components/atlas/term";

/**
 * Connect a local barkd (Second wallet daemon) to the watchlist page. Same
 * behaviour and storage as before: read-only endpoints, credentials in
 * localStorage under `arkade-explorer-barkd-connection`.
 */
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
        const validated = validateBarkdBaseUrl(baseUrl);
        if (!validated.ok) {
            setIsChecking(false);
            setFormError(validated.error);
            return;
        }
        const nextConnection = {
            baseUrl: validated.url,
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

    const inputClass =
        "h-9 w-full rounded-md border border-line-strong bg-secondary px-2.5 font-mono text-[12px] " +
        "text-foreground placeholder:text-faint focus:border-virt focus:outline-none " +
        "focus:ring-1 focus:ring-virt/50";
    const buttonClass =
        "inline-flex h-9 items-center justify-center rounded-md border border-line-strong bg-secondary " +
        "px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent " +
        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
        "disabled:cursor-not-allowed disabled:opacity-50";

    return (
        <Panel
            title="Second wallet (barkd)"
            subtitle={
                <>
                    Optional local daemon · <Term k="serverAddress">no public index</Term>
                </>
            }
        >
            <div className="space-y-4 p-4">
                {connected ? (
                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2 text-[13px]">
                            <Tag tone="ok">Connected</Tag>
                            {displayedTipHeight !== null && (
                                <span className="font-mono text-[11.5px] text-muted-foreground">
                                    tip height {displayedTipHeight.toLocaleString("en-US")}
                                </span>
                            )}
                            <span className="font-mono text-[11px] text-faint">
                                {connection?.baseUrl}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-[13px] text-muted-foreground">
                                VTXOs:{" "}
                                <span className="font-mono text-foreground">
                                    {vtxos
                                        ? vtxos.length.toLocaleString("en-US")
                                        : isLoading
                                          ? "…"
                                          : "—"}
                                </span>
                            </p>
                            <button type="button" onClick={disconnect} className={buttonClass}>
                                Disconnect
                            </button>
                        </div>
                        {error && (
                            <p className="text-[12.5px] text-alert" role="alert">
                                {error.message}
                            </p>
                        )}
                    </div>
                ) : (
                    <form className="space-y-3" onSubmit={handleSubmit}>
                        <div className="space-y-1.5">
                            <label htmlFor="barkd-base-url" className="micro block text-faint">
                                Base URL
                            </label>
                            <input
                                id="barkd-base-url"
                                type="text"
                                autoComplete="url"
                                placeholder="http://127.0.0.1:7474"
                                value={baseUrl}
                                onChange={(event) => setBaseUrl(event.target.value)}
                                className={inputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label htmlFor="barkd-auth-token" className="micro block text-faint">
                                Auth token
                            </label>
                            <input
                                id="barkd-auth-token"
                                type="password"
                                autoComplete="new-password"
                                value={token}
                                onChange={(event) => setToken(event.target.value)}
                                className={inputClass}
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                type="submit"
                                disabled={
                                    isChecking || baseUrl.trim().length === 0 || token.length === 0
                                }
                                className={buttonClass}
                            >
                                {isChecking ? "Connecting…" : "Connect"}
                            </button>
                        </div>
                        {formError && (
                            <p className="text-[12.5px] text-alert" role="alert">
                                {formError}
                            </p>
                        )}
                    </form>
                )}
                <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
                    Runs on your machine. Read-only endpoints. URL and token stay in this browser's
                    localStorage. Plaintext http:// is only allowed for loopback addresses — remote
                    barkd endpoints require https:// so the token is not sent unencrypted.
                </p>
            </div>
        </Panel>
    );
}
