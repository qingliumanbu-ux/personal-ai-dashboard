import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAiProviderSettingsRepository,
  validateAiProviderSettings,
} from "../server/ai-provider-settings.mjs";

test("AI Provider settings default to Codex CLI without pinning a model", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-ai-settings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = createAiProviderSettingsRepository({ root });

  const settings = await repository.load();
  assert.equal(settings.source, "default");
  assert.deepEqual(settings.summary, { provider: "codex_cli", model: "default" });
  assert.deepEqual(settings.knowledge, { provider: "codex_cli", model: "default" });
  assert.equal(settings.providers.find((item) => item.id === "codex_cli")?.available, true);
  assert.deepEqual(settings.providers.find((item) => item.id === "manual")?.supports, ["summary", "knowledge"]);
  assert.equal(settings.providers.find((item) => item.id === "manual")?.available, true);
  assert.equal(settings.providers.find((item) => item.id === "openai_api")?.available, false);
  assert.equal(settings.providers.find((item) => item.id === "local")?.available, false);
});

test("AI Provider settings persist only provider and model identifiers", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workbench-ai-settings-save-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = createAiProviderSettingsRepository({ root });

  const saved = await repository.save({
    schemaVersion: 1,
    summary: { provider: "codex_cli", model: "fast-summary-model" },
    knowledge: { provider: "codex_cli", model: "strong-knowledge-model" },
  });
  assert.equal(saved.source, "local");
  assert.equal(saved.summary.model, "fast-summary-model");
  assert.equal(saved.knowledge.model, "strong-knowledge-model");

  const persisted = JSON.parse(await readFile(repository.filePath, "utf8"));
  assert.deepEqual(Object.keys(persisted).sort(), ["knowledge", "schemaVersion", "summary"]);
  assert.deepEqual(Object.keys(persisted.summary).sort(), ["model", "provider"]);
  assert.deepEqual(Object.keys(persisted.knowledge).sort(), ["model", "provider"]);
});

test("AI Provider settings fail closed for unimplemented providers and unsafe model identifiers", () => {
  assert.throws(
    () => validateAiProviderSettings({
      schemaVersion: 1,
      summary: { provider: "openai_api", model: "default" },
      knowledge: { provider: "codex_cli", model: "default" },
    }),
    (error) => error.code === "AI_PROVIDER_UNSUPPORTED",
  );
  assert.throws(
    () => validateAiProviderSettings({
      schemaVersion: 1,
      summary: { provider: "codex_cli", model: "--dangerous" },
      knowledge: { provider: "codex_cli", model: "default" },
    }),
    (error) => error.code === "AI_MODEL_INVALID",
  );
});

test("manual provider is allowed for first-stage summary and second-stage planning", () => {
  const settings = validateAiProviderSettings({
    schemaVersion: 1,
    summary: { provider: "manual", model: "none" },
    knowledge: { provider: "manual", model: "none" },
  });
  assert.deepEqual(settings.summary, { provider: "manual", model: "none" });
  assert.deepEqual(settings.knowledge, { provider: "manual", model: "none" });
});
