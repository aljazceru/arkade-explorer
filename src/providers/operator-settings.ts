/** Bundled default operator: ark.observer works out of the box. */
export const DEFAULT_OPERATOR_URL = "https://arkade.computer";

export function resolveOperatorUrl(): string {
    const environmentUrl = import.meta.env.VITE_INDEXER_URL;
    return typeof environmentUrl === "string" && environmentUrl.trim().length > 0
        ? environmentUrl.trim()
        : DEFAULT_OPERATOR_URL;
}
