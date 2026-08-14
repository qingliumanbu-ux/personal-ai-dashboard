import assert from "node:assert/strict";
import test from "node:test";

import {
  createIngestionProxyConfig,
  isIngestionProxyPath,
} from "../server/ingestion-proxy.mjs";

test("ingestion proxy keeps browser requests same-origin and rewrites the API prefix", () => {
  const proxy = createIngestionProxyConfig("http://127.0.0.1:8765");

  assert.equal(proxy.target, "http://127.0.0.1:8765");
  assert.equal(proxy.changeOrigin, false);
  assert.equal(proxy.rewrite("/api/ingestion/jobs/123"), "/api/jobs/123");
  assert.equal(proxy.rewrite("/api/overview"), "/api/overview");
  assert.equal(isIngestionProxyPath("/api/ingestion/jobs"), true);
  assert.equal(isIngestionProxyPath("/api/ingestion-other"), false);
});

test("ingestion proxy rejects non-loopback targets", () => {
  assert.throws(
    () => createIngestionProxyConfig("https://example.com"),
    /loopback HTTP service/,
  );
});
