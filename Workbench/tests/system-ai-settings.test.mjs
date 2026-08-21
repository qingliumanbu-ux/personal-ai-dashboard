import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = join(ROOT, "..");

test("system page exposes separate first-summary and second-extraction model settings", () => {
  const source = readFileSync(join(ROOT, "src/pages/SystemPage.jsx"), "utf8");
  assert.match(source, /Provider 与模型/);
  assert.match(source, /第一次资料总结/);
  assert.match(source, /第二次知识提炼/);
  assert.match(source, /人工模式/);
  assert.match(source, /不会调用任何模型/);
  assert.match(source, /provider\.supports\?\.includes\(task\)/);
  assert.match(source, /default = 跟随当前 Codex CLI 的默认模型/);
  assert.match(source, /不在这里保存账号密码、Token 或 API Key/);
  assert.match(source, /saveAiProviderSettings/);
});

test("system page documents internal project codes without requiring users to memorize them", () => {
  const source = readFileSync(join(ROOT, "src/pages/SystemPage.jsx"), "utf8");
  assert.match(source, /阶段与代号说明/);
  assert.match(source, /P1\.3\.7/);
  assert.match(source, /p137-8/);
  assert.match(source, /p2-0/);
  assert.match(source, /p2-1/);
  assert.match(source, /业务页面优先使用中文名称/);
  assert.match(source, /较早的 “P2 · 15–30 天受控自进化”编号/);
});

test("AI settings use an ignored local file and API routes rather than credentials in source", () => {
  const ignoreSource = readFileSync(join(PROJECT_ROOT, ".gitignore"), "utf8");
  const pluginSource = readFileSync(join(ROOT, "server/vite-plugin-workbench.mjs"), "utf8");
  const apiSource = readFileSync(join(ROOT, "src/lib/api.js"), "utf8");
  assert.match(ignoreSource, /Workbench\/config\/ai-provider\.local\.json/);
  assert.match(pluginSource, /\/api\/ai-provider-settings/);
  assert.match(apiSource, /loadAiProviderSettings/);
  assert.match(apiSource, /saveAiProviderSettings/);
});
