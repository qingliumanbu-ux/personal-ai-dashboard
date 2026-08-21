export const P2_ADMISSION_STORAGE_KEY = "workbench:p2-admission:v1";
export const P2_ADMISSION_VERSION = 1;

function emptyState() {
  return {
    version: P2_ADMISSION_VERSION,
    decision: "pending",
    note: "",
    decidedAt: null,
    updatedAt: null,
    userOverride: false,
    userConfirmed: false,
    source: null,
    snapshot: null,
    history: [],
  };
}

function cleanText(value, maxLength = 1200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const number = (field) => Number.isInteger(value[field]) && value[field] >= 0 ? value[field] : 0;
  return {
    totalRaw: number("totalRaw"),
    reviewedSummaryCount: number("reviewedSummaryCount"),
    classificationCompleteCount: number("classificationCompleteCount"),
    reuseSignalCount: number("reuseSignalCount"),
    duplicateGroupCount: number("duplicateGroupCount"),
    snapshotFingerprint: cleanText(value.snapshotFingerprint, 160),
    sourceTypes: Array.isArray(value.sourceTypes)
      ? value.sourceTypes
          .filter((item) => item && typeof item.value === "string" && Number.isInteger(item.count))
          .slice(0, 20)
          .map((item) => ({ value: cleanText(item.value, 80), count: Math.max(0, item.count) }))
      : [],
  };
}

export function p2AdmissionSnapshotDrift(state, currentSnapshot) {
  const current = normalizeP2AdmissionState(state);
  const latest = normalizeSnapshot(currentSnapshot);
  if (!current.snapshot || !latest) return { drifted: false, reason: null };
  const previousFingerprint = current.snapshot.snapshotFingerprint;
  const nextFingerprint = latest.snapshotFingerprint;
  if (previousFingerprint && nextFingerprint && previousFingerprint !== nextFingerprint) {
    return { drifted: true, reason: "snapshot_fingerprint_changed" };
  }
  const comparableFields = [
    "totalRaw",
    "reviewedSummaryCount",
    "classificationCompleteCount",
    "reuseSignalCount",
    "duplicateGroupCount",
  ];
  const drifted = comparableFields.some((field) => current.snapshot[field] !== latest[field]);
  return { drifted, reason: drifted ? "snapshot_metrics_changed" : null };
}

export function normalizeP2AdmissionState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== P2_ADMISSION_VERSION) {
    return emptyState();
  }
  const decision = ["approved", "deferred"].includes(value.decision) ? value.decision : "pending";
  const decidedAt = typeof value.decidedAt === "string" ? value.decidedAt : null;
  return {
    version: P2_ADMISSION_VERSION,
    decision,
    note: cleanText(value.note),
    decidedAt,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : decidedAt,
    userOverride: value.userOverride === true || decision !== "pending",
    userConfirmed: value.userConfirmed === true || decision !== "pending",
    source: value.source === "user" || decision !== "pending" ? "user" : null,
    snapshot: normalizeSnapshot(value.snapshot),
    history: Array.isArray(value.history)
      ? value.history
          .filter((item) => item && typeof item === "object" && !Array.isArray(item))
          .slice(-20)
          .map((item) => ({
            decision: ["approved", "deferred", "reset"].includes(item.decision) ? item.decision : "reset",
            note: cleanText(item.note),
            decidedAt: typeof item.decidedAt === "string" ? item.decidedAt : null,
            source: "user",
            snapshot: normalizeSnapshot(item.snapshot),
          }))
      : [],
  };
}

export function loadP2AdmissionState(storage = globalThis.localStorage) {
  if (!storage) return emptyState();
  try {
    const raw = storage.getItem(P2_ADMISSION_STORAGE_KEY);
    return normalizeP2AdmissionState(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyState();
  }
}

export function saveP2AdmissionState(state, storage = globalThis.localStorage) {
  const current = normalizeP2AdmissionState(state);
  if (!storage) return current;
  try {
    storage.setItem(P2_ADMISSION_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Admission state remains browser-local when storage is unavailable.
  }
  return current;
}

export function decideP2Admission(state, { decision, note = "", snapshot, confirm = false } = {}, now = new Date()) {
  const current = normalizeP2AdmissionState(state);
  if (!["approved", "deferred"].includes(decision)) {
    throw new TypeError("P2 admission decision must be approved or deferred");
  }
  if (confirm !== true) {
    throw new TypeError("P2 admission decision requires explicit user confirmation");
  }
  const normalizedSnapshot = normalizeSnapshot(snapshot);
  if (decision === "approved" && (!normalizedSnapshot || normalizedSnapshot.totalRaw < 1)) {
    throw new TypeError("P2 cannot be approved without at least one real Raw source record");
  }
  const timestamp = now.toISOString();
  const history = [
    ...current.history,
    {
      decision,
      note: cleanText(note),
      decidedAt: timestamp,
      source: "user",
      snapshot: normalizedSnapshot,
    },
  ].slice(-20);
  return {
    ...current,
    decision,
    note: cleanText(note),
    decidedAt: timestamp,
    updatedAt: timestamp,
    userOverride: true,
    userConfirmed: true,
    source: "user",
    snapshot: normalizedSnapshot,
    history,
  };
}

export function resetP2AdmissionDecision(state, now = new Date()) {
  const current = normalizeP2AdmissionState(state);
  const timestamp = now.toISOString();
  return {
    ...emptyState(),
    updatedAt: timestamp,
    note: current.note,
    history: [
      ...current.history,
      {
        decision: "reset",
        note: current.note,
        decidedAt: timestamp,
        source: "user",
        snapshot: current.snapshot,
      },
    ].slice(-20),
  };
}

export function p2AdmissionAllowsExtraction(state) {
  const current = normalizeP2AdmissionState(state);
  return current.decision === "approved" && current.userConfirmed === true && current.source === "user";
}

export function p2AdmissionAllowsExtractionForSnapshot(state, currentSnapshot) {
  if (!p2AdmissionAllowsExtraction(state)) return false;
  return p2AdmissionSnapshotDrift(state, currentSnapshot).drifted === false;
}
