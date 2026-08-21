import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("ingestion main flow generates an editable AI draft and archives to materials", () => {
  const page = readFileSync(join(ROOT, "src/pages/IngestionPage.jsx"), "utf8");
  assert.match(page, /生成 AI 总结/);
  assert.match(page, /审核并修改 AI 候选总结/);
  assert.match(page, /归档到资料中心/);
  assert.match(page, /来源资料，不是正式知识/);
  assert.match(page, /备用方式：复制标准提示词给其他 AI/);
  assert.match(page, /准备人工总结提示词/);
  assert.doesNotMatch(page, /打开 Codex/);
});

test("reader presents P2 Raw-to-Wiki review without restoring the Codex client handoff", () => {
  const reader = readFileSync(join(ROOT, "src/components/reader/ReaderWorkspace.jsx"), "utf8");
  assert.match(reader, /资料信息/);
  assert.match(reader, /已经完成第一次入库并作为来源资料保存/);
  assert.match(reader, /提炼为知识/);
  assert.match(reader, /已审核 AI 候选总结/);
  assert.match(reader, /第二次提炼准备/);
  assert.match(reader, /P2 准入/);
  assert.match(reader, /生成二次提炼方案/);
  assert.match(reader, /概念候选 · 去重\/关联 · Wiki Diff/);
  assert.match(reader, /确认这个方案并写入 Wiki/);
  assert.match(reader, /这是第二道人工确认/);
  assert.doesNotMatch(reader, /整理、复制并打开 Codex/);
  assert.doesNotMatch(reader, /手动入库审查/);
});

test("P2 planning is admission-gated and the read-only plan exposes reviewable Wiki Diff sections", () => {
  const server = readFileSync(join(ROOT, "server/vite-plugin-workbench.mjs"), "utf8");
  const runner = readFileSync(join(ROOT, "server/wiki-ingest-runner.mjs"), "utf8");
  assert.match(server, /P2_ADMISSION_REQUIRED/);
  assert.match(server, /P2_ADMISSION_STALE/);
  assert.match(server, /approvedFingerprint !== currentAdmission\?\.snapshotFingerprint/);
  assert.match(runner, /## 概念候选/);
  assert.match(runner, /## 去重与关联/);
  assert.match(runner, /## Wiki Diff/);
  assert.match(runner, /## 二次确认清单/);
  assert.match(runner, /当前进程是 read-only/);
  assert.match(runner, /只有 awaiting_review 状态的任务可以二次确认并执行写入/);
});

test("automatic candidate summary endpoint is explicit, local-API guarded, and draft-only", () => {
  const server = readFileSync(join(ROOT, "server/vite-plugin-workbench.mjs"), "utf8");
  assert.match(server, /POST" && url\.pathname === "\/api\/candidate-summary\/generate"/);
  assert.match(server, /candidateSummaryProvider\.generate\(body\?\.prompt\)/);
  assert.match(server, /assertLocalMutationRequest\(req\)/);
  assert.doesNotMatch(server, /candidateSummaryProvider\.generate[\s\S]{0,300}refreshIndex/);
});
