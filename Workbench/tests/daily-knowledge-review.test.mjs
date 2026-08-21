import assert from "node:assert/strict";
import test from "node:test";

import { buildDailyKnowledgeReview } from "../src/lib/daily-knowledge-review.js";

const SNAPSHOT = {
  id: "kw:v1:classify_source:doc-1",
  kind: "classify_source",
  title: "补全来源分类：示例",
  reason: "缺少分类",
  source: {
    documentId: "doc-1",
    path: "10_raw/articles/example.md",
    title: "示例",
    layer: "raw",
  },
};

test("Daily Review only verifies knowledge change when a completed candidate trigger disappeared", () => {
  const state = {
    date: "2026-08-17",
    focusHistory: [{ workItemId: SNAPSHOT.id, startedAt: "2026-08-17T01:00:00Z", exitedAt: "2026-08-17T01:05:00Z", outcome: "completed", workItem: SNAPSHOT }],
    events: [{ type: "status_changed", at: "2026-08-17T01:05:00Z", workItemId: SNAPSHOT.id, outcome: "completed", workItem: SNAPSHOT }],
    review: { note: "今天确认了分类。", updatedAt: "2026-08-17T01:06:00Z" },
  };

  const resolved = buildDailyKnowledgeReview(state, []);
  assert.equal(resolved.verifiedChanges.length, 1);
  assert.equal(resolved.unverifiedCompletions.length, 0);
  assert.equal(resolved.note, "今天确认了分类。");

  const stillPending = buildDailyKnowledgeReview(state, [SNAPSHOT]);
  assert.equal(stillPending.verifiedChanges.length, 0);
  assert.equal(stillPending.unverifiedCompletions.length, 1);
});

test("Daily Review keeps untouched and deferred candidates separate from verified changes", () => {
  const later = { ...SNAPSHOT, id: "later", title: "稍后处理" };
  const untouched = { ...SNAPSHOT, id: "untouched", title: "未处理" };
  const review = buildDailyKnowledgeReview(
    {
      date: "2026-08-17",
      focusHistory: [],
      events: [{ type: "status_changed", at: "2026-08-17T02:00:00Z", workItemId: "later", outcome: "later", workItem: later }],
      review: { note: "", updatedAt: null },
    },
    [later, untouched],
  );
  assert.deepEqual(review.deferred.map((item) => item.workItemId), ["later"]);
  assert.deepEqual(review.active.map((item) => item.workItemId), ["untouched"]);
  assert.equal(review.verifiedChanges.length, 0);
});
