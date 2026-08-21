export const TODAY_KNOWLEDGE_QUEUE_STORAGE_KEY = "workbench:knowledge-work:today:v1";
export const TODAY_KNOWLEDGE_QUEUE_VERSION = 1;

import {
  getWorkbenchDayState,
  loadWorkbenchStateStore,
  putWorkbenchDayState,
  saveWorkbenchStateStore,
} from "./workbench-state-store.js";

const STATUS_VALUES = new Set(["active", "completed", "skipped", "later"]);
const KIND_PRIORITY = Object.freeze({
  review_judgment: 10,
  add_evidence: 20,
  classify_source: 30,
  review_relation: 40,
  connect_isolated_knowledge: 50,
  review_knowledge: 60,
});

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyState(date = new Date()) {
  return {
    version: TODAY_KNOWLEDGE_QUEUE_VERSION,
    date: localDateKey(date),
    updatedAt: null,
    overrides: {},
    order: [],
    orderOverride: { userOverride: false, userConfirmed: false, source: null, updatedAt: null },
    focusHistory: [],
    events: [],
    usage: {
      todayOpenCount: 0,
      firstTodayOpenedAt: null,
      lastTodayOpenedAt: null,
    },
    review: {
      note: "",
      updatedAt: null,
      userAuthored: false,
      userOverride: false,
      userConfirmed: false,
      source: null,
    },
    evaluation: {
      reviewValue: null,
      maintenanceMinutes: null,
      updatedAt: null,
      userOverride: false,
      userConfirmed: false,
      source: null,
    },
  };
}

