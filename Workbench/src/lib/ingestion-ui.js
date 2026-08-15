const ACTIVE_REFRESH_DELAY = 1_500;
const IDLE_REFRESH_DELAY = 15_000;

export function ingestionRefreshDelay(job) {
  return ["queued", "running"].includes(job?.status)
    ? ACTIVE_REFRESH_DELAY
    : IDLE_REFRESH_DELAY;
}

export function candidateSummarySaveLabel(saving, hasSavedSummary) {
  if (saving) return "保存中…";
  return hasSavedSummary ? "保存修改" : "保存候选摘要";
}
