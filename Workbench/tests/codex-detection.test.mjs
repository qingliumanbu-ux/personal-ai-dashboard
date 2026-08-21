import assert from "node:assert/strict";
import test from "node:test";

import { detectCodexCli } from "../server/codex-runner.mjs";

test("Windows Codex detection resolves a standard npm global install without invoking codex.cmd", async () => {
  const expectedScript = "C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js";
  const result = await detectCodexCli({
    platform: "win32",
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    chatGptCodexPath: "C:\\missing\\codex.exe",
    env: {
      APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
      USERPROFILE: "C:\\Users\\tester",
      PATH: "C:\\Windows\\System32;C:\\Users\\tester\\AppData\\Roaming\\npm",
    },
    isExecutableImpl: async () => false,
    isRegularFileImpl: async (candidate) => candidate === expectedScript,
  });

  assert.equal(result.available, true);
  assert.equal(result.executablePath, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(result.argsPrefix, [expectedScript]);
  assert.equal(result.source, "windows-npm-global");
});

test("Windows Codex detection supports an explicit executable override", async () => {
  const configured = "D:\\Tools\\codex.exe";
  const result = await detectCodexCli({
    platform: "win32",
    env: { PERSONAL_DASHBOARD_CODEX_PATH: configured, PATH: "" },
    chatGptCodexPath: "C:\\missing\\codex.exe",
    isExecutableImpl: async (candidate) => candidate === configured,
    isRegularFileImpl: async () => false,
  });

  assert.equal(result.available, true);
  assert.equal(result.executablePath, configured);
  assert.deepEqual(result.argsPrefix, []);
  assert.equal(result.source, "configured");
});

test("Windows Codex detection gives a Windows-specific recovery message when unavailable", async () => {
  const result = await detectCodexCli({
    platform: "win32",
    env: { APPDATA: "C:\\Users\\tester\\AppData\\Roaming", PATH: "" },
    chatGptCodexPath: "C:\\missing\\codex.exe",
    isExecutableImpl: async () => false,
    isRegularFileImpl: async () => false,
  });

  assert.equal(result.available, false);
  assert.match(result.reason, /Windows npm 全局安装目录/);
  assert.match(result.reason, /PERSONAL_DASHBOARD_CODEX_PATH/);
});
