import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildDiagnostics, summarizeSystemHealth } from "../server/system-health.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function healthyInput(overrides = {}) {
  return {
    vault: { connected: true, documents: 24, errors: 0 },
    sync: { status: "watching" },
    graph: { nodeCount: 8, edgeCount: 11 },
    classification: { unclassified: 0, coveragePct: 100 },
    ingestion: { available: true },
    codex: { available: true },
    checks: {
      tests: { status: "healthy", detail: "测试通过" },
      privacyScan: { status: "healthy", detail: "扫描通过" },
    },
    ...overrides,
  };
}

test("system health stays healthy only when every recorded component is healthy", () => {
  const health = summarizeSystemHealth(healthyInput());
  assert.equal(health.overall, "healthy");
  assert.equal(health.components.length, 8);
  assert.equal(buildDiagnostics(health).length, 0);
});

test("unreachable ingestion becomes an unavailable finding with bounded recovery guidance", () => {
  const health = summarizeSystemHealth(healthyInput({
    ingestion: { available: false, status: "unreachable" },
  }));
  assert.equal(health.overall, "unavailable");
  const finding = buildDiagnostics(health).find((item) => item.component === "ingestion");
  assert.equal(finding.status, "unavailable");
  assert.match(finding.impact, /采集审核队列/);
  assert.match(finding.recovery, /loopback/);
});

test("missing run records remain unknown instead of being reported as passing", () => {
  const health = summarizeSystemHealth(healthyInput({ checks: {} }));
  assert.equal(health.overall, "unknown");
  assert.equal(health.components.find((item) => item.id === "tests").status, "unknown");
  assert.equal(health.components.find((item) => item.id === "privacy").status, "unknown");
});

test("diagnostics endpoint is GET-only and does not call the refresh mutation", () => {
  const serverSource = readFileSync(join(ROOT, "server/vite-plugin-workbench.mjs"), "utf8");
  const match = serverSource.match(
    /if \(req\.method === "GET" && url\.pathname === "\/api\/diagnostics"\) \{([\s\S]*?)\n          \}/,
  );
  assert.ok(match, "diagnostics GET endpoint should exist");
  assert.doesNotMatch(match[1], /refreshIndex|refreshVault|writeFile|spawn|git/i);
  assert.match(match[1], /buildDiagnostics\(health\)/);
});

test("system page keeps diagnostics separate from the explicit index maintenance action", () => {
  const pageSource = readFileSync(join(ROOT, "src/pages/SystemPage.jsx"), "utf8");
  assert.match(pageSource, /runSystemDiagnostics\(\)/);
  assert.match(pageSource, /不会刷新索引、改写正式知识库、修改 Git、来源原件或凭据/);
  assert.match(pageSource, /previewMaintenance\("rebuild-index"\)/);
  assert.match(pageSource, /executeMaintenance\(maintenancePlan\.action\)/);
  assert.doesNotMatch(pageSource, /refreshVault\(/);
});
