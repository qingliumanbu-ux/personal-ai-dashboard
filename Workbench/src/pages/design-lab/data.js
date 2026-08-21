import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";

export const recentItems = [
  { id: "r1", title: "构建长期知识库的受控反馈闭环", meta: "知识 · 方法", time: "08:42", state: "已提炼" },
  { id: "r2", title: "AI 工作流中的上下文压缩与任务拆分", meta: "来源 · 网页", time: "08:15", state: "待复核" },
  { id: "r3", title: "如何让个人知识库从收藏走向复用", meta: "来源 · 视频", time: "昨天", state: "已分类" },
  { id: "r4", title: "本地优先知识系统的同步边界", meta: "知识 · 判断", time: "周六", state: "已发布" },
];

export const sourceItems = [
  { id: "s1", title: "本地优先 AI 工作台架构", source: "网页文章", domain: "AI 与智能体", type: "参考资料", status: "已分类", updated: "08:31", summary: "把知识存储、AI 推理与联网查询拆成不同边界，避免系统能力互相污染。", useCase: "架构参考" },
  { id: "s2", title: "构建会持续复利的第二大脑", source: "视频", domain: "个人成长", type: "方法", status: "待复核", updated: "08:12", summary: "重点不是收集更多资料，而是让旧知识在新任务中持续被重新调用。", useCase: "方法提炼" },
  { id: "s3", title: "用类型化对象构建结构化知识", source: "文档", domain: "知识管理", type: "教程", status: "已分类", updated: "昨天", summary: "用对象类型和属性代替无限文件夹，让概念、方法、案例拥有不同结构。", useCase: "模型设计" },
  { id: "s4", title: "智能体记忆与检索模式", source: "论文笔记", domain: "AI 与智能体", type: "观点", status: "已分类", updated: "周六", summary: "不同记忆层承担不同职责，检索质量比单纯扩大上下文更重要。", useCase: "AI 记忆" },
  { id: "s5", title: "设计平静高效的生产力软件", source: "设计文章", domain: "产品设计", type: "参考资料", status: "待补全", updated: "周五", summary: "降低视觉噪音，让动画承担状态反馈而不是装饰，长期使用体验优先。", useCase: "视觉原则" },
];

export const knowledgeItems = [
  { id: "k1", title: "受控反馈闭环", kind: "方法", summary: "用明确的输入、审核、发布和回看机制，让知识质量随使用不断提高。", relations: 8, status: "活跃" },
  { id: "k2", title: "本地优先边界", kind: "判断", summary: "默认在本地完成事实保存和加工，把联网能力限制在明确的公共信息查询。", relations: 5, status: "稳定" },
  { id: "k3", title: "知识对象化", kind: "框架", summary: "把资料、概念、方法和判断视为不同对象，而不是全部塞进同一种文档。", relations: 11, status: "活跃" },
  { id: "k4", title: "低摩擦采集", kind: "原则", summary: "采集阶段只要求最少信息，分类与提炼在后续工作流中完成。", relations: 6, status: "待验证" },
];

export const graphClusters = [
  { id: "ai", label: "AI 与智能体", count: 24, detail: "智能体 · 记忆 · 检索", className: "is-ai" },
  { id: "knowledge", label: "知识管理", count: 16, detail: "对象 · 关系 · 复盘", className: "is-knowledge" },
  { id: "product", label: "产品设计", count: 11, detail: "平静界面 · 工作流 · 系统", className: "is-product" },
  { id: "growth", label: "个人成长", count: 18, detail: "学习 · 反思 · 实践", className: "is-growth" },
];

export const graphClusterNodes = [
  { id: "k2", label: "本地优先边界", importance: 3, real: true },
  { id: "k3", label: "知识对象化", importance: 3, real: true },
  { id: "agent-memory", label: "智能体记忆", importance: 2 },
  { id: "context", label: "上下文压缩", importance: 2 },
  { id: "rag", label: "RAG", importance: 1 },
  { id: "retrieval", label: "检索质量", importance: 1 },
  { id: "k1", label: "受控反馈闭环", importance: 2, real: true },
  { id: "k4", label: "低摩擦采集", importance: 1, real: true },
];

const fullGraphLabels = {
  ai: ["智能体记忆", "上下文压缩", "RAG", "检索质量", "本地优先边界", "提示词记忆", "工具调用", "智能体规划", "长上下文", "评估", "向量嵌入"],
  knowledge: ["知识对象化", "受控反馈闭环", "低摩擦采集", "双向链接", "内容提炼", "来源证据", "分类体系", "复盘队列", "知识图谱", "每日笔记", "知识复用"],
  product: ["平静界面", "信息层级", "命令面板", "检查器", "工作台壳层", "交互设计", "设计变量", "动效系统", "视觉密度", "阅读界面", "导航"],
  growth: ["第二大脑", "反思", "学习闭环", "阅读笔记", "习惯", "每周复盘", "目标", "实践", "采集", "记忆", "综合提炼"],
};

const fullGraphRealIds = {
  "本地优先边界": "k2",
  "知识对象化": "k3",
  "受控反馈闭环": "k1",
  "低摩擦采集": "k4",
};

