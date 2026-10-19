import { Activity, AlertTriangle } from "lucide-react";
import { useServerInfo } from "@/providers/server-info-provider";
import { useExitDelays } from "@/hooks/use-expiry";
import { ARK_URL } from "@/lib/api/indexer";
import { describeTimelock } from "@/lib/vtxo-display";
import { truncateHash } from "@/lib/utils";
import { CopyButton } from "@/components/shared/copy-button";

function sats(v: unknown): string {
    if (v === undefined || v === null || v === "") return "--";
    const n = BigInt(v as bigint);
    if (n < 0n) return "unlimited";
    return `${n.toLocaleString("en-US")} sats`;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {label}
            </span>
            <span className="text-sm text-foreground font-mono break-all">{children}</span>
        </div>
    );
}

/**
 * Network health panel: everything here comes straight from the operator's
 * `/v1/info` endpoint (no extra backend).
 */
export function NetworkHealthPanel() {
    const { serverInfo, isLoading, error } = useServerInfo();
    const { unilateralExitDelay, boardingExitDelay } = useExitDelays();

    const status = error
        ? "unreachable"
        : isLoading
          ? "checking"
          : serverInfo
            ? "online"
            : "unknown";
    const dot =
        status === "online"
            ? "bg-green-500"
            : status === "checking"
              ? "bg-yellow-500"
              : "bg-red-500";

    const fees = serverInfo?.fees;
    const intent = fees?.intentFee ?? {};
    const intentStr =
        Object.entries(intent)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ") || "none";

    const serviceStatus = serverInfo?.serviceStatus
        ? Object.entries(serverInfo.serviceStatus as Record<string, unknown>)
        : [];

    return (
        <section
            className="rounded-xl bg-card overflow-hidden border border-border"
            aria-labelledby="network-health-title"
            data-testid="network-health"
        >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span
                    id="network-health-title"
                    className="text-sm font-medium text-foreground inline-flex items-center gap-2"
                >
                    <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Network health
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`inline-flex rounded-full h-2 w-2 ${dot}`} />
                    {status} ·{" "}
                    <span className="font-mono">{ARK_URL.replace(/^https?:\/\//, "")}/v1/info</span>
                </span>
            </div>
            {error && (
                <div className="px-4 py-3 text-sm text-red-600 inline-flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Could not reach the operator:{" "}
                    {error.message}
                </div>
            )}
            {serverInfo && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
                    <Stat label="Service version">{serverInfo.version || "--"}</Stat>
                    <Stat label="Network">{serverInfo.network}</Stat>
                    <Stat label="Signer pubkey">
                        <span className="inline-flex items-center gap-1">
                            {truncateHash(serverInfo.signerPubkey, 8, 8)}
                            <CopyButton text={serverInfo.signerPubkey} />
                        </span>
                    </Stat>
                    <Stat label="Session duration">{String(serverInfo.sessionDuration)} s</Stat>
                    <Stat label="Unilateral exit delay">
                        {unilateralExitDelay ? describeTimelock(unilateralExitDelay) : "--"}
                    </Stat>
                    <Stat label="Boarding exit delay">
                        {boardingExitDelay ? describeTimelock(boardingExitDelay) : "--"}
                    </Stat>
                    <Stat label="VTXO min / max">
                        {sats(serverInfo.vtxoMinAmount)} / {sats(serverInfo.vtxoMaxAmount)}
                    </Stat>
                    <Stat label="Boarding UTXO min / max">
                        {sats(serverInfo.utxoMinAmount)} / {sats(serverInfo.utxoMaxAmount)}
                    </Stat>
                    <Stat label="Dust">{sats(serverInfo.dust)}</Stat>
                    <Stat label="Tx fee rate">{fees?.txFeeRate || "0"}</Stat>
                    <Stat label="Intent fees">{intentStr}</Stat>
                    <Stat label="Deprecated signers">
                        {serverInfo.deprecatedSigners?.length ?? 0}
                    </Stat>
                    {serviceStatus.length > 0 && (
                        <Stat label="Service status">
                            {serviceStatus.map(([k, v]) => `${k}: ${String(v)}`).join(", ")}
                        </Stat>
                    )}
                </div>
            )}
        </section>
    );
}
