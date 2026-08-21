import { normalizeWorkbenchStateStore } from "./workbench-state-store.js";

function dailySuggestionStats(cycle) {
  const items = Array.isArray(cycle?.items) ? cycle.items : [];
  return {
    total: items.length,
    adopted: items.filter((item) => item?.status === "confirmed").length,
  };
}

function completedCount(today) {
  return Object.values(today?.overrides ?? {}).filter((item) => item?.status === "completed").length;
}

function longestConsecutiveRecordedDayStreak(days) {
  let longest = 0;
  let current = 0;
  let previousDay = null;
  for (const day of days) {
    const [year, month, date] = String(day.date).split("-").map(Number);
    const ordinal = Date.UTC(year, month - 1, date) / 86_400_000;
    current = previousDay != null && ordinal === previousDay + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previousDay = ordinal;
  }
  return longest;
}

export function buildKnowledgeWorkLoopAcceptanceReport(store) {
  const current = normalizeWorkbenchStateStore(store);
  const days = Object.keys(current.days)
    .sort()
    .map((date) => {
      const today = current.days[date]?.today ?? {};
      const suggestions = dailySuggestionStats(current.tomorrowCycles[date]);
      const reviewValue = today.evaluation?.reviewValue ?? null;
      const maintenanceMinutes = today.evaluation?.maintenanceMinutes ?? null;
      const todayOpenCount = today.usage?.todayOpenCount ?? 0;
      return {
        date,
        todayOpenCount,
        completedKnowledgeWork: completedCount(today),
        reviewValue,
        maintenanceMinutes,
        aiSuggestions: suggestions.total,
        aiSuggestionsAdopted: suggestions.adopted,
        aiSuggestionAdoptionRate: suggestions.total > 0 ? suggestions.adopted / suggestions.total : null,
        fullyRecorded:
          todayOpenCount > 0
          && Number.isInteger(reviewValue)
          && Number.isInteger(maintenanceMinutes),
      };
    });
  const recordedDays = days.filter((day) => day.fullyRecorded);
  const consecutiveRecordedDayStreak = longestConsecutiveRecordedDayStreak(recordedDays);
  const totalSuggestions = recordedDays.reduce((sum, day) => sum + day.aiSuggestions, 0);
  const adoptedSuggestions = recordedDays.reduce((sum, day) => sum + day.aiSuggestionsAdopted, 0);
  const reviewValues = recordedDays.map((day) => day.reviewValue).filter(Number.isInteger);
  return {
    days,
    recordedDays,
    hasAtLeastThreeRecordedDays: recordedDays.length >= 3,
    consecutiveRecordedDayStreak,
    hasThreeConsecutiveRecordedDays: consecutiveRecordedDayStreak >= 3,
    requiresConsecutiveRealWorkdayConfirmation: true,
    summary: {
      todayOpenCount: recordedDays.reduce((sum, day) => sum + day.todayOpenCount, 0),
      completedKnowledgeWork: recordedDays.reduce((sum, day) => sum + day.completedKnowledgeWork, 0),
      averageReviewValue: reviewValues.length
        ? reviewValues.reduce((sum, value) => sum + value, 0) / reviewValues.length
        : null,
      maintenanceMinutes: recordedDays.reduce((sum, day) => sum + day.maintenanceMinutes, 0),
      aiSuggestions: totalSuggestions,
      aiSuggestionsAdopted: adoptedSuggestions,
      aiSuggestionAdoptionRate: totalSuggestions > 0 ? adoptedSuggestions / totalSuggestions : null,
    },
  };
}