export function buildFullGraphNetwork() {
  const centers = {
    ai: { x: 560, y: 320 },
    knowledge: { x: 632, y: 318 },
    product: { x: 640, y: 394 },
    growth: { x: 566, y: 400 },
  };
  const nodes = [];
  const links = [];

  graphClusters.forEach((cluster) => {
    const labels = fullGraphLabels[cluster.id] || [];
    for (let index = 0; index < cluster.count; index += 1) {
      const label = index === 0 ? cluster.label : labels[index - 1] || `${cluster.label} · 关系节点 ${String(index).padStart(2, "0")}`;
      nodes.push({
        id: index === 0 ? `${cluster.id}:hub` : `${cluster.id}:${index}`,
        cluster: cluster.id,
        clusterLabel: cluster.label,
        label,
        realId: fullGraphRealIds[label] || null,
        importance: index === 0 ? 4 : index <= 3 ? 3 : index <= 8 ? 2 : 1,
      });
    }
  });

  graphClusters.forEach((cluster) => {
    const hubId = `${cluster.id}:hub`;
    const clusterNodes = nodes.filter((node) => node.cluster === cluster.id && node.id !== hubId);
    clusterNodes.forEach((node, index) => {
      links.push({ source: hubId, target: node.id, kind: "cluster" });
      if (index > 0 && index % 2 === 0) links.push({ source: clusterNodes[index - 1].id, target: node.id, kind: "local" });
      if (index > 3 && index % 5 === 0) links.push({ source: clusterNodes[index - 3].id, target: node.id, kind: "local" });
    });
  });

  links.push(
    { source: "ai:hub", target: "knowledge:hub", kind: "cross" },
    { source: "knowledge:hub", target: "product:hub", kind: "cross" },
    { source: "product:hub", target: "growth:hub", kind: "cross" },
    { source: "growth:hub", target: "ai:hub", kind: "cross" },
    { source: "ai:4", target: "knowledge:2", kind: "cross" },
    { source: "knowledge:3", target: "product:1", kind: "cross" },
    { source: "growth:2", target: "knowledge:1", kind: "cross" },
    { source: "ai:7", target: "product:4", kind: "cross" },
    { source: "ai:10", target: "growth:6", kind: "cross" },
    { source: "knowledge:6", target: "growth:4", kind: "cross" },
    { source: "knowledge:9", target: "product:7", kind: "cross" },
    { source: "product:5", target: "growth:8", kind: "cross" },
  );

  links.forEach((link, index) => {
    link.id = `${typeof link.source === "string" ? link.source : link.source.id}:${typeof link.target === "string" ? link.target : link.target.id}:${link.kind}:${index}`;
  });

  let sphereNodes = nodes;
  const sphereForce = () => {
    const cx = 600;
    const cy = 360;
    const maxRadius = 232;
    sphereNodes.forEach((node) => {
      const dx = node.x - cx;
      const dy = node.y - cy;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance > maxRadius) {
        const overflow = distance - maxRadius;
        node.vx -= (dx / distance) * overflow * 0.022;
        node.vy -= (dy / distance) * overflow * 0.022;
      }
      node.vx += (cx - node.x) * 0.00062;
      node.vy += (cy - node.y) * 0.00062;
    });
  };
  sphereForce.initialize = (nextNodes) => {
    sphereNodes = nextNodes;
  };

  const simulation = forceSimulation(nodes)
    .force("charge", forceManyBody().strength((node) => node.importance >= 4 ? -104 : node.importance >= 3 ? -48 : -27))
    .force("link", forceLink(links).id((node) => node.id).distance((link) => link.kind === "cross" ? 82 : link.kind === "cluster" ? 52 : 36).strength((link) => link.kind === "cross" ? 0.34 : 0.38))
    .force("collide", forceCollide((node) => node.importance >= 4 ? 22 : node.importance >= 3 ? 15 : 8.5).iterations(2))
    .force("x", forceX((node) => centers[node.cluster].x).strength(0.035))
    .force("y", forceY((node) => centers[node.cluster].y).strength(0.035))
    .force("center", forceCenter(600, 360))
    .force("sphere", sphereForce)
    .stop();

  for (let tick = 0; tick < 260; tick += 1) simulation.tick();
  nodes.forEach((node) => {
    node.x = Math.max(38, Math.min(1162, node.x));
    node.y = Math.max(38, Math.min(682, node.y));
  });
  return { nodes, links, centers };
}

export const sourceKnowledgeLinks = {
  s1: ["k2", "k3"],
  s2: ["k1", "k4"],
  s3: ["k3", "k1"],
  s4: ["k2", "k3"],
  s5: ["k4", "k1"],
};

export const knowledgeLinks = {
  k1: ["k3", "k4"],
  k2: ["k3", "k1"],
  k3: ["k1", "k2"],
  k4: ["k1", "k3"],
};

export const constellationEdges = [
  { id: "e1", nodes: ["k1", "k2"], d: "M120 84 C220 22 300 38 382 76" },
  { id: "e2", nodes: ["k2", "k4"], d: "M382 76 C470 116 552 110 642 58" },
  { id: "e3", nodes: ["k1", "k4"], d: "M120 84 C260 132 498 132 642 58" },
];
