import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Serve freshly collected observations during development/preview without
 * changing the committed JSON regression fixtures. Production can point the
 * collector at the deployed observation directory instead.
 */
function collectedObservations(directory: string | undefined, basePath: string): Plugin {
    const base = basePath.replace(/\/?$/, "/");
    const names = new Set(["arkade.json", "bark.json", "summary.json"]);
    const middleware = async (
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void,
    ) => {
        if (!directory) return next();
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        const name = path.posix.basename(pathname);
        if (!names.has(name) || pathname !== `${base}observation/${name}`) return next();
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        try {
            response.end(await readFile(path.resolve(directory, name)));
        } catch {
            // Never silently substitute old bundled fixtures for a failed live collector.
            response.statusCode = 503;
            response.end(JSON.stringify({ error: "Configured observation file unavailable" }));
        }
    };
    return {
        name: "collected-observations",
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}

let commitHash = "unknown";
try {
    commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
    // No git repo available (e.g. Docker build)
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const base = process.env.VITE_BASE_PATH || env.VITE_BASE_PATH || "/";
    return {
        // Sub-path deploys (e.g. /ark/) set VITE_BASE_PATH; default stays "/".
        base,
        plugins: [
            react(),
            collectedObservations(process.env.OBSERVATION_OUT || env.OBSERVATION_OUT, base),
        ],
        resolve: {
            alias: {
                "@": path.resolve(import.meta.dirname, "./src"),
            },
        },
        define: {
            __COMMIT_HASH__: JSON.stringify(commitHash),
        },
    };
});
