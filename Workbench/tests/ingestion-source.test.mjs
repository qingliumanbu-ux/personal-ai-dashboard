import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngestionPayload,
  ingestionSourceLocation,
  ingestionSourceName,
} from "../src/lib/ingestion-source.js";

test("local video submissions keep the existing transcription options", () => {
  assert.deepEqual(
    buildIngestionPayload({
      sourceType: "local-video",
      value: "D:\\Sources\\clip.mp4",
      useVad: true,
      vadAvailable: true,
    }),
    {
      source_type: "local-video",
      source_path: "D:\\Sources\\clip.mp4",
      language: "zh",
      model: "small",
      vad: true,
    },
  );
});

test("web submissions send a URL without video-only options", () => {
  const job = {
    source_type: "web-page",
    source_path: null,
    source_url: "https://example.com/articles/knowledge",
  };

  assert.deepEqual(
    buildIngestionPayload({
      sourceType: "web-page",
      value: " https://example.com/articles/knowledge ",
      useVad: true,
      vadAvailable: true,
    }),
    {
      source_type: "web-page",
      source_url: "https://example.com/articles/knowledge",
    },
  );
  assert.equal(ingestionSourceName(job), "example.com");
  assert.equal(ingestionSourceLocation(job), job.source_url);
});
