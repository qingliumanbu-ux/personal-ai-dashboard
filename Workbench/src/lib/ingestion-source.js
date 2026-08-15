export function buildIngestionPayload({
  sourceType,
  value,
  useVad,
  vadAvailable,
  captureTags = "",
  captureReason = "",
}) {
  const normalized = value.trim();
  const tags = parseCaptureTags(captureTags);
  const reason = captureReason.trim();
  const captureContext = {
    ...(tags.length ? { tags } : {}),
    ...(reason ? { capture_reason: reason } : {}),
  };
  if (sourceType === "web-page") {
    return {
      source_type: "web-page",
      source_text: normalized,
      ...captureContext,
    };
  }
  return {
    source_type: "local-video",
    source_path: normalized,
    language: "zh",
    model: "small",
    vad: useVad && vadAvailable,
    ...captureContext,
  };
}

export function parseCaptureTags(value = "") {
  const seen = new Set();
  return value
    .split(/[,，;；\n]+/)
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function ingestionCaptureContext(job) {
  let tags = [];
  try {
    const parsed = JSON.parse(job?.params?.capture_tags || "[]");
    if (Array.isArray(parsed)) tags = parsed.filter((tag) => typeof tag === "string" && tag.trim());
  } catch {
    tags = [];
  }
  return {
    tags,
    reason: job?.params?.capture_reason || "",
    sharedText: job?.params?.capture_text || "",
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
