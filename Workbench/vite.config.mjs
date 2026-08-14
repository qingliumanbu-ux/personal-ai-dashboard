import path from "node:path";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createIngestionProxyConfig } from "./server/ingestion-proxy.mjs";
import { workbenchApiPlugin } from "./server/vite-plugin-workbench.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const vaultRoot = env.PERSONAL_DASHBOARD_VAULT_ROOT
    ? path.resolve(env.PERSONAL_DASHBOARD_VAULT_ROOT)
    : undefined;

  return {
    cacheDir: env.VITE_CACHE_DIR || "node_modules/.vite",
    build: {
      outDir: "dist/client",
      emptyOutDir: false,
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      // This server exposes local Vault reads, note persistence, and a confirmed
      // Codex write action. Keep it loopback-only by default.
      host: "127.0.0.1",
      allowedHosts: ["terminal.local"],
      proxy: {
        "/api/ingestion": createIngestionProxyConfig(
          env.PERSONAL_DASHBOARD_INGESTION_URL || "http://127.0.0.1:8765",
        ),
      },
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [
      react(),
      workbenchApiPlugin({
        vaultRoot,
        layoutId: env.PERSONAL_DASHBOARD_VAULT_LAYOUT || "dashboard-v1",
        readOnly: env.PERSONAL_DASHBOARD_READ_ONLY === "true",
      }),
    ],
  };
});
