import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginSource = readFileSync(join(ROOT, "server/vite-plugin-workbench.mjs"), "utf8");
const indexSource = readFileSync(join(ROOT, "server/vault-index.mjs"), "utf8");

test("formal graph nodes are restricted to real Markdown knowledge objects", () => {
  assert.match(
    pluginSource,
    /document\.layer === "wiki"[\s\S]*?document\.kind === "knowledge"[\s\S]*?document\.extension === "md"/,
  );
  assert.doesNotMatch(pluginSource, /graphClusters|buildFullGraphNetwork|design-lab\/data/);
});

test("formal graph edges come only from resolved Vault wiki links", () => {
  assert.match(pluginSource, /for \(const link of node\.wikiLinks \?\? \[\]\)/);
  assert.match(pluginSource, /if \(!link\.resolvedId \|\| !nodeIds\.has\(link\.resolvedId\)\) continue/);
  assert.match(pluginSource, /edgeMap\.set\(key, \{ source: node\.id, target: link\.resolvedId, weight: 1 \}\)/);
  assert.doesNotMatch(pluginSource, /similarity|embedding|cosine|infer(?:red|ence)?Relation/i);
});

test("wiki link resolution is rebuilt from Markdown paths instead of persisted graph truth", () => {
  assert.match(indexSource, /function resolveWikiLinks\(documents, layout\)/);
  assert.match(indexSource, /const wikiRoot = layout\.root\("wiki"\)/);
  assert.match(indexSource, /for \(const link of document\.wikiLinks\)/);
  assert.match(indexSource, /link\.resolvedId = resolved\.id/);
  assert.match(indexSource, /resolved\.backlinks\.push/);
});

test("formal reader revalidates files with the active Vault layout instead of legacy roots", () => {
  assert.match(pluginSource, /const vaultAllowedRoots = \[/);
  assert.match(pluginSource, /Object\.values\(vaultLayout\.summary\(\)\.roots\)\.filter\(Boolean\)/);
  assert.match(
    pluginSource,
    /validateVaultSelections\(\[indexed\.relativePath\],[\s\S]*?allowedRoots: vaultAllowedRoots/,
  );
});
