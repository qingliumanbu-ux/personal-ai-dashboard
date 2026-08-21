import assert from "node:assert/strict";
import test from "node:test";

import {
  STARTER_WORK_RULES,
  addWorkRule,
  deleteWorkRule,
  enabledWorkRulesContext,
  normalizeWorkRulesState,
  updateWorkRule,
} from "../src/lib/work-rules-state.js";

const NOW = new Date("2026-08-17T09:00:00.000Z");

test("Work Rules start from a visible 5-10 item starter set instead of hidden memory", () => {
  const state = normalizeWorkRulesState(null);
  assert.equal(state.rules.length, STARTER_WORK_RULES.length);
  assert.ok(state.rules.length >= 5 && state.rules.length <= 10);
  assert.ok(state.rules.every((rule) => rule.origin === "starter"));
});

test("only enabled visible Work Rules are exported to suggestion or AI context", () => {
  let state = normalizeWorkRulesState(null);
  state = updateWorkRule(state, state.rules[0].id, { enabled: false }, NOW);
  const context = enabledWorkRulesContext(state);
  assert.equal(context.visibleRuleCount, state.rules.length);
  assert.equal(context.enabledRuleCount, state.rules.length - 1);
  assert.ok(!context.rules.some((rule) => rule.id === state.rules[0].id));
  assert.ok(context.rules.every((rule) => Object.keys(rule).sort().join(",") === "body,id,title"));
});

test("manual rule edits and enable decisions remain the authoritative stored version", () => {
  let state = normalizeWorkRulesState(null);
  const id = state.rules[1].id;
  state = updateWorkRule(state, id, { title: "我确认后的规则", enabled: false }, NOW);
  const normalized = normalizeWorkRulesState(state);
  const rule = normalized.rules.find((item) => item.id === id);
  assert.equal(rule.title, "我确认后的规则");
  assert.equal(rule.enabled, false);
  assert.equal(rule.userEdited, true);
  assert.equal(rule.userOverride, true);
  assert.equal(rule.userConfirmed, true);
  assert.equal(rule.overrideSource, "user");
});

test("users can add and delete explicit rules without any invisible replacement", () => {
  let state = normalizeWorkRulesState({ version: 1, updatedAt: null, rules: [] });
  state = addWorkRule(state, { title: "先找证据", body: "没有证据就保持候选。" }, NOW);
  assert.equal(state.rules.length, 1);
  assert.equal(state.rules[0].origin, "user");
  assert.equal(state.rules[0].userOverride, true);
  assert.equal(state.rules[0].userConfirmed, true);
  state = deleteWorkRule(state, state.rules[0].id, NOW);
  assert.equal(state.rules.length, 0);
  assert.equal(enabledWorkRulesContext(state).enabledRuleCount, 0);
});

test("deleting a starter rule leaves a user-authoritative tombstone", () => {
  let state = normalizeWorkRulesState(null);
  const starterId = state.rules[0].id;
  state = deleteWorkRule(state, starterId, NOW);
  const normalized = normalizeWorkRulesState(JSON.parse(JSON.stringify(state)));
  assert.ok(!normalized.rules.some((rule) => rule.id === starterId));
  assert.ok(normalized.deletedRuleIds.includes(starterId));
});
