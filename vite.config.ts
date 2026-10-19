import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";

let commitHash = "unknown";
try {
    commitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
    // No git repo available (e.g. Docker build)
}

export default defineConfig({
    // Sub-path deploys (e.g. /ark/) set VITE_BASE_PATH; default stays "/".
    base: process.env.VITE_BASE_PATH || "/",
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "./src"),
        },
    },
    define: {
        __COMMIT_HASH__: JSON.stringify(commitHash),
    },
});
