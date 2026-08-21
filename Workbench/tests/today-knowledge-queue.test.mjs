import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTodayKnowledgeQueue,
  finishTodayFocusSession,
  moveTodayKnowledgeQueueItem,
  normalizeTodayKnowledgeQueueState,
  recordTodayKnowledgeQueueVisit,
  startTodayFocusSession,
  updateDailyReviewEvaluation,
  updateDailyReviewNote,
  updateTodayKnowledgeQueueItem,
} from "../src/lib/today-knowledge-queue-state.js";

const DAY = new Date("2026-08-17T12:00:00");

function item(id, kind) {
  return { id, kind, title: id, reason: `${id} reason`, source: { documentId: id } };
}

test("Today queue is finite and prioritizes explicit knowledge-work kinds deterministically", () => {
  const state = normalizeTodayKnowledgeQueueState(null, DAY);
  const payload = buildTodayKnowledgeQueue(
    [
      item("review", "review_knowledge"),
      item("classify", "classify_source"),
      item("evidence", "add_evidence"),
      item("judgment", "review_judgment"),
      item("relation", "review_relation"),
      item("isolated", "connect_isolated_knowledge"),
    ],
    state,
    { limit: 5, date: DAY },
  );
  assert.deepEqual(payload.visible.map((entry) => entry.id), [
    "judgment",
    "evidence",
    "classify",
    "relation",
    "isolated",
  ]);
  assert.equal(payload.remaining, 1);
});

test("manual completion, skip, and later decisions persist for the current day", () => {
  let state = normalizeTodayKnowledgeQueueState(null, DAY);
  state = updateTodayKnowledgeQueueItem(state, "a", "completed", DAY);
  state = updateTodayKnowledgeQueueItem(state, "b", "skipped", DAY);
  state = updateTodayKnowledgeQueueItem(state, "c", "later", DAY);
  const payload = buildTodayKnowledgeQueue(
    [item("a", "classify_source"), item("b", "classify_source"), item("c", "classify_source"), item("d", "classify_source")],
    state,
    { date: DAY },
  );
  assert.deepEqual(payload.visible.map((entry) => entry.id), ["d"]);
  assert.equal(payload.completed, 1);
  assert.equal(payload.skipped, 1);
  assert.equal(payload.later, 1);
  assert.deepEqual(state.overrides.a, {
    status: "completed",
    updatedAt: DAY.toISOString(),
    userOverride: true,
    userConfirmed: true,
    source: "user",
  });
});

test("manual queue order overrides deterministic ranking without changing candidate content", () => {
  let state = normalizeTodayKnowledgeQueueState(null, DAY);
  const candidates = [item("a", "review_judgment"), item("b", "review_judgment"), item("c", "review_judgment")];
  state = moveTodayKnowledgeQueueItem(state, ["a", "b", "c"], "c", "up", DAY);
  const payload = buildTodayKnowledgeQueue(candidates, state, { date: DAY });
  assert.deepEqual(payload.visible.map((entry) => entry.id), ["a", "c", "b"]);
  assert.equal(payload.visible[1], candidates[2]);
  assert.equal(state.orderOverride.userOverride, true);
  assert.equal(state.orderOverride.userConfirmed, true);
  assert.equal(state.orderOverride.source, "user");
});

test("confirmed Tomorrow items are preferred on the target day until the user manually reorders Today", () => {
  const state = normalizeTodayKnowledgeQueueState(null, DAY);
  const candidates = [
    item("a", "review_judgment"),
    item("b", "review_knowledge"),
    item("c", "add_evidence"),
  ];
  const preferred = buildTodayKnowledgeQueue(candidates, state, {
    date: DAY,
    preferredIds: ["b"],
  });
  assert.deepEqual(preferred.visible.map((entry) => entry.id), ["b", "a", "c"]);

  const reordered = moveTodayKnowledgeQueueItem(state, ["b", "a", "c"], "a", "up", DAY);
  const manual = buildTodayKnowledgeQueue(candidates, reordered, {
    date: DAY,
    preferredIds: ["b"],
  });
  assert.deepEqual(manual.visible.map((entry) => entry.id), ["a", "b", "c"]);
});

test("Today overrides reset on a new local day instead of becoming knowledge truth", () => {
  const state = updateTodayKnowledgeQueueItem(
    normalizeTodayKnowledgeQueueState(null, DAY),
    "a",
    "completed",
    DAY,
  );
  const tomorrow = new Date("2026-08-18T12:00:00");
  const reset = normalizeTodayKnowledgeQueueState(state, tomorrow);
  assert.deepEqual(reset.overrides, {});
  assert.equal(reset.date, "2026-08-18");
});

