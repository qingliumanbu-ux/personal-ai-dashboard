function statusRank(status) {
  return { healthy: 0, unknown: 1, degraded: 2, unavailable: 3 }[status] ?? 1;
}

export function summarizeSystemHealth({
  vault,
  sync,
  graph,
  classification,
  ingestion,
  codex,
  checks = {},
}) {
  const components = [
    {
      id: "vault",
      label: "Vault",
      status: vault.connected === true ? ((vault.errors ?? 0) > 0 ? "degraded" : "healthy") : "unavailable",
      detail: vault.connected === true ? `${vault.documents ?? 0} 个文档` : "Vault 当前不可用",
    },
    {
      id: "index",
      label: "索引",
      status: sync?.status === "watching" ? "healthy" : sync?.status ? "degraded" : "unknown",
      detail: sync?.status ? `同步状态：${sync.status}` : "未取得同步状态",
    },
    {
      id: "graph",
      label: "Graph",
      status: graph?.nodeCount > 0 ? "healthy" : "degraded",
      detail: `${graph?.nodeCount ?? 0} 个节点 · ${graph?.edgeCount ?? 0} 条显式关系`,
    },
    {
      id: "classification",
      label: "来源分类",
      status: (classification?.unclassified ?? 0) > 0 ? "degraded" : "healthy",
      detail: `${classification?.unclassified ?? 0} 份待补全 · 覆盖 ${classification?.coveragePct ?? 0}%`,
    },
    {
      id: "ingestion",
      label: "Ingestion",
      status: ingestion?.available === true ? "healthy" : "unavailable",
      detail: ingestion?.available === true ? "本地采集服务可达" : "本地采集服务不可达",
    },
    {
      id: "codex",
      label: "Codex",
      status: codex?.available === true ? "healthy" : "unknown",
      detail: codex?.available === true ? "本地运行时可用" : "当前未检测到可用运行时",
    },
    {
      id: "tests",
      label: "测试记录",
      status: checks.tests?.status ?? "unknown",
      detail: checks.tests?.detail ?? "当前进程没有最近测试结果记录",
    },
    {
      id: "privacy",
      label: "隐私扫描",
      status: checks.privacyScan?.status ?? "unknown",
      detail: checks.privacyScan?.detail ?? "当前进程没有最近隐私扫描记录",
    },
  ];

  const overall = components.reduce(
    (current, component) => statusRank(component.status) > statusRank(current) ? component.status : current,
    "healthy",
  );

  return { overall, components };
}

export function buildDiagnostics(health) {
  const advice = {
    vault: ["来源与知识读取会受影响。", "确认 Vault 所在磁盘与目录可访问，然后重新打开本地 Workbench。"],
    index: ["页面可能显示旧数据或不能及时反映文件变化。", "先等待文件同步恢复；仍异常时再从维护中心预览索引重建。"],
    graph: ["知识星图可能为空或只能显示孤立节点。", "确认正式知识 Markdown 中存在可解析双链；不要用自动推断关系补空图。"],
    classification: ["部分来源无法通过领域、主题和用途稳定定位。", "进入来源库的“待补全分类”逐条确认，不自动改写历史 Raw。"],
    ingestion: ["新链接与本地媒体无法进入采集审核队列。", "确认本地 Ingestion 服务已启动并监听配置的 loopback 地址。"],
    codex: ["依赖 Codex 的解释或受控工作流可能不可用。", "确认本地 Codex CLI 可用；普通 Vault 浏览不受此项影响。"],
    tests: ["无法从健康页确认最近代码回归状态。", "在发布或稳定化验收前运行 Workbench 测试并记录结果。"],
    privacy: ["无法从健康页确认最近隐私扫描状态。", "在发布或稳定化验收前运行 privacy:scan 并记录结果。"],
  };

  return health.components
    .filter((component) => component.status !== "healthy")
    .map((component) => ({
      component: component.id,
      label: component.label,
      status: component.status,
      cause: component.detail,
      impact: advice[component.id]?.[0] ?? "该组件状态需要人工确认。",
      recovery: advice[component.id]?.[1] ?? "检查本地服务状态后再决定是否执行维护动作。",
    }));
}
