import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  IconCalendarClock,
  IconChecklist,
  IconClock,
  IconHome,
  IconInbox,
  IconLibrary,
  IconListCheck,
  IconSearch,
  IconSettings,
  IconStack2,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { LabCommandPalette } from "./design-lab/CommandPalette.jsx";
import { GraphView } from "./design-lab/GraphView.jsx";
import { Inspector } from "./design-lab/Inspector.jsx";
import { KnowledgeView, SourcesView, TodayView } from "./design-lab/WorkspaceViews.jsx";
import {
  CommandCenterView,
  FocusPrototypeView,
  IngestionPrototypeView,
  ReviewPrototypeView,
  RulesPrototypeView,
  SystemPrototypeView,
  TomorrowPrototypeView,
} from "./design-lab/UnifiedWorkbenchViews.jsx";
import {
  constellationEdges,
  knowledgeItems,
  knowledgeLinks,
  recentItems,
  sourceItems,
  sourceKnowledgeLinks,
} from "./design-lab/data.js";

const views = [
  { key: "command", label: "指挥中心", icon: IconHome, section: "home" },
  { key: "today", label: "今日", icon: IconHome, section: "work" },
  { key: "focus", label: "专注", icon: IconClock, section: "work" },
  { key: "review", label: "复盘", icon: IconListCheck, section: "work" },
  { key: "tomorrow", label: "明日计划", icon: IconCalendarClock, section: "work" },
  { key: "rules", label: "工作规则", icon: IconChecklist, section: "work" },
  { key: "ingestion", label: "入库", icon: IconInbox, section: "knowledge" },
  { key: "sources", label: "资料中心", icon: IconStack2, section: "knowledge" },
  { key: "knowledge", label: "知识库", icon: IconLibrary, section: "knowledge" },
  { key: "graph", label: "知识图谱", icon: IconTopologyStar3, section: "knowledge" },
  { key: "system", label: "系统与设置", icon: IconSettings, section: "system" },
];

const navSections = [
  ["work", "工作"],
  ["knowledge", "知识"],
  ["system", "系统"],
];