test("Focus history records entry and exit without mutating knowledge content", () => {
  let state = normalizeTodayKnowledgeQueueState(null, DAY);
  state = startTodayFocusSession(state, "kw:v1:review_judgment:doc-1", DAY);
  assert.equal(state.focusHistory.length, 1);
  assert.equal(state.focusHistory[0].outcome, "active");
  assert.equal(state.focusHistory[0].exitedAt, null);

  const later = new Date("2026-08-17T12:10:00");
  state = finishTodayFocusSession(state, "kw:v1:review_judgment:doc-1", "completed", later);
  assert.equal(state.focusHistory[0].outcome, "completed");
  assert.equal(state.focusHistory[0].exitedAt, later.toISOString());
  assert.deepEqual(state.overrides, {});
});

test("Daily Review note is explicit user-authored Workbench state and resets with the local day", () => {
  let state = normalizeTodayKnowledgeQueueState(null, DAY);
  state = updateDailyReviewNote(state, "仍需补一条证据。", DAY);
  assert.equal(state.review.note, "仍需补一条证据。");
  assert.equal(state.review.updatedAt, DAY.toISOString());
  assert.equal(state.review.userAuthored, true);
  assert.equal(state.review.userOverride, true);
  assert.equal(state.review.userConfirmed, true);
  assert.equal(state.review.source, "user");
  const tomorrow = normalizeTodayKnowledgeQueueState(state, new Date("2026-08-18T12:00:00"));
  assert.equal(tomorrow.review.note, "");
});

test("p137-8 usage and subjective evaluation stay explicit browser-local daily state", () => {
  let state = normalizeTodayKnowledgeQueueState(null, DAY);
  state = recordTodayKnowledgeQueueVisit(state, DAY);
  state = recordTodayKnowledgeQueueVisit(state, new Date(DAY.getTime() + 10_000));
  assert.equal(state.usage.todayOpenCount, 1, "StrictMode-style remounts should not double count a visit");
  state = recordTodayKnowledgeQueueVisit(state, new Date(DAY.getTime() + 60_000));
  assert.equal(state.usage.todayOpenCount, 2);
  state = updateDailyReviewEvaluation(state, { reviewValue: 4, maintenanceMinutes: 12 }, DAY);
  assert.equal(state.evaluation.reviewValue, 4);
  assert.equal(state.evaluation.maintenanceMinutes, 12);
  assert.equal(state.evaluation.userOverride, true);
  assert.equal(state.evaluation.userConfirmed, true);
  assert.equal(state.evaluation.source, "user");
  const tomorrow = normalizeTodayKnowledgeQueueState(state, new Date("2026-08-18T12:00:00"));
  assert.equal(tomorrow.usage.todayOpenCount, 0);
  assert.equal(tomorrow.evaluation.reviewValue, null);
});

test("Today and Review user decisions survive save-load normalization during the same day", () => {
  let state = normalizeTodayKnowledgeQueueState(null, DAY);
  state = updateTodayKnowledgeQueueItem(state, "a", "later", DAY);
  state = moveTodayKnowledgeQueueItem(state, ["a", "b"], "b", "up", DAY);
  state = updateDailyReviewNote(state, "这是用户原文。", DAY);
  const reloaded = normalizeTodayKnowledgeQueueState(JSON.parse(JSON.stringify(state)), DAY);
  assert.equal(reloaded.overrides.a.userOverride, true);
  assert.equal(reloaded.overrides.a.userConfirmed, true);
  assert.equal(reloaded.orderOverride.userOverride, true);
  assert.equal(reloaded.orderOverride.userConfirmed, true);
  assert.equal(reloaded.review.note, "这是用户原文。");
  assert.equal(reloaded.review.userOverride, true);
  assert.equal(reloaded.review.userConfirmed, true);
});

test("an open Today page drops yesterday overrides when the queue is recomputed after midnight", () => {
  const state = updateTodayKnowledgeQueueItem(
    normalizeTodayKnowledgeQueueState(null, DAY),
    "a",
    "completed",
    DAY,
  );
  const payload = buildTodayKnowledgeQueue(
    [item("a", "classify_source")],
    state,
    { date: new Date("2026-08-18T00:01:00") },
  );
  assert.deepEqual(payload.visible.map((entry) => entry.id), ["a"]);
  assert.equal(payload.completed, 0);
});
