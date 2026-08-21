import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(join(ROOT, relativePath), "utf8");

const pageSource = readSource("src/pages/DesignLabPage.jsx");
const workbenchSource = readSource("src/pages/design-lab/UnifiedWorkbenchViews.jsx");
const fixtureSource = readSource("src/pages/design-lab/data.js");
const commandPaletteSource = readSource("src/pages/design-lab/CommandPalette.jsx");
const inspectorSource = readSource("src/pages/design-lab/Inspector.jsx");
const graphSource = readSource("src/pages/design-lab/GraphView.jsx");
const networkGraphSource = readSource("src/pages/design-lab/NetworkGraph.jsx");
const starfieldSource = readSource("src/pages/design-lab/StarfieldBackdrop.jsx");
const baseCss = readSource("src/styles/design-lab.css");
const workspaceCss = readSource("src/styles/design-lab-workspace.css");
const semanticGraphCss = readSource("src/styles/design-lab-graph-semantic.css");
const networkGraphCss = readSource("src/styles/design-lab-graph-network.css");

test("p137-6c design lab exposes the unified Workbench information architecture", () => {
  assert.match(pageSource, /useState\("command"\)/);
  for (const key of ["command", "today", "focus", "review", "tomorrow", "rules", "ingestion", "sources", "knowledge", "graph", "system"]) {
    assert.match(pageSource, new RegExp(`key: "${key}"`));
  }
  for (const label of ["工作", "知识", "系统"]) {
    assert.match(pageSource, new RegExp(`"${label}"`));
  }
});

