import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import matter from "gray-matter";

import {
  createMaterialReviewBackfillService,
  normalizeHistoricalCandidateSummaryPaste,
  validateHistoricalCandidateSummary,
} from "../server/material-review-backfill.mjs";

const SUMMARY = `## AI 候选摘要

这是一份用于验证历史来源补录流程的候选摘要。

## 核心要点

- 保留来源原文。
- 人工审核 AI 总结。

## 建议标签

- 知识库
- Obsidian

## 可复用方向

可用于知识管理流程设计。

## 不确定内容

暂未发现。

## 建议领域

AI与智能体

## 建议内容类型

案例

## 建议用途

学习`;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "material-review-backfill-"));
  const raw = path.join(root, "10_raw");
  await mkdir(raw, { recursive: true });
  const file = path.join(raw, "source.md");
  await writeFile(file, "---\ntype: raw-source\n---\n\n# 来源\n\n正文。\n", "utf8");
  return { root, file };
}

async function personalVaultFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "material-review-backfill-personal-"));
  const raw = path.join(root, "04-来源资料", "视频");
  await mkdir(raw, { recursive: true });
  const file = path.join(raw, "source.md");
  await writeFile(file, "---\ntype: raw-source\n---\n\n# 来源\n\n正文。\n", "utf8");
  return { root, file };
}

test("historical review backfill requires explicit confirmation", async () => {
  const { root } = await fixture();
  try {
    const service = createMaterialReviewBackfillService({ vaultRoot: root });
    await assert.rejects(
      () => service.save({ relativePath: "10_raw/source.md", summary: SUMMARY }),
      /明确确认/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical review backfill appends reviewed summary and classification without replacing source body", async () => {
  const { root, file } = await fixture();
  try {
    const service = createMaterialReviewBackfillService({ vaultRoot: root });
    await service.save({
      relativePath: "10_raw/source.md",
      summary: SUMMARY,
      classification: {
        domain: "AI与智能体",
        topics: ["知识库", "Obsidian"],
        contentKind: "案例",
        useCases: ["学习"],
      },
      confirm: true,
    });
    const content = await readFile(file, "utf8");
    const parsed = matter(content);
    assert.match(parsed.content, /# 来源/);
    assert.match(parsed.content, /## 摘要说明/);
    assert.match(parsed.content, /## AI 候选摘要/);
    assert.match(parsed.content, /## 分类/);
    assert.equal(parsed.data.summary_origin, "workbench-backfill");
    assert.equal(parsed.data.domain, "AI与智能体");
    assert.equal(parsed.data.content_kind, "案例");
    assert.deepEqual(parsed.data.use_cases, ["学习"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical review backfill refuses to overwrite an existing reviewed summary", async () => {
  const { root } = await fixture();
  try {
    const service = createMaterialReviewBackfillService({ vaultRoot: root });
    await service.save({
      relativePath: "10_raw/source.md",
      summary: SUMMARY,
      classification: {
        domain: "AI与智能体",
        topics: [],
        contentKind: "案例",
        useCases: [],
      },
      confirm: true,
    });
    await assert.rejects(
      () => service.save({ relativePath: "10_raw/source.md", summary: SUMMARY, confirm: true }),
      /已经有已审核 AI 候选总结/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical candidate summary keeps the same required review headings", () => {
  assert.equal(validateHistoricalCandidateSummary(SUMMARY), SUMMARY);
  assert.throws(() => validateHistoricalCandidateSummary("## AI 候选摘要\n\n只有摘要"), /缺少必需章节/);
});

test("historical candidate summary repairs headings copied from rendered ChatGPT text", () => {
  const renderedCopy = SUMMARY
    .replace(/^## AI 候选摘要$/m, "AI 候选摘要")
    .replace(/^## 核心要点$/m, "**核心要点**")
    .replace(/^## 建议标签$/m, "建议标签：")
    .replace(/^## 可复用方向$/m, "### 可复用方向")
    .replace(/^## 不确定内容$/m, "不确定内容")
    .replace(/^## 建议领域$/m, "建议领域")
    .replace(/^## 建议内容类型$/m, "建议内容类型")
    .replace(/^## 建议用途$/m, "建议用途");

  const normalized = normalizeHistoricalCandidateSummaryPaste(renderedCopy);
  assert.equal(normalized, SUMMARY);
  assert.equal(validateHistoricalCandidateSummary(renderedCopy), SUMMARY);
});

test("historical review backfill follows the configured Raw root for personal-ai-vault-v1", async () => {
  const { root, file } = await personalVaultFixture();
  try {
    const service = createMaterialReviewBackfillService({ vaultRoot: root, rawRoot: "04-来源资料" });
    await service.save({
      relativePath: "04-来源资料/视频/source.md",
      classification: {
        domain: "AI与智能体",
        topics: ["知识库"],
        contentKind: "案例",
        useCases: ["学习"],
      },
      confirm: true,
    });
    const parsed = matter(await readFile(file, "utf8"));
    assert.equal(parsed.data.domain, "AI与智能体");
    assert.equal(parsed.data.content_kind, "案例");
    assert.match(parsed.content, /## 分类/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
