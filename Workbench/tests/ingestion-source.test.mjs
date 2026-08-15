import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngestionPayload,
  ingestionCaptureContext,
  ingestionSourceLocation,
  ingestionSourceName,
  parseCaptureTags,
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
      value: " 收藏内容 https://example.com/articles/knowledge 稍后阅读 ",
      useVad: true,
      vadAvailable: true,
      captureTags: "AI，Obsidian, AI",
      captureReason: " 作为采集流程参考 ",
    }),
    {
      source_type: "web-page",
      source_text: "收藏内容 https://example.com/articles/knowledge 稍后阅读",
      tags: ["AI", "Obsidian"],
      capture_reason: "作为采集流程参考",
    },
  );
  assert.equal(ingestionSourceName(job), "example.com");
  assert.equal(ingestionSourceLocation(job), job.source_url);
});

test("douyin submissions keep share text and local transcription options", () => {
  const job = {
    source_type: "douyin",
    source_path: null,
    source_url: "https://v.douyin.com/AbCdEf12/",
  };

  assert.deepEqual(
    buildIngestionPayload({
      sourceType: "douyin",
      value: " 复制打开抖音 https://v.douyin.com/AbCdEf12/ 看完整视频 ",
      useVad: true,
      vadAvailable: true,
      captureTags: "知识库, 抖音",
      captureReason: "稍后审核",
    }),
    {
      source_type: "douyin",
      source_text: "复制打开抖音 https://v.douyin.com/AbCdEf12/ 看完整视频",
      language: "zh",
      model: "small",
      vad: true,
      tags: ["知识库", "抖音"],
      capture_reason: "稍后审核",
    },
  );
  assert.equal(ingestionSourceName(job), "抖音视频");
  assert.equal(ingestionSourceLocation(job), job.source_url);
});

test("capture context is normalized for submission and display", () => {
  assert.deepEqual(parseCaptureTags("AI，Obsidian\nAI；网页"), [
    "AI",
    "Obsidian",
    "网页",
  ]);
  assert.deepEqual(
    ingestionCaptureContext({
      params: {
        capture_tags: '["AI", "Obsidian"]',
        capture_reason: "保留采集入口设计",
        capture_text: "分享文案 https://example.com/article",
      },
    }),
    {
      tags: ["AI", "Obsidian"],
      reason: "保留采集入口设计",
      sharedText: "分享文案 https://example.com/article",
    },
  );
});
