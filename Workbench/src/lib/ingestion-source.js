export function buildIngestionPayload({
  sourceType,
  value,
  useVad,
  vadAvailable,
}) {
  const normalized = value.trim();
  if (sourceType === "web-page") {
    return { source_type: "web-page", source_url: normalized };
  }
  return {
    source_type: "local-video",
    source_path: normalized,
    language: "zh",
    model: "small",
    vad: useVad && vadAvailable,
  };
}

export function ingestionSourceName(job) {
  if (job?.source_type === "web-page") {
    try {
      return new URL(job.source_url).hostname;
    } catch {
      return "未命名网页";
    }
  }
  return (job?.source_path || "").split(/[\\/]/).pop() || "未命名视频";
}

export function ingestionSourceLocation(job) {
  return job?.source_type === "web-page" ? job.source_url : job?.source_path;
}
