import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateSummarySaveLabel,
  ingestionRefreshDelay,
  MEDIA_RETENTION_OPTIONS,
  mediaRetentionStatusLabel,
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

test("media retention exposes three explicit policies and honest states", () => {
  assert.deepEqual(
    MEDIA_RETENTION_OPTIONS.map((option) => option.value),
    ["delete_now", "keep_30_days", "keep_forever"],
  );
  assert.equal(mediaRetentionStatusLabel({ state: "unconfigured" }), "尚未选择");
  assert.equal(mediaRetentionStatusLabel({ state: "retained" }), "正在保留");
  assert.equal(mediaRetentionStatusLabel({ state: "due" }), "已到期，等待手动清理");
  assert.equal(mediaRetentionStatusLabel({ state: "cleaned" }), "临时视频已清理");
});
