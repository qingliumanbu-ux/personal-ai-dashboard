const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isIngestionProxyPath(pathname) {
  return pathname === "/api/ingestion" || pathname.startsWith("/api/ingestion/");
}

export function createIngestionProxyConfig(target = "http://127.0.0.1:8766") {
  const parsed = new URL(target);
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Ingestion proxy target must be a loopback HTTP service");
  }
  return {
    target: parsed.origin,
    changeOrigin: false,
    rewrite(pathname) {
      return isIngestionProxyPath(pathname)
        ? pathname.replace(/^\/api\/ingestion(?=\/|$)/, "/api")
        : pathname;
    },
  };
}
