import { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { IconSearch } from "@tabler/icons-react";
import { getGraphPerformanceBudget, selectRenderableLinks, selectRenderableNodes } from "../../graph/graph-performance-budget.js";
import { StarfieldBackdrop } from "./StarfieldBackdrop.jsx";
import { buildFullGraphNetwork, graphClusters, knowledgeItems } from "./data.js";

export function NetworkGraph({ graphFocus, graphViewport, selectedGraphNode, selectedKnowledge, onGraphFocusChange, onGraphViewportChange, onSelectGraphNode, onSelectKnowledge }) {
  const network = useMemo(() => buildFullGraphNetwork(), []);
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const matchingNode = network.nodes.find((node) => node.id === selectedGraphNode?.networkNodeId)
    || network.nodes.find((node) => node.id === graphFocus?.nodeId)
    || (graphFocus?.knowledgeId ? network.nodes.find((node) => node.realId === graphFocus.knowledgeId) : null);
  const [activeId, setActiveId] = useState(matchingNode?.id || null);
  const [hoveredId, setHoveredId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [relationDepth, setRelationDepth] = useState(1);
  const [clusterFilter, setClusterFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [performanceMode, setPerformanceMode] = useState("auto");
  const [scale, setScale] = useState(graphViewport?.scale ?? 0.86);
  const [pan, setPan] = useState(graphViewport?.pan ?? { x: 84, y: 48 });
  const viewRef = useRef({ scale: graphViewport?.scale ?? 0.86, pan: graphViewport?.pan ?? { x: 84, y: 48 } });
  const positionsRef = useRef(Object.fromEntries(network.nodes.map((node) => [node.id, { x: node.x, y: node.y }])));
  const nodeElementRefs = useRef(new Map());
  const linkElementRefs = useRef(new Map());
  const simulationRef = useRef(null);
  const simulationNodesRef = useRef([]);
  const activeIdRef = useRef(activeId);
  const viewportPersistTimerRef = useRef(null);
  const reducedMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches, []);
  const performanceBudget = useMemo(() => getGraphPerformanceBudget({
    mode: performanceMode,
    nodeCount: network.nodes.length,
    linkCount: network.links.length,
    reducedMotion,
  }), [network.links.length, network.nodes.length, performanceMode, reducedMotion]);

  useEffect(() => {
    const nextNode = network.nodes.find((node) => node.id === selectedGraphNode?.networkNodeId)
      || network.nodes.find((node) => node.id === graphFocus?.nodeId)
      || (graphFocus?.knowledgeId ? network.nodes.find((node) => node.realId === graphFocus.knowledgeId) : null);
    setActiveId(nextNode?.id || null);
  }, [graphFocus?.knowledgeId, graphFocus?.nodeId, network.nodes, selectedGraphNode?.networkNodeId]);

  useEffect(() => {
    activeIdRef.current = activeId;
    const simulation = simulationRef.current;
    if (simulation) simulation.alpha(0.22).alphaTarget(0).restart();
  }, [activeId]);

  useEffect(() => {
    const nodes = network.nodes.map((node, index) => ({ ...node, index }));
    const links = network.links.map((link) => ({
      ...link,
      source: typeof link.source === "string" ? link.source : link.source.id,
      target: typeof link.target === "string" ? link.target : link.target.id,
    }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const neighborMap = new Map(nodes.map((node) => [node.id, new Set()]));
    links.forEach((link) => {
      neighborMap.get(link.source)?.add(link.target);
      neighborMap.get(link.target)?.add(link.source);
    });

    let driftNodes = nodes;
    const driftForce = () => {
      const time = performance.now() * 0.00032;
      driftNodes.forEach((node, index) => {
        const center = network.centers[node.cluster];
        const phase = index * 1.618 + (node.cluster.charCodeAt(0) % 7);
        node.vx += Math.sin(time + phase) * 0.012;
        node.vy += Math.cos(time * 0.86 + phase * 0.73) * 0.012;
        if (center) {
          const breathe = Math.sin(time * 0.72 + phase * 0.12) * 0.000035;
          node.vx += (node.x - center.x) * breathe;
          node.vy += (node.y - center.y) * breathe;
        }
      });
    };
    driftForce.initialize = (nextNodes) => {
      driftNodes = nextNodes;
    };

    let focusNodes = nodes;
    const focusForce = () => {
      const active = nodeById.get(activeIdRef.current);
      if (!active) return;
      const neighbors = neighborMap.get(active.id);
      focusNodes.forEach((node) => {
        if (!neighbors?.has(node.id)) return;
        node.vx += (active.x - node.x) * 0.00045;
        node.vy += (active.y - node.y) * 0.00045;
      });
    };
    focusForce.initialize = (nextNodes) => {
      focusNodes = nextNodes;
    };

    let sphereNodes = nodes;
    const sphereForce = () => {
      const cx = 600;
      const cy = 360;
      const maxRadius = 242;
      sphereNodes.forEach((node) => {
        const dx = node.x - cx;
        const dy = node.y - cy;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance > maxRadius) {
          const overflow = distance - maxRadius;
          node.vx -= (dx / distance) * overflow * 0.018;
          node.vy -= (dy / distance) * overflow * 0.018;
        }
        node.vx += (cx - node.x) * 0.00052;
        node.vy += (cy - node.y) * 0.00052;
      });
    };
    sphereForce.initialize = (nextNodes) => {
      sphereNodes = nextNodes;
    };

    const simulation = forceSimulation(nodes)
      .alpha(0.26)
      .alphaDecay(0.022)
      .alphaTarget(0)
      .velocityDecay(0.42)
      .force("charge", forceManyBody().strength((node) => node.importance >= 4 ? -96 : node.importance >= 3 ? -44 : -25))
      .force("link", forceLink(links).id((node) => node.id).distance((link) => link.kind === "cross" ? 82 : link.kind === "cluster" ? 52 : 36).strength((link) => link.kind === "cross" ? 0.32 : 0.36))
      .force("collide", forceCollide((node) => node.importance >= 4 ? 22 : node.importance >= 3 ? 15 : 8.5).iterations(1))
      .force("x", forceX((node) => network.centers[node.cluster].x).strength(0.03))
      .force("y", forceY((node) => network.centers[node.cluster].y).strength(0.03))
      .force("center", forceCenter(600, 360))
      .force("drift", performanceBudget.enableDrift ? driftForce : null)
      .force("focus", focusForce)
      .force("sphere", sphereForce);

    simulationRef.current = simulation;
    simulationNodesRef.current = nodes;
    let lastPaint = 0;
    simulation.on("tick", () => {
      const now = performance.now();
      if (now - lastPaint < performanceBudget.frameIntervalMs) return;
      lastPaint = now;
      nodes.forEach((node) => {
        node.x = Math.max(32, Math.min(1168, node.x));
        node.y = Math.max(32, Math.min(688, node.y));
        positionsRef.current[node.id] = { x: node.x, y: node.y };
        nodeElementRefs.current.get(node.id)?.setAttribute("transform", `translate(${node.x} ${node.y})`);
      });
      links.forEach((link) => {
        const sourceId = typeof link.source === "string" ? link.source : link.source.id;
        const targetId = typeof link.target === "string" ? link.target : link.target.id;
        const line = linkElementRefs.current.get(link.id);
        if (!line) return;
        const source = typeof link.source === "string" ? nodes.find((node) => node.id === link.source) : link.source;
        const target = typeof link.target === "string" ? nodes.find((node) => node.id === link.target) : link.target;
        line.setAttribute("x1", source.x);
        line.setAttribute("y1", source.y);
        line.setAttribute("x2", target.x);
        line.setAttribute("y2", target.y);
      });
    });

    return () => {
      simulation.stop();
      simulationRef.current = null;
      simulationNodesRef.current = [];
    };
  }, [network, performanceBudget.enableDrift, performanceBudget.frameIntervalMs]);

  const adjacency = useMemo(() => {
    const map = new Map(network.nodes.map((node) => [node.id, new Set()]));
    network.links.forEach((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      map.get(sourceId)?.add(targetId);
      map.get(targetId)?.add(sourceId);
    });
    return map;
  }, [network.links, network.nodes]);

  const relationDistances = useMemo(() => {
    if (!activeId) return new Map();
    const distances = new Map([[activeId, 0]]);
    let frontier = [activeId];
    for (let depth = 1; depth <= relationDepth; depth += 1) {
      const next = [];
      frontier.forEach((nodeId) => {
        adjacency.get(nodeId)?.forEach((neighborId) => {
          if (distances.has(neighborId)) return;
          distances.set(neighborId, depth);
          next.push(neighborId);
        });
      });
      frontier = next;
      if (!frontier.length) break;
    }
    return distances;
  }, [activeId, adjacency, relationDepth]);

  const relatedIds = useMemo(() => {
    const related = new Set(relationDistances.keys());
    if (activeId) related.delete(activeId);
    return related;
  }, [activeId, relationDistances]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchMatchIds = useMemo(() => {
    if (!normalizedSearch) return new Set();
    return new Set(network.nodes
      .filter((node) => `${node.label} ${node.clusterLabel}`.toLowerCase().includes(normalizedSearch))
      .map((node) => node.id));
  }, [network.nodes, normalizedSearch]);

  const searchLitIds = useMemo(() => {
    if (!searchMatchIds.size) return new Set();
    const lit = new Set(searchMatchIds);
    searchMatchIds.forEach((nodeId) => adjacency.get(nodeId)?.forEach((neighborId) => lit.add(neighborId)));
    return lit;
  }, [adjacency, searchMatchIds]);

  const renderableNodes = useMemo(() => selectRenderableNodes(network.nodes, performanceBudget, {
    activeId,
    relatedIds,
    searchMatchIds,
  }), [activeId, network.nodes, performanceBudget, relatedIds, searchMatchIds]);
  const renderableNodeIds = useMemo(() => new Set(renderableNodes.map((node) => node.id)), [renderableNodes]);
  const renderableLinks = useMemo(() => {
    const eligibleLinks = network.links.filter((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      return renderableNodeIds.has(sourceId) && renderableNodeIds.has(targetId);
    });
    return selectRenderableLinks(eligibleLinks, renderableNodes, performanceBudget, { activeId, relationDistances });
  }, [activeId, network.links, performanceBudget, relationDistances, renderableNodeIds, renderableNodes]);

  const nodeTypeKey = (node) => node.importance >= 4 ? "hub" : node.importance >= 3 ? "key" : "normal";
  const nodePassesFilters = (node) => (
    (clusterFilter === "all" || node.cluster === clusterFilter)
    && (typeFilter === "all" || nodeTypeKey(node) === typeFilter)
  );

  const activeNode = activeId ? network.nodes.find((node) => node.id === activeId) || null : null;
  const hoveredNode = hoveredId ? network.nodes.find((node) => node.id === hoveredId) : null;
  const previewRelationCount = hoveredNode ? adjacency.get(hoveredNode.id)?.size || 0 : 0;
  const filteredNodeCount = network.nodes.filter(nodePassesFilters).length;
  const labelCounterScale = scale > 1 ? 1 / scale : 1;
  const semanticZoomLevel = scale < 1.12 ? "overview" : scale < 1.72 ? "context" : "focus";
  const activeCluster = activeNode?.cluster || null;
  const semanticNodeOpacity = (node) => {
    if (normalizedSearch || clusterFilter !== "all" || typeFilter !== "all") return 1;
    if (!activeId) return semanticZoomLevel === "overview" ? (node.importance >= 3 ? 1 : 0.76) : (node.importance >= 2 ? 0.96 : 0.68);
    if (semanticZoomLevel === "overview") return node.importance >= 3 || node.id === activeId ? 1 : 0.76;
    if (semanticZoomLevel === "context") {
      if (node.cluster === activeCluster || node.id === activeId || relationDistances.has(node.id)) return 1;
      return node.importance >= 4 ? 0.58 : 0.2;
    }
    if (node.id === activeId || relationDistances.get(node.id) === 1) return 1;
    if (node.cluster === activeCluster && node.importance >= 3) return 0.56;
    if (node.importance >= 4) return 0.22;
    return 0.08;
  };

  const clampScale = (value) => Math.max(0.48, Math.min(2.35, value));

  const persistViewportSoon = (nextViewport) => {
    if (viewportPersistTimerRef.current) clearTimeout(viewportPersistTimerRef.current);
    viewportPersistTimerRef.current = setTimeout(() => {
      onGraphViewportChange(nextViewport);
      viewportPersistTimerRef.current = null;
    }, 120);
  };

  const commitViewport = (nextScale, nextPan, persist = true) => {
    viewRef.current = { scale: nextScale, pan: nextPan };
    setScale(nextScale);
    setPan(nextPan);
    if (persist) persistViewportSoon({ scale: nextScale, pan: nextPan });
  };

  useEffect(() => () => {
    if (viewportPersistTimerRef.current) clearTimeout(viewportPersistTimerRef.current);
  }, []);

  const clientToSvgPoint = (clientX, clientY) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM?.();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  };

  const zoomAtPoint = (nextScale, pointX = 600, pointY = 360) => {
    const resolvedScale = clampScale(nextScale);
    const currentView = viewRef.current;
    const worldX = (pointX - currentView.pan.x) / currentView.scale;
    const worldY = (pointY - currentView.pan.y) / currentView.scale;
    const nextPan = {
      x: pointX - worldX * resolvedScale,
      y: pointY - worldY * resolvedScale,
    };
    commitViewport(resolvedScale, nextPan);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const point = clientToSvgPoint(event.clientX, event.clientY);
    if (!point) return;
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    zoomAtPoint(viewRef.current.scale * factor, point.x, point.y);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const blockPageScrollAndZoomGraph = (event) => handleWheel(event);
    canvas.addEventListener("wheel", blockPageScrollAndZoomGraph, { passive: false });
    return () => canvas.removeEventListener("wheel", blockPageScrollAndZoomGraph);
  }, []);

  const handlePointerDown = (event) => {
    if (event.target.closest?.("[data-network-node='true']")) return;
    const point = clientToSvgPoint(event.clientX, event.clientY);
    if (!point) return;
    dragRef.current = { pointerId: event.pointerId, point, pan: viewRef.current.pan, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = clientToSvgPoint(event.clientX, event.clientY);
    if (!point) return;
    const nextPan = { x: drag.pan.x + point.x - drag.point.x, y: drag.pan.y + point.y - drag.point.y };
    if (Math.hypot(point.x - drag.point.x, point.y - drag.point.y) > 4) drag.moved = true;
    commitViewport(viewRef.current.scale, nextPan, false);
  };

  const handlePointerUp = (event) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      const wasDrag = dragRef.current.moved;
      dragRef.current = null;
      onGraphViewportChange(viewRef.current);
      if (!wasDrag) {
        setActiveId(null);
        onGraphFocusChange(null);
        onSelectGraphNode(null);
      }
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const selectNode = (node) => {
    setActiveId(node.id);
    onGraphFocusChange({ nodeId: node.id });
    const relationCount = network.links.reduce((count, link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      return sourceId === node.id || targetId === node.id ? count + 1 : count;
    }, 0);
    const realItem = node.realId ? knowledgeItems.find((item) => item.id === node.realId) : null;
    onSelectGraphNode({
      id: `network:${node.id}`,
      networkNodeId: node.id,
      knowledgeId: realItem?.id || null,
      title: node.label,
      kind: node.importance >= 4 ? "主题簇" : "网络知识",
      summary: `属于「${node.clusterLabel}」主题，在当前全量网络中与 ${relationCount} 个节点直接连接。`,
      relations: relationCount,
      status: "网络节点",
      domain: node.clusterLabel,
    });
    if (realItem) onSelectKnowledge(realItem);
  };

  const nodeDragRef = useRef(null);
  const handleNodePointerDown = (event, node) => {
    event.stopPropagation();
    const liveNode = simulationNodesRef.current.find((entry) => entry.id === node.id);
    if (!liveNode) return;
    nodeDragRef.current = { pointerId: event.pointerId, nodeId: node.id };
    liveNode.fx = liveNode.x;
    liveNode.fy = liveNode.y;
    simulationRef.current?.alphaTarget(0.18).restart();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleNodePointerMove = (event, node) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.nodeId !== node.id) return;
    const liveNode = simulationNodesRef.current.find((entry) => entry.id === node.id);
    const point = clientToSvgPoint(event.clientX, event.clientY);
    if (!point || !liveNode) return;
    liveNode.fx = (point.x - viewRef.current.pan.x) / viewRef.current.scale;
    liveNode.fy = (point.y - viewRef.current.pan.y) / viewRef.current.scale;
  };

  const handleNodePointerUp = (event, node) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.nodeId !== node.id) return;
    const liveNode = simulationNodesRef.current.find((entry) => entry.id === node.id);
    if (liveNode) {
      liveNode.fx = null;
      liveNode.fy = null;
    }
    nodeDragRef.current = null;
    simulationRef.current?.alphaTarget(0).alpha(0.2).restart();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const focusNode = (node) => {
    selectNode(node);
    const nextScale = Math.max(viewRef.current.scale, 1.58);
    const position = positionsRef.current[node.id] || node;
    const nextPan = { x: 600 - position.x * nextScale, y: 360 - position.y * nextScale };
    commitViewport(nextScale, nextPan);
  };

  const resetView = () => commitViewport(0.86, { x: 84, y: 48 });
  const radiusFor = (node) => node.importance >= 4 ? 10 : node.importance >= 3 ? 6.2 : node.importance >= 2 ? 4.1 : 2.55;

  const labelBudget = performanceBudget.labelBudget[semanticZoomLevel];
  const labelLayout = (() => {
    const candidates = renderableNodes
      .map((node) => {
        const isActive = node.id === activeId;
        const isHovered = hoveredId === node.id;
        const isSearchMatch = searchMatchIds.has(node.id);
        const relationDistance = relationDistances.get(node.id);
        const passesFilter = nodePassesFilters(node);
        const isSearchLit = !normalizedSearch || searchLitIds.has(node.id);
        const canShow = Boolean(node.label) && (
          isActive || isHovered || isSearchMatch || relationDistance === 1
          || (semanticZoomLevel === "overview" && node.importance >= 4)
          || (semanticZoomLevel === "context" && node.cluster === activeCluster && node.importance >= 3)
          || (semanticZoomLevel === "focus" && node.cluster === activeCluster && node.importance >= 4)
        );
        if (!canShow || ((!passesFilter || !isSearchLit) && !isActive && !isHovered && !isSearchMatch)) return null;
        const position = positionsRef.current[node.id] || node;
        const radius = radiusFor(node);
        const projectedX = pan.x + position.x * scale;
        const projectedY = pan.y + position.y * scale;
        const width = Math.max(70, (node.label.length || 8) * 7.1 + 18);
        const height = 22;
        const side = projectedX > 770 ? "left" : "right";
        const anchorOffset = (radius + 7) * scale;
        const x = side === "left" ? projectedX - anchorOffset - width : projectedX + anchorOffset;
        const y = projectedY - 8 * scale;
        const priority = isActive ? 100 : isHovered ? 96 : isSearchMatch ? 92 : relationDistance === 1 ? 82 : node.cluster === activeCluster && node.importance >= 4 ? 68 : 44;
        return { id: node.id, width, height, side, x, y, priority };
      })
      .filter(Boolean)
      .sort((a, b) => b.priority - a.priority);

    const accepted = new Map();
    const occupied = [];
    const padding = 7;
    const reserved = [
      ...(hoveredNode ? [{ x1: 12, y1: 12, x2: 300, y2: 108 }] : []),
      { x1: 880, y1: 12, x2: 1188, y2: 62 },
      { x1: 8, y1: 654, x2: 300, y2: 712 },
      { x1: 930, y1: 650, x2: 1192, y2: 712 },
    ];
    const overlaps = (box, other) => !(box.x2 + padding < other.x1 || box.x1 - padding > other.x2 || box.y2 + padding < other.y1 || box.y1 - padding > other.y2);
    candidates.some((candidate) => {
      if (accepted.size >= labelBudget) return true;
      const box = { x1: candidate.x, y1: candidate.y, x2: candidate.x + candidate.width, y2: candidate.y + candidate.height };
      if (box.x2 < 16 || box.x1 > 1184 || box.y2 < 12 || box.y1 > 708) return false;
      if (reserved.some((area) => overlaps(box, area))) return false;
      if (occupied.some((area) => overlaps(box, area))) return false;
      occupied.push(box);
      accepted.set(candidate.id, candidate);
      return false;
    });
    return accepted;
  })();

  return (
    <section className={`design-lab-network-stage${performanceBudget.enableAmbientGlow ? "" : " is-low-effects"}`}>
      <div className="design-lab-network-stage__topline">
        <div><span>全量知识球</span><strong>{filteredNodeCount} / {network.nodes.length} 个知识对象 · {network.links.length} 条关系</strong></div>
        <div><span>{activeNode ? "当前焦点" : "浏览状态"}</span><strong>{activeNode ? `${activeNode.label || activeNode.clusterLabel} · ${semanticZoomLevel === "overview" ? "整体" : semanticZoomLevel === "context" ? "上下文" : "聚焦"}` : "自由探索 · 未选择节点"}</strong></div>
      </div>

      <div className="design-lab-network-toolbar">
        <label className="design-lab-network-search">
          <IconSearch aria-hidden="true" />
          <input onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索知识节点…" type="search" value={searchQuery} />
          {normalizedSearch ? <span>{searchMatchIds.size} 命中</span> : null}
        </label>
        <select aria-label="按领域筛选" onChange={(event) => setClusterFilter(event.target.value)} value={clusterFilter}>
          <option value="all">全部领域</option>
          {graphClusters.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <select aria-label="按节点类型筛选" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
          <option value="all">全部类型</option><option value="hub">主题枢纽</option><option value="key">重点知识</option><option value="normal">普通知识</option>
        </select>
        <select aria-label="图谱性能模式" onChange={(event) => setPerformanceMode(event.target.value)} value={performanceMode}>
          <option value="auto">性能 · 自动</option><option value="saver">性能 · 节能</option><option value="balanced">性能 · 平衡</option><option value="quality">性能 · 高质量</option>
        </select>
        <span className="design-lab-network-budget-status">{performanceBudget.label} · {performanceBudget.renderer === "svg" ? "SVG" : `建议 ${performanceBudget.renderer.toUpperCase()}`}</span>
        <div className="design-lab-network-depth" aria-label="关系深度">
          <span>关系</span>
          {[1, 2, 3].map((depth) => <button className={relationDepth === depth ? "is-active" : ""} key={depth} onClick={() => setRelationDepth(depth)} type="button">{depth}跳</button>)}
        </div>
      </div>

      <div className="design-lab-network-canvas lab-wb-cosmos lab-wb-cosmos--network" ref={canvasRef}>
        <StarfieldBackdrop variant="network" viewport={{ pan, scale }} />
        <svg aria-label="全量知识网络" ref={svgRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} role="img" viewBox="0 0 1200 720">
          <defs>
            <filter id="design-lab-network-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4.8" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <filter id="design-lab-network-focus-glow" x="-140%" y="-140%" width="380%" height="380%"><feGaussianBlur stdDeviation="7.2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            <g className="design-lab-network-links">
              {renderableLinks.map((link) => {
                const source = typeof link.source === "string" ? network.nodes.find((node) => node.id === link.source) : link.source;
                const target = typeof link.target === "string" ? network.nodes.find((node) => node.id === link.target) : link.target;
                const sourceInRelation = relationDistances.has(source?.id);
                const targetInRelation = relationDistances.has(target?.id);
                const isActive = sourceInRelation && targetInRelation;
                const isDirect = source?.id === activeId || target?.id === activeId;
                const passesFilter = nodePassesFilters(source) && nodePassesFilters(target);
                const matchesSearch = !normalizedSearch || (searchLitIds.has(source?.id) && searchLitIds.has(target?.id));
                const isDimmed = !passesFilter || !matchesSearch;
                const semanticOpacity = Math.min(semanticNodeOpacity(source), semanticNodeOpacity(target));
                const sourcePosition = positionsRef.current[source?.id] || source;
                const targetPosition = positionsRef.current[target?.id] || target;
                const linkKey = link.id;
                return <line className={`${link.kind === "cross" ? "is-cross" : ""}${isActive ? " is-active" : ""}${isDirect ? " is-direct" : ""}${isDimmed ? " is-dimmed" : ""}`} key={linkKey} ref={(element) => { if (element) linkElementRefs.current.set(linkKey, element); else linkElementRefs.current.delete(linkKey); }} x1={sourcePosition?.x} x2={targetPosition?.x} y1={sourcePosition?.y} y2={targetPosition?.y} style={{ opacity: isDimmed ? undefined : Math.max(0.05, semanticOpacity * (isDirect ? 1 : isActive ? 0.72 : 0.42)) }} />;
              })}
            </g>
            <g className="design-lab-network-nodes">
              {renderableNodes.map((node) => {
                const isActive = node.id === activeId;
                const isRelated = relatedIds.has(node.id);
                const passesFilter = nodePassesFilters(node);
                const isSearchMatch = searchMatchIds.has(node.id);
                const isSearchLit = !normalizedSearch || searchLitIds.has(node.id);
                const isDimmed = !passesFilter || !isSearchLit;
                const semanticOpacity = semanticNodeOpacity(node);
                const radius = radiusFor(node);
                const labelPlacement = labelLayout.get(node.id);
                const position = positionsRef.current[node.id] || node;
                return (
                  <g className={`design-lab-network-node cluster-${node.cluster}${node.importance >= 4 ? " is-hub" : node.importance >= 3 ? " is-key" : " is-ordinary"}${isActive ? " is-active" : ""}${isRelated ? " is-related" : ""}${isSearchMatch ? " is-search-match" : ""}${isDimmed ? " is-dimmed" : ""}`} data-network-node="true" key={node.id} ref={(element) => { if (element) nodeElementRefs.current.set(node.id, element); else nodeElementRefs.current.delete(node.id); }} onClick={() => selectNode(node)} onDoubleClick={() => focusNode(node)} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId(null)} onPointerDown={(event) => handleNodePointerDown(event, node)} onPointerMove={(event) => handleNodePointerMove(event, node)} onPointerUp={(event) => handleNodePointerUp(event, node)} onPointerCancel={(event) => handleNodePointerUp(event, node)} role="button" style={{ opacity: isDimmed ? undefined : semanticOpacity }} tabIndex="0" transform={`translate(${position.x} ${position.y})`}>
                    <circle className="design-lab-network-node__halo" r={radius * 2.7} /><circle className="design-lab-network-node__core" r={radius} />
                    {labelPlacement ? <g transform={`translate(${labelPlacement.side === "left" ? -(radius + 7) : radius + 7} -8)`}><g className="design-lab-network-node__label" transform={`scale(${labelCounterScale})`}><rect height="22" rx="6" width={labelPlacement.width} x={labelPlacement.side === "left" ? -labelPlacement.width : 0} /><text x={labelPlacement.side === "left" ? -labelPlacement.width + 9 : 9} y="14.6">{node.label}</text></g></g> : null}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {hoveredNode ? <div className="design-lab-network-selection-card"><span>悬停预览</span><strong>{hoveredNode.label}</strong><small>{hoveredNode.clusterLabel} · {previewRelationCount} 条直接关系</small><em>单击选中 · 双击聚焦</em></div> : null}
        <div className="design-lab-network-islands" aria-hidden="true"><span>AI 与智能体</span><span>知识管理</span><span>产品设计</span><span>个人成长</span></div>
        <div className="design-lab-network-legend"><span><i /> 普通知识</span><span><i className="is-hub" /> 主题枢纽</span><span><i className="is-focus" /> 当前焦点</span></div>
        <div className="design-lab-network-controls"><button aria-label="缩小" onClick={() => zoomAtPoint(scale * 0.86)} type="button">−</button><span>{Math.round(scale * 100)}%</span><button aria-label="放大" onClick={() => zoomAtPoint(scale * 1.16)} type="button">+</button><button onClick={resetView} type="button">适应视图</button></div>
        <div className="design-lab-network-help"><span>滚轮缩放</span><span>拖拽平移</span><span>双击节点聚焦</span></div>
      </div>
    </section>
  );
}
