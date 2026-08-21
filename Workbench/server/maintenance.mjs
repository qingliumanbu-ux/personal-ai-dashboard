const ACTIONS = {
  "rebuild-index": {
    action: "rebuild-index",
    title: "重建 Vault 派生索引",
    target: "Workbench 内存索引与可重建派生状态",
    impact: "重新扫描当前 Vault 并替换 Workbench 的派生索引；扫描期间页面可能短暂显示同步中。",
    preserves: ["Vault Markdown 正文", "来源原件", "Git 历史与工作区", "凭据与本地安全配置"],
    rollback: "索引本身不拥有正式知识；若重建失败，Vault 原文件保持不变，Workbench 继续保留最后一次可用索引。",
    reversible: true,
  },
};

export function maintenancePreview(action) {
  const definition = ACTIONS[action];
  if (!definition) {
    const error = new Error("不支持的维护动作。");
    error.code = "MAINTENANCE_ACTION_NOT_ALLOWED";
    throw error;
  }
  return {
    ...definition,
    dryRun: true,
    requiresConfirmation: true,
  };
}

export function validateMaintenanceExecution(payload) {
  const preview = maintenancePreview(payload?.action);
  if (payload?.confirmed !== true) {
    const error = new Error("维护动作需要显式确认。");
    error.code = "MAINTENANCE_CONFIRMATION_REQUIRED";
    throw error;
  }
  return preview;
}
