import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadTodayKnowledgeQueueState,
  normalizeTodayKnowledgeQueueState,
  saveTodayKnowledgeQueueState,
  updateDailyReviewNote,
  updateTodayKnowledgeQueueItem,
} from "../src/lib/today-knowledge-queue-state.js";
import {
  buildTomorrowSuggestions,
  loadTomorrowSuggestionsForTargetDate,
  loadTomorrowSuggestionsState,
  saveTomorrowSuggestionsState,
  updateTomorrowSuggestion,
} from "../src/lib/tomorrow-knowledge-suggestions-state.js";
import {
  clearWorkbenchStateStore,
  loadWorkbenchStateStore,
  WORKBENCH_STATE_STORAGE_KEY,
} from "../src/lib/workbench-state-store.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAY_ONE = new Date("2026-08-17T12:00:00");
const DAY_TWO = new Date("2026-08-18T12:00:00");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    has(key) {
      return values.has(key);
    },
  };
}

function workItem(id) {
  return {
    id,
    kind: "classify_source",
    title: `来源 ${id}`,
    reason: "缺少分类",
    source: {
      documentId: `doc-${id}`,
      path: `10_raw/articles/${id}.md`,
      title: `来源 ${id}`,
      layer: "raw",
    },
  };
}

function reviewFor(item, note = "") {
  return {
    deferred: [],
    unverifiedCompletions: [],
    active: [{ workItemId: item.id }],
    skipped: [],
    note,
  };
}

test("Workbench State Store keeps multiple local days while Today still opens the requested day", () => {
  const storage = memoryStorage();
  let dayOne = normalizeTodayKnowledgeQueueState(null, DAY_ONE);
  dayOne = updateTodayKnowledgeQueueItem(dayOne, "a", "later", DAY_ONE, workItem("a"));
  dayOne = updateDailyReviewNote(dayOne, "第一天人工复盘。", DAY_ONE);
  saveTodayKnowledgeQueueState(dayOne, storage);

  let dayTwo = normalizeTodayKnowledgeQueueState(null, DAY_TWO);
  dayTwo = updateTodayKnowledgeQueueItem(dayTwo, "b", "completed", DAY_TWO, workItem("b"));
  saveTodayKnowledgeQueueState(dayTwo, storage);

  const reloadedOne = loadTodayKnowledgeQueueState(storage, DAY_ONE);
  const reloadedTwo = loadTodayKnowledgeQueueState(storage, DAY_TWO);
  const store = loadWorkbenchStateStore(storage);

  assert.equal(reloadedOne.review.note, "第一天人工复盘。");
  assert.equal(reloadedOne.overrides.a.status, "later");
  assert.equal(reloadedTwo.overrides.b.status, "completed");
  assert.deepEqual(Object.keys(store.days).sort(), ["2026-08-17", "2026-08-18"]);
});

test("Tomorrow cycles survive across days and target-day priority reads the previous source cycle", () => {
  const storage = memoryStorage();
  const firstItem = workItem("first");
  let firstCycle = buildTomorrowSuggestions(reviewFor(firstItem), [firstItem], null, { now: DAY_ONE });
  firstCycle = updateTomorrowSuggestion(firstCycle, firstCycle.items[0].id, { status: "confirmed" }, DAY_ONE);
  saveTomorrowSuggestionsState(firstCycle, storage);

  const secondItem = workItem("second");
  const secondCycle = buildTomorrowSuggestions(reviewFor(secondItem), [secondItem], null, { now: DAY_TWO });
  saveTomorrowSuggestionsState(secondCycle, storage);

  const currentSourceCycle = loadTomorrowSuggestionsState(storage, DAY_TWO);
  const targetDayCycle = loadTomorrowSuggestionsForTargetDate(storage, DAY_TWO);

  assert.equal(currentSourceCycle.sourceDate, "2026-08-18");
  assert.equal(currentSourceCycle.items[0].workItemId, "second");
  assert.equal(targetDayCycle.sourceDate, "2026-08-17");
  assert.equal(targetDayCycle.targetDate, "2026-08-18");
  assert.equal(targetDayCycle.items[0].status, "confirmed");
  assert.equal(targetDayCycle.items[0].userOverride, true);
});

test("legacy Today and Tomorrow keys migrate into the unified store without deleting the legacy copy", () => {
  let legacyToday = normalizeTodayKnowledgeQueueState(null, DAY_ONE);
  legacyToday = updateDailyReviewNote(legacyToday, "旧状态仍需保留。", DAY_ONE);
  const legacyItem = workItem("legacy");
  let legacyTomorrow = buildTomorrowSuggestions(reviewFor(legacyItem), [legacyItem], null, { now: DAY_ONE });
  legacyTomorrow = updateTomorrowSuggestion(
    legacyTomorrow,
    legacyTomorrow.items[0].id,
    { status: "confirmed" },
    DAY_ONE,
  );
  const storage = memoryStorage({
    "workbench:knowledge-work:today:v1": JSON.stringify(legacyToday),
    "workbench:knowledge-work:tomorrow:v1": JSON.stringify(legacyTomorrow),
  });

  assert.equal(loadTodayKnowledgeQueueState(storage, DAY_ONE).review.note, "旧状态仍需保留。");
  assert.equal(loadTomorrowSuggestionsForTargetDate(storage, DAY_TWO).items[0].status, "confirmed");

  const store = loadWorkbenchStateStore(storage);
  assert.ok(store.days["2026-08-17"]);
  assert.ok(store.tomorrowCycles["2026-08-17"]);
  assert.equal(storage.has("workbench:knowledge-work:today:v1"), true);
  assert.equal(storage.has("workbench:knowledge-work:tomorrow:v1"), true);
});

test("clearing Workbench State removes only Workbench lifecycle state and leaves unrelated data alone", () => {
  const storage = memoryStorage({
    [WORKBENCH_STATE_STORAGE_KEY]: JSON.stringify({ version: 1, days: {}, tomorrowCycles: {} }),
    "workbench:knowledge-work:today:v1": "{}",
    "workbench:knowledge-work:tomorrow:v1": "{}",
    "workbench:knowledge-work:rules:v1": "USER RULES",
    "vault:index:sentinel": "FORMAL KNOWLEDGE MUST SURVIVE",
  });

  clearWorkbenchStateStore(storage);

  assert.equal(storage.getItem(WORKBENCH_STATE_STORAGE_KEY), null);
  assert.equal(storage.getItem("workbench:knowledge-work:today:v1"), null);
  assert.equal(storage.getItem("workbench:knowledge-work:tomorrow:v1"), null);
  assert.equal(storage.getItem("workbench:knowledge-work:rules:v1"), "USER RULES");
  assert.equal(storage.getItem("vault:index:sentinel"), "FORMAL KNOWLEDGE MUST SURVIVE");
});

test("Workbench State Store is browser-local state plumbing with no Vault or network mutation dependency", () => {
  const source = readFileSync(join(ROOT, "src/lib/workbench-state-store.js"), "utf8");
  assert.doesNotMatch(source, /fetch\(|\/api\/|ingestion-api|\.\.\/server\//);
  assert.match(source, /workbench:knowledge-work:state:v1/);
  assert.match(source, /MAX_DAILY_RECORDS = 90/);
  assert.match(source, /MAX_TOMORROW_CYCLES = 90/);
});
