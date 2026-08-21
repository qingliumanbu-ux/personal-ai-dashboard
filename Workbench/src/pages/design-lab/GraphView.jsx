import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IconFileText, IconLibrary } from "@tabler/icons-react";
import { NetworkGraph } from "./NetworkGraph.jsx";
import { StarfieldBackdrop } from "./StarfieldBackdrop.jsx";
import { graphClusterNodes, graphClusters, knowledgeItems } from "./data.js";

export function GraphView({ graphFocus, graphViewport, selectedKnowledge, selectedGraphNode, onGraphFocusChange, onGraphViewportChange, onSelectKnowledge, onSelectGraphNode }) {
  const [graphMode, setGraphMode] = useState("semantic");
  const [level, setLevel] = useState("overview");
  const [cluster, setCluster] = useState(graphClusters[0]);

  const selectedNode = selectedKnowledge || knowledgeItems[0];

  const openCluster = (nextCluster) => {
    setCluster(nextCluster);
    setLevel("cluster");
  };

  const openFocus = (item) => {
    if (item?.real) {
      const realItem = knowledgeItems.find((entry) => entry.id === item.id);
      if (realItem) onSelectKnowledge(realItem);
    }
    setLevel("focus");
  };

  const goBack = () => {
    if (level === "focus") {
      setLevel("cluster");
      return;
    }
    if (level === "cluster") setLevel("overview");
  };

  return (
    <div className="design-lab-view design-lab-view--graph">
      <header className="design-lab-page-head">
        <div>
          <span>关系与上下文</span>
          <h1>知识星图</h1>
          <p>{graphMode === "semantic"
            ? "从主题簇进入局部网络，再聚焦单个知识对象。不同缩放层级只显示当下真正需要的信息。"
            : "把全部知识放进同一张深空网络里探索。主题 Hub、重点知识和普通节点保持清楚层级，滚轮缩放、拖拽平移，放大后逐步显示更多标签。"}</p>
        </div>
        <div className="design-lab-graph-head-controls">
          <div className="design-lab-graph-view-switch" aria-label="星图视图">
            <button className={graphMode === "semantic" ? "is-active" : ""} onClick={() => { setGraphMode("semantic"); onSelectGraphNode(null); }} type="button">语义视图</button>
            <button className={graphMode === "network" ? "is-active" : ""} onClick={() => setGraphMode("network")} type="button">全量网络</button>
          </div>
          {graphMode === "semantic" ? (
            <div className="design-lab-graph-mode-switch" aria-label="星图层级">
              <button className={level === "overview" ? "is-active" : ""} onClick={() => setLevel("overview")} type="button">概览</button>
              <button className={level === "cluster" ? "is-active" : ""} onClick={() => setLevel("cluster")} type="button">领域</button>
              <button className={level === "focus" ? "is-active" : ""} onClick={() => setLevel("focus")} type="button">聚焦</button>
            </div>
          ) : null}
        </div>
      </header>

      {graphMode === "network" ? (
        <NetworkGraph
          graphFocus={graphFocus}
          graphViewport={graphViewport}
          onGraphFocusChange={onGraphFocusChange}
          onGraphViewportChange={onGraphViewportChange}
          onSelectGraphNode={onSelectGraphNode}
          onSelectKnowledge={onSelectKnowledge}
          selectedGraphNode={selectedGraphNode}
          selectedKnowledge={selectedKnowledge}
        />
      ) : (
        <section className="design-lab-graph-stage">
          <div className="design-lab-graph-stage__toolbar">
            <div className="design-lab-graph-breadcrumb">
              {level !== "overview" ? <button onClick={goBack} type="button">←</button> : null}
              <span>知识星图</span>
              {level !== "overview" ? <span>/</span> : null}
              {level !== "overview" ? <strong>{cluster.label}</strong> : null}
              {level === "focus" ? <><span>/</span><strong>{selectedNode.title}</strong></> : null}
            </div>
            <div className="design-lab-graph-scale-copy">
              <strong>{level === "overview" ? "主题簇概览" : level === "cluster" ? `${cluster.label} · 领域网络` : `${selectedNode.title} · 聚焦`}</strong>
              <small>{level === "overview" ? "4 个主题簇 · 69 个知识对象" : level === "cluster" ? "8 个可见对象 · 其余按需展开" : `1 跳关系 · ${selectedNode.relations} 条已知连接`}</small>
            </div>
            <span className="design-lab-graph-zoom-note">语义缩放</span>
          </div>

          <div className="design-lab-semantic-canvas lab-wb-cosmos lab-wb-cosmos--semantic">
            <StarfieldBackdrop variant="semantic" />
            <AnimatePresence mode="wait" initial={false}>
              {level === "overview" ? (
                <motion.div animate={{ opacity: 1, scale: 1 }} className="design-lab-graph-universe" exit={{ opacity: 0, scale: 0.985 }} initial={{ opacity: 0, scale: 1.015 }} key="overview">
                <svg aria-hidden="true" viewBox="0 0 900 430">
                  <path d="M235 225 C350 80 520 92 665 210" />
                  <path d="M235 225 C380 345 555 340 665 210" />
                  <path d="M455 112 C520 160 565 215 604 310" />
                </svg>
                {graphClusters.map((item, index) => (
                  <button className={`design-lab-graph-cluster design-lab-graph-cluster--${index + 1} ${item.className}`} key={item.id} onClick={() => openCluster(item)} type="button">
                    <motion.i whileHover={{ scale: 1.06 }} />
                    <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                    <b>{item.count}</b>
                  </button>
                ))}
                <div className="design-lab-graph-universe__legend"><span>缩放较远：只显示主题簇</span><span>点击一个主题进入领域网络</span></div>
                </motion.div>
              ) : null}

              {level === "cluster" ? (
                <motion.div animate={{ opacity: 1, scale: 1 }} className="design-lab-graph-cluster-stage" exit={{ opacity: 0, scale: 1.012 }} initial={{ opacity: 0, scale: 0.988 }} key={`cluster:${cluster.id}`}>
                <svg aria-hidden="true" viewBox="0 0 900 430">
                  <path d="M172 230 C280 120 390 116 452 218" />
                  <path d="M452 218 C550 106 690 128 756 214" />
                  <path d="M270 316 C390 255 530 258 650 328" />
                  <path d="M452 218 C465 305 535 332 650 328" />
                </svg>
                {graphClusterNodes.map((item, index) => (
                  <button className={`design-lab-graph-semantic-node design-lab-graph-semantic-node--${index + 1} importance-${item.importance}`} key={item.id} onClick={() => openFocus(item)} type="button">
                    <i />
                    <span>{item.importance >= 2 ? item.label : ""}</span>
                  </button>
                ))}
                <div className="design-lab-graph-density-note"><strong>{cluster.label}</strong><span>仅 8 个对象可见 · 次要节点隐藏标签</span></div>
                </motion.div>
              ) : null}

              {level === "focus" ? (
                <motion.div animate={{ opacity: 1, scale: 1 }} className="design-lab-graph-focus-stage" exit={{ opacity: 0, scale: 1.015 }} initial={{ opacity: 0, scale: 0.985 }} key={`focus:${selectedNode.id}`}>
                <svg aria-hidden="true" viewBox="0 0 900 430">
                  <path className="is-active" d="M450 214 C340 126 260 120 170 174" />
                  <path className="is-active" d="M450 214 C572 112 675 128 748 184" />
                  <path d="M450 214 C330 316 246 322 166 298" />
                  <path d="M450 214 C572 312 666 314 750 292" />
                </svg>
                <button className="design-lab-graph-focus-node is-center" onClick={() => onSelectKnowledge(selectedNode)} type="button">
                  <span><IconLibrary aria-hidden="true" /></span>
                  <div><strong>{selectedNode.title}</strong><small>{selectedNode.kind} · 当前焦点</small></div>
                </button>
                {knowledgeItems.filter((item) => item.id !== selectedNode.id).slice(0, 3).map((item, index) => (
                  <button className={`design-lab-graph-focus-node design-lab-graph-focus-node--${index + 1}`} key={item.id} onClick={() => { onSelectKnowledge(item); setLevel("focus"); }} type="button">
                    <i />
                    <div><strong>{item.title}</strong><small>{item.kind} · 1 跳</small></div>
                  </button>
                ))}
                <div className="design-lab-graph-source design-lab-graph-source--1"><IconFileText /><span>本地优先的 AI 工作台架构</span></div>
                <div className="design-lab-graph-source design-lab-graph-source--2"><IconFileText /><span>带明确类型的结构化知识对象</span></div>
                <div className="design-lab-graph-focus-hint">聚焦模式只显示当前知识、直接关系与必要来源</div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </section>
      )}
    </div>
  );
}
