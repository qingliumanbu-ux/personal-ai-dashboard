import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("reader top actions are wired to real handlers and Windows open commands", () => {
  const drawer = readFileSync(join(ROOT, "src/components/DocumentDrawer.jsx"), "utf8");
  const server = readFileSync(join(ROOT, "server/vite-plugin-workbench.mjs"), "utf8");
  assert.match(drawer, /handleOpen\("obsidian"\)/);
  assert.match(drawer, /handleOpen\("finder"\)/);
  assert.match(drawer, /handleReturnHome/);
  assert.match(drawer, />主页</);
  assert.match(drawer, /onClick=\{handleClose\}/);
  assert.match(drawer, /在文件夹中定位/);
  assert.match(server, /process\.platform === "win32"/);
  assert.match(server, /explorer\.exe/);
  assert.match(server, /\/select,\$\{absolutePath\}/);
  assert.match(server, /rundll32\.exe/);
  assert.match(server, /url\.dll,FileProtocolHandler/);
  assert.doesNotMatch(server, /cmd\.exe[\s\S]{0,160}start/);
  assert.match(server, /await openLocalDocument\(vaultRoot, document, body\.target\)/);
});

test("reader knowledge actions all have handlers rather than placeholder buttons", () => {
  const source = readFileSync(join(ROOT, "src/components/reader/ReaderWorkspace.jsx"), "utf8");
  for (const handler of [
    "generateHistoricalSummary",
    "openManualSummaryBackfill",
    "openClassificationBackfill",
    "saveHistoricalReview",
    "beginKnowledgeExtraction",
    "retryKnowledgeExtraction",
    "saveManualKnowledgePlan",
    "submitWikiReview",
    "confirmWikiWrite",
    "executeManualWikiWrite",
    "cancelWikiWork",
    "refreshP2Admission",
    "approveCurrentP2Snapshot",
  ]) {
    assert.match(source, new RegExp(`const ${handler} =`));
  }
  assert.match(source, /onClick=\{beginKnowledgeExtraction\}/);
  assert.match(source, /人工补录总结/);
  assert.match(source, /标准提示词（可交给任意 AI）/);
  assert.match(source, /wikiJob\.error\?\.message/);
  assert.match(source, /重新生成方案/);
  assert.match(source, /onClick=\{confirmWikiWrite\}/);
  assert.match(source, /onClick=\{cancelWikiWork\}/);
  assert.match(source, /重新批准当前资料快照/);
  assert.match(source, /刷新准入状态/);
  assert.match(source, /人工提炼方案已确认，等待写入 Wiki/);
  assert.match(source, /执行写入 Wiki/);
  assert.match(source, /executeManualWikiIngest/);
  assert.match(source, /本轮操作记录/);
  assert.match(source, /最近的二次提炼记录/);
  assert.match(source, /setP2Admission\(loadP2AdmissionState\(\)\)/);
  assert.match(source, /const latest = await refreshP2Admission\(\)/);
  assert.match(source, /P2_ADMISSION_STALE/);
});
