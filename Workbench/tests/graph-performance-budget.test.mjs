import assert from "node:assert/strict";
import test from "node:test";

import {
  getGraphPerformanceBudget,
  recommendGraphRenderer,
  selectRenderableLinks,
  selectRenderableNodes,
} from "../src/graph/graph-performance-budget.js";

test("graph renderer recommendation scales from SVG to Canvas and WebGL", () => {
  assert.equal(recommendGraphRenderer(69, 117), "svg");
  assert.equal(recommendGraphRenderer(600, 1800), "canvas");
  assert.equal(recommendGraphRenderer(1800, 6000), "webgl");
});

test("auto performance mode keeps the current prototype high quality and degrades larger graphs", () => {
  const current = getGraphPerformanceBudget({ mode: "auto", nodeCount: 69, linkCount: 117 });
  assert.equal(current.resolvedMode, "quality");
  assert.equal(current.renderer, "svg");
  assert.equal(current.labelBudget.focus, 18);

  const medium = getGraphPerformanceBudget({ mode: "auto", nodeCount: 300, linkCount: 620 });
  assert.equal(medium.resolvedMode, "balanced");

  const large = getGraphPerformanceBudget({ mode: "auto", nodeCount: 900, linkCount: 2800 });
  assert.equal(large.resolvedMode, "saver");
  assert.equal(large.renderer, "canvas");

  const reducedMotion = getGraphPerformanceBudget({ mode: "auto", nodeCount: 69, linkCount: 117, reducedMotion: true });
  assert.equal(reducedMotion.resolvedMode, "saver");
  assert.equal(reducedMotion.enableDrift, false);
});

test("node render budget preserves focus, search matches, and relation context before ordinary nodes", () => {
  const nodes = [
    { id: "ordinary-a", importance: 1 },
    { id: "hub", importance: 4 },
    { id: "related", importance: 1 },
    { id: "search", importance: 1 },
    { id: "active", importance: 1 },
    { id: "ordinary-b", importance: 2 },
  ];
  const selected = selectRenderableNodes(nodes, { maxRenderedNodes: 4 }, {
    activeId: "active",
    relatedIds: new Set(["related"]),
    searchMatchIds: new Set(["search"]),
  });
  assert.deepEqual(new Set(selected.map((node) => node.id)), new Set(["active", "search", "related", "hub"]));
});

test("link render budget keeps direct and relation links before background links", () => {
  const nodes = [
    { id: "active", importance: 1 },
    { id: "one", importance: 1 },
    { id: "two", importance: 1 },
    { id: "hub", importance: 4 },
    { id: "far", importance: 1 },
  ];
  const links = [
    { id: "background", source: "two", target: "far", kind: "local" },
    { id: "hub-link", source: "hub", target: "far", kind: "cluster" },
    { id: "relation", source: "one", target: "two", kind: "local" },
    { id: "direct", source: "active", target: "one", kind: "local" },
  ];
  const selected = selectRenderableLinks(links, nodes, { maxRenderedLinks: 2 }, {
    activeId: "active",
    relationDistances: new Map([["active", 0], ["one", 1], ["two", 2]]),
  });
  assert.deepEqual(new Set(selected.map((link) => link.id)), new Set(["direct", "relation"]));
});
