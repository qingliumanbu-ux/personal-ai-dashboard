import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createIngestionProxyConfig } from "./server/ingestion-proxy.mjs";
import { workbenchApiPlugin } from "./server/vite-plugin-workbench.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const packageRoot = process.env.INIT_CWD
    ? path.resolve(process.env.INIT_CWD)
    : process.env.npm_package_json
      ? path.dirname(path.resolve(process.env.npm_package_json))
      : process.cwd();
  const defaultVaultRoot = [
    path.resolve(packageRoot, "..", "个人知识库"),
    path.resolve(packageRoot, "个人知识库"),
    path.resolve(process.cwd(), "个人知识库"),
    path.resolve(process.cwd(), "..", "个人知识库"),
  ].find((candidate) => existsSync(candidate));
  const hostedBuild =
    process.env.VITE_WORKBENCH_HOSTED === "true" || env.VITE_WORKBENCH_HOSTED === "true";
  const vaultRoot = hostedBuild
    ? defaultVaultRoot
    : env.PERSONAL_DASHBOARD_VAULT_ROOT
      ? path.resolve(env.PERSONAL_DASHBOARD_VAULT_ROOT)
      : defaultVaultRoot;
  const ingestionUrl = env.PERSONAL_DASHBOARD_INGESTION_URL || "http://127.0.0.1:8766";

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
        "/api/ingestion": createIngestionProxyConfig(ingestionUrl),
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
        ingestionUrl,
      }),
    ],
  };
});
