import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { maintenancePreview, validateMaintenanceExecution } from "../server/maintenance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("maintenance preview is dry-run, explicit, and preserves protected data", () => {
  const preview = maintenancePreview("rebuild-index");
  assert.equal(preview.dryRun, true);
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.reversible, true);
  assert.match(preview.title, /派生索引/);
  assert.match(preview.target, /可重建派生/);
  assert.ok(preview.preserves.some((item) => /Vault Markdown/.test(item)));
  assert.ok(preview.preserves.some((item) => /Git/.test(item)));
  assert.ok(preview.preserves.some((item) => /凭据/.test(item)));
});

test("maintenance rejects unapproved actions and execution without explicit confirmation", () => {
  assert.throws(
    () => maintenancePreview("delete-vault"),
    (error) => error.code === "MAINTENANCE_ACTION_NOT_ALLOWED",
  );
  assert.throws(
    () => validateMaintenanceExecution({ action: "rebuild-index", confirmed: false }),
    (error) => error.code === "MAINTENANCE_CONFIRMATION_REQUIRED",
  );
  assert.equal(
    validateMaintenanceExecution({ action: "rebuild-index", confirmed: true }).action,
    "rebuild-index",
  );
});

test("maintenance API separates GET preview from confirmed POST execution", () => {
  const serverSource = readFileSync(join(ROOT, "server/vite-plugin-workbench.mjs"), "utf8");
  assert.match(serverSource, /req\.method === "GET" && url\.pathname === "\/api\/maintenance\/preview"/);
  assert.match(serverSource, /req\.method === "POST" && url\.pathname === "\/api\/maintenance\/execute"/);
  assert.match(serverSource, /validateMaintenanceExecution\(body\)/);
  assert.match(serverSource, /refreshIndex\(\{ reason: "maintenance-confirmed" \}\)/);
});

test("maintenance UI requires preview before the confirmation control is rendered", () => {
  const pageSource = readFileSync(join(ROOT, "src/pages/SystemPage.jsx"), "utf8");
  assert.match(pageSource, /预览重建索引/);
  assert.match(pageSource, /maintenancePlan \? \(/);
  assert.match(pageSource, /只读预览/);
  assert.match(pageSource, /确认执行重建/);
  assert.match(pageSource, /删除正式知识库、清理 Git、来源原件和凭据不在这里提供/);
});
