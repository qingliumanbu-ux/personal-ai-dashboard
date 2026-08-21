import { spawn as spawnProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { detectCodexCli } from "./codex-runner.mjs";

const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_SUMMARY_CHARACTERS = 30_000;
const REQUIRED_HEADINGS = Object.freeze([
  "## AI 候选摘要",
  "## 核心要点",
  "## 建议标签",
  "## 可复用方向",
  "## 不确定内容",
  "## 建议领域",
  "## 建议内容类型",
  "## 建议用途",
]);

export class CandidateSummaryProviderError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CandidateSummaryProviderError";
    this.code = code;
    this.details = details;
  }
}

function appendBounded(current, chunk, limit) {
  const next = current + chunk;
  return next.length <= limit ? next : next.slice(-limit);
}

function fail(code, message, details = undefined) {
  throw new CandidateSummaryProviderError(code, message, details);
}

export function validateCandidateSummaryMarkdown(value) {
  const content = String(value ?? "").trim();
  if (!content) fail("EMPTY_SUMMARY", "AI 没有返回候选摘要。");
  if (content.length > MAX_SUMMARY_CHARACTERS) {
    fail("SUMMARY_TOO_LONG", `AI 候选摘要不能超过 ${MAX_SUMMARY_CHARACTERS} 个字符。`);
  }

  const lines = content.split(/\r?\n/);
  let previousIndex = -1;
  for (const heading of REQUIRED_HEADINGS) {
    const indexes = lines
      .map((line, index) => line.trim() === heading ? index : -1)
      .filter((index) => index >= 0);
    if (indexes.length === 0) fail("INVALID_SUMMARY", `缺少必需章节：${heading}`);
    if (indexes.length > 1) fail("INVALID_SUMMARY", `章节只能出现一次：${heading}`);
    if (indexes[0] <= previousIndex) fail("INVALID_SUMMARY", "AI 候选摘要章节顺序不正确。");
    previousIndex = indexes[0];
  }
  return content;
}

function defaultRunCommand({ executable, args, cwd, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawnProcess(executable, args, {
      cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, String(chunk), MAX_STDOUT_BYTES);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, String(chunk), MAX_STDERR_BYTES);
    });
    child.on("error", (error) => finish(() => reject(new CandidateSummaryProviderError(
      "PROVIDER_START_FAILED",
      `无法启动 AI Provider：${error.message}`,
    ))));
    child.on("close", (exitCode, signal) => finish(() => {
      if (timedOut) {
        reject(new CandidateSummaryProviderError(
          "PROVIDER_TIMEOUT",
          `AI 总结超过 ${timeoutMs}ms，已停止。`,
        ));
        return;
      }
      resolve({ exitCode, signal, stdout, stderr });
    }));
    child.stdin.on("error", (error) => {
      if (error?.code !== "EPIPE") {
        finish(() => reject(new CandidateSummaryProviderError(
          "PROVIDER_STDIN_FAILED",
          `无法向 AI Provider 发送候选正文：${error.message}`,
        )));
      }
    });
    child.stdin.end(input);
  });
}

export function createCandidateSummaryProvider({
  detectImpl = detectCodexCli,
  runCommand = defaultRunCommand,
  timeoutMs = 120_000,
  settingsLoader = async () => ({ summary: { provider: "codex_cli", model: "default" } }),
  now = () => new Date(),
} = {}) {
  async function generate(prompt) {
    const safePrompt = String(prompt ?? "").trim();
    if (!safePrompt) fail("EMPTY_PROMPT", "候选摘要提示词为空。");

    const settings = await settingsLoader();
    const provider = settings?.summary?.provider || "codex_cli";
    const model = settings?.summary?.model || "default";
    if (provider === "manual") {
      fail(
        "MANUAL_PROVIDER_REQUIRED",
        "当前第一次资料总结使用人工模式，不会自动调用模型。请复制标准提示词，并把你手工填写或任意 AI 生成的结果粘贴回编辑区审核。",
      );
    }
    if (provider !== "codex_cli") {
      fail(
        "PROVIDER_UNAVAILABLE",
        `第一次资料总结当前尚未接入 Provider：${provider}。`,
      );
    }

    const detected = await detectImpl();
    if (!detected?.available || !detected.executablePath) {
      fail(
        "PROVIDER_UNAVAILABLE",
        detected?.reason || "当前没有可用的 AI Provider。",
        { checked: detected?.checked || [] },
      );
    }

    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "workbench-summary-"));
    const outputPath = path.join(temporaryDirectory, "candidate-summary.md");
    try {
      const args = [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "--color",
        "never",
        ...(model !== "default" ? ["--model", model] : []),
        "--output-last-message",
        outputPath,
        "-",
      ];
      const completed = await runCommand({
        executable: detected.executablePath,
        args: [...(detected.argsPrefix ?? []), ...args],
        cwd: temporaryDirectory,
        input: safePrompt,
        timeoutMs,
        outputPath,
      });
      if ((completed?.exitCode ?? 0) !== 0) {
        const detail = String(completed?.stderr || completed?.stdout || "")
          .replace(/\s+/g, " ")
          .slice(-800);
        fail(
          "PROVIDER_FAILED",
          `AI Provider 执行失败${detail ? `：${detail}` : ""}`,
        );
      }
      let output = "";
      try {
        output = await readFile(outputPath, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const content = validateCandidateSummaryMarkdown(
        output || completed?.resultText || completed?.stdout || "",
      );
      return {
        content,
        provider,
        model,
        promptVersion: "candidate-summary-v1",
        generatedAt: now().toISOString(),
      };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  return { generate };
}
