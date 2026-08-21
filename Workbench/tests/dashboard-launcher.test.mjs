import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("Windows dashboard launcher recovers stale process state instead of hard-blocking startup", () => {
  const source = readFileSync(join(ROOT, "scripts/start-dashboard.ps1"), "utf8");
  assert.match(source, /Get-RecordedProcess/);
  assert.match(source, /removing the stale state file/);
  assert.match(source, /Stopped incomplete recorded dashboard process/);
  assert.doesNotMatch(source, /Dashboard may already be running\. Run scripts\\stop-dashboard\.ps1 first\./);
});

test("Windows dashboard launcher probes the current ingestion port and opens the home page", () => {
  const source = readFileSync(join(ROOT, "scripts/start-dashboard.ps1"), "utf8");
  assert.match(source, /http:\/\/127\.0\.0\.1:8766\/api\/health/);
  assert.match(source, /\$dashboardUrl = "http:\/\/127\.0\.0\.1:5173\/"/);
  assert.match(source, /Open-DashboardPage/);
});

test("root one-click launcher is independent from the current PowerShell directory and surfaces failure logs", () => {
  const source = readFileSync(join(ROOT, "open-dashboard.cmd"), "utf8");
  assert.match(source, /set "ROOT=%~dp0"/);
  assert.match(source, /chcp 65001 >nul/);
  assert.match(source, /del \/q "%LOG_ROOT%\\dashboard\.stdout\.log"/);
  assert.match(source, /scripts\\stop-dashboard\.ps1/);
  assert.match(source, /scripts\\start-dashboard\.ps1/);
  assert.match(source, /dashboard\.stderr\.log/);
  assert.match(source, /ingestion\.stderr\.log/);
});

test("root one-click launcher restarts this project before opening so Vite serves current code", () => {
  const source = readFileSync(join(ROOT, "open-dashboard.cmd"), "utf8");
  const stopCall = source.indexOf('-File "%STOP_SCRIPT%"');
  const startCall = source.indexOf('-File "%START_SCRIPT%"');
  assert.ok(stopCall >= 0);
  assert.ok(startCall > stopCall);
});

test("Windows launcher reuses an already healthy ingestion service instead of failing on port 8766", () => {
  const source = readFileSync(join(ROOT, "scripts/start-dashboard.ps1"), "utf8");
  assert.match(source, /function Test-IngestionReady/);
  assert.match(source, /personal-ai-dashboard-ingestion/);
  assert.match(source, /\$reuseExistingIngestion = Test-IngestionReady/);
  assert.match(source, /Reusing healthy ingestion service/);
  assert.match(source, /if \(-not \$reuseExistingIngestion\) \{[\s\S]*Assert-PortAvailable 8766/);
});

test("Windows stop script tolerates a reused ingestion service with no recorded process", () => {
  const source = readFileSync(join(ROOT, "scripts/stop-dashboard.ps1"), "utf8");
  assert.match(source, /if \(-not \$Record -or -not \$Record\.id\) \{ return \}/);
  assert.match(source, /PERSONAL_DASHBOARD_INGESTION_PYTHON/);
  assert.match(source, /ExpectedExecutablePaths/);
  assert.match(source, /function Test-KnownIngestionHealth/);
  assert.match(source, /TrustCurrentListener/);
  assert.match(source, /AllowVerifiedAccessDeniedReuse/);
  assert.match(source, /running with higher Windows privileges/);
  assert.match(source, /\$knownIngestionHealth = Test-KnownIngestionHealth/);
  assert.match(source, /capabilities\.douyin/);
  assert.match(source, /Stop-Process -Id \$ownerPid -Force -ErrorAction Stop/);
  assert.match(source, /port \$Port is still listening after 5 seconds/);
  assert.doesNotMatch(source, /Stopped orphan dashboard process PID/);
  assert.match(source, /Only verified project processes were stopped/);
});

test("Windows launcher can reuse the verified pre-marker ingestion service when elevated ownership prevents restart", () => {
  const source = readFileSync(join(ROOT, "scripts/start-dashboard.ps1"), "utf8");
  assert.match(source, /function Test-IngestionReady/);
  assert.match(source, /capabilities\.vad/);
  assert.match(source, /capabilities\.web_page/);
  assert.match(source, /capabilities\.douyin/);
  assert.match(source, /function Test-IngestionIsCurrentVersion/);
  assert.match(source, /verified legacy ingestion service on port 8766/);
});

test("Windows launcher clears stale logs before port checks so old Vite errors are not reported as current", () => {
  const source = readFileSync(join(ROOT, "scripts/start-dashboard.ps1"), "utf8");
  const clearLogs = source.indexOf("Remove-Item -LiteralPath $dashboardStdout");
  const portCheck = source.indexOf('Assert-PortAvailable 5173 "Dashboard frontend"');
  assert.ok(clearLogs >= 0);
  assert.ok(portCheck > clearLogs);
  assert.equal(source.lastIndexOf("Remove-Item -LiteralPath $dashboardStdout"), clearLogs);
});
