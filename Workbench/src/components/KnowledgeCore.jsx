import { useMemo, useState } from "react";
import { IconArrowUpRight } from "@tabler/icons-react";

function edgeIds(edge) {
  return {
    source: typeof edge.source === "object" ? edge.source.id : edge.source,
    target: typeof edge.target === "object" ? edge.target.id : edge.target,
  };
}

function compactTitle(value, max = 12) {
  const text = String(value || "未命名知识");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildScene(nodes, edges) {
  const selectedNodes = [...nodes]
    .sort((a, b) => (b.degree || 0) - (a.degree || 0) || String(a.title).localeCompare(String(b.title), "zh-CN"))
    .slice(0, 10);

  if (selectedNodes.length === 0) return { nodes: [], edges: [] };

  const centerX = 180;
  const centerY = 132;
  const sceneNodes = selectedNodes.map((node, index) => {
    if (index === 0) {
      return { ...node, x: centerX, y: centerY, radius: 13, sceneIndex: index };
    }

    const ring = index <= 5 ? 1 : 2;
    const ringItems = ring === 1 ? Math.min(5, selectedNodes.length - 1) : Math.max(1, selectedNodes.length - 6);
    const ringIndex = ring === 1 ? index - 1 : index - 6;
    const angle = (ringIndex / ringItems) * Math.PI * 2 - Math.PI / 2 + (ring === 2 ? 0.38 : 0);
    const radiusX = ring === 1 ? 76 : 126;
    const radiusY = ring === 1 ? 58 : 92;
    return {
      ...node,
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
      radius: Math.max(5.5, Math.min(9, 5.5 + (node.degree || 0) * 0.65)),
      sceneIndex: index,
    };
  });

  const nodeMap = new Map(sceneNodes.map((node) => [node.id, node]));
  const sceneEdges = edges
    .map((edge) => ({ ...edgeIds(edge), weight: Math.max(1, Number(edge.weight) || 1) }))
    .filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target))
    .slice(0, 18)
    .map((edge) => ({
      ...edge,
      sourceNode: nodeMap.get(edge.source),
      targetNode: nodeMap.get(edge.target),
    }));

  return { nodes: sceneNodes, edges: sceneEdges };
}