function NavItem({ active, icon: Icon, label, onClick }) {
  return (
    <button className={`design-lab-nav__item${active ? " is-active" : ""}`} onClick={onClick} type="button">
      {active ? <motion.span className="design-lab-nav__active-pill" layoutId="design-lab-nav-active" /> : null}
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function DesignLabPage() {
  const [view, setView] = useState("command");
  const [selectedSource, setSelectedSource] = useState(sourceItems[0]);
  const [selectedKnowledge, setSelectedKnowledge] = useState(knowledgeItems[0]);
  const [selectedGraphNode, setSelectedGraphNode] = useState(null);
  const [graphFocus, setGraphFocus] = useState(null);
  const [graphViewport, setGraphViewport] = useState({ scale: 0.86, pan: { x: 84, y: 48 } });
  const [originSource, setOriginSource] = useState(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const showInspector = ["today", "sources", "knowledge", "graph"].includes(view);

  const inspectorMode = view === "sources"
    ? "sources"
    : view === "graph" && selectedGraphNode
      ? "network"
      : view === "graph"
        ? "graph"
        : view === "knowledge"
          ? "knowledge"
          : "today";
  const inspectorItem = view === "sources"
    ? selectedSource
    : view === "graph" && selectedGraphNode
      ? selectedGraphNode
      : view === "knowledge"
        ? selectedKnowledge
        : null;

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setCommandQuery("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectCommand = (action) => {
    if (action.type === "view") setView(action.value);
    if (action.type === "source") {
      setSelectedSource(action.value);
      setOriginSource(action.value);
      setView("sources");
    }
    if (action.type === "knowledge") {
      setSelectedKnowledge(action.value);
      setSelectedGraphNode(null);
      setOriginSource(null);
      setView("knowledge");
    }
    setCommandOpen(false);
    setCommandQuery("");
  };

  const openKnowledge = (knowledge, source = null) => {
    setSelectedKnowledge(knowledge);
    setSelectedGraphNode(null);
    setOriginSource(source);
    setView("knowledge");
  };

  const openSource = (source) => {
    setSelectedSource(source);
    setOriginSource(source);
    setView("sources");
  };

  const openGraph = (knowledge) => {
    if (knowledge) setSelectedKnowledge(knowledge);
    setSelectedGraphNode(null);
    setGraphFocus(knowledge ? { knowledgeId: knowledge.id } : null);
    setView("graph");
  };

  const updateWorkspaceLight = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--lab-pointer-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--lab-pointer-y", `${event.clientY - rect.top}px`);
  };

  return (
    <div className="design-lab">
      <aside className="design-lab-nav">
        <div className="design-lab-brand">
          <span className="design-lab-brand__mark">W</span>
          <div><strong>个人 AI</strong><small>知识工作台</small></div>
        </div>

        <button className="design-lab-search" onClick={() => setCommandOpen(true)} type="button"><IconSearch aria-hidden="true" /><span>搜索</span><kbd>⌘ K</kbd></button>

        <nav>
          {views.filter((item) => item.section === "home").map((item) => (
            <NavItem active={view === item.key} icon={item.icon} key={item.key} label={item.label} onClick={() => setView(item.key)} />
          ))}
          {navSections.map(([section, label]) => (
            <div className="design-lab-nav__group" key={section}>
              <span className="design-lab-nav__label">{label}</span>
              {views.filter((item) => item.section === section).map((item) => (
                <NavItem active={view === item.key} icon={item.icon} key={item.key} label={item.label} onClick={() => setView(item.key)} />
              ))}
            </div>
          ))}
        </nav>

        <div className="design-lab-prototype-boundary">
          <span>原型边界</span>
          <strong>仅使用合成演示数据</strong>
          <small>不连接正式工作台状态，不写入知识库。</small>
        </div>

        <div className="design-lab-nav__footer">
          <span className="design-lab-sync-dot" />
          <span>合成演示数据</span>
        </div>
      </aside>

      <div className="design-lab-workspace">
        <header className="design-lab-topbar">
          <div><strong>个人 AI 工作台</strong><span>/</span><span>{views.find((item) => item.key === view)?.label || "指挥中心"}</span></div>
          <button onClick={() => setCommandOpen(true)} type="button"><IconSearch aria-hidden="true" /> 搜索、打开或执行命令 <kbd>⌘ K</kbd></button>
          <span className="design-lab-topbar__status"><i /> 原型 · 合成数据</span>
        </header>

        <div className={`design-lab-content-grid${!showInspector ? " is-inspector-hidden" : inspectorCollapsed ? " is-inspector-collapsed" : ""}`}>
          <main className="design-lab-main" onPointerMove={updateWorkspaceLight}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                animate={{ opacity: 1, x: 0, y: 0 }}
                className="design-lab-stage"
                exit={{ opacity: 0, x: -8, y: 2 }}
                initial={{ opacity: 0, x: 10, y: 2 }}
                key={view}
                transition={{ duration: 0.19, ease: [0.22, 1, 0.36, 1] }}
              >
                {view === "sources" ? <SourcesView onSelect={setSelectedSource} selected={selectedSource} sourceItems={sourceItems} /> : null}
                {view === "knowledge" ? <KnowledgeView constellationEdges={constellationEdges} knowledgeItems={knowledgeItems} onSelect={setSelectedKnowledge} selected={selectedKnowledge} /> : null}
                {view === "graph" ? (
                  <GraphView
                    graphFocus={graphFocus}
                    graphViewport={graphViewport}
                    onGraphFocusChange={setGraphFocus}
                    onGraphViewportChange={setGraphViewport}
                    onSelectGraphNode={setSelectedGraphNode}
                    onSelectKnowledge={setSelectedKnowledge}
                    selectedGraphNode={selectedGraphNode}
                    selectedKnowledge={selectedKnowledge}
                  />
                ) : null}
                {view === "command" ? <CommandCenterView onOpen={setView} /> : null}
                {view === "today" ? <TodayView recentItems={recentItems} /> : null}
                {view === "focus" ? <FocusPrototypeView /> : null}
                {view === "ingestion" ? <IngestionPrototypeView /> : null}
                {view === "review" ? <ReviewPrototypeView /> : null}
                {view === "tomorrow" ? <TomorrowPrototypeView /> : null}
                {view === "rules" ? <RulesPrototypeView /> : null}
                {view === "system" ? <SystemPrototypeView /> : null}
              </motion.div>
            </AnimatePresence>
          </main>

          {showInspector ? (
            <AnimatePresence mode="wait" initial={false}>
              <Inspector
                collapsed={inspectorCollapsed}
                item={inspectorItem}
                key={`${inspectorMode}:${inspectorItem?.id || "default"}:${inspectorCollapsed ? "collapsed" : "open"}`}
                knowledgeItems={knowledgeItems}
                knowledgeLinks={knowledgeLinks}
                mode={inspectorMode}
                onOpenGraph={openGraph}
                onOpenKnowledge={openKnowledge}
                onOpenSource={openSource}
                onToggleCollapsed={() => setInspectorCollapsed((value) => !value)}
                originSource={originSource}
                sourceItems={sourceItems}
                sourceKnowledgeLinks={sourceKnowledgeLinks}
              />
            </AnimatePresence>
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {commandOpen ? (
          <LabCommandPalette
            knowledgeItems={knowledgeItems}
            onClose={() => {
              setCommandOpen(false);
              setCommandQuery("");
            }}
            onQueryChange={setCommandQuery}
            onSelect={selectCommand}
            open={commandOpen}
            query={commandQuery}
            sourceItems={sourceItems}
            views={views}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
