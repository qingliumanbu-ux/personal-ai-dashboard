import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decideP2Admission,
  normalizeP2AdmissionState,
  p2AdmissionAllowsExtraction,
  p2AdmissionAllowsExtractionForSnapshot,
  p2AdmissionSnapshotDrift,
  resetP2AdmissionDecision,
} from "../src/lib/p2-admission-state.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = {
  totalRaw: 4,
  reviewedSummaryCount: 2,
  classificationCompleteCount: 3,
  reuseSignalCount: 2,
  duplicateGroupCount: 1,
  snapshotFingerprint: "snapshot-a",
  sourceTypes: [{ value: "web-page", count: 2 }, { value: "douyin-video", count: 2 }],
};

test("P2 remains blocked until an explicit user-confirmed approval exists", () => {
  const initial = normalizeP2AdmissionState(null);
  assert.equal(initial.decision, "pending");
  assert.equal(p2AdmissionAllowsExtraction(initial), false);
  assert.throws(
    () => decideP2Admission(initial, { decision: "approved", snapshot: SNAPSHOT }),
    /explicit user confirmation/,
  );
  const approved = decideP2Admission(
    initial,
    { decision: "approved", snapshot: SNAPSHOT, confirm: true, note: "当前真实 Raw 足以开始小样本评测。" },
    new Date("2026-08-18T14:30:00.000Z"),
  );
  assert.equal(approved.userOverride, true);
  assert.equal(approved.userConfirmed, true);
  assert.equal(approved.source, "user");
  assert.equal(p2AdmissionAllowsExtraction(approved), true);
  assert.equal(approved.history.length, 1);
  assert.equal(approved.history[0].decision, "approved");
});

test("approved admission is blocked again when the real Raw snapshot drifts", () => {
  const approved = decideP2Admission(
    null,
    { decision: "approved", snapshot: SNAPSHOT, confirm: true },
  );
  assert.deepEqual(p2AdmissionSnapshotDrift(approved, SNAPSHOT), { drifted: false, reason: null });
  assert.equal(p2AdmissionAllowsExtractionForSnapshot(approved, SNAPSHOT), true);
  const changed = { ...SNAPSHOT, totalRaw: 5, snapshotFingerprint: "snapshot-b" };
  assert.deepEqual(
    p2AdmissionSnapshotDrift(approved, changed),
    { drifted: true, reason: "snapshot_fingerprint_changed" },
  );
  assert.equal(p2AdmissionAllowsExtractionForSnapshot(approved, changed), false);
});

test("deferring P2 is a durable user decision and never authorizes extraction", () => {
  const deferred = decideP2Admission(
    null,
    { decision: "deferred", snapshot: SNAPSHOT, confirm: true, note: "继续积累来源。" },
  );
  assert.equal(deferred.decision, "deferred");
  assert.equal(p2AdmissionAllowsExtraction(deferred), false);
});

test("P2 approval fails closed when no real Raw exists", () => {
  assert.throws(
    () => decideP2Admission(null, { decision: "approved", snapshot: { ...SNAPSHOT, totalRaw: 0 }, confirm: true }),
    /at least one real Raw/,
  );
});

test("resetting admission revokes approval and keeps an audit entry", () => {
  const approved = decideP2Admission(
    null,
    { decision: "approved", snapshot: SNAPSHOT, confirm: true, note: "先做小样本评测。" },
  );
  const reset = resetP2AdmissionDecision(approved, new Date("2026-08-18T15:00:00.000Z"));
  assert.equal(reset.decision, "pending");
  assert.equal(p2AdmissionAllowsExtraction(reset), false);
  assert.equal(reset.history.length, 2);
  assert.equal(reset.history.at(-1).decision, "reset");
});

test("P2 admission state is browser-local and contains no Vault or network mutation", () => {
  const source = readFileSync(join(ROOT, "src/lib/p2-admission-state.js"), "utf8");
  assert.doesNotMatch(source, /fetch\(|\/api\/|Vault|wiki-ingest|workspace-write/);
});
