export const WORKBENCH_STATE_STORAGE_KEY = "workbench:knowledge-work:state:v1";
export const WORKBENCH_STATE_VERSION = 1;

const LEGACY_WORKBENCH_STORAGE_KEYS = Object.freeze([
  "workbench:knowledge-work:today:v1",
  "workbench:knowledge-work:tomorrow:v1",
]);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAILY_RECORDS = 90;
const MAX_TOMORROW_CYCLES = 90;

function emptyStore() {
  return {
    version: WORKBENCH_STATE_VERSION,
    updatedAt: null,
    days: {},
    tomorrowCycles: {},
  };
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function recentKeys(record, limit) {
  return Object.keys(record)
    .filter((key) => DATE_KEY_PATTERN.test(key))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, limit);
}

function pruneRecord(record, limit) {
  const next = {};
  recentKeys(record, limit).forEach((key) => {
    next[key] = record[key];
  });
  return next;
}

export function workbenchDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeWorkbenchStateStore(value) {
  if (!isRecord(value) || value.version !== WORKBENCH_STATE_VERSION) return emptyStore();

  const days = {};
  if (isRecord(value.days)) {
    for (const [date, record] of Object.entries(value.days)) {
      if (!DATE_KEY_PATTERN.test(date) || !isRecord(record) || !isRecord(record.today)) continue;
      days[date] = {
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
        today: record.today,
      };
    }
  }

  const tomorrowCycles = {};
  if (isRecord(value.tomorrowCycles)) {
    for (const [sourceDate, cycle] of Object.entries(value.tomorrowCycles)) {
      if (!DATE_KEY_PATTERN.test(sourceDate) || !isRecord(cycle)) continue;
      tomorrowCycles[sourceDate] = cycle;
    }
  }

  return {
    version: WORKBENCH_STATE_VERSION,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    days: pruneRecord(days, MAX_DAILY_RECORDS),
    tomorrowCycles: pruneRecord(tomorrowCycles, MAX_TOMORROW_CYCLES),
  };
}

export function loadWorkbenchStateStore(storage = globalThis.localStorage) {
  if (!storage) return emptyStore();
  try {
    const raw = storage.getItem(WORKBENCH_STATE_STORAGE_KEY);
    return normalizeWorkbenchStateStore(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyStore();
  }
}

export function saveWorkbenchStateStore(state, storage = globalThis.localStorage) {
  const normalized = normalizeWorkbenchStateStore(state);
  if (!storage) return normalized;
  try {
    storage.setItem(WORKBENCH_STATE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Workbench state remains optional when browser storage is unavailable.
  }
  return normalized;
}

export function getWorkbenchDayState(store, date) {
  if (!DATE_KEY_PATTERN.test(date)) return null;
  return normalizeWorkbenchStateStore(store).days[date]?.today ?? null;
}

export function putWorkbenchDayState(store, date, todayState, updatedAt = null) {
  if (!DATE_KEY_PATTERN.test(date) || !isRecord(todayState)) {
    throw new TypeError("Workbench day state requires a valid local date and Today state");
  }
  const current = normalizeWorkbenchStateStore(store);
  const timestamp = typeof updatedAt === "string" && updatedAt ? updatedAt : new Date().toISOString();
  const days = pruneRecord(
    {
      ...current.days,
      [date]: { today: todayState, updatedAt: timestamp },
    },
    MAX_DAILY_RECORDS,
  );
  return {
    ...current,
    updatedAt: timestamp,
    days,
  };
}

export function getTomorrowCycleState(store, sourceDate) {
  if (!DATE_KEY_PATTERN.test(sourceDate)) return null;
  return normalizeWorkbenchStateStore(store).tomorrowCycles[sourceDate] ?? null;
}

export function getTomorrowCycleForTargetDate(store, targetDate) {
  if (!DATE_KEY_PATTERN.test(targetDate)) return null;
  const current = normalizeWorkbenchStateStore(store);
  return Object.keys(current.tomorrowCycles)
    .sort((left, right) => right.localeCompare(left))
    .map((sourceDate) => current.tomorrowCycles[sourceDate])
    .find((cycle) => cycle?.targetDate === targetDate) ?? null;
}

export function putTomorrowCycleState(store, cycle, updatedAt = null) {
  if (!isRecord(cycle) || !DATE_KEY_PATTERN.test(cycle.sourceDate || "")) {
    throw new TypeError("Tomorrow cycle requires a valid sourceDate");
  }
  const current = normalizeWorkbenchStateStore(store);
  const timestamp = typeof updatedAt === "string" && updatedAt
    ? updatedAt
    : typeof cycle.updatedAt === "string" && cycle.updatedAt
      ? cycle.updatedAt
      : new Date().toISOString();
  const tomorrowCycles = pruneRecord(
    {
      ...current.tomorrowCycles,
      [cycle.sourceDate]: cycle,
    },
    MAX_TOMORROW_CYCLES,
  );
  return {
    ...current,
    updatedAt: timestamp,
    tomorrowCycles,
  };
}

export function clearWorkbenchStateStore(storage = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.removeItem(WORKBENCH_STATE_STORAGE_KEY);
    LEGACY_WORKBENCH_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
  } catch {
    // Clearing Workbench state is best-effort and never touches Vault data.
  }
}
