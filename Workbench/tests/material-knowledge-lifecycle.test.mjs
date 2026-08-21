import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMaterialKnowledgeReadiness,
  extractPublishedCandidateSummary,
} from "../src/lib/material-knowledge-lifecycle.js";

const rawDocument = {
  layer: "raw",
  domain: "AI与智能体",
  contentKind: "案例",
  frontmatter: {
    summary_origin: "manual-import",
    summary_sha256: "sha256-demo",
  },
  body: `# 示例资料

## 摘要说明

> 候选说明。

## AI 候选摘要

这是一份已经人工核对过的候选总结。

## 核心要点

- 要点 A
- 要点 B

## 建议标签

AI、工作台

## 可复用方向

用于产品设计复盘。

## 不确定内容

部分细节需要回原文确认。

## 建议领域

AI与智能体

## 建议内容类型

案例

## 建议用途

项目

## 全文正文

真实来源正文。`,
};

test("published candidate summary is extracted only from explicitly marked Raw", () => {
  const summary = extractPublishedCandidateSummary(rawDocument);
  assert.equal(summary.summary, "这是一份已经人工核对过的候选总结。");
  assert.match(summary.keyPoints, /要点 A/);
  assert.match(summary.uncertainties, /回原文确认/);

  const unmarked = extractPublishedCandidateSummary({
    ...rawDocument,
    frontmatter: {},
  });
  assert.equal(unmarked, null);
});

test("knowledge extraction readiness never authorizes Wiki writes", () => {
  const readiness = buildMaterialKnowledgeReadiness(rawDocument, [{ id: "note-1" }]);
  assert.equal(readiness.requiredReady, true);
  assert.equal(readiness.status, "ready_for_p2_review");
  assert.equal(readiness.p2GateRequired, true);
  assert.equal(readiness.canWriteWiki, false);
  assert.equal(readiness.noteCount, 1);
});

test("missing reviewed summary or classification remains a source-review issue", () => {
  const readiness = buildMaterialKnowledgeReadiness({
    ...rawDocument,
    domain: null,
    contentKind: null,
    frontmatter: {},
  });
  assert.equal(readiness.requiredReady, false);
  assert.equal(readiness.status, "needs_source_review");
  assert.equal(readiness.canWriteWiki, false);
});
