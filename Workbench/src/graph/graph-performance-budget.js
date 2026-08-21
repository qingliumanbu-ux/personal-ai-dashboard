export const GRAPH_PERFORMANCE_MODES = ["auto", "saver", "balanced", "quality"];

const PROFILE_DEFINITIONS = {
  saver: {
    id: "saver",
    label: "节能",
    frameIntervalMs: 50,
    labelBudget: { overview: 5, context: 8, focus: 9 },
    maxRenderedNodes: 420,
    maxRenderedLinks: 760,
    enableDrift: false,
    enableAmbientGlow: false,
    relationGlow: "direct",
  },
  balanced: {
    id: "balanced",
    label: "平衡",
    frameIntervalMs: 32,
    labelBudget: { overview: 8, context: 12, focus: 14 },
    maxRenderedNodes: 700,
    maxRenderedLinks: 1500,
    enableDrift: true,
    enableAmbientGlow: true,
    relationGlow: "context",
  },
  quality: {
    id: "quality",
    label: "高质量",
    frameIntervalMs: 24,
    labelBudget: { overview: 10, context: 16, focus: 18 },
    maxRenderedNodes: 900,
    maxRenderedLinks: 2200,
    enableDrift: true,
    enableAmbientGlow: true,
    relationGlow: "context",
  },
};

export function recommendGraphRenderer(nodeCount, linkCount) {
  if (nodeCount <= 350 && linkCount <= 1000) return "svg";
  if (nodeCount <= 1600 && linkCount <= 5200) return "canvas";
  return "webgl";
}

export function resolveAutoGraphPerformanceMode({ nodeCount, linkCount, reducedMotion = false }) {
  if (reducedMotion) return "saver";
  const renderer = recommendGraphRenderer(nodeCount, linkCount);
  if (renderer !== "svg") return "saver";
  if (nodeCount <= 120 && linkCount <= 300) return "quality";
  return "balanced";
}

export function getGraphPerformanceBudget({ mode = "auto", nodeCount, linkCount, reducedMotion = false }) {
  const requestedMode = GRAPH_PERFORMANCE_MODES.includes(mode) ? mode : "auto";
  const resolvedMode = requestedMode === "auto"
    ? resolveAutoGraphPerformanceMode({ nodeCount, linkCount, reducedMotion })
    : requestedMode;
  const profile = PROFILE_DEFINITIONS[resolvedMode];
  return {
    ...profile,
    requestedMode,
    resolvedMode,
    renderer: recommendGraphRenderer(nodeCount, linkCount),
    nodeCount,
    linkCount,
  };
}

function nodePriority(node, { activeId, relatedIds, searchMatchIds }) {
  if (node.id === activeId) return 1000;
  if (searchMatchIds?.has(node.id)) return 920;
  if (relatedIds?.has(node.id)) return 850;
  if (node.importance >= 4) return 700;
  if (node.importance >= 3) return 560;
  if (node.importance >= 2) return 360;
  return 120;
}

export function selectRenderableNodes(nodes, budget, context = {}) {
  const limit = Math.max(1, budget?.maxRenderedNodes || nodes.length);
  if (nodes.length <= limit) return nodes;
  return nodes
    .map((node, index) => ({ node, index, priority: nodePriority(node, context) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map(({ node }) => node);
}

function linkPriority(link, nodeById, { activeId, relationDistances }) {
  const sourceId = typeof link.source === "string" ? link.source : link.source.id;
  const targetId = typeof link.target === "string" ? link.target : link.target.id;
  if (sourceId === activeId || targetId === activeId) return 1000;
  if (relationDistances?.has(sourceId) && relationDistances?.has(targetId)) return 850;
  if (link.kind === "cross") return 600;
  const source = nodeById.get(sourceId);
  const target = nodeById.get(targetId);
  if (source?.importance >= 4 || target?.importance >= 4) return 520;
  if (source?.importance >= 3 || target?.importance >= 3) return 380;
  return 120;
}

export function selectRenderableLinks(links, nodes, budget, context = {}) {
  const limit = Math.max(1, budget?.maxRenderedLinks || links.length);
  if (links.length <= limit) return links;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return links
    .map((link, index) => ({ link, index, priority: linkPriority(link, nodeById, context) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map(({ link }) => link);
}