test("workflow prototypes use the full stage while object views retain the Inspector", () => {
  assert.match(pageSource, /const showInspector = \["today", "sources", "knowledge", "graph"\]\.includes\(view\)/);
  assert.match(pageSource, /is-inspector-hidden/);
  assert.match(workspaceCss, /\.design-lab-content-grid\.is-inspector-hidden\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(workspaceCss, /\.is-inspector-hidden \.lab-wb-view/);
});

test("the unified shell is visibly synthetic and never reads formal Workbench state", () => {
  assert.match(pageSource, /原型 · 合成数据/);
  assert.match(pageSource, /合成演示数据/);
  assert.match(workbenchSource, /仅合成演示/);
  assert.match(workbenchSource, /不是真实检测结果/);
  assert.doesNotMatch(workbenchSource, /today-knowledge-queue-state|tomorrow-knowledge-suggestions-state|work-rules-state|\.\.\/\.\.\/lib\/api|localStorage|fetch\(/);
});

test("Command Center covers the approved daily Workbench surfaces", () => {
  for (const label of ["今日", "专注", "知识", "复盘", "明日计划", "系统", "AI 洞察", "最近活动"]) {
    assert.match(workbenchSource, new RegExp(label));
  }
  assert.match(workbenchSource, /用户决定优先/);
  assert.match(workbenchSource, /onOpen\("ingestion"\)/);
  assert.match(workbenchSource, /新建入库/);
});

test("p137-6c restores ingestion as a synthetic-only Workbench surface", () => {
  assert.match(pageSource, /key: "ingestion", label: "入库"/);
  assert.match(pageSource, /view === "ingestion" \? <IngestionPrototypeView/);
  assert.match(workbenchSource, /export function IngestionPrototypeView/);
  assert.match(workbenchSource, /仅演示，不上传/);
  assert.match(workbenchSource, /不调用正式入库接口/);
  assert.match(workbenchSource, /不会调用正式 `\/ingestion` 服务/);
  assert.doesNotMatch(workbenchSource, /\/api\/ingestion|ingestion-api|fetch\(/);
});

test("Control Center prototypes diagnostics and safe maintenance without executing maintenance", () => {
  for (const label of ["系统健康", "诊断", "安全维护", "接入与服务"]) {
    assert.match(workbenchSource, new RegExp(label));
  }
  assert.match(workbenchSource, /仅预览 · 合成演示/);
  assert.match(workbenchSource, /不写知识库 · 不改 Git · 不删除来源原件/);
  assert.doesNotMatch(workbenchSource, /rebuild-index|\/api\/diagnostics|\/api\/system-health/);
});

test("p137-6c visible navigation and primary workbench copy are Chinese-first", () => {
  for (const label of ["指挥中心", "今日", "专注", "复盘", "明日计划", "工作规则", "入库", "资料中心", "知识库", "知识图谱", "系统与设置"]) {
    assert.match(pageSource, new RegExp(`label: "${label}"`));
  }
  assert.match(workbenchSource, /<h1>指挥中心<\/h1>/);
  assert.match(workbenchSource, /<h3>一键诊断<\/h3>/);
  assert.match(workbenchSource, /<h3>安全维护<\/h3>/);
  assert.doesNotMatch(workbenchSource, />Command Center<|>Start Focus<|>Daily Review<|>Control Center<|>Run synthetic check/);
});

test("synthetic materials, graph labels, command palette, and inspector are Chinese-first", () => {
  for (const label of ["本地优先 AI 工作台架构", "构建会持续复利的第二大脑", "智能体记忆与检索模式", "本地优先边界", "上下文压缩", "复盘队列", "命令面板", "第二大脑"]) {
    assert.match(fixtureSource, new RegExp(label));
  }
  assert.match(commandPaletteSource, /本地知识索引/);
  assert.match(commandPaletteSource, /回车打开/);
  assert.match(inspectorSource, />检查<\/span>/);
  assert.doesNotMatch(fixtureSource, /Local-first AI workspace architecture|Building a second brain that compounds|Agent Memory|Context Compression|Command Palette|Second Brain/);
});

test("sidebar exposes the prototype boundary and the command palette can open every Workbench view", () => {
  assert.match(pageSource, /原型边界/);
  assert.match(pageSource, /仅使用合成演示数据/);
  assert.match(pageSource, /不连接正式工作台状态，不写入知识库/);
  assert.doesNotMatch(pageSource, /design-lab-spaces/);
  assert.doesNotMatch(baseCss, /\.design-lab-spaces/);
  assert.match(baseCss, /\.design-lab-prototype-boundary/);
  assert.match(commandPaletteSource, /\.\.\.views\.map\(\(view\) =>/);
  assert.doesNotMatch(commandPaletteSource, /views\.slice\(0, 5\)/);
});

test("Chinese-first shell copy remains layout-safe on narrow screens", () => {
  assert.match(baseCss, /\.design-lab-nav__item > span\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(baseCss, /\.design-lab-topbar > div > span:last-child\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(baseCss, /\.design-lab-topbar__status\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(baseCss, /\.lab-wb-rules b,[\s\S]*\.lab-wb-badge\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(baseCss, /@media \(max-width: 760px\)[\s\S]*\.design-lab-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(baseCss, /@media \(max-width: 760px\)[\s\S]*\.design-lab-topbar > button\s*\{\s*display:\s*none;/s);
  assert.match(baseCss, /@media \(max-width: 760px\)[\s\S]*\.lab-wb-rules > button\s*\{\s*flex-direction:\s*column;/s);
});

test("p137-6c interaction styles stay inside Design Lab namespaces", () => {
  for (const selector of ["lab-wb-tabs", "lab-wb-decision", "lab-wb-rules", "lab-wb-dry-run", "lab-wb-ingestion"]) {
    assert.match(baseCss, new RegExp(`\\.${selector}`));
  }
  assert.doesNotMatch(baseCss, /\.app-shell\s|\.studio-dashboard\s|\.workspace-bar\s/);
});

test("Starry implementation stays state-isolated while Design Lab keeps its graph-only variants", () => {
  assert.match(workbenchSource, /<StarfieldBackdrop variant="command" \/>/);
  assert.match(workbenchSource, /lab-wb-cosmos--command/);
  assert.match(starfieldSource, /centerY = height \* \(variant === "command" \? 0\.28/);
  assert.match(graphSource, /design-lab-semantic-canvas lab-wb-cosmos lab-wb-cosmos--semantic/);
  assert.match(graphSource, /<StarfieldBackdrop variant="semantic" \/>/);
  assert.doesNotMatch(graphSource, /lab-wb-cosmos--graph|variant="graph"/);
  assert.match(networkGraphSource, /design-lab-network-canvas lab-wb-cosmos lab-wb-cosmos--network/);
  assert.match(networkGraphSource, /<StarfieldBackdrop variant="network" viewport=\{\{ pan, scale \}\} \/>/);
  assert.match(starfieldSource, /semantic: \{ stars: 100/);
  assert.match(starfieldSource, /network: \{ stars: 180, dust: 500, constellations: 2/);
  assert.match(starfieldSource, /--starfield-pan-x/);
  assert.match(starfieldSource, /viewportPan\.x \* 0\.18/);
  assert.match(starfieldSource, /prefers-reduced-motion: reduce/);
  assert.match(starfieldSource, /ResizeObserver/);
  assert.match(starfieldSource, /requestAnimationFrame/);
  assert.doesNotMatch(starfieldSource, /localStorage|fetch\(|\.\.\/\.\.\/lib\/api|ingestion-api/);
  assert.match(baseCss, /\.lab-wb-cosmos--command/);
  assert.match(baseCss, /mask-image: linear-gradient\(180deg/);
  assert.doesNotMatch(baseCss, /\.lab-wb-cosmos--graph/);
  assert.match(semanticGraphCss, /\.design-lab-semantic-canvas/);
  assert.match(semanticGraphCss, /\.lab-wb-cosmos--semantic \.lab-wb-starfield/);
  assert.match(networkGraphCss, /\.lab-wb-cosmos--network \.lab-wb-starfield/);
  assert.match(networkGraphCss, /transform: translate3d\(var\(--starfield-pan-x/);
  assert.doesNotMatch(networkGraphCss, /transparent 0 31%/);
  assert.match(networkGraphCss, /fill: rgba\(184, 204, 228, 0\.72\)/);
});
