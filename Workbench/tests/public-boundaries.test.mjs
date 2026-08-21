import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildVaultIndex } from "../server/vault-index.mjs";

test("public index skips hidden private workflow roots", async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "personal-dashboard-vault-"));
  t.after(() => fs.rm(vaultRoot, { recursive: true, force: true }));

  await Promise.all([
    fs.mkdir(path.join(vaultRoot, "wiki", "concepts"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "Brainstorm", "session"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "90_runs", "content_strategy"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "30_self_media", "public-account"), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(path.join(vaultRoot, "wiki", "concepts", "public.md"), "# Public\n"),
    fs.writeFile(path.join(vaultRoot, "Brainstorm", "session", "brainstorm.md"), "# Hidden\n"),
    fs.writeFile(path.join(vaultRoot, "90_runs", "content_strategy", "private.md"), "# Hidden\n"),
    fs.writeFile(path.join(vaultRoot, "30_self_media", "public-account", "private.md"), "# Hidden\n"),
  ]);

  const index = await buildVaultIndex(vaultRoot);
  assert.deepEqual(index.documents.map((document) => document.path), [
    "wiki/concepts/public.md",
  ]);
  assert.equal(index.stats.runs, 0);
  assert.equal(index.stats.brainstormSessions, 0);
});

test("demo mode only activates through the explicit marker", async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "personal-dashboard-demo-"));
  t.after(() => fs.rm(vaultRoot, { recursive: true, force: true }));

  assert.equal((await buildVaultIndex(vaultRoot)).demoMode, false);
  await fs.writeFile(
    path.join(vaultRoot, ".workbench-demo.json"),
    JSON.stringify({ schemaVersion: 1, demoMode: true }),
  );
  assert.equal((await buildVaultIndex(vaultRoot)).demoMode, true);
});

test("personal AI Vault layout maps existing source, candidate, and formal knowledge roots", async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "personal-ai-vault-layout-"));
  t.after(() => fs.rm(vaultRoot, { recursive: true, force: true }));

  await Promise.all([
    fs.mkdir(path.join(vaultRoot, "04-来源资料", "视频"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "05-候选知识"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "06-正式知识"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "08-智能体运行", "ingest_plans"), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(path.join(vaultRoot, "04-来源资料", "视频", "来源.md"), "# 来源\n"),
    fs.writeFile(path.join(vaultRoot, "05-候选知识", "候选.md"), "# 候选\n"),
    fs.writeFile(path.join(vaultRoot, "06-正式知识", "正式知识.md"), "# 正式知识\n\n[[关联知识]]\n"),
    fs.writeFile(path.join(vaultRoot, "06-正式知识", "关联知识.md"), "# 关联知识\n"),
    fs.writeFile(path.join(vaultRoot, "08-智能体运行", "ingest_plans", "private.md"), "# Hidden run\n"),
  ]);

  const index = await buildVaultIndex(vaultRoot, {
    layoutId: "personal-ai-vault-v1",
  });

  assert.equal(index.layout.id, "personal-ai-vault-v1");
  assert.equal(index.layout.roots.raw, "04-来源资料");
  assert.equal(index.stats.rawFiles, 1);
  assert.equal(index.stats.formalWikiPages, 2);
  assert.equal(index.documents.some((document) => document.path.startsWith("08-智能体运行/")), false);
  const formal = index.documents.find((document) => document.path === "06-正式知识/正式知识.md");
  assert.equal(formal.wikiLinks[0]?.resolvedId, index.documents.find((document) => document.path === "06-正式知识/关联知识.md")?.id);
  assert.equal(
    index.documents.find((document) => document.path === "05-候选知识/候选.md")?.layer,
    "candidate",
  );
});
