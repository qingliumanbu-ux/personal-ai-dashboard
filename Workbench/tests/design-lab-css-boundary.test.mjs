import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainSource = readFileSync(join(ROOT, "src/main.jsx"), "utf8");
const tokenSource = readFileSync(join(ROOT, "src/styles/design-lab-tokens.css"), "utf8");
const networkSource = readFileSync(join(ROOT, "src/styles/design-lab-graph-network.css"), "utf8");

const stableLayers = [
  "design-lab-tokens.css",
  "design-lab.css",
  "design-lab-workspace.css",
  "design-lab-graph-semantic.css",
  "design-lab-graph-network.css",
];

const retiredLayers = [
  "design-lab-motion.css",
  "design-lab-polish.css",
  "design-lab-fluid.css",
  "design-lab-composition.css",
  "design-lab-finish.css",
];

test("design lab uses a bounded stable CSS layer stack", () => {
  let lastIndex = -1;
  for (const layer of stableLayers) {
    const index = mainSource.indexOf(layer);
    assert.ok(index > lastIndex, `${layer} should be imported in stable cascade order`);
    assert.ok(existsSync(join(ROOT, "src/styles", layer)), `${layer} should exist`);
    lastIndex = index;
  }

  for (const layer of retiredLayers) {
    assert.doesNotMatch(mainSource, new RegExp(layer.replaceAll(".", "\\.")));
    assert.equal(existsSync(join(ROOT, "src/styles", layer)), false);
  }
});

test("design lab tokens are centralized instead of restated in the base layer", () => {
  for (const token of ["--lab-bg", "--lab-border", "--lab-text", "--lab-accent", "--lab-radius-soft", "--lab-shadow-float"]) {
    assert.match(tokenSource, new RegExp(token));
  }

  const baseSource = readFileSync(join(ROOT, "src/styles/design-lab.css"), "utf8");
  assert.doesNotMatch(baseSource, /--lab-bg\s*:/);
  assert.doesNotMatch(baseSource, /--lab-accent\s*:/);
});

test("retired Starry comparison skin does not remain in runtime styles", () => {
  assert.doesNotMatch(networkSource, /design-lab-starry/);
  assert.doesNotMatch(networkSource, /is-starry-graph/);
});
