const CANDIDATE_SUMMARY_HEADINGS = Object.freeze([
  "AI 候选摘要",
  "核心要点",
  "建议标签",
  "可复用方向",
  "不确定内容",
  "建议领域",
  "建议内容类型",
  "建议用途",
]);

function normalizedBody(document) {
  const body = document?.body ?? document?.bodyText;
  return typeof body === "string" ? body.replace(/\r\n?/g, "\n") : "";
}

function hasPublishedSummaryMarker(document) {
  const frontmatter = document?.frontmatter ?? {};
  return Boolean(
    frontmatter.summary_sha256
    || frontmatter.summary_source_sha256
    || frontmatter.summary_origin,
  );
}

function sectionBody(lines, headingIndex) {
  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > headingIndex && /^##\s+\S/.test(line.trim()),
  );
  const end = nextHeadingIndex < 0 ? lines.length : nextHeadingIndex;
  return lines.slice(headingIndex + 1, end).join("\n").trim();
}

export function extractPublishedCandidateSummary(document) {
  if (!hasPublishedSummaryMarker(document)) return null;
  const body = normalizedBody(document);
  if (!body) return null;
  const lines = body.split("\n");
  const sections = {};
  for (const heading of CANDIDATE_SUMMARY_HEADINGS) {
    const index = lines.findIndex((line) => line.trim() === `## ${heading}`);
    if (index >= 0) sections[heading] = sectionBody(lines, index);
  }
  if (!sections["AI 候选摘要"]) return null;
  return {
    sections,
    summary: sections["AI 候选摘要"],
    keyPoints: sections["核心要点"] || "",
    tags: sections["建议标签"] || "",
    reuse: sections["可复用方向"] || "",
    uncertainties: sections["不确定内容"] || "",
  };
}

export function buildMaterialKnowledgeReadiness(document, notes = []) {
  const summary = extractPublishedCandidateSummary(document);
  const hasClassification = Boolean(document?.domain && document?.contentKind);
  const noteCount = Array.isArray(notes) ? notes.length : 0;
  const isRaw = document?.layer === "raw";
  const checks = [
    { id: "source", label: "完整来源资料", ready: isRaw && Boolean(normalizedBody(document).trim()) },
    { id: "summary", label: "已审核 AI 候选总结", ready: Boolean(summary) },
    { id: "classification", label: "资料分类", ready: hasClassification },
    { id: "notes", label: "阅读笔记", ready: noteCount > 0, optional: true },
  ];
  const requiredReady = checks.filter((item) => !item.optional).every((item) => item.ready);
  return {
    isRaw,
    summary,
    noteCount,
    checks,
    requiredReady,
    status: !isRaw ? "not_raw" : requiredReady ? "ready_for_p2_review" : "needs_source_review",
    p2GateRequired: true,
    canWriteWiki: false,
  };
}

export { CANDIDATE_SUMMARY_HEADINGS };
