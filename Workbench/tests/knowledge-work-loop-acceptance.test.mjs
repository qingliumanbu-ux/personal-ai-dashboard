import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildKnowledgeWorkLoopAcceptanceReport } from "../src/lib/knowledge-work-loop-acceptance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function day(date, { opens = 1, completed = 0, reviewValue = 4, maintenanceMinutes = 5 } = {}) {
  const overrides = {};
  for (let index = 0; index < completed; index += 1) overrides[`work-${index}`] = { status: "completed" };
  return {
    updatedAt: `${date}T12:00:00.000Z`,
    today: {
      version: 1,
      date,
      overrides,
      usage: { todayOpenCount: opens },
      evaluation: { reviewValue, maintenanceMinutes },
    },
  };
}

function cycle(date, statuses) {
  return {
    sourceDate: date,
    targetDate: "2099-01-01",
    items: statuses.map((status, index) => ({ id: `${date}-${index}`, status })),
  };
}

test("p137-8 report summarizes only fully recorded real-use day records without declaring acceptance", () => {
  const store = {
    version: 1,
    days: {
      "2026-08-18": day("2026-08-18", { opens: 2, completed: 1, reviewValue: 4, maintenanceMinutes: 8 }),
      "2026-08-19": day("2026-08-19", { opens: 1, completed: 2, reviewValue: 5, maintenanceMinutes: 4 }),
      "2026-08-20": day("2026-08-20", { opens: 3, completed: 1, reviewValue: 3, maintenanceMinutes: 6 }),
    },
    tomorrowCycles: {
      "2026-08-18": cycle("2026-08-18", ["confirmed", "rejected"]),
      "2026-08-19": cycle("2026-08-19", ["confirmed"]),
      "2026-08-20": cycle("2026-08-20", ["candidate"]),
    },
  };
  const report = buildKnowledgeWorkLoopAcceptanceReport(store);
  assert.equal(report.recordedDays.length, 3);
  assert.equal(report.hasAtLeastThreeRecordedDays, true);
  assert.equal(report.consecutiveRecordedDayStreak, 3);
  assert.equal(report.hasThreeConsecutiveRecordedDays, true);
  assert.equal(report.requiresConsecutiveRealWorkdayConfirmation, true);
  assert.equal(report.summary.todayOpenCount, 6);
  assert.equal(report.summary.completedKnowledgeWork, 4);
  assert.equal(report.summary.maintenanceMinutes, 18);
  assert.equal(report.summary.averageReviewValue, 4);
  assert.equal(report.summary.aiSuggestions, 4);
  assert.equal(report.summary.aiSuggestionsAdopted, 2);
  assert.equal(report.summary.aiSuggestionAdoptionRate, 0.5);
});

test("p137-8 report excludes days missing explicit subjective evaluation", () => {
  const report = buildKnowledgeWorkLoopAcceptanceReport({
    version: 1,
    days: {
      "2026-08-18": day("2026-08-18", { reviewValue: null }),
      "2026-08-19": day("2026-08-19", { maintenanceMinutes: null }),
      "2026-08-20": day("2026-08-20"),
    },
    tomorrowCycles: {},
  });
  assert.equal(report.recordedDays.length, 1);
  assert.equal(report.hasAtLeastThreeRecordedDays, false);
  assert.equal(report.consecutiveRecordedDayStreak, 1);
  assert.equal(report.hasThreeConsecutiveRecordedDays, false);
});

test("p137-8 report does not treat three non-consecutive records as a consecutive-use streak", () => {
  const report = buildKnowledgeWorkLoopAcceptanceReport({
    version: 1,
    days: {
      "2026-08-18": day("2026-08-18"),
      "2026-08-20": day("2026-08-20"),
      "2026-08-22": day("2026-08-22"),
    },
    tomorrowCycles: {},
  });
  assert.equal(report.recordedDays.length, 3);
  assert.equal(report.hasAtLeastThreeRecordedDays, true);
  assert.equal(report.consecutiveRecordedDayStreak, 1);
  assert.equal(report.hasThreeConsecutiveRecordedDays, false);
  assert.equal(report.requiresConsecutiveRealWorkdayConfirmation, true);
});

test("p137-8 acceptance reporting stays local-only and has no Vault or network mutation dependency", () => {
  const source = readFileSync(join(ROOT, "src/lib/knowledge-work-loop-acceptance.js"), "utf8");
  assert.doesNotMatch(source, /fetch\(|\/api\/|ingestion-api|\.\.\/server\//);
  assert.match(source, /requiresConsecutiveRealWorkdayConfirmation/);
});