function safeWorkItemSnapshot(value) {
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

function safeOverride(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = STATUS_VALUES.has(value.status) ? value.status : "active";
  return {
    status,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    userOverride: true,
    userConfirmed: true,
    source: "user",
  };
}

export function normalizeTodayKnowledgeQueueState(value, date = new Date()) {
  const expectedDate = localDateKey(date);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== TODAY_KNOWLEDGE_QUEUE_VERSION ||
    value.date !== expectedDate
  ) {
    return emptyState(date);
  }

  const overrides = {};
  for (const [id, override] of Object.entries(value.overrides ?? {})) {
    if (!id || id.length > 1024) continue;
    const normalized = safeOverride(override);
    if (normalized) overrides[id] = normalized;
  }
  const seen = new Set();
  const order = Array.isArray(value.order)
    ? value.order.filter((id) => {
        if (typeof id !== "string" || !id || id.length > 1024 || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
    : [];
  const orderUpdatedAt =
    typeof value.orderOverride?.updatedAt === "string"
      ? value.orderOverride.updatedAt
      : typeof value.updatedAt === "string" && order.length > 0
        ? value.updatedAt
        : null;
  const orderOverride = {
    userOverride: value.orderOverride?.userOverride === true || order.length > 0,
    userConfirmed: value.orderOverride?.userConfirmed === true || order.length > 0,
    source: value.orderOverride?.source === "user" || order.length > 0 ? "user" : null,
    updatedAt: orderUpdatedAt,
  };
  const focusHistory = Array.isArray(value.focusHistory)
    ? value.focusHistory
        .filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof entry.workItemId === "string" &&
            entry.workItemId &&
            typeof entry.startedAt === "string",
        )
        .slice(-100)
        .map((entry) => ({
          workItemId: entry.workItemId,
          startedAt: entry.startedAt,
          exitedAt: typeof entry.exitedAt === "string" ? entry.exitedAt : null,
          outcome: STATUS_VALUES.has(entry.outcome) ? entry.outcome : "active",
          workItem: safeWorkItemSnapshot(entry.workItem),
        }))
    : [];
  const events = Array.isArray(value.events)
    ? value.events
        .filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof entry.type === "string" &&
            typeof entry.at === "string" &&
            typeof entry.workItemId === "string",
        )
        .slice(-200)
        .map((entry) => ({
          type: entry.type,
          at: entry.at,
          workItemId: entry.workItemId,
          outcome: STATUS_VALUES.has(entry.outcome) ? entry.outcome : null,
          workItem: safeWorkItemSnapshot(entry.workItem),
        }))
    : [];
  const reviewUpdatedAt = typeof value.review?.updatedAt === "string" ? value.review.updatedAt : null;
  const review = {
    note: typeof value.review?.note === "string" ? value.review.note.slice(0, 4000) : "",
    updatedAt: reviewUpdatedAt,
    userAuthored: value.review?.userAuthored === true || reviewUpdatedAt != null,
    userOverride: value.review?.userOverride === true || reviewUpdatedAt != null,
    userConfirmed: value.review?.userConfirmed === true || reviewUpdatedAt != null,
    source: value.review?.source === "user" || reviewUpdatedAt != null ? "user" : null,
  };
  const todayOpenCount = Number.isInteger(value.usage?.todayOpenCount)
    ? Math.min(100, Math.max(0, value.usage.todayOpenCount))
    : 0;
  const usage = {
    todayOpenCount,
    firstTodayOpenedAt: typeof value.usage?.firstTodayOpenedAt === "string" ? value.usage.firstTodayOpenedAt : null,
    lastTodayOpenedAt: typeof value.usage?.lastTodayOpenedAt === "string" ? value.usage.lastTodayOpenedAt : null,
  };
  const reviewValue = Number.isInteger(value.evaluation?.reviewValue)
    && value.evaluation.reviewValue >= 1
    && value.evaluation.reviewValue <= 5
    ? value.evaluation.reviewValue
    : null;
  const maintenanceMinutes = Number.isInteger(value.evaluation?.maintenanceMinutes)
    && value.evaluation.maintenanceMinutes >= 0
    && value.evaluation.maintenanceMinutes <= 1440
    ? value.evaluation.maintenanceMinutes
    : null;
  const evaluationUpdatedAt = typeof value.evaluation?.updatedAt === "string" ? value.evaluation.updatedAt : null;
  const evaluation = {
    reviewValue,
    maintenanceMinutes,
    updatedAt: evaluationUpdatedAt,
    userOverride: value.evaluation?.userOverride === true || evaluationUpdatedAt != null,
    userConfirmed: value.evaluation?.userConfirmed === true || evaluationUpdatedAt != null,
    source: value.evaluation?.source === "user" || evaluationUpdatedAt != null ? "user" : null,
  };
  return {
    version: TODAY_KNOWLEDGE_QUEUE_VERSION,
    date: expectedDate,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    overrides,
    order,
    orderOverride,
    focusHistory,
    events,
    usage,
    review,
    evaluation,
  };
}

export function loadTodayKnowledgeQueueState(storage = globalThis.localStorage, date = new Date()) {
  if (!storage) return emptyState(date);
  const expectedDate = localDateKey(date);
  const store = loadWorkbenchStateStore(storage);
  const stored = getWorkbenchDayState(store, expectedDate);
  if (stored) return normalizeTodayKnowledgeQueueState(stored, date);
  try {
    const raw = storage.getItem(TODAY_KNOWLEDGE_QUEUE_STORAGE_KEY);
    const legacy = raw ? JSON.parse(raw) : null;
    const normalized = normalizeTodayKnowledgeQueueState(legacy, date);
    if (legacy?.version === TODAY_KNOWLEDGE_QUEUE_VERSION && legacy?.date === expectedDate) {
      saveWorkbenchStateStore(
        putWorkbenchDayState(store, expectedDate, normalized, normalized.updatedAt),
        storage,
      );
    }
    return normalized;
  } catch {
    return emptyState(date);
  }
}

export function saveTodayKnowledgeQueueState(state, storage = globalThis.localStorage) {
  if (!storage) return state;
  try {
    const date = typeof state?.date === "string" ? state.date : localDateKey();
    const store = loadWorkbenchStateStore(storage);
    saveWorkbenchStateStore(
      putWorkbenchDayState(store, date, state, state?.updatedAt),
      storage,
    );
  } catch {
    // Today state is optional when browser storage is unavailable.
  }
  return state;
}

function defaultSort(left, right) {
  const priorityDifference =
    (KIND_PRIORITY[left.kind] ?? 999) - (KIND_PRIORITY[right.kind] ?? 999);
  if (priorityDifference) return priorityDifference;
  return String(left.id).localeCompare(String(right.id), "zh-CN");
}

export function buildTodayKnowledgeQueue(
  candidates,
  state,
  { limit = 5, date = new Date(), preferredIds = [] } = {},
) {
  const safeState = normalizeTodayKnowledgeQueueState(state, date);
  const sourceItems = Array.isArray(candidates) ? candidates : [];
  const byId = new Map(sourceItems.map((item) => [item.id, item]));
  const manualOrder = safeState.order.filter((id) => byId.has(id));
  const manualIndex = new Map(manualOrder.map((id, index) => [id, index]));
  const preferredOrder = Array.isArray(preferredIds)
    ? preferredIds.filter((id, index, all) => byId.has(id) && all.indexOf(id) === index)
    : [];
  const preferredIndex = new Map(preferredOrder.map((id, index) => [id, index]));
  const active = sourceItems
    .filter((item) => (safeState.overrides[item.id]?.status ?? "active") === "active")
    .sort((left, right) => {
      const leftManual = manualIndex.get(left.id);
      const rightManual = manualIndex.get(right.id);
      if (leftManual != null || rightManual != null) {
        if (leftManual == null) return 1;
        if (rightManual == null) return -1;
        return leftManual - rightManual;
      }
      const leftPreferred = preferredIndex.get(left.id);
      const rightPreferred = preferredIndex.get(right.id);
      if (leftPreferred != null || rightPreferred != null) {
        if (leftPreferred == null) return 1;
        if (rightPreferred == null) return -1;
        return leftPreferred - rightPreferred;
      }
      return defaultSort(left, right);
    });

  return {
    date: safeState.date,
    totalCandidates: sourceItems.length,
    visible: active.slice(0, Math.max(1, limit)),
    remaining: Math.max(0, active.length - Math.max(1, limit)),
    completed: Object.values(safeState.overrides).filter((item) => item.status === "completed").length,
    skipped: Object.values(safeState.overrides).filter((item) => item.status === "skipped").length,
    later: Object.values(safeState.overrides).filter((item) => item.status === "later").length,
  };
}

export function updateTodayKnowledgeQueueItem(state, itemId, status, now = new Date(), workItem = null) {
  if (!STATUS_VALUES.has(status)) throw new TypeError("Today queue status is invalid");
  const current = normalizeTodayKnowledgeQueueState(state, now);
  const timestamp = now.toISOString();
  const snapshot = safeWorkItemSnapshot(workItem);
  return {
    ...current,
    updatedAt: timestamp,
    overrides: {
      ...current.overrides,
      [itemId]: {
        status,
        updatedAt: timestamp,
        userOverride: true,
        userConfirmed: true,
        source: "user",
      },
    },
    events: [
      ...current.events,
      {
        type: "status_changed",
        at: timestamp,
        workItemId: itemId,
        outcome: status,
        workItem: snapshot,
      },
    ].slice(-200),
  };
}

export function moveTodayKnowledgeQueueItem(state, visibleIds, itemId, direction, now = new Date()) {
  if (!["up", "down"].includes(direction)) throw new TypeError("Today queue direction is invalid");
  const current = normalizeTodayKnowledgeQueueState(state, now);
  const order = [...visibleIds];
  const index = order.indexOf(itemId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= order.length) return current;
  [order[index], order[target]] = [order[target], order[index]];
  const untouched = current.order.filter((id) => !order.includes(id));
  return {
    ...current,
    updatedAt: now.toISOString(),
    order: [...order, ...untouched],
    orderOverride: {
      userOverride: true,
      userConfirmed: true,
      source: "user",
      updatedAt: now.toISOString(),
    },
  };
}

export function startTodayFocusSession(state, itemId, now = new Date(), workItem = null) {
  const current = normalizeTodayKnowledgeQueueState(state, now);
  const latest = current.focusHistory.at(-1);
  if (latest?.workItemId === itemId && !latest.exitedAt) return current;
  const timestamp = now.toISOString();
  const snapshot = safeWorkItemSnapshot(workItem);
  const focusHistory = [
    ...current.focusHistory,
    {
      workItemId: itemId,
      startedAt: timestamp,
      exitedAt: null,
      outcome: "active",
      workItem: snapshot,
    },
  ].slice(-100);
  const events = [
    ...current.events,
    {
      type: "focus_started",
      at: timestamp,
      workItemId: itemId,
      outcome: null,
      workItem: snapshot,
    },
  ].slice(-200);
  return { ...current, updatedAt: timestamp, focusHistory, events };
}

export function finishTodayFocusSession(
  state,
  itemId,
  outcome = "active",
  now = new Date(),
  workItem = null,
) {
  if (!STATUS_VALUES.has(outcome)) throw new TypeError("Focus outcome is invalid");
  const current = normalizeTodayKnowledgeQueueState(state, now);
  const timestamp = now.toISOString();
  const snapshot = safeWorkItemSnapshot(workItem);
  const focusHistory = [...current.focusHistory];
  for (let index = focusHistory.length - 1; index >= 0; index -= 1) {
    const entry = focusHistory[index];
    if (entry.workItemId === itemId && !entry.exitedAt) {
      focusHistory[index] = {
        ...entry,
        exitedAt: timestamp,
        outcome,
        workItem: snapshot ?? entry.workItem ?? null,
      };
      const events = [
        ...current.events,
        {
          type: "focus_finished",
          at: timestamp,
          workItemId: itemId,
          outcome,
          workItem: snapshot ?? entry.workItem ?? null,
        },
      ].slice(-200);
      return { ...current, updatedAt: timestamp, focusHistory, events };
    }
  }
  focusHistory.push({
    workItemId: itemId,
    startedAt: timestamp,
    exitedAt: timestamp,
    outcome,
    workItem: snapshot,
  });
  const events = [
    ...current.events,
    {
      type: "focus_finished",
      at: timestamp,
      workItemId: itemId,
      outcome,
      workItem: snapshot,
    },
  ].slice(-200);
  return {
    ...current,
    updatedAt: timestamp,
    focusHistory: focusHistory.slice(-100),
    events,
  };
}

export function updateDailyReviewNote(state, note, now = new Date()) {
  if (typeof note !== "string") throw new TypeError("Daily review note must be a string");
  const current = normalizeTodayKnowledgeQueueState(state, now);
  const timestamp = now.toISOString();
  return {
    ...current,
    updatedAt: timestamp,
    review: {
      note: note.slice(0, 4000),
      updatedAt: timestamp,
      userAuthored: true,
      userOverride: true,
      userConfirmed: true,
      source: "user",
    },
  };
}

export function recordTodayKnowledgeQueueVisit(state, now = new Date(), { dedupeMs = 30_000 } = {}) {
  const current = normalizeTodayKnowledgeQueueState(state, now);
  const timestamp = now.toISOString();
  const previousAt = Date.parse(current.usage.lastTodayOpenedAt || "");
  if (Number.isFinite(previousAt) && Math.abs(now.getTime() - previousAt) < Math.max(0, dedupeMs)) {
    return current;
  }
  return {
    ...current,
    updatedAt: timestamp,
    usage: {
      todayOpenCount: Math.min(100, current.usage.todayOpenCount + 1),
      firstTodayOpenedAt: current.usage.firstTodayOpenedAt || timestamp,
      lastTodayOpenedAt: timestamp,
    },
  };
}

export function updateDailyReviewEvaluation(state, patch, now = new Date()) {
  const current = normalizeTodayKnowledgeQueueState(state, now);
  const nextReviewValue = patch?.reviewValue === undefined ? current.evaluation.reviewValue : patch.reviewValue;
  const nextMaintenanceMinutes = patch?.maintenanceMinutes === undefined
    ? current.evaluation.maintenanceMinutes
    : patch.maintenanceMinutes;
  if (nextReviewValue !== null && (!Number.isInteger(nextReviewValue) || nextReviewValue < 1 || nextReviewValue > 5)) {
    throw new TypeError("Daily review value must be an integer from 1 to 5 or null");
  }
  if (
    nextMaintenanceMinutes !== null
    && (!Number.isInteger(nextMaintenanceMinutes) || nextMaintenanceMinutes < 0 || nextMaintenanceMinutes > 1440)
  ) {
    throw new TypeError("Daily maintenance minutes must be an integer from 0 to 1440 or null");
  }
  const timestamp = now.toISOString();
  return {
    ...current,
    updatedAt: timestamp,
    evaluation: {
      reviewValue: nextReviewValue,
      maintenanceMinutes: nextMaintenanceMinutes,
      updatedAt: timestamp,
      userOverride: true,
      userConfirmed: true,
      source: "user",
    },
  };
}
