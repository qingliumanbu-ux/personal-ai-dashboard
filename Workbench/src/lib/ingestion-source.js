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
  if (sourceType === "douyin") {
    return {
      source_type: "douyin",
      source_text: normalized,
      language: "zh",
      model: "small",
      vad: useVad && vadAvailable,
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
  if (job?.source_type === "douyin") return "抖音内容";
  if (job?.source_type === "web-page") {
    try {
      return new URL(job.source_url).hostname;
    } catch {
      return "未命名网页";
    }
  }
  return (job?.source_path || "").split(/[\\/]/).pop() || "未命名视频";
}

export function ingestionContentKind(job) {
  if (job?.source_type === "web-page") return "document";
  const hasDocument = job?.artifacts?.some((item) => item.kind === "content")
    || job?.current_step?.includes("Douyin image");
  return hasDocument ? "document" : "transcript";
}

export function ingestionReadableContent(value = "", job) {
  const hasImages = job?.artifacts?.some((item) => item.kind.startsWith("source_image_"));
  if (job?.source_type !== "douyin" || !hasImages) return value;
  return value.split(/\n## 图片\s*\n/, 1)[0].trim();
}

export function ingestionSourceLocation(job) {
  return ["web-page", "douyin"].includes(job?.source_type)
    ? job.source_url
    : job?.source_path;
}
