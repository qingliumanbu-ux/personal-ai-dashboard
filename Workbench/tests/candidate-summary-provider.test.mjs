import assert from "node:assert/strict";
import test from "node:test";

import {
  createCandidateSummaryProvider,
  validateCandidateSummaryMarkdown,
} from "../server/candidate-summary-provider.mjs";

const VALID = `## AI 候选摘要

这是一份候选摘要。

## 核心要点

- 要点一

## 建议标签

- AI

## 可复用方向

用于后续学习。

## 不确定内容

暂未发现。

## 建议领域

AI与智能体

## 建议内容类型

观点

## 建议用途

学习`;

test("candidate summary provider returns a reviewable draft without saving it", async () => {
  let invocation = null;
  const provider = createCandidateSummaryProvider({
    detectImpl: async () => ({ available: true, executablePath: "/fake/codex" }),
    runCommand: async (request) => {
      invocation = request;
      return { exitCode: 0, resultText: VALID, stdout: "", stderr: "" };
    },
  });
  const result = await provider.generate("只生成候选总结，不做写入。");
  assert.equal(result.content, VALID);
  assert.equal(result.provider, "codex_cli");
  assert.equal(result.model, "default");
  assert.equal(result.promptVersion, "candidate-summary-v1");
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(invocation.executable, "/fake/codex");
  assert.match(invocation.args.join(" "), /--sandbox read-only/);
  assert.match(invocation.args.join(" "), /--ephemeral/);
});

test("candidate summary provider passes an explicitly configured model to Codex CLI", async () => {
  let invocation = null;
  const provider = createCandidateSummaryProvider({
    detectImpl: async () => ({ available: true, executablePath: "/fake/codex" }),
    settingsLoader: async () => ({
      summary: { provider: "codex_cli", model: "summary-model" },
    }),
    runCommand: async (request) => {
      invocation = request;
      return { exitCode: 0, resultText: VALID, stdout: "", stderr: "" };
    },
  });

  const result = await provider.generate("生成候选摘要。");
  assert.equal(result.model, "summary-model");
  const modelIndex = invocation.args.indexOf("--model");
  assert.ok(modelIndex >= 0);
  assert.deepEqual(invocation.args.slice(modelIndex, modelIndex + 2), ["--model", "summary-model"]);
});

test("candidate summary provider rejects missing required review sections", () => {
  assert.throws(
    () => validateCandidateSummaryMarkdown("## AI 候选摘要\n只有一个章节"),
    /缺少必需章节/,
  );
});

test("candidate summary provider fails closed when no provider is available", async () => {
  const provider = createCandidateSummaryProvider({
    detectImpl: async () => ({ available: false, reason: "没有 Provider", checked: [] }),
  });
  await assert.rejects(
    () => provider.generate("prompt"),
    (error) => error.code === "PROVIDER_UNAVAILABLE" && /没有 Provider/.test(error.message),
  );
});

test("candidate summary provider manual mode never invokes Codex", async () => {
  let invoked = false;
  const provider = createCandidateSummaryProvider({
    settingsLoader: async () => ({ summary: { provider: "manual", model: "none" } }),
    detectImpl: async () => {
      invoked = true;
      return { available: true, executablePath: "/fake/codex" };
    },
  });
  await assert.rejects(
    () => provider.generate("prompt"),
    (error) => error.code === "MANUAL_PROVIDER_REQUIRED" && /人工模式/.test(error.message),
  );
  assert.equal(invoked, false);
});
