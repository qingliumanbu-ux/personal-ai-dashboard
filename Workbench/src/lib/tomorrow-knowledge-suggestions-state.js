export const TOMORROW_SUGGESTIONS_STORAGE_KEY = "workbench:knowledge-work:tomorrow:v1";
export const TOMORROW_SUGGESTIONS_VERSION = 1;

import {
  getTomorrowCycleForTargetDate,
  getTomorrowCycleState,
  loadWorkbenchStateStore,
  putTomorrowCycleState,
  saveWorkbenchStateStore,
  workbenchDateKey,
} from "./workbench-state-store.js";

const STATUS_VALUES = new Set(["candidate", "confirmed", "rejected", "deleted"]);
const MAX_ITEMS = 12;

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextDateKey(date = new Date()) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return dateKey(next);
}

function emptyState(date = new Date()) {
  return {
    version: TOMORROW_SUGGESTIONS_VERSION,
    sourceDate: dateKey(date),
    targetDate: nextDateKey(date),
    generatedAt: null,
    updatedAt: null,
    reviewContext: "",
    rulesContext: { version: 1, visibleRuleCount: 0, enabledRuleCount: 0, rules: [] },
    items: [],
  };
}

function safeRulesContext(value) {
  const rules = Array.isArray(value?.rules)
    ? value.rules
        .filter((rule) => rule && typeof rule === "object")
        .map((rule) => ({
          id: typeof rule.id === "string" ? rule.id.slice(0, 160) : "",
          title: typeof rule.title === "string" ? rule.title.slice(0, 80) : "",
          body: typeof rule.body === "string" ? rule.body.slice(0, 500) : "",
        }))
        .filter((rule) => rule.id && rule.title && rule.body)
        .slice(0, 10)
    : [];
  return {
    version: 1,
    visibleRuleCount: Number.isInteger(value?.visibleRuleCount) ? Math.max(0, value.visibleRuleCount) : rules.length,
    enabledRuleCount: rules.length,
    rules,
  };
}

function safeWorkItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const kind = typeof value.kind === "string" ? value.kind.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const documentId = typeof value.source?.documentId === "string" ? value.source.documentId.trim() : "";
  const path = typeof value.source?.path === "string" ? value.source.path.trim() : "";
  if (!id || !kind || !title || !documentId || !path) return null;
  return {
    id,
    kind,
    title,
    reason: typeof value.reason === "string" ? value.reason.trim() : "",
    source: {
      documentId,
      path,
      title: typeof value.source?.title === "string" ? value.source.title.trim() : title,
      layer: value.source?.layer === "wiki" ? "wiki" : "raw",
    },
  };
}

function safeItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const workItem = safeWorkItem(value.workItem);
  if (!workItem) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) return null;
  return {
    id,
    workItemId: workItem.id,
    workItem,
    reason: typeof value.reason === "string" ? value.reason.trim() : "",
    sourceState: typeof value.sourceState === "string" ? value.sourceState : "active",
    planText: typeof value.planText === "string" ? value.planText.slice(0, 500) : `继续：${workItem.title}`,
    status: STATUS_VALUES.has(value.status) ? value.status : "candidate",
    userEdited: value.userEdited === true,
    userOverride:
      value.userOverride === true ||
      value.userEdited === true ||
      ["confirmed", "rejected", "deleted"].includes(value.status),
    userConfirmed:
      value.userConfirmed === true ||
      value.userEdited === true ||
      ["confirmed", "rejected", "deleted"].includes(value.status),
    overrideSource:
      value.overrideSource === "user" ||
      value.userEdited === true ||
      ["confirmed", "rejected", "deleted"].includes(value.status)
        ? "user"
        : null,
    confirmedAt: typeof value.confirmedAt === "string" ? value.confirmedAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function normalizeTomorrowSuggestionsState(value, date = new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyState(date);
  const sourceDate = typeof value.sourceDate === "string" ? value.sourceDate : "";
  const targetDate = typeof value.targetDate === "string" ? value.targetDate : "";
  if (!sourceDate || !targetDate || value.version !== TOMORROW_SUGGESTIONS_VERSION) {
    return emptyState(date);
  }
  return {
    version: TOMORROW_SUGGESTIONS_VERSION,
    sourceDate,
    targetDate,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    reviewContext: typeof value.reviewContext === "string" ? value.reviewContext.slice(0, 1000) : "",
    rulesContext: safeRulesContext(value.rulesContext),
    items: Array.isArray(value.items) ? value.items.map(safeItem).filter(Boolean).slice(0, MAX_ITEMS) : [],
  };
}

export function loadTomorrowSuggestionsState(storage = globalThis.localStorage, date = new Date()) {
  if (!storage) return emptyState(date);
  const store = loadWorkbenchStateStore(storage);
  const sourceDate = dateKey(date);
  const stored = getTomorrowCycleState(store, sourceDate);
  if (stored) return normalizeTomorrowSuggestionsState(stored, date);
  try {
    const raw = storage.getItem(TOMORROW_SUGGESTIONS_STORAGE_KEY);
    const legacy = raw ? JSON.parse(raw) : null;
    const normalized = normalizeTomorrowSuggestionsState(legacy, date);
    if (legacy?.version === TOMORROW_SUGGESTIONS_VERSION && legacy?.sourceDate === sourceDate) {
      saveWorkbenchStateStore(
        putTomorrowCycleState(store, normalized, normalized.updatedAt),
        storage,
      );
    }
    return normalized.sourceDate === sourceDate ? normalized : emptyState(date);
  } catch {
    return emptyState(date);
  }
}

export function saveTomorrowSuggestionsState(state, storage = globalThis.localStorage) {
  if (!storage) return state;
  try {
    const store = loadWorkbenchStateStore(storage);
    saveWorkbenchStateStore(
      putTomorrowCycleState(store, state, state?.updatedAt),
      storage,
    );
  } catch {
    // Tomorrow suggestions are optional when browser storage is unavailable.
  }
  return state;
}

export function loadTomorrowSuggestionsForTargetDate(
  storage = globalThis.localStorage,
  date = new Date(),
) {
  const targetDate = workbenchDateKey(date);
  if (!storage) return emptyState(new Date(date.getTime() - 24 * 60 * 60 * 1000));
  const store = loadWorkbenchStateStore(storage);
  const stored = getTomorrowCycleForTargetDate(store, targetDate);
  if (stored) return normalizeTomorrowSuggestionsState(stored, date);
  try {
    const raw = storage.getItem(TOMORROW_SUGGESTIONS_STORAGE_KEY);
    const legacy = raw ? JSON.parse(raw) : null;
    const normalized = normalizeTomorrowSuggestionsState(legacy, date);
    if (legacy?.version === TOMORROW_SUGGESTIONS_VERSION && normalized.targetDate === targetDate) {
      saveWorkbenchStateStore(
        putTomorrowCycleState(store, normalized, normalized.updatedAt),
        storage,
      );
      return normalized;
    }
  } catch {
    // Ignore malformed legacy Workbench state.
  }
  const sourceDate = new Date(date);
  sourceDate.setDate(sourceDate.getDate() - 1);
  return emptyState(sourceDate);
}

function reasonFor(sourceState) {
  if (sourceState === "later") return "今天明确选择了稍后处理，明天可继续推进。";
  if (sourceState === "completed_unverified") return "今天标记完成，但当前显式触发条件仍存在。";
  if (sourceState === "skipped") return "今天跳过了这项真实知识工作，明天是否继续由你决定。";
  return "这项真实知识工作今天仍未解决。";
}

function reviewPool(review) {
  return [
    ...(review?.deferred ?? []).map((item) => ({ item, sourceState: "later", priority: 10 })),
    ...(review?.unverifiedCompletions ?? []).map((item) => ({ item, sourceState: "completed_unverified", priority: 20 })),
    ...(review?.active ?? []).map((item) => ({ item, sourceState: "active", priority: 30 })),
    ...(review?.skipped ?? []).map((item) => ({ item, sourceState: "skipped", priority: 40 })),
  ];
}

export function buildTomorrowSuggestions(
  review,
  candidates,
  persistedState,
  { now = new Date(), limit = 8, rulesContext = null } = {},
) {
  const sourceDate = dateKey(now);
  const targetDate = nextDateKey(now);
  const previous = normalizeTomorrowSuggestionsState(persistedState, now);
  const sameCycle = previous.sourceDate === sourceDate && previous.targetDate === targetDate;
  const previousByWorkItem = new Map(
    (sameCycle ? previous.items : []).map((item) => [item.workItemId, item]),
  );
  const candidateById = new Map((Array.isArray(candidates) ? candidates : []).map((item) => [item.id, item]));
  const seen = new Set();
  const pool = reviewPool(review)
    .filter(({ item }) => item?.workItemId && candidateById.has(item.workItemId))
    .sort((left, right) => left.priority - right.priority || String(left.item.workItemId).localeCompare(String(right.item.workItemId), "zh-CN"));
  const items = [];

  for (const entry of pool) {
    if (items.length >= Math.max(1, limit) || seen.has(entry.item.workItemId)) continue;
    seen.add(entry.item.workItemId);
    const currentWorkItem = safeWorkItem(candidateById.get(entry.item.workItemId));
    if (!currentWorkItem) continue;
    const previousItem = previousByWorkItem.get(currentWorkItem.id);
    items.push({
      id: `tomorrow:v1:${sourceDate}:${currentWorkItem.id}`,
      workItemId: currentWorkItem.id,
      workItem: currentWorkItem,
      reason: reasonFor(entry.sourceState),
      sourceState: entry.sourceState,
      planText: previousItem?.userEdited ? previousItem.planText : `继续：${currentWorkItem.title}`,
      status: previousItem?.status ?? "candidate",
      userEdited: previousItem?.userEdited === true,
      userOverride: previousItem?.userOverride === true,
      userConfirmed: previousItem?.userConfirmed === true,
      overrideSource: previousItem?.overrideSource === "user" ? "user" : null,
      confirmedAt: previousItem?.confirmedAt ?? null,
      updatedAt: previousItem?.updatedAt ?? null,
    });
  }

  const timestamp = now.toISOString();
  return {
    version: TOMORROW_SUGGESTIONS_VERSION,
    sourceDate,
    targetDate,
    generatedAt: sameCycle ? previous.generatedAt ?? timestamp : timestamp,
    updatedAt: sameCycle ? previous.updatedAt : null,
    reviewContext: typeof review?.note === "string" ? review.note.trim().slice(0, 1000) : "",
    rulesContext: safeRulesContext(rulesContext),
    items,
  };
}

export function updateTomorrowSuggestion(state, suggestionId, patch, now = new Date()) {
  const current = normalizeTomorrowSuggestionsState(state, now);
  const timestamp = now.toISOString();
  const items = current.items.map((item) => {
    if (item.id !== suggestionId) return item;
    const next = { ...item, updatedAt: timestamp };
    if (typeof patch?.planText === "string") {
      next.planText = patch.planText.slice(0, 500);
      next.userEdited = true;
      next.userOverride = true;
      next.userConfirmed = true;
      next.overrideSource = "user";
    }
    if (patch?.status != null) {
      if (!STATUS_VALUES.has(patch.status)) throw new TypeError("Tomorrow suggestion status is invalid");
      next.status = patch.status;
      next.confirmedAt = patch.status === "confirmed" ? timestamp : null;
      next.userOverride = true;
      next.userConfirmed = true;
      next.overrideSource = "user";
    }
    return next;
  });
  return { ...current, updatedAt: timestamp, items };
}

export function rejectAllTomorrowSuggestions(state, now = new Date()) {
  const current = normalizeTomorrowSuggestionsState(state, now);
  const timestamp = now.toISOString();
  return {
    ...current,
    updatedAt: timestamp,
    items: current.items.map((item) => ({
      ...item,
      status: "rejected",
      confirmedAt: null,
      userOverride: true,
      userConfirmed: false,
      overrideSource: "user",
      updatedAt: timestamp,
    })),
  };
}

export function deleteTomorrowSuggestion(state, suggestionId, now = new Date()) {
  return updateTomorrowSuggestion(state, suggestionId, { status: "deleted" }, now);
}

export function confirmedTomorrowWorkItemIds(state, date = new Date()) {
  const current = normalizeTomorrowSuggestionsState(state, date);
  if (current.targetDate !== dateKey(date)) return [];
  return current.items
    .filter((item) => item.status === "confirmed")
    .map((item) => item.workItemId);
}
