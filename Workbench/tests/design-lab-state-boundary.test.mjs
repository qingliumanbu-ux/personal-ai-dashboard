import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WORKBENCH_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESIGN_LAB_SOURCE = readFileSync(join(WORKBENCH_ROOT, "src/pages/DesignLabPage.jsx"), "utf8");
const NETWORK_GRAPH_SOURCE = readFileSync(join(WORKBENCH_ROOT, "src/pages/design-lab/NetworkGraph.jsx"), "utf8");
const INSPECTOR_SOURCE = readFileSync(join(WORKBENCH_ROOT, "src/pages/design-lab/Inspector.jsx"), "utf8");

test("design lab keeps real knowledge and graph-node selection in separate state", () => {
  assert.match(DESIGN_LAB_SOURCE, /const \[selectedKnowledge, setSelectedKnowledge\] = useState\(/);
  assert.match(DESIGN_LAB_SOURCE, /const \[selectedGraphNode, setSelectedGraphNode\] = useState\(null\)/);
  assert.match(DESIGN_LAB_SOURCE, /const \[graphFocus, setGraphFocus\] = useState\(/);
  assert.match(DESIGN_LAB_SOURCE, /const \[graphViewport, setGraphViewport\] = useState\(/);
  assert.match(NETWORK_GRAPH_SOURCE, /onSelectGraphNode\(\{[\s\S]*networkNodeId:/);
  assert.match(NETWORK_GRAPH_SOURCE, /if \(realItem\) onSelectKnowledge\(realItem\)/);
  assert.doesNotMatch(DESIGN_LAB_SOURCE, /setSelectedKnowledge\(\{[\s\S]{0,220}networkNodeId:/);
});

test("graph focus and viewport survive view changes without updating parent state every drag frame", () => {
  assert.match(DESIGN_LAB_SOURCE, /const \[graphFocus, setGraphFocus\] = useState\(null\)/);
  assert.match(DESIGN_LAB_SOURCE, /graphFocus=\{graphFocus\}/);
  assert.match(DESIGN_LAB_SOURCE, /graphViewport=\{graphViewport\}/);
  assert.match(NETWORK_GRAPH_SOURCE, /commitViewport\(viewRef\.current\.scale, nextPan, false\)/);
  assert.match(NETWORK_GRAPH_SOURCE, /onGraphViewportChange\(viewRef\.current\)/);
  assert.match(NETWORK_GRAPH_SOURCE, /setTimeout\(\(\) => \{[\s\S]*onGraphViewportChange\(nextViewport\)/);
  assert.match(NETWORK_GRAPH_SOURCE, /if \(!wasDrag\) \{[\s\S]*setActiveId\(null\)[\s\S]*onGraphFocusChange\(null\)[\s\S]*onSelectGraphNode\(null\)/);
  assert.match(DESIGN_LAB_SOURCE, /setGraphFocus\(knowledge \? \{ knowledgeId: knowledge\.id \} : null\)/);
});

test("network inspector is explicit instead of pretending to be a knowledge object", () => {
  assert.match(INSPECTOR_SOURCE, /mode === "knowledge" \|\| mode === "network"/);
  assert.match(INSPECTOR_SOURCE, /eyebrow: isNetworkNode \? "网络节点" : "知识对象"/);
  assert.match(INSPECTOR_SOURCE, /item\?\.knowledgeId/);
  assert.match(INSPECTOR_SOURCE, /打开对应知识对象/);
});

test("design lab page stays an orchestrator instead of regrowing graph implementation", () => {
  const lineCount = DESIGN_LAB_SOURCE.split(/\r?\n/).length;
  assert.ok(lineCount < 350, `DesignLabPage should stay compact; found ${lineCount} lines`);
  assert.match(DESIGN_LAB_SOURCE, /import \{ GraphView \} from "\.\/design-lab\/GraphView\.jsx"/);
  assert.match(DESIGN_LAB_SOURCE, /import \{ Inspector \} from "\.\/design-lab\/Inspector\.jsx"/);
  assert.match(DESIGN_LAB_SOURCE, /import \{ KnowledgeView, SourcesView, TodayView \} from "\.\/design-lab\/WorkspaceViews\.jsx"/);
  assert.doesNotMatch(DESIGN_LAB_SOURCE, /forceSimulation|function NetworkGraph|function FullNetworkGraph/);
});
