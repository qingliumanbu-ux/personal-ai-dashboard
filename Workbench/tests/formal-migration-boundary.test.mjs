import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(join(ROOT, relativePath), "utf8");

const appSource = readSource("src/App.jsx");
const appShellSource = readSource("src/components/AppShell.jsx");
const sharedStarfieldSource = readSource("src/components/StarfieldBackdrop.jsx");
const searchPaletteSource = readSource("src/components/SearchPalette.jsx");
const commandCenterSource = readSource("src/pages/CommandCenterPage.jsx");
const overviewSource = readSource("src/pages/OverviewPage.jsx");
const focusLandingSource = readSource("src/pages/FocusLandingPage.jsx");
const focusSource = readSource("src/pages/FocusWorkspacePage.jsx");
const reviewSource = readSource("src/pages/DailyKnowledgeReviewPage.jsx");
const tomorrowSource = readSource("src/pages/TomorrowPlanPage.jsx");
const rulesSource = readSource("src/pages/WorkRulesPage.jsx");
const materialsSource = readSource("src/pages/MaterialsPage.jsx");
const collectionSource = readSource("src/pages/CollectionPage.jsx");
const graphSource = readSource("src/pages/GraphPage.jsx");
const formalGraphSource = readSource("src/pages/FormalGraphPage.jsx");
const systemSource = readSource("src/pages/SystemPage.jsx");
const mainSource = readSource("src/main.jsx");
const formalV7Source = readSource("src/styles/v7-formal.css");

const formalSources = [
  ["指挥中心", commandCenterSource],
  ["Today", overviewSource],
  ["Focus", focusLandingSource],
  ["Review", reviewSource],
  ["Tomorrow", tomorrowSource],
  ["Rules", rulesSource],
  ["资料中心", materialsSource],
  ["知识库", collectionSource],
];

