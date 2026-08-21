import assert from "node:assert/strict";
import test from "node:test";

import { buildDailyKnowledgeReview } from "../src/lib/daily-knowledge-review.js";
import {
  buildTomorrowSuggestions,
  confirmedTomorrowWorkItemIds,
  deleteTomorrowSuggestion,
  rejectAllTomorrowSuggestions,
  updateTomorrowSuggestion,
} from "../src/lib/tomorrow-knowledge-suggestions-state.js";

const NOW = new Date("2026-08-17T18:00:00");

function workItem(id, title = id) {
  return {
    id,
    kind: "classify_source",
    title,
    reason: "缺少分类",
    source: {
      documentId: `doc-${id}`,
      path: `10_raw/articles/${id}.md`,
      title,
      layer: "raw",
    },
  };
}

function todayState(events = [], note = "") {
  return {
    date: "2026-08-17",
    events,
    focusHistory: [],
    review: { note, updatedAt: note ? NOW.toISOString() : null },
  };
}

test("Tomorrow suggestions only come from unresolved real Work Items", () => {
  const a = workItem("a");
  const b = workItem("b");
  const review = buildDailyKnowledgeReview(
    todayState([
      { type: "status_changed", at: NOW.toISOString(), workItemId: a.id, outcome: "later", workItem: a },
    ], "明天优先继续资料整理"),
    [a, b],
  );
  const state = buildTomorrowSuggestions(review, [a, b], null, { now: NOW });

  assert.deepEqual(state.items.map((item) => item.workItemId), ["a", "b"]);
  assert.equal(state.items[0].sourceState, "later");
  assert.equal(state.reviewContext, "明天优先继续资料整理");
  assert.ok(state.items.every((item) => item.workItem.source.documentId));
});

test("review text never creates a standalone Tomorrow task", () => {
  const review = buildDailyKnowledgeReview(todayState([], "明天记得买牛奶"), []);
  const state = buildTomorrowSuggestions(review, [], null, { now: NOW });
  assert.equal(state.items.length, 0);
  assert.equal(state.reviewContext, "明天记得买牛奶");
});

test("Tomorrow stores only the explicit enabled Work Rules context supplied by the UI", () => {
  const candidate = workItem("rules-context");
  const candidates = [candidate];
  const review = buildDailyKnowledgeReview(todayState([], "按启用规则继续"), candidates);
  const state = buildTomorrowSuggestions(review, candidates, null, {
    now: NOW,
    rulesContext: {
      version: 1,
      visibleRuleCount: 3,
      enabledRuleCount: 1,
      rules: [{ id: "r1", title: "保留证据", body: "判断必须回到来源。" }],
    },
  });
  assert.equal(state.rulesContext.visibleRuleCount, 3);
  assert.equal(state.rulesContext.enabledRuleCount, 1);
  assert.deepEqual(state.rulesContext.rules.map((rule) => rule.id), ["r1"]);
});

test("user edits and confirmations survive regeneration for the same source day", () => {
  const a = workItem("a", "来源 A");
  const review = buildDailyKnowledgeReview(todayState(), [a]);
  let state = buildTomorrowSuggestions(review, [a], null, { now: NOW });
  state = updateTomorrowSuggestion(state, state.items[0].id, { planText: "明天先补领域，再补内容类型" }, NOW);
  state = updateTomorrowSuggestion(state, state.items[0].id, { status: "confirmed" }, NOW);

  const rebuilt = buildTomorrowSuggestions(review, [{ ...a, title: "来源 A 新标题" }], state, {
    now: new Date("2026-08-17T20:00:00"),
  });
  assert.equal(rebuilt.items[0].planText, "明天先补领域，再补内容类型");
  assert.equal(rebuilt.items[0].userEdited, true);
  assert.equal(rebuilt.items[0].status, "confirmed");
  assert.equal(rebuilt.items[0].userOverride, true);
  assert.equal(rebuilt.items[0].userConfirmed, true);
  assert.equal(rebuilt.items[0].overrideSource, "user");
});

test("only confirmed suggestions become next-day preferred Work Items", () => {
  const a = workItem("a");
  const b = workItem("b");
  const review = buildDailyKnowledgeReview(todayState(), [a, b]);
  let state = buildTomorrowSuggestions(review, [a, b], null, { now: NOW });
  state = updateTomorrowSuggestion(state, state.items[0].id, { status: "confirmed" }, NOW);
  assert.deepEqual(confirmedTomorrowWorkItemIds(state, new Date("2026-08-18T08:00:00")), ["a"]);
  assert.deepEqual(confirmedTomorrowWorkItemIds(state, NOW), []);

  state = rejectAllTomorrowSuggestions(state, NOW);
  assert.deepEqual(confirmedTomorrowWorkItemIds(state, new Date("2026-08-18T08:00:00")), []);
});

test("deleted suggestions remain deleted across same-day regeneration", () => {
  const a = workItem("a");
  const review = buildDailyKnowledgeReview(todayState(), [a]);
  let state = buildTomorrowSuggestions(review, [a], null, { now: NOW });
  state = deleteTomorrowSuggestion(state, state.items[0].id, NOW);
  const rebuilt = buildTomorrowSuggestions(review, [a], state, {
    now: new Date("2026-08-17T21:00:00"),
  });
  assert.equal(rebuilt.items[0].status, "deleted");
  assert.equal(rebuilt.items[0].userOverride, true);
  assert.equal(rebuilt.items[0].overrideSource, "user");
  assert.equal(rebuilt.items[0].userConfirmed, true);
});

test("rejected suggestions remain explicit user decisions after regeneration", () => {
  const a = workItem("reject-me");
  const review = buildDailyKnowledgeReview(todayState(), [a]);
  let state = buildTomorrowSuggestions(review, [a], null, { now: NOW });
  state = updateTomorrowSuggestion(state, state.items[0].id, { status: "rejected" }, NOW);
  const rebuilt = buildTomorrowSuggestions(review, [a], state, {
    now: new Date("2026-08-17T22:00:00"),
  });
  assert.equal(rebuilt.items[0].status, "rejected");
  assert.equal(rebuilt.items[0].userOverride, true);
  assert.equal(rebuilt.items[0].userConfirmed, true);
  assert.equal(rebuilt.items[0].overrideSource, "user");
});
