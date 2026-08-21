import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowUpRight,
  IconChevronRight,
  IconLibrary,
  IconLink,
  IconSearch,
} from "@tabler/icons-react";
import { KnowledgeGraph } from "../components/KnowledgeGraph";
import { StarfieldBackdrop } from "../components/StarfieldBackdrop.jsx";
import {
  getGraphPerformanceBudget,
  selectRenderableLinks,
  selectRenderableNodes,
} from "../graph/graph-performance-budget.js";
import { loadGraph } from "../lib/api";
import { formatCompactDate, statusLabel } from "../lib/format";
import { typeLabelOf } from "../lib/graph";
import { NetworkGraph } from "./design-lab/NetworkGraph.jsx";
import {
  graphClusterNodes as demoGraphClusterNodes,
  graphClusters as demoGraphClusters,
  knowledgeItems as demoKnowledgeItems,
} from "./design-lab/data.js";

const CLUSTER_CLASSES = ["is-ai", "is-knowledge", "is-product", "is-growth"];

function edgeIds(edge) {
  return {
    source: typeof edge.source === "object" ? edge.source.id : edge.source,
    target: typeof edge.target === "object" ? edge.target.id : edge.target,
  };
}

function demoKnowledgeNode(item) {
  if (!item) return null;
  return {
    ...item,
    demo: true,
    type: "demo",
    degree: item.relations ?? 0,
  };
}

function fallbackDemoNode(item) {
  return {
    id: item.id,
    title: item.label,
    kind: item.importance >= 3 ? "重点知识" : "知识节点",
    status: "合成演示",
    relations: item.importance >= 3 ? 6 : 2,
    summary: "用于正式前台视觉验收的合成知识节点，不代表真实 Vault 内容。",
    demo: true,
    type: "demo",
  };
}

function semanticNodeLabel(node) {
  return node?.title || node?.label || "未命名知识";
}

