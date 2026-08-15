import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateSummarySaveLabel,
  ingestionRefreshDelay,
} from "../src/lib/ingestion-ui.js";

test("candidate summary save gives immediate progress feedback", () => {
  assert.equal(candidateSummarySaveLabel(true, true), "保存中…");
  assert.equal(candidateSummarySaveLabel(false, true), "保存修改");
  assert.equal(candidateSummarySaveLabel(false, false), "保存候选摘要");
});

test("ingestion polling stays fast only while a job is active", () => {
  assert.equal(ingestionRefreshDelay({ status: "queued" }), 1_500);
  assert.equal(ingestionRefreshDelay({ status: "running" }), 1_500);
  assert.equal(ingestionRefreshDelay({ status: "waiting_review" }), 15_000);
  assert.equal(ingestionRefreshDelay({ status: "succeeded" }), 15_000);
  assert.equal(ingestionRefreshDelay({ status: "succeeded", publication: {} }), 15_000);
  assert.equal(ingestionRefreshDelay(null), 15_000);
});