export function KnowledgeCore({ nodes = [], edges = [], metrics = {}, ready = false, onOpenGraph }) {
  const [hoveredId, setHoveredId] = useState(null);
  const scene = useMemo(() => buildScene(nodes, edges), [nodes, edges]);
  const hoveredNode = scene.nodes.find((node) => node.id === hoveredId) || null;
  const edgeCount = edges.length;
  const nodeCount = nodes.length;
  const density = nodeCount > 1 ? Math.min(99, Math.round((edgeCount / (nodeCount * 1.5)) * 100)) : 0;
  const mode = edgeCount > 0 && nodeCount > 1 ? "关系已就绪" : nodeCount > 0 ? "知识起步" : "等待索引";

  return (
    <button
      aria-label={`打开知识图谱。当前 ${nodeCount} 个知识节点，${edgeCount} 条连接。`}
      className={`knowledge-core${ready ? " knowledge-core--ready" : ""}`}
      onClick={onOpenGraph}
      type="button"
    >
      <span className="knowledge-core__halo" aria-hidden="true" />
      <span className="knowledge-core__scan" aria-hidden="true" />

      <span className="knowledge-core__eyebrow mono">
        <span className="knowledge-core__live-dot" aria-hidden="true" />
        AI 知识核心
      </span>

      <svg
        aria-hidden="true"
        className="knowledge-core__scene"
        preserveAspectRatio="xMidYMid meet"
        viewBox="0 0 360 270"
      >
        <defs>
          <radialGradient id="knowledge-core-node" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#f7f4ff" />
            <stop offset="32%" stopColor="#a995ff" />
            <stop offset="100%" stopColor="#7658ff" />
          </radialGradient>
          <linearGradient id="knowledge-core-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8c73ff" stopOpacity="0.14" />
            <stop offset="50%" stopColor="#b8a9ff" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#66b6ff" stopOpacity="0.16" />
          </linearGradient>
          <filter id="knowledge-core-glow" x="-200%" y="-200%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <ellipse className="knowledge-core__orbit knowledge-core__orbit--outer" cx="180" cy="132" rx="145" ry="105" />
        <ellipse className="knowledge-core__orbit knowledge-core__orbit--mid" cx="180" cy="132" rx="103" ry="76" />
        <ellipse className="knowledge-core__orbit knowledge-core__orbit--inner" cx="180" cy="132" rx="58" ry="44" />

        {scene.edges.map((edge) => {
          const active = hoveredId && (edge.source === hoveredId || edge.target === hoveredId);
          return (
            <line
              className={`knowledge-core__edge${active ? " is-active" : ""}`}
              key={`${edge.source}-${edge.target}`}
              stroke="url(#knowledge-core-edge)"
              strokeWidth={Math.min(2.4, 0.75 + edge.weight * 0.28)}
              x1={edge.sourceNode.x}
              x2={edge.targetNode.x}
              y1={edge.sourceNode.y}
              y2={edge.targetNode.y}
            />
          );
        })}

        {scene.nodes.length === 1 ? (
          <>
            <line className="knowledge-core__seed-line" x1="180" x2="102" y1="132" y2="72" />
            <line className="knowledge-core__seed-line" x1="180" x2="284" y1="132" y2="92" />
            <line className="knowledge-core__seed-line" x1="180" x2="257" y1="132" y2="215" />
            <circle className="knowledge-core__seed-point" cx="102" cy="72" r="3" />
            <circle className="knowledge-core__seed-point" cx="284" cy="92" r="3" />
            <circle className="knowledge-core__seed-point" cx="257" cy="215" r="3" />
          </>
        ) : null}

        {scene.nodes.map((node) => {
          const active = hoveredId === node.id;
          const connected = hoveredId
            ? scene.edges.some((edge) =>
                (edge.source === hoveredId && edge.target === node.id) ||
                (edge.target === hoveredId && edge.source === node.id),
              )
            : false;
          return (
            <g
              className={`knowledge-core__node${active ? " is-active" : ""}${connected ? " is-connected" : ""}`}
              key={node.id}
              onPointerEnter={() => setHoveredId(node.id)}
              onPointerLeave={() => setHoveredId(null)}
              transform={`translate(${node.x} ${node.y})`}
            >
              <circle className="knowledge-core__node-aura" r={node.radius + (node.sceneIndex === 0 ? 15 : 8)} />
              <circle
                className="knowledge-core__node-dot"
                filter={node.sceneIndex === 0 ? "url(#knowledge-core-glow)" : undefined}
                fill="url(#knowledge-core-node)"
                r={node.radius}
              />
              {node.sceneIndex === 0 ? <circle className="knowledge-core__node-core" r="3.5" /> : null}
            </g>
          );
        })}
      </svg>

      <span className="knowledge-core__mode mono">{mode}</span>
      <span className="knowledge-core__telemetry knowledge-core__telemetry--left mono">
        <strong>{metrics.raw ?? 0}</strong>
        <small>来源</small>
      </span>
      <span className="knowledge-core__telemetry knowledge-core__telemetry--right mono">
        <strong>{density}%</strong>
        <small>连接密度</small>
      </span>

      <span className={`knowledge-core__focus${hoveredNode ? " is-visible" : ""}`}>
        <small className="mono">聚焦节点</small>
        <strong>{compactTitle(hoveredNode?.title)}</strong>
        <span>{hoveredNode ? `${hoveredNode.degree || 0} 条连接` : "将指针移到节点"}</span>
      </span>

      <span className="knowledge-core__footer">
        <span className="mono">{nodeCount} 个节点 · {edgeCount} 条连接</span>
        <span>打开图谱 <IconArrowUpRight aria-hidden="true" /></span>
      </span>
    </button>
  );
}