function FormalGraphInspector({ collapsed, demoMode, graphMode, item, onOpenDocument, onShowRelations, onToggle }) {
  if (collapsed) {
    return (
      <aside className="design-lab-inspector design-lab-inspector--collapsed formal-graph-inspector">
        <button aria-label="展开检查器" className="design-lab-inspector__toggle" onClick={onToggle} type="button">
          <IconChevronRight aria-hidden="true" />
        </button>
        <span className="design-lab-inspector__rail-label">检查</span>
      </aside>
    );
  }

  const relationCount = item?.relations ?? item?.degree ?? 0;
  const itemStatus = item?.status ? statusLabel(item.status) : "自由探索";
  const typeLabel = item?.kind || (item?.type ? typeLabelOf(item.type) : "知识节点");
  const summary = item
    ? item.summary || `当前节点有 ${relationCount} 条直接关系。选择相邻节点可以继续收窄上下文。`
    : "当前没有锁定知识节点。你可以自由缩放和平移；只有明确点击节点后，图谱才进入该节点的关系聚焦。";

  return (
    <aside className="design-lab-inspector formal-graph-inspector">
      <div className="design-lab-inspector__head">
        <span>{item ? (demoMode ? "演示知识节点" : "知识节点") : "知识图谱"}</span>
        <div>
          <button aria-label="收起检查器" className="design-lab-inspector__toggle" onClick={onToggle} type="button">
            <IconChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>
      <h2>{item ? semanticNodeLabel(item) : "未选择节点"}</h2>
      <p>{summary}</p>
      <dl>
        {item ? (
          <>
            <div><dt>类型</dt><dd>{typeLabel}</dd></div>
            <div><dt>状态</dt><dd>{demoMode ? "Demo · 合成数据" : itemStatus}</dd></div>
            <div><dt>直接关系</dt><dd>{relationCount} 条</dd></div>
            <div><dt>视图</dt><dd>{graphMode === "semantic" ? "语义聚焦" : "全量网络"}</dd></div>
          </>
        ) : (
          <>
            <div><dt>状态</dt><dd>自由探索</dd></div>
            <div><dt>操作</dt><dd>点击节点查看详情</dd></div>
            <div><dt>缩放</dt><dd>以鼠标位置为中心</dd></div>
            <div><dt>数据</dt><dd>{demoMode ? "Demo · 合成数据" : "本地 Vault"}</dd></div>
          </>
        )}
      </dl>
      <div className="design-lab-inspector__section">
        <span>网络上下文</span>
        <button disabled={!item} onClick={() => onShowRelations?.(item)} type="button"><IconLink aria-hidden="true" /> 查看直接关系 <IconChevronRight aria-hidden="true" /></button>
        {item && !demoMode ? (
          <button onClick={() => onOpenDocument?.(item.id)} type="button">
            <IconLibrary aria-hidden="true" /> 打开对应知识对象 <IconArrowUpRight aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {demoMode ? <div className="formal-graph-demo-note">合成演示只用于当前前台展示，不写入 Vault 或 Workbench authoritative state。</div> : null}
    </aside>
  );
}

export function FormalGraphPage({ onOpenDocument }) {
  const searchRef = useRef(null);
  const [result, setResult] = useState(null);
  const [graphMode, setGraphMode] = useState("semantic");
  const [level, setLevel] = useState("overview");
  const [clusterId, setClusterId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState(() => new Set());
  const [activeStatuses, setActiveStatuses] = useState(() => new Set());
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [selectedGraphNode, setSelectedGraphNode] = useState(null);
  const [selectedKnowledge, setSelectedKnowledge] = useState(null);
  const [graphFocus, setGraphFocus] = useState(null);
  const [graphViewport, setGraphViewport] = useState({ scale: 0.86, pan: { x: 84, y: 48 } });

  useEffect(() => {
    let cancelled = false;
    loadGraph().then((response) => {
      if (!cancelled) setResult(response);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (!typing && graphMode === "network") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [graphMode]);

  const data = result?.data;
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const useDemo = Boolean(result) && nodes.length < 4;

  const realClusters = useMemo(() => {
    const byType = new Map();
    nodes.forEach((node) => {
      const type = node.type || "unknown";
      const current = byType.get(type) || [];
      current.push(node);
      byType.set(type, current);
    });
    return [...byType.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4)
      .map(([type, clusterNodes], index) => ({
        id: type,
        type,
        label: typeLabelOf(type),
        count: clusterNodes.length,
        detail: `${clusterNodes.length} 个对象 · ${clusterNodes.reduce((sum, node) => sum + (node.degree || 0), 0)} 条连接`,
        className: CLUSTER_CLASSES[index] || "is-knowledge",
      }));
  }, [nodes]);

  const semanticClusters = useDemo ? demoGraphClusters : realClusters;
  const totalSemanticCount = useDemo
    ? demoGraphClusters.reduce((sum, item) => sum + item.count, 0)
    : nodes.length;

  useEffect(() => {
    if (!semanticClusters.length) return;
    if (!clusterId || !semanticClusters.some((item) => item.id === clusterId)) {
      setClusterId(semanticClusters[0].id);
    }
  }, [clusterId, semanticClusters]);

  const activeCluster = semanticClusters.find((item) => item.id === clusterId) || semanticClusters[0] || null;

  const semanticClusterNodes = useMemo(() => {
    if (useDemo) return demoGraphClusterNodes;
    if (!activeCluster) return [];
    return nodes
      .filter((node) => node.type === activeCluster.type)
      .sort((a, b) => (b.degree || 0) - (a.degree || 0))
      .slice(0, 8)
      .map((node, index) => ({
        id: node.id,
        label: node.title,
        importance: index < 2 ? 3 : index < 5 ? 2 : 1,
        real: true,
        node,
      }));
  }, [activeCluster, nodes, useDemo]);

  const focusRelations = useMemo(() => {
    if (!selected) return [];
    if (useDemo) {
      return demoKnowledgeItems
        .filter((item) => item.id !== selected.id)
        .slice(0, 3)
        .map(demoKnowledgeNode);
    }
    const neighborIds = new Set();
    edges.forEach((edge) => {
      const { source, target } = edgeIds(edge);
      if (source === selected.id) neighborIds.add(target);
      if (target === selected.id) neighborIds.add(source);
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return [...neighborIds].map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
  }, [edges, nodes, selected, useDemo]);

  const typeEntries = useMemo(() => Object.entries(data?.typeCounts ?? {}).sort((a, b) => b[1] - a[1]), [data]);
  const statusEntries = useMemo(() => {
    const counts = {};
    nodes.forEach((node) => {
      const key = node.status ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  const filteredNodes = useMemo(() => nodes.filter((node) => {
    if (activeTypes.size && !activeTypes.has(node.type)) return false;
    if (activeStatuses.size && !activeStatuses.has(node.status ?? "unknown")) return false;
    return true;
  }), [activeStatuses, activeTypes, nodes]);

  const searchResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return [];
    return filteredNodes
      .filter((node) => [node.title, node.section, node.type, ...(node.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(normalized))
      .sort((a, b) => (b.degree || 0) - (a.degree || 0))
      .slice(0, 7);
  }, [filteredNodes, query]);

  const searchMatchIds = useMemo(() => new Set(searchResults.map((node) => node.id)), [searchResults]);
  const graphBudget = useMemo(() => getGraphPerformanceBudget({
    mode: "auto",
    nodeCount: filteredNodes.length,
    linkCount: edges.length,
    reducedMotion: typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  }), [edges.length, filteredNodes.length]);
  const renderNodes = useMemo(() => selectRenderableNodes(filteredNodes, graphBudget, {
    activeId: selected?.id ?? null,
    searchMatchIds,
  }), [filteredNodes, graphBudget, searchMatchIds, selected?.id]);
  const renderNodeIds = useMemo(() => new Set(renderNodes.map((node) => node.id)), [renderNodes]);
  const renderEdges = useMemo(() => selectRenderableLinks(
    edges.filter((edge) => {
      const { source, target } = edgeIds(edge);
      return renderNodeIds.has(source) && renderNodeIds.has(target);
    }),
    renderNodes,
    graphBudget,
    { activeId: selected?.id ?? null },
  ), [edges, graphBudget, renderNodeIds, renderNodes, selected?.id]);

  const selectSemanticNode = (item) => {
    if (useDemo) {
      const demoItem = demoKnowledgeItems.find((entry) => entry.id === item.id);
      setSelected(demoKnowledgeNode(demoItem) || fallbackDemoNode(item));
    } else {
      setSelected(item.node || nodes.find((node) => node.id === item.id) || null);
    }
    setLevel("focus");
  };

  const selectCluster = (cluster) => {
    setClusterId(cluster.id);
    setSelected(null);
    setLevel("cluster");
  };

  const goBack = () => {
    if (level === "focus") {
      setLevel("cluster");
      return;
    }
    setLevel("overview");
  };

  const toggleSetValue = (setter, value) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  if (!result) {
    return <div className="formal-graph-loading"><span className="eyebrow">知识 / 图谱</span><h1>知识图谱</h1><div className="skeleton graph-loading" /></div>;
  }

  const inspectorItem = graphMode === "network" && useDemo
    ? selectedGraphNode || (selectedKnowledge ? demoKnowledgeNode(selectedKnowledge) : null)
    : selected;

  return (
    <div className={`formal-graph-page${inspectorCollapsed ? " is-inspector-collapsed" : ""}`}>
      <section className="formal-graph-primary">
        <header className="design-lab-page-head formal-graph-head">
          <div>
            <span>知识 / 图谱</span>
            <h1>知识图谱</h1>
            <p>{graphMode === "semantic"
              ? "从主题簇进入局部网络，再聚焦单个知识对象。不同缩放层级只显示当下真正需要的信息。"
              : "把全部知识放进同一张网络里探索。滚轮缩放、拖拽平移，放大后逐步查看更多关系。"}</p>
          </div>
          <div className="design-lab-graph-head-controls">
            <div className="design-lab-graph-view-switch" aria-label="星图视图">
              <button className={graphMode === "semantic" ? "is-active" : ""} onClick={() => { setGraphMode("semantic"); setSelectedGraphNode(null); }} type="button">语义视图</button>
              <button className={graphMode === "network" ? "is-active" : ""} onClick={() => setGraphMode("network")} type="button">全量网络</button>
            </div>
            {graphMode === "semantic" ? (
              <div className="design-lab-graph-mode-switch" aria-label="星图层级">
                <button className={level === "overview" ? "is-active" : ""} onClick={() => { setLevel("overview"); setSelected(null); }} type="button">概览</button>
                <button className={level === "cluster" ? "is-active" : ""} onClick={() => setLevel("cluster")} type="button">领域</button>
                <button className={level === "focus" ? "is-active" : ""} onClick={() => setLevel("focus")} type="button">聚焦</button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="formal-graph-source-strip">
          <span className={useDemo ? "is-demo" : "is-live"} />
          <strong>{useDemo ? "Demo · 合成数据" : "本地 Vault"}</strong>
          <small>{useDemo
            ? `真实图谱当前只有 ${nodes.length} 个节点，暂用已验收合成网络补足视觉与交互；不会写入 Vault。`
            : `${nodes.length} 个知识对象 · ${edges.length} 条已解析关系 · ${formatCompactDate(data.generatedAt, true)}`}</small>
        </div>

        {graphMode === "semantic" ? (
          <section className="design-lab-graph-stage formal-graph-semantic-stage">
            <div className="design-lab-graph-stage__toolbar">
              <div className="design-lab-graph-breadcrumb">
                {level !== "overview" ? <button onClick={goBack} type="button">←</button> : null}
                <span>知识图谱</span>
                {level !== "overview" && activeCluster ? <><span>/</span><strong>{activeCluster.label}</strong></> : null}
                {level === "focus" && selected ? <><span>/</span><strong>{semanticNodeLabel(selected)}</strong></> : null}
              </div>
              <div className="design-lab-graph-scale-copy">
                <strong>{level === "overview" ? "主题簇概览" : level === "cluster" ? `${activeCluster?.label || "领域"} · 领域网络` : `${semanticNodeLabel(selected)} · 聚焦`}</strong>
                <small>{level === "overview"
                  ? `${semanticClusters.length} 个主题簇 · ${totalSemanticCount} 个知识对象`
                  : level === "cluster"
                    ? `${semanticClusterNodes.length} 个可见对象 · 其余按需展开`
                    : `1 跳关系 · ${selected?.relations ?? selected?.degree ?? 0} 条已知连接`}</small>
              </div>
              <span className="design-lab-graph-zoom-note">语义缩放</span>
            </div>

            <div className="design-lab-semantic-canvas lab-wb-cosmos lab-wb-cosmos--semantic">
              <StarfieldBackdrop variant="semantic" />
              {level === "overview" ? (
                <div className="design-lab-graph-universe">
                  <svg aria-hidden="true" viewBox="0 0 900 430">
                    <path d="M235 225 C350 80 520 92 665 210" />
                    <path d="M235 225 C380 345 555 340 665 210" />
                    <path d="M455 112 C520 160 565 215 604 310" />
                  </svg>
                  {semanticClusters.map((item, index) => (
                    <button className={`design-lab-graph-cluster design-lab-graph-cluster--${index + 1} ${item.className || ""}`} key={item.id} onClick={() => selectCluster(item)} type="button">
                      <i />
                      <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                      <b>{item.count}</b>
                    </button>
                  ))}
                  <div className="design-lab-graph-universe__legend"><span>缩放较远：只显示主题簇</span><span>点击一个主题进入领域网络</span></div>
                </div>
              ) : null}

              {level === "cluster" ? (
                <div className="design-lab-graph-cluster-stage">
                  <svg aria-hidden="true" viewBox="0 0 900 430">
                    <path d="M172 230 C280 120 390 116 452 218" />
                    <path d="M452 218 C550 106 690 128 756 214" />
                    <path d="M270 316 C390 255 530 258 650 328" />
                    <path d="M452 218 C465 305 535 332 650 328" />
                  </svg>
                  {semanticClusterNodes.map((item, index) => (
                    <button className={`design-lab-graph-semantic-node design-lab-graph-semantic-node--${index + 1} importance-${item.importance}`} key={item.id} onClick={() => selectSemanticNode(item)} type="button">
                      <i />
                      <span>{item.importance >= 2 ? item.label : ""}</span>
                    </button>
                  ))}
                  <div className="design-lab-graph-density-note"><strong>{activeCluster?.label || "知识领域"}</strong><span>仅显示关键对象 · 次要节点隐藏标签</span></div>
                </div>
              ) : null}

              {level === "focus" ? (
                <div className="design-lab-graph-focus-stage">
                  <svg aria-hidden="true" viewBox="0 0 900 430">
                    <path className="is-active" d="M450 214 C340 126 260 120 170 174" />
                    <path className="is-active" d="M450 214 C572 112 675 128 748 184" />
                    <path d="M450 214 C330 316 246 322 166 298" />
                    <path d="M450 214 C572 312 666 314 750 292" />
                  </svg>
                  {selected ? (
                    <button className="design-lab-graph-focus-node is-center" onClick={() => !useDemo && onOpenDocument?.(selected.id)} type="button">
                      <span><IconLibrary aria-hidden="true" /></span>
                      <div><strong>{semanticNodeLabel(selected)}</strong><small>{selected.kind || (selected.type ? typeLabelOf(selected.type) : "知识")} · 当前焦点</small></div>
                    </button>
                  ) : null}
                  {focusRelations.map((item, index) => (
                    <button className={`design-lab-graph-focus-node design-lab-graph-focus-node--${index + 1}`} key={item.id} onClick={() => setSelected(item)} type="button">
                      <i />
                      <div><strong>{semanticNodeLabel(item)}</strong><small>{item.kind || (item.type ? typeLabelOf(item.type) : "知识")} · 1 跳</small></div>
                    </button>
                  ))}
                  <div className="design-lab-graph-focus-hint">聚焦模式只显示当前知识、直接关系与必要来源</div>
                </div>
              ) : null}
            </div>
          </section>
        ) : useDemo ? (
          <NetworkGraph
            graphFocus={graphFocus}
            graphViewport={graphViewport}
            onGraphFocusChange={setGraphFocus}
            onGraphViewportChange={setGraphViewport}
            onSelectGraphNode={setSelectedGraphNode}
            onSelectKnowledge={setSelectedKnowledge}
            selectedGraphNode={selectedGraphNode}
            selectedKnowledge={selectedKnowledge}
          />
        ) : (
          <section className="formal-graph-network-real">
            <div className="formal-graph-network-toolbar">
              <label className="graph-search-shell formal-graph-search">
                <IconSearch aria-hidden="true" />
                <input
                  aria-label="搜索图谱节点"
                  autoComplete="off"
                  name="graph-search"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && searchResults[0]) setSelected(searchResults[0]);
                    if (event.key === "Escape") setQuery("");
                  }}
                  placeholder={`搜索 ${nodes.length} 个知识对象…`}
                  ref={searchRef}
                  type="search"
                  value={query}
                />
                <kbd>/</kbd>
              </label>
              <div className="formal-graph-filter-row">
                {typeEntries.slice(0, 4).map(([type, count]) => (
                  <button className={activeTypes.has(type) ? "is-active" : ""} key={type} onClick={() => toggleSetValue(setActiveTypes, type)} type="button">{typeLabelOf(type)} <span>{count}</span></button>
                ))}
                {statusEntries.slice(0, 3).map(([status, count]) => (
                  <button className={activeStatuses.has(status) ? "is-active" : ""} key={status} onClick={() => toggleSetValue(setActiveStatuses, status)} type="button">{statusLabel(status)} <span>{count}</span></button>
                ))}
              </div>
            </div>
            <div className="formal-graph-network-canvas">
              <KnowledgeGraph
                activeStatuses={activeStatuses}
                activeTypes={activeTypes}
                edges={renderEdges}
                nodes={renderNodes}
                onActivate={(node) => onOpenDocument?.(node.id)}
                onSelect={setSelected}
                selectedId={selected?.id ?? null}
                viewportInsets={{ top: 24, right: 24, bottom: 24, left: 24 }}
              />
            </div>
          </section>
        )}
      </section>

      <FormalGraphInspector
        collapsed={inspectorCollapsed}
        demoMode={useDemo}
        graphMode={graphMode}
        item={inspectorItem}
        onOpenDocument={onOpenDocument}
        onShowRelations={(item) => {
          if (!item) return;
          setSelected(item);
          setGraphMode("semantic");
          setLevel("focus");
        }}
        onToggle={() => setInspectorCollapsed((value) => !value)}
      />
    </div>
  );
}