test("formal V7 routes keep synthetic demo usage explicit and bounded", () => {
  assert.match(appSource, /location\.pathname === "\/design-lab"/);
  assert.match(appSource, /<Route path="\/" element={<CommandCenterPage/);
  assert.match(appSource, /<Route path="\/today" element={<OverviewPage/);
  assert.match(appSource, /<Route path="\/focus" element={<FocusLandingPage/);
  assert.match(appSource, /path="\/focus\/:workItemId"[\s\S]*?<FocusWorkspacePage/);
  assert.match(appSource, /<Route path="\/tomorrow" element={<TomorrowPlanPage/);
  assert.match(appSource, /path="\/materials"[\s\S]*?<MaterialsPage/);
  assert.match(appSource, /path="\/wiki"[\s\S]*?kind="wiki"/);
  assert.match(appSource, /<Route path="\/graph" element={<FormalGraphPage/);

  for (const [label, source] of formalSources) {
    assert.doesNotMatch(
      source,
      /(?:from\s+|import\s*\()["'][^"']*design-lab(?:\/data)?[^"']*["']/i,
      `${label} must not import design-lab fixtures`,
    );
  }

  assert.match(formalGraphSource, /design-lab\/data\.js/);
  assert.match(formalGraphSource, /Demo · 合成数据/);
  assert.match(formalGraphSource, /真实图谱当前只有/);
  assert.doesNotMatch(formalGraphSource, /localStorage|saveTodayKnowledgeQueueState|saveTomorrowSuggestionsState|\/api\/maintenance/);
});

test("formal migrated pages continue to load their real API-backed data", () => {
  assert.match(commandCenterSource, /loadOverview\(\)/);
  assert.match(commandCenterSource, /loadGraph\(\)/);
  assert.match(commandCenterSource, /loadKnowledgeWork\(\)/);
  assert.match(commandCenterSource, /loadSystemHealth\(\)/);

  assert.match(overviewSource, /loadOverview\(\)/);
  assert.match(overviewSource, /loadGraph\(\)/);
  assert.match(focusLandingSource, /loadKnowledgeWork\(\)/);
  assert.match(tomorrowSource, /loadKnowledgeWork\(\)/);
  assert.match(tomorrowSource, /buildDailyKnowledgeReview/);
  assert.match(tomorrowSource, /buildTomorrowSuggestions/);

  assert.match(materialsSource, /loadMaterialsHome\(\)/);
  assert.match(materialsSource, /loadMaterialFolder\(folderPath\)/);
  assert.match(materialsSource, /loadMaterialReadingQueue\(\)/);

  assert.match(collectionSource, /loadCollection\(kind\)/);
  assert.match(formalGraphSource, /loadGraph\(\)/);
});

test("formal unified shell mirrors the approved Workbench information architecture without synthetic fixtures", () => {
  for (const label of ["指挥中心", "工作", "今日", "专注", "复盘", "明日计划", "知识", "资料中心", "知识库", "知识图谱", "系统", "系统与设置"]) {
    assert.match(appShellSource, new RegExp(label));
  }
  assert.match(appShellSource, /label: "入库"/);
  assert.doesNotMatch(appShellSource, /to: "\/rules", label: "工作规则"/);
  assert.match(systemSource, /navigate\("\/rules"\)/);
  assert.match(systemSource, /<strong>工作规则<\/strong>/);

  for (const route of ["/", "/today", "/focus", "/review", "/tomorrow", "/rules", "/materials", "/wiki", "/graph", "/system"]) {
    const escaped = route.replaceAll("/", "\\/");
    assert.match(searchPaletteSource, new RegExp(`to: "${escaped}"`));
  }

  assert.doesNotMatch(appShellSource, /design-lab\/data|sourceItems|knowledgeItems/);
  assert.doesNotMatch(searchPaletteSource, /design-lab\/data|sourceItems|knowledgeItems/);
});

test("formal sidebar supports a reversible compact desktop rail", () => {
  assert.match(appShellSource, /sidebarCollapsed/);
  assert.match(appShellSource, /app-shell--sidebar-collapsed/);
  assert.match(appShellSource, /展开侧栏/);
  assert.match(appShellSource, /收起侧栏/);
  assert.match(formalV7Source, /\.app-shell--sidebar-collapsed\s*\{/);
  assert.match(formalV7Source, /--sidebar-w:\s*58px/);
  assert.match(formalV7Source, /\.sidebar__collapse\s*\{/);
});

test("formal command center keeps the approved cosmos as a visual-only atmosphere without a separate cover", () => {
  assert.match(commandCenterSource, /components\/StarfieldBackdrop\.jsx/);
  assert.match(commandCenterSource, /<StarfieldBackdrop variant="command" \/>/);
  assert.match(commandCenterSource, /formal-command-cosmos/);
  assert.match(commandCenterSource, /command-workbench/);
  assert.doesNotMatch(commandCenterSource, /formal-cover|>起点</);
  assert.match(commandCenterSource, /metrics\.wiki \?\? "—"/);
  assert.match(commandCenterSource, /暂无来自真实索引的最近活动/);
  assert.match(commandCenterSource, /当前没有显式待处理的知识工作/);
  assert.doesNotMatch(commandCenterSource, /DEMO_|DemoBadge|合成演示|demo:/i);
  assert.doesNotMatch(commandCenterSource, /design-lab\/data|sourceItems|knowledgeItems/);
  assert.doesNotMatch(sharedStarfieldSource, /design-lab\/data|sourceItems|knowledgeItems|localStorage|fetch\(|\.\.\/lib\/api|ingestion-api/);
});

test("formal Focus and Tomorrow routes preserve Workbench state boundaries and User Override First", () => {
  assert.match(focusLandingSource, /loadTodayKnowledgeQueueState/);
  assert.match(focusLandingSource, /confirmedTomorrowWorkItemIds/);
  assert.match(focusSource, /navigate\("\/today"\)/);
  assert.match(reviewSource, /navigate\("\/today"\)/);
  assert.match(tomorrowSource, /updateTomorrowSuggestion/);
  assert.match(tomorrowSource, /saveTomorrowSuggestionsState/);
  assert.match(tomorrowSource, /userOverride/);
  assert.doesNotMatch(focusLandingSource, /fetch\(|\/api\/maintenance|design-lab\/data/);
  assert.doesNotMatch(tomorrowSource, /fetch\(|\/api\/maintenance|design-lab\/data/);
});

test("formal migration keeps user-facing source, knowledge, search, and graph interactions", () => {
  assert.match(materialsSource, /classificationFilter/);
  assert.match(materialsSource, /onOpenDocument/);
  assert.match(collectionSource, /collectionItemMatchesGroup/);
  assert.match(collectionSource, /onOpenDocument\(item\)/);
  assert.match(formalGraphSource, /graph-search-shell/);
  assert.match(formalGraphSource, /activeTypes/);
  assert.match(formalGraphSource, /activeStatuses/);
  assert.match(formalGraphSource, /onOpenDocument\?\.\(selected\.id\)/);
  assert.match(formalGraphSource, /语义视图/);
  assert.match(formalGraphSource, /全量网络/);
  assert.match(formalGraphSource, /design-lab-graph-universe/);
  assert.match(formalGraphSource, /FormalGraphInspector/);
});

test("formal knowledge surfaces use one Chinese-first Workbench title language", () => {
  assert.match(materialsSource, /<h1>资料中心<\/h1>/);
  assert.match(materialsSource, /知识 \/ 资料中心/);
  assert.match(collectionSource, /<h1>知识库<\/h1>/);
  assert.match(collectionSource, /知识 \/ 知识库/);
  assert.match(readSource("src/pages/IngestionPage.jsx"), /title="入库工作台"/);
  assert.match(systemSource, /title="系统与设置"/);
  assert.doesNotMatch(materialsSource, /来源，不只是收藏/);
  assert.doesNotMatch(collectionSource, /把信息变成可以再次调用的判断/);
});

test("formal workflow surfaces use navigation-aligned Chinese page names", () => {
  assert.match(overviewSource, /<h1>今日<\/h1>/);
  assert.match(focusLandingSource, /eyebrow="工作 \/ 专注"/);
  assert.match(reviewSource, /<h1>复盘<\/h1>/);
  assert.match(tomorrowSource, /工作 \/ 明日计划/);
  assert.match(rulesSource, /<h1>工作规则<\/h1>/);
  assert.match(formalGraphSource, /<h1>知识图谱<\/h1>/);
  assert.doesNotMatch(overviewSource, /<h1>今天的工作台<\/h1>/);
  assert.doesNotMatch(reviewSource, /<h1>今日知识复盘<\/h1>/);
  assert.doesNotMatch(rulesSource, /<h1>知识工作规则<\/h1>/);
  assert.doesNotMatch(formalGraphSource, /<h1>知识星图<\/h1>/);
  assert.doesNotMatch(overviewSource, /知识星图/);
  assert.doesNotMatch(systemSource, /知识星图/);
  assert.doesNotMatch(formalGraphSource, /知识星图/);
});

test("formal core workbench surfaces keep user-visible status language Chinese-first", () => {
  const coreSources = [overviewSource, focusLandingSource, focusSource, reviewSource, tomorrowSource, rulesSource, materialsSource, collectionSource, systemSource];
  for (const source of coreSources) {
    assert.doesNotMatch(source, /DEMO VAULT|LOCAL VAULT|LOCAL API OFFLINE|USER DECISIONS PRESERVED|USER AUTHORED|USER OVERRIDE · PRESERVED|NO AUTO CARRY-OVER|VERIFIED BY CURRENT INDEX|ADD EXPLICIT RULE|READ-ONLY DIAGNOSTICS|DRY-RUN PREVIEW/);
  }
  assert.match(overviewSource, /今日队列/);
  assert.match(reviewSource, /当前索引已核验/);
  assert.match(rulesSource, /初始规则不是个人记忆/);
  assert.match(systemSource, /只读诊断/);
});

test("formal routes share the approved V7 visual baseline with an integrated command atmosphere", () => {
  assert.match(mainSource, /styles\/v7-formal\.css/);
  assert.match(formalV7Source, /--ui-canvas:\s*#f3f4f6/);
  assert.match(formalV7Source, /\.sidebar\s*\{/);
  assert.match(formalV7Source, /\.workspace-bar\s*\{/);
  assert.match(formalV7Source, /\.studio-dashboard__grid\s*\{/);
  assert.match(formalV7Source, /\.materials-observatory,/);
  assert.match(formalV7Source, /\.knowledge-atlas-hero\s*\{/);
  assert.match(formalV7Source, /\.graph-stage,/);
  assert.match(formalV7Source, /\.app-shell \.app-main\s*\{/);
  assert.match(formalV7Source, /\.app-shell \.page--collection/);
  assert.match(formalV7Source, /\.app-shell \.graph-page-shell \.graph-page\.graph-page--immersive/);
  assert.match(formalV7Source, /\.formal-command-center\s*\{/);
  assert.match(formalV7Source, /\.formal-command-cosmos\s*\{/);
  assert.match(formalV7Source, /\.formal-command-badge\s*\{/);
  assert.match(formalV7Source, /\.formal-command-progress\s*\{/);
  assert.match(formalV7Source, /\.formal-graph-page\s*\{/);
  assert.match(formalV7Source, /\.formal-graph-inspector\.design-lab-inspector/);
  assert.match(formalV7Source, /\.focus-landing__list/);
  assert.doesNotMatch(formalV7Source, /design-lab\/data|sourceItems|knowledgeItems/);
});

test("formal graph applies the existing performance budget before sending data to the canvas", () => {
  assert.match(formalGraphSource, /getGraphPerformanceBudget/);
  assert.match(formalGraphSource, /selectRenderableNodes/);
  assert.match(formalGraphSource, /selectRenderableLinks/);
  assert.match(formalGraphSource, /nodes=\{renderNodes\}/);
  assert.match(formalGraphSource, /edges=\{renderEdges\}/);
});
