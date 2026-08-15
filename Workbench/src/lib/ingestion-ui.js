const ACTIVE_REFRESH_DELAY = 1_500;
const IDLE_REFRESH_DELAY = 15_000;

export const MEDIA_RETENTION_OPTIONS = [
  {
    value: "delete_now",
    label: "立即清理",
    description: "删除任务 Run 中的临时视频；保留转写、摘要、字幕、哈希和审核记录。",
  },
  {
    value: "keep_30_days",
    label: "保留 30 天",
    description: "到期后标记为待清理，由你再次确认删除，不会静默执行。",
  },
  {
    value: "keep_forever",
    label: "永久保留",
    description: "继续把源视频保存在任务 Run 中，之后仍可改为清理。",
  },
];

export function ingestionRefreshDelay(job) {
  return ["queued", "running"].includes(job?.status)
    ? ACTIVE_REFRESH_DELAY
    : IDLE_REFRESH_DELAY;
}

export function candidateSummarySaveLabel(saving, hasSavedSummary) {
  if (saving) return "保存中…";
  return hasSavedSummary ? "保存修改" : "保存候选摘要";
}

export function mediaRetentionStatusLabel(retention) {
  const labels = {
    unconfigured: "尚未选择",
    retained: "正在保留",
    due: "已到期，等待手动清理",
    cleaned: "临时视频已清理",
  };
  return labels[retention?.state] || "未知状态";
}
