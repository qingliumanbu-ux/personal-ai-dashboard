import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const configSource = readFileSync(join(ROOT, "vite.config.mjs"), "utf8");

test("Vite resolves the default public Vault before bundling local plugins", () => {
  assert.match(configSource, /process\.env\.INIT_CWD/);
  assert.match(configSource, /process\.env\.npm_package_json/);
  assert.match(
    configSource,
    /path\.resolve\(packageRoot,\s*"\.\.",\s*"个人知识库"\)/,
  );
  assert.match(
    configSource,
    /path\.resolve\(process\.cwd\(\),\s*"个人知识库"\)/,
  );
  assert.match(
    configSource,
    /path\.resolve\(process\.cwd\(\),\s*"\.\.",\s*"个人知识库"\)/,
  );
  assert.match(
    configSource,
    /\.find\(\(candidate\) => existsSync\(candidate\)\)/,
  );
  assert.match(configSource, /VITE_WORKBENCH_HOSTED/);
  assert.match(
    configSource,
    /const vaultRoot = hostedBuild\s*\? defaultVaultRoot/,
  );
  assert.doesNotMatch(
    configSource,
    /PERSONAL_DASHBOARD_VAULT_ROOT[\s\S]{0,160}:\s*undefined/,
  );
});
