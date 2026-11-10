export type BarkdVtxoState =
    | { type: "spendable" }
    | { type: "spent" }
    | { type: "exited" }
    | { type: "locked"; actionId?: string; movementId?: number };

export type BarkdVtxo = {
    id: string;
    amountSat: number;
    policyType: string;
    expiryHeight: number;
    exitDelta: number;
    exitDepth: number | null;
    chainAnchor: string;
    state: BarkdVtxoState;
};

export type BarkdConnection = { baseUrl: string; token: string };

export const BARKD_STORAGE_KEY = "arkade-explorer-barkd-connection";

const REQUEST_TIMEOUT_MS = 10_000;

export function loadBarkdConnection(): BarkdConnection | null {
    try {
        const raw = localStorage.getItem(BARKD_STORAGE_KEY);
        if (!raw) return null;

        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
        const value = parsed as Record<string, unknown>;
        if (
            typeof value.baseUrl !== "string" ||
            value.baseUrl.trim().length === 0 ||
            typeof value.token !== "string"
        ) {
            return null;
        }

        const validated = validateBarkdBaseUrl(value.baseUrl);
        if (!validated.ok) return null;
        return { baseUrl: validated.url, token: value.token };
    } catch {
        return null;
    }
}

export function saveBarkdConnection(connection: BarkdConnection | null): void {
    try {
        if (connection === null) {
            localStorage.removeItem(BARKD_STORAGE_KEY);
        } else {
            localStorage.setItem(BARKD_STORAGE_KEY, JSON.stringify(connection));
        }
    } catch {
        // Storage may be unavailable or full.
    }
}

export function normalizeBarkdBaseUrl(input: string): string {
    const trimmed = input.trim();
    if (trimmed.length === 0) return "";
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, "");
}

const LOOPBACK_HOSTS: Record<string, true> = {
    localhost: true,
    "127.0.0.1": true,
    "::1": true,
    "[::1]": true,
};

/**
 * The barkd bearer token is sent as an Authorization header on every request.
 * Plaintext HTTP is only acceptable to loopback daemons; anything else must
 * use HTTPS so the token is not exposed on the wire. Non-http(s) schemes are
 * rejected outright.
 */
export function validateBarkdBaseUrl(
    input: string,
): { ok: true; url: string } | { ok: false; error: string } {
    const url = normalizeBarkdBaseUrl(input);
    if (url === "") return { ok: false, error: "Base URL is required." };
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, error: "Base URL is not a valid URL." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "Base URL must use http:// or https://." };
    }
    if (parsed.protocol === "http:" && LOOPBACK_HOSTS[parsed.hostname] !== true) {
        return {
            ok: false,
            error: "Refusing plaintext http:// for a non-localhost barkd — the auth token would be sent unencrypted. Use https:// or a loopback address.",
        };
    }
    return { ok: true, url };
}

function redactToken(value: string, token: string): string {
    return token ? value.split(token).join("[redacted]") : value;
}

async function requestText(connection: BarkdConnection, path: string): Promise<string> {
    const validated = validateBarkdBaseUrl(connection.baseUrl);
    if (!validated.ok) {
        throw new Error(validated.error);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${validated.url}${path}`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${connection.token}`,
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            let body = "";
            try {
                body = await response.text();
            } catch {
                body = "Unable to read response body";
            }
            const safeSnippet = redactToken(body, connection.token).slice(0, 300);
            const detail = safeSnippet ? `: ${safeSnippet}` : "";
            throw new Error(`barkd request failed with status ${response.status}${detail}`);
        }

        return await response.text();
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error("barkd request timed out after 10 seconds");
        }
        const message = error instanceof Error ? error.message : "Request failed";
        throw new Error(redactToken(message, connection.token));
    } finally {
        clearTimeout(timeout);
    }
}

function parseJson(text: string, endpoint: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error(`Invalid JSON response from barkd ${endpoint}`);
    }
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string") {
        throw new Error(`Invalid barkd VTXO: ${field} must be a string`);
    }
    return value;
}

function requireNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Invalid barkd VTXO: ${field} must be a number`);
    }
    return value;
}

function parseVtxoState(value: unknown): BarkdVtxoState {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Invalid barkd VTXO: state must have a type");
    }
    const stateValue = value as Record<string, unknown>;
    if (typeof stateValue.type !== "string") {
        throw new Error("Invalid barkd VTXO: state must have a type");
    }

    if (
        stateValue.type === "spendable" ||
        stateValue.type === "spent" ||
        stateValue.type === "exited"
    ) {
        return { type: stateValue.type };
    }
    if (stateValue.type === "locked") {
        const state: BarkdVtxoState = { type: "locked" };
        if (stateValue.action_id !== undefined) {
            if (typeof stateValue.action_id !== "string") {
                throw new Error("Invalid barkd VTXO: state.action_id must be a string");
            }
            state.actionId = stateValue.action_id;
        }
        if (stateValue.movement_id !== undefined) {
            if (
                typeof stateValue.movement_id !== "number" ||
                !Number.isFinite(stateValue.movement_id)
            ) {
                throw new Error("Invalid barkd VTXO: state.movement_id must be a number");
            }
            state.movementId = stateValue.movement_id;
        }
        return state;
    }

    throw new Error(`Invalid barkd VTXO: unsupported state type ${stateValue.type}`);
}

function parseVtxo(value: unknown): BarkdVtxo {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Invalid barkd VTXO: expected an object");
    }
    const vtxo = value as Record<string, unknown>;
    const exitDepth = vtxo.exit_depth;
    if (exitDepth !== null && (typeof exitDepth !== "number" || !Number.isFinite(exitDepth))) {
        throw new Error("Invalid barkd VTXO: exit_depth must be a number or null");
    }
    return {
        id: requireString(vtxo.id, "id"),
        amountSat: requireNumber(vtxo.amount_sat, "amount_sat"),
        policyType: requireString(vtxo.policy_type, "policy_type"),
        expiryHeight: requireNumber(vtxo.expiry_height, "expiry_height"),
        exitDelta: requireNumber(vtxo.exit_delta, "exit_delta"),
        exitDepth,
        chainAnchor: requireString(vtxo.chain_anchor, "chain_anchor"),
        state: parseVtxoState(vtxo.state),
    };
}

export async function fetchBarkdTipHeight(connection: BarkdConnection): Promise<number> {
    const path = "/api/v1/bitcoin/tip";
    const text = await requestText(connection, path);
    const value = parseJson(text, path);
    let height: unknown;
    if (typeof value === "number") {
        height = value;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const tip = value as Record<string, unknown>;
        height = tip.tip_height ?? tip.height;
    }
    if (typeof height !== "number" || !Number.isInteger(height) || height < 0) {
        throw new Error("Invalid barkd tip-height response");
    }
    return height;
}

export async function fetchBarkdVtxos(
    connection: BarkdConnection,
    includeSpent = false,
): Promise<BarkdVtxo[]> {
    const path = `/api/v1/wallet/vtxos${includeSpent ? "?all=true" : ""}`;
    const value = parseJson(await requestText(connection, path), path);
    if (!Array.isArray(value)) {
        throw new Error("Invalid barkd VTXO response: expected an array");
    }
    return value.map(parseVtxo);
}

export async function fetchBarkdNextRoundAt(connection: BarkdConnection): Promise<string | null> {
    const path = "/api/v1/wallet/next-round";
    const value = parseJson(await requestText(connection, path), path);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const startTime = (value as Record<string, unknown>).start_time;
    return typeof startTime === "string" && Number.isFinite(Date.parse(startTime))
        ? startTime
        : null;
}

export async function checkBarkdConnection(
    connection: BarkdConnection,
): Promise<{ ok: true; tipHeight: number } | { ok: false; error: string }> {
    try {
        return { ok: true, tipHeight: await fetchBarkdTipHeight(connection) };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to connect to barkd";
        return { ok: false, error: redactToken(message, connection.token) };
    }
}
