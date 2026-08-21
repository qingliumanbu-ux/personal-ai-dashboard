import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildVaultIndex,
  getDocument,
  searchIndex,
} from "./vault-index.mjs";
import {
  cancelJob,
  confirmJob,
  createXhsDraftJob,
  detectCodexCli,
  getJob,
  listJobs,
  subscribeJob,
} from "./codex-runner.mjs";
import {
  createIngestSnapshot,
  createReaderNotesRepository,
  hashReaderDocumentContent,
} from "./reader-notes.mjs";
import { createReaderExplanationsService } from "./reader-explanations.mjs";
import { createMaterialReadingStateRepository } from "./material-reading-state.mjs";
import {
  materialFolderPayload,
  materialReadingQueuePayload,
  materialsHomePayload,
} from "./materials.mjs";
import { booksPayload } from "./books.mjs";
import {
  getSocialInsight,
  getSocialTrend,
  listSocialInsights,
  listSocialTrends,
} from "./social-insights.mjs";
import { validateVaultSelections } from "./security.mjs";
import {
  WIKI_INGEST_STATUS,
  createWikiIngestRunner,
} from "./wiki-ingest-runner.mjs";
import { createVaultSyncService } from "./vault-sync.mjs";
import { loadAttentionStrategy } from "./public-config.mjs";
import { isIngestionProxyPath } from "./ingestion-proxy.mjs";
import { buildDiagnostics, summarizeSystemHealth } from "./system-health.mjs";
import { maintenancePreview, validateMaintenanceExecution } from "./maintenance.mjs";
import { knowledgeWorkCandidates, knowledgeWorkFocusContext } from "./knowledge-work.mjs";
import { createCandidateSummaryProvider } from "./candidate-summary-provider.mjs";
import { createAiProviderSettingsRepository } from "./ai-provider-settings.mjs";
import { createVaultLayout } from "./vault-layout.mjs";
import {
  MATERIAL_REVIEW_OPTIONS,
  buildHistoricalCandidateSummaryPrompt,
  classificationSuggestionFromHistoricalSummary,
  createMaterialReviewBackfillService,
  validateHistoricalCandidateSummary,
} from "./material-review-backfill.mjs";

const workbenchRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultVaultRoot = path.resolve(
  process.env.PERSONAL_DASHBOARD_VAULT_ROOT ||
    path.join(workbenchRoot, "..", "个人知识库"),
);
const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
const imageContentTypes = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};
const maximumVaultImageBytes = 8 * 1024 * 1024;
function layoutRoots(index) {
  return index?.layout?.roots || {};
}

function readerImageAllowedRoots(index) {
  const roots = layoutRoots(index);
  return [roots.raw, roots.selfMedia, roots.topics, roots.scripts, roots.wiki].filter(Boolean);
}

function json(res, status, value) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(value));
}

async function serveVaultImage(res, index, vaultRoot, id) {
  const document = getDocument(index, id);
  const contentType = imageContentTypes[document?.extension];
  const roots = layoutRoots(index);
  const isAllowedCover =
    (roots.scripts && document?.path.startsWith(`${roots.scripts}/`)) ||
    (roots.raw && document?.path.startsWith(`${roots.raw}/books/`));
  if (
    !document ||
    document.previewKind !== "image" ||
    !contentType ||
    !isAllowedCover
  ) {
    return json(res, 404, {
      error: { code: "VAULT_IMAGE_NOT_FOUND", message: "封面图片不存在。" },
    });
  }

  const validated = await validateVaultSelections([document.path], {
    vaultRoot,
    allowedRoots: [roots.scripts, roots.raw].filter(Boolean),
  });
  const selection = validated.selections[0];
  if (
    !selection ||
    selection.kind !== "file" ||
    selection.size > maximumVaultImageBytes
  ) {
    return json(res, 413, {
      error: { code: "VAULT_IMAGE_TOO_LARGE", message: "封面图片超过读取上限。" },
    });
  }

  const buffer = await readFile(selection.absolutePath);
  res.writeHead(200, {
    "Cache-Control": "private, max-age=60",
    "Content-Length": buffer.byteLength,
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buffer);
}

function readerImageDocument(index, sourceId, rawSource) {
  const sourceDocument = getDocument(index, sourceId);
  const source = String(rawSource ?? "").trim();
  if (
    !sourceDocument ||
    sourceDocument.previewKind !== "markdown" ||
    !source ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)
  ) {
    return null;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(source.split(/[?#]/, 1)[0]).replace(/\\/g, "/");
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0")) return null;

  const candidate = decoded.startsWith("/")
    ? path.posix.normalize(decoded.replace(/^\/+/, ""))
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(sourceDocument.path), decoded),
      );
  if (
    !candidate ||
    candidate === "." ||
    candidate === ".." ||
    candidate.startsWith("../") ||
    path.posix.isAbsolute(candidate)
  ) {
    return null;
  }

  const imageDocument = getDocument(index, candidate);
  return imageDocument?.previewKind === "image" ? imageDocument : null;
}

async function serveReaderImage(res, index, vaultRoot, sourceId, source) {
  const document = readerImageDocument(index, sourceId, source);
  const contentType = imageContentTypes[document?.extension];
  if (!document || !contentType) {
    return json(res, 404, {
      error: { code: "READER_IMAGE_NOT_FOUND", message: "文章图片不存在。" },
    });
  }

  const validated = await validateVaultSelections([document.path], {
    vaultRoot,
    allowedRoots: readerImageAllowedRoots(index),
  });
  const selection = validated.selections[0];
  if (
    !selection ||
    selection.kind !== "file" ||
    selection.size > maximumVaultImageBytes
  ) {
    return json(res, 413, {
      error: { code: "READER_IMAGE_TOO_LARGE", message: "文章图片超过读取上限。" },
    });
  }

  const buffer = await readFile(selection.absolutePath);
  res.writeHead(200, {
    "Cache-Control": "private, max-age=60",
    "Content-Length": buffer.byteLength,
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buffer);
}

function errorPayload(error) {
  return {
    error: {
      code: error?.code || "WORKBENCH_ERROR",
      message: error?.message || "工作台请求失败。",
    },
  };
}

function errorStatus(error) {
  const code = error?.code;
  if (code === "READ_ONLY_MODE") return 403;
  if (code === "LOCAL_API_ORIGIN_DENIED") return 403;
  if (code === "UNSUPPORTED_MEDIA_TYPE") return 415;
  if (
    ["JOB_NOT_FOUND", "DOCUMENT_NOT_FOUND", "READER_EXPLANATION_NOT_FOUND"].includes(code) ||
    code?.endsWith("_NOT_FOUND")
  ) return 404;
  if (
    [
      "CONCURRENCY_LIMIT",
      "CONFIRMATION_IN_PROGRESS",
      "JOB_OPERATION_IN_PROGRESS",
      "JOB_NOT_AWAITING_REVIEW",
      "INVALID_STATUS_TRANSITION",
      "SOURCE_CHANGED_SINCE_REVIEW",
      "NOTES_CHANGED_SINCE_REVIEW",
      "REVIEW_PLAN_STALE",
      "HANDOFF_PATH_CONFLICT",
      "TURN_LIMIT_REACHED",
      "TOO_MANY_READER_DOCUMENTS",
      "TOO_MANY_READER_NOTES",
      "DUPLICATE_READER_NOTE_ID",
      "DOCUMENT_PATH_ALREADY_NOTED",
      "READER_EXPLANATION_CONCURRENCY_LIMIT",
      "READER_EXPLANATION_FOLLOW_UP_LIMIT",
      "READER_EXPLANATION_SOURCE_CHANGED",
      "READER_EXPLANATION_NOT_COMPLETED",
      "CONTENT_HASH_MISMATCH",
      "FOLLOW_UP_LIMIT_REACHED",
      "EXPLANATION_NOT_COMPLETED",
      "EXPLANATION_ALREADY_SAVED",
      "TOO_MANY_EXPLANATIONS",
      "DUPLICATE_EXPLANATION_ID",
      "SERVICE_CLOSED",
      "RESERVED_READER_NOTE",
      "READER_EXPLANATION_NOTE_ID_CONFLICT",
      "TOO_MANY_MATERIAL_READING_ITEMS",
      "JOB_NOT_ACTIVE",
      "WRITEBACK_PLAN_REQUIRED",
      "WRITEBACK_PLAN_STALE",
      "WRITEBACK_PLAN_CHANGED",
    ].includes(code)
  ) {
    return 409;
  }
  if (
    code === "READER_NOTES_STORE_CORRUPT" ||
    code === "READER_NOTES_STORE_TOO_LARGE" ||
    code?.startsWith("UNSAFE_READER_NOTES_") ||
    code?.startsWith("UNSAFE_READER_EXPLANATIONS_") ||
    code?.startsWith("READER_EXPLANATIONS_STORE_") ||
    code?.startsWith("MATERIAL_READING_STATE_") ||
    code === "SYMLINK_ESCAPE"
  ) {
    return 500;
  }
  if (
    code === "INVALID_JSON" ||
    code === "REQUEST_TOO_LARGE" ||
    code?.startsWith("INVALID_") ||
    code?.startsWith("READER_NOTE") ||
    code?.startsWith("INVALID_EXPLANATION") ||
    code?.startsWith("INVALID_QUOTE") ||
    code?.startsWith("SOURCE_") ||
    code?.startsWith("NOTES_") ||
    code?.startsWith("REVIEW_") ||
    code === "PATH_TRAVERSAL" ||
    code === "NO_READER_NOTES" ||
    code === "UNSUPPORTED_EXPLANATION_OVERRIDE" ||
    code === "EXPLANATION_INPUT_TOO_LONG" ||
    code === "QUOTE_CONTEXT_MISMATCH" ||
    code === "QUOTE_NOT_IN_DOCUMENT" ||
    code === "QUESTION_REQUIRED" ||
    code === "DOCUMENT_MISMATCH" ||
    code === "QUOTE_MISMATCH" ||
    code?.startsWith("INVALID_MATERIAL")
  ) {
    return 400;
  }
  return 500;
}

function assertLocalMutationRequest(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")) return;
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") {
    const error = new Error("本地工作台拒绝跨站修改请求。");
    error.code = "LOCAL_API_ORIGIN_DENIED";
    throw error;
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // Invalid Origin headers are rejected below.
    }
    if (originHost !== host) {
      const error = new Error("本地工作台拒绝来自其他 Origin 的修改请求。");
      error.code = "LOCAL_API_ORIGIN_DENIED";
      throw error;
    }
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    const error = new Error("修改请求必须使用 application/json。");
    error.code = "UNSUPPORTED_MEDIA_TYPE";
    throw error;
  }
}

function assertWritableApiRequest(req, url, readOnly) {
  if (!readOnly || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method || "")) {
    return;
  }
  if (req.method === "POST" && ["/api/refresh", "/api/open"].includes(url.pathname)) {
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/ai-provider-settings") {
    return;
  }
  const error = new Error("当前 Dashboard 以只读模式连接 Vault，已拒绝写入请求。");
  error.code = "READ_ONLY_MODE";
  throw error;
}

function assertAllowedObjectKeys(value, allowedKeys, code = "INVALID_READER_EXPLANATION_REQUEST") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("请求必须是 JSON 对象。");
    error.code = code;
    throw error;
  }
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    const error = new Error(`请求包含不允许的字段：${unexpected.join("、")}`);
    error.code = code;
    throw error;
  }
}

function readerExplanationDocumentId(record) {
  if (record?.document && typeof record.document === "object") {
    return record.document.id ?? record.document.documentId ?? null;
  }
  return record?.documentId ?? record?.document ?? null;
}

function readerExplanationThread(records, targetId) {
  const rows = Array.isArray(records) ? records : [];
  const byId = new Map(rows.filter((record) => record?.id).map((record) => [String(record.id), record]));
  const rootOf = (record) => {
    let current = record;
    const seen = new Set();
    while (current?.parentId && byId.has(String(current.parentId))) {
      if (seen.has(String(current.id))) break;
      seen.add(String(current.id));
      current = byId.get(String(current.parentId));
    }
    return current;
  };
  const target = byId.get(String(targetId));
  if (!target) return [];
  const rootId = String(rootOf(target)?.id || target.id);
  return rows
    .filter((record) => String(rootOf(record)?.id || record.id) === rootId)
    .sort((left, right) =>
      (Number(left.followUpDepth) || 0) - (Number(right.followUpDepth) || 0) ||
      String(left.createdAt || "").localeCompare(String(right.createdAt || "")),
    );
}

function renderReaderExplanationNote(records) {
  const completed = (Array.isArray(records) ? records : [])
    .filter((record) => record?.status === "completed" && record?.result);
  const turns = completed.flatMap((record, index) => {
    const result = record.result || {};
    const answer = result.answer || result.plainLanguage || "_本轮没有生成回答。_";
    const question = String(record.question || "").trim();
    const questionLabel = index === 0 ? "我的问题" : `我的追问 ${index}`;
    const answerLabel = index === 0 ? "Codex 回答" : `Codex 继续回答 ${index}`;
    return [
      ...(index > 0 ? ["", "---", ""] : []),
      `**${questionLabel}**`,
      "",
      question || (index === 0 ? "_未填写问题，直接理解原文。_" : "_本轮问题缺失。_"),
      "",
      `**${answerLabel}**`,
      "",
      answer,
    ];
  });
  return [
    "> AI 阅读辅助，非用户判断。以下内容由 Codex 结合保存时对应版本的整篇原文生成，请回到原文核对。",
    "",
    ...turns,
  ].join("\n");
}

async function readJson(req, maximumBytes = 64 * 1024) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > maximumBytes) {
      const error = new Error("请求内容超过安全上限。");
      error.code = "REQUEST_TOO_LARGE";
      throw error;
    }
  }

  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求 JSON 无法解析。");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function groupDefinition(key, label, count, description = undefined) {
  return { key, label, count, ...(description ? { description } : {}) };
}

function materialGroup(document) {
  const section = document.section;
  if (["articles", "deep-reading", "web-search"].includes(section)) return "reading";
  if (["my-thoughts", "personal-reviews", "diagnosis-cases"].includes(section)) return "personal";
  if (section === "douyin") return "douyin";
  if (section === "codex-sessions") return "sessions";
  return "other";
}

function collectionPayload(index, kind) {
  if (kind === "materials") {
    const rawRoot = index?.layout?.roots?.raw || "10_raw";
    const items = index.documents
      .filter(
        (item) =>
          item.layer === "raw" &&
          !item.path.startsWith(`${rawRoot}/books/`) &&
          !item.path.startsWith(`${rawRoot}/social-insights/`),
      )
      .map((item) => ({ ...item, group: materialGroup(item) }));
    const counts = Object.groupBy
      ? Object.groupBy(items, (item) => item.group)
      : items.reduce((result, item) => {
          (result[item.group] ||= []).push(item);
          return result;
        }, {});
    return {
      total: items.length,
      groups: [
        groupDefinition("reading", "阅读与研究", counts.reading?.length ?? 0, "文章、深度阅读与网页研究"),
        groupDefinition("personal", "个人输入", counts.personal?.length ?? 0, "每日想法、读后思考与诊断案例"),
        groupDefinition("douyin", "抖音证据", counts.douyin?.length ?? 0, "作品数据、截图与复盘证据包"),
        groupDefinition("sessions", "Codex 活动", counts.sessions?.length ?? 0, "每周 Session 轻量索引"),
      ],
      items,
    };
  }

  if (kind === "wiki") {
    const typeLabels = {
      source: "来源拆解",
      framework: "方法框架",
      concept: "核心概念",
      diagnosis: "诊断判断",
      analysis: "综合分析",
      case: "具体案例",
      comparison: "比较选型",
      topic: "主题入口",
      conflict: "争议问题",
      question: "复用问答",
    };
    const groups = Object.entries(index.wiki.countsByType)
      .sort((left, right) => right[1] - left[1])
      .map(([key, count]) => groupDefinition(key, typeLabels[key] ?? key, count));
    return {
      total: index.wiki.pages.length,
      groups,
      items: index.wiki.pages,
    };
  }

  if (kind === "content") {
    const stageLabels = {
      idea: "候选",
      material_validating: "素材验证中",
      filmed: "已拍",
      published: "已发布",
      selected: "已确认",
      topic_selected: "已选题",
      ready_to_shoot: "准备完成",
    };
    const groups = Object.entries(index.topics.countsByPipelineStage)
      .sort((left, right) => right[1] - left[1])
      .map(([key, count]) => groupDefinition(key, stageLabels[key] ?? key, count));
    const items = index.topics.items.map((item) => ({
      ...item,
      layer: "topic",
      type: "Topic",
      section: item.series || item.folderStatus,
      status: item.pipelineStage,
      excerpt: [
        item.isFilmed ? "已拍" : null,
        item.isPublished ? "已发布" : null,
        item.displayFormat,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
    return { total: items.length, groups, items };
  }

  if (kind === "archive") {
    const labels = {
      data_reviews: "数据复盘",
      weekly_reviews: "周复盘",
      content_strategy: "内容策略",
      content_reviews: "内容审查",
      system_design: "系统设计",
      rule_sync: "规则修复",
      topic_outputs: "选题探索",
      dashboards: "Dashboard",
    };
    const groups = Object.entries(index.runs.countsByCategory)
      .sort((left, right) => right[1] - left[1])
      .map(([key, count]) => groupDefinition(key, labels[key] ?? key, count));
    return { total: index.runs.items.length, groups, items: index.runs.items };
  }

  return { total: 0, groups: [], items: [] };
}

function overviewPayload(index) {
  const candidateCount = index.topics.items.filter(
    (topic) =>
      topic.folderStatus === "idea" &&
      !topic.isFilmed &&
      !topic.isPublished,
  ).length;
  const douyinAvailable = index.douyin.available === true;
  const personalKnowledgeLine = douyinAvailable
    ? index.douyin.contentLines.find((line) =>
        String(line.name || "").includes("个人知识库"),
      )
    : null;
  let cumulativePlays = 0;
  const douyinTrend = [...(douyinAvailable ? index.douyin.monthly ?? [] : [])]
    .filter((item) => item.month && Number.isFinite(item.views))
    .sort((left, right) => String(left.month).localeCompare(String(right.month)))
    .map((item) => {
      cumulativePlays += item.views;
      return {
        date: item.month,
        plays: item.views,
        cumulativePlays,
        workCount: item.workCount,
      };
    });
  const douyinRange = index.douyin.range ?? {};
  const douyinRangeLabel =
    douyinRange.from && douyinRange.to
      ? `${douyinRange.from} → ${douyinRange.to}`
      : null;
  const douyinQualityNotices = douyinAvailable
    ? [
        `来源：${index.douyin.sourcePath}；${index.douyin.comparableCount} 条可比作品${douyinRangeLabel ? `，作品发布时间范围 ${douyinRangeLabel}` : ""}。`,
        "图表按作品发布月份汇总当前累计播放，不代表账号每日新增播放。",
        ...(index.douyin.qualityIssues ?? [])
          .slice(0, 3)
          .map((issue) => `${issue.issue}${issue.affectedWorks ? `（${issue.affectedWorks}）` : ""}`),
      ]
    : [
        `抖音数据源不可用：${index.douyin.sourcePath} 未找到或无法解析。`,
      ];
  const filmedTopics = index.topics.items
    .filter((topic) => topic.isFilmed)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, 2);
  const byUpdated = (left, right) =>
    (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
  const selectedRecent = [
    ...index.documents
      .filter((item) => !item.isArchived && item.layer === "wiki" && item.kind === "knowledge")
      .sort(byUpdated)
      .slice(0, 3),
    ...index.documents
      .filter((item) => !item.isArchived && item.layer === "raw")
      .sort(byUpdated)
      .slice(0, 3),
  ].sort(byUpdated);
  const sourceLabels = {
    source: "来源拆解",
    framework: "方法框架",
    concept: "核心概念",
    diagnosis: "诊断判断",
    analysis: "综合分析",
    comparison: "比较选型",
    case: "案例",
    articles: "文章原文",
    "deep-reading": "深度阅读",
    "web-search": "网页研究",
    "my-thoughts": "个人想法",
    "personal-reviews": "读后思考",
    "diagnosis-cases": "诊断案例",
    douyin: "抖音证据",
  };

  return {
    generatedAt: index.generatedAt,
    demoMode: index.demoMode === true,
    metrics: {
      raw: index.stats.rawFiles,
      wiki: index.stats.formalWikiPages,
      topics: index.stats.topics,
      candidates: candidateCount,
      filmed: index.stats.filmedTopics,
      publishedWorks: douyinAvailable ? index.stats.douyinWorks : null,
      runs: index.stats.runs,
      totalPlays: douyinAvailable
        ? index.douyin.summary.totalViews ?? null
        : null,
      profileVisits: douyinAvailable
        ? index.douyin.summary.totalProfileVisits ?? null
        : null,
      profileVisitsIsLowerBound:
        douyinAvailable &&
        index.douyin.summaryLowerBounds.totalProfileVisits === true,
      knowledgeContribution: personalKnowledgeLine?.viewSharePct ?? null,
    },
    wikiStatus: {
      active: index.wiki.countsByStatus.active ?? 0,
      needsReview:
        index.wiki.countsByStatus["needs-review"] ??
        index.wiki.countsByStatus.needs_review ??
        0,
      deprecated: index.wiki.countsByStatus.deprecated ?? 0,
    },
    recent: selectedRecent.map((item) => ({
      ...item,
      type: item.layer === "wiki" ? "Wiki" : "素材",
      section: sourceLabels[item.type] ?? sourceLabels[item.section] ?? item.section,
      relativePath: item.path,
    })),
    activity: filmedTopics.map((topic) => ({
      id: topic.id,
      documentId: topic.id,
      status: topic.isPublished ? "已拍摄 · 已发布" : "已拍摄",
      title: topic.title,
      meta: `更新于 ${String(topic.updatedAt || "").slice(5, 16).replace("T", " ")}`,
      dateTime: topic.updatedAt,
    })),
    douyinTrend,
    douyinAvailable,
    douyinQualityFlags: index.douyin.qualityFlags ?? [],
    douyinTrendTitle: douyinAvailable
      ? `作品播放汇总 · 按发布月份${douyinRange.to ? `（截至 ${String(douyinRange.to).slice(0, 10)}）` : ""}`
      : "抖音作品数据不可用",
    dataProvenance: douyinAvailable
      ? {
          sourcePath: index.douyin.sourcePath,
          sourceUpdatedAt: index.douyin.updatedAt,
          comparableWorks: index.douyin.comparableCount,
          range: douyinRange,
          trendGrain: "作品发布月份",
          trendMetric: "各月发布作品的当前累计播放",
          isRealtime: false,
        }
      : null,
    qualityNotices: douyinQualityNotices,
  };
}

function graphPayload(index) {
  const nodes = index.documents.filter(
    (document) =>
      document.layer === "wiki" &&
      document.kind === "knowledge" &&
      document.extension === "md",
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeMap = new Map();
  for (const node of nodes) {
    for (const link of node.wikiLinks ?? []) {
      if (!link.resolvedId || !nodeIds.has(link.resolvedId)) continue;
      if (link.resolvedId === node.id) continue;
      const key = `${node.id}__${link.resolvedId}`;
      const existing = edgeMap.get(key);
      if (existing) existing.weight += 1;
      else edgeMap.set(key, { source: node.id, target: link.resolvedId, weight: 1 });
    }
  }
  const degree = new Map();
  const inDegree = new Map();
  const outDegree = new Map();
  for (const edge of edgeMap.values()) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  return {
    generatedAt: index.generatedAt,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edgeMap.size,
      isolatedCount: nodes.filter((node) => !degree.has(node.id)).length,
    },
    typeCounts: index.wiki?.countsByType ?? {},
    nodes: nodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.type ?? "other",
      status: node.status ?? null,
      section: node.section ?? null,
      tags: node.tags ?? [],
      updatedAt: node.updatedAt,
      degree: degree.get(node.id) ?? 0,
      inDegree: inDegree.get(node.id) ?? 0,
      outDegree: outDegree.get(node.id) ?? 0,
    })),
    edges: [...edgeMap.values()],
  };
}

function readerBodyFromContent(content) {
  return typeof content === "string"
    ? content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    : content;
}

function documentPayload(index, id) {
  const document = getDocument(index, id);
  if (!document) return null;
  const body = readerBodyFromContent(document.content);
  return {
    ...document,
    relativePath: document.path,
    body,
    contentHash:
      typeof body === "string" ? hashReaderDocumentContent(body) : null,
    outgoingLinks: (document.wikiLinks ?? [])
      .filter((link) => link.resolvedId)
      .map((link) => ({
        id: link.resolvedId,
        title: link.label || link.target,
      })),
  };
}

function requestFilters(url) {
  const filters = {};
  for (const key of [
    "layer",
    "kind",
    "section",
    "type",
    "status",
    "extension",
    "tags",
    "domain",
    "topics",
    "contentKind",
    "useCases",
    "sourceType",
  ]) {
    const values = url.searchParams.getAll(key).filter(Boolean);
    if (values.length) filters[key] = values.length === 1 ? values[0] : values;
  }
  if (url.searchParams.get("includeArchived") === "true") filters.includeArchived = true;
  filters.limit = Number(url.searchParams.get("limit") || 100);
  return filters;
}

function spawnDetached(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      ...options,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openLocalDocument(vaultRoot, document, target) {
  const absolutePath = path.resolve(vaultRoot, document.path);
  if (target === "finder") {
    if (process.platform === "win32") {
      await spawnDetached("explorer.exe", [`/select,${absolutePath}`], { windowsHide: true });
      return;
    }
    if (process.platform === "darwin") {
      await spawnDetached("/usr/bin/open", ["-R", absolutePath]);
      return;
    }
    await spawnDetached("xdg-open", [path.dirname(absolutePath)]);
    return;
  }

  const vaultName = path.basename(vaultRoot);
  const url = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(document.path)}`;
  if (process.platform === "win32") {
    await spawnDetached("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true });
    return;
  }
  if (process.platform === "darwin") {
    await spawnDetached("/usr/bin/open", [url]);
    return;
  }
  await spawnDetached("xdg-open", [url]);
}

export function workbenchApiPlugin({
  vaultRoot = defaultVaultRoot,
  layoutId = "dashboard-v1",
  readOnly = false,
  readerExplanationService = null,
  ingestionUrl = "http://127.0.0.1:8766",
} = {}) {
  let readerNoteApiMutationQueue = Promise.resolve();
  const vaultLayout = createVaultLayout(layoutId);
  const vaultAllowedRoots = [
    ...new Set(Object.values(vaultLayout.summary().roots).filter(Boolean)),
    "Brainstorm",
  ];
  const rawRoot = vaultLayout.root("raw");
  const notesDirectory = `${rawRoot}/my-thoughts/reading-notes`;
  const readerNotes = createReaderNotesRepository({ vaultRoot, notesDirectory });
  const materialReadingState = createMaterialReadingStateRepository({ vaultRoot, rawRoot });
  const aiProviderSettings = createAiProviderSettingsRepository({ root: workbenchRoot });
  const wikiIngest = createWikiIngestRunner({
    vaultRoot,
    rawRoot,
    runsRoot: vaultLayout.root("runs"),
    wikiRoot: vaultLayout.root("wiki"),
    settingsLoader: () => aiProviderSettings.load(),
  });
  const readerExplanations = readerExplanationService ??
    createReaderExplanationsService({
      vaultRoot,
      storePath: `${notesDirectory}/.workbench-reader-explanations.json`,
    });
  const candidateSummaryProvider = createCandidateSummaryProvider({
    settingsLoader: () => aiProviderSettings.load(),
  });
  const materialReviewBackfill = createMaterialReviewBackfillService({
    vaultRoot,
    rawRoot,
  });
  const vaultSync = createVaultSyncService({
    vaultRoot,
    roots: vaultLayout.summary().roots,
    buildIndex: (root) => buildVaultIndex(root, { layoutId }),
  });
  const currentIndex = () => vaultSync.currentIndex();
  const refreshIndex = (options = {}) => vaultSync.refresh({
    reason: "manual",
    ...options,
  });

  async function ingestionHealth() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(new URL("/api/health", ingestionUrl), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return { available: false, status: `http-${response.status}` };
      const payload = await response.json().catch(() => ({}));
      return { available: payload?.status === "ok", status: payload?.status ?? "unknown" };
    } catch {
      return { available: false, status: "unreachable" };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function systemHealthPayload() {
    const [current, codex, ingestion] = await Promise.all([
      currentIndex(),
      detectCodexCli(),
      ingestionHealth(),
    ]);
    const graph = graphPayload(current).stats;
    const classification = materialsHomePayload(current, []).classification;
    const vault = {
      connected: true,
      label: path.basename(vaultRoot),
      generatedAt: current.generatedAt,
      documents: current.stats.documents,
      errors: current.errors.length,
    };
    const sync = vaultSync.getStatus();
    const codexStatus = { available: codex.available, source: codex.source };
    const checks = {
      tests: { status: "unknown", detail: "当前进程没有最近测试结果记录" },
      privacyScan: { status: "unknown", detail: "当前进程没有最近隐私扫描记录" },
    };
    const health = summarizeSystemHealth({
      vault,
      sync,
      graph,
      classification,
      ingestion,
      codex: codexStatus,
      checks,
    });
    return {
      generatedAt: new Date().toISOString(),
      vault,
      sync,
      graph,
      classification: {
        classified: classification.classified,
        unclassified: classification.unclassified,
        coveragePct: classification.coveragePct,
      },
      ingestion,
      codex: codexStatus,
      checks,
      ...health,
    };
  }

  async function indexedReaderDocument(documentId) {
    const document = documentPayload(await currentIndex(), documentId);
    if (!document) {
      const error = new Error("文档不存在。");
      error.code = "DOCUMENT_NOT_FOUND";
      throw error;
    }
    return document;
  }

  async function freshIndexedReaderDocument(documentId) {
    const indexed = await indexedReaderDocument(documentId);
    if (typeof indexed.body !== "string") {
      const error = new Error("当前文档没有可可靠读取的文本正文。");
      error.code = "INVALID_DOCUMENT_BODY";
      throw error;
    }
    const validated = await validateVaultSelections([indexed.relativePath], {
      vaultRoot,
      allowedRoots: vaultAllowedRoots,
    });
    const selected = validated.selections[0];
    if (!selected || selected.kind !== "file") {
      const error = new Error("当前文档路径无法重新读取。");
      error.code = "DOCUMENT_NOT_FOUND";
      throw error;
    }
    const content = await readFile(selected.absolutePath, "utf8");
    const body = readerBodyFromContent(content);
    return {
      ...indexed,
      relativePath: selected.relativePath,
      content,
      body,
      contentHash: hashReaderDocumentContent(body),
    };
  }

  function queueReaderNoteMutation(operation) {
    const result = readerNoteApiMutationQueue.then(operation, operation);
    readerNoteApiMutationQueue = result.catch(() => {});
    return result;
  }

  function saveOneReaderNote(
    document,
    note,
    { allowCodexExplanation = false } = {},
  ) {
    return queueReaderNoteMutation(async () => {
      const existing = await readerNotes.get(document.id);
      const previousNotes = existing?.notes ?? [];
      const existingIndex = note?.id
        ? previousNotes.findIndex((item) => item.id === note.id)
        : -1;
      const previousNote = existingIndex >= 0 ? previousNotes[existingIndex] : null;
      if (!allowCodexExplanation && previousNote?.origin === "codex-explanation") {
        const error = new Error("AI 阅读辅助保持原始归属，不能通过普通笔记接口改写。");
        error.code = "RESERVED_READER_NOTE";
        throw error;
      }
      if (
        allowCodexExplanation &&
        previousNote &&
        (
          previousNote.origin !== "codex-explanation" ||
          previousNote.sourceAnalysisId !== note?.sourceAnalysisId
        )
      ) {
        const error = new Error("解释笔记 ID 已被其他笔记占用，已停止保存。");
        error.code = "READER_EXPLANATION_NOTE_ID_CONFLICT";
        throw error;
      }
      const nextNotes = [...previousNotes];
      if (existingIndex >= 0) nextNotes[existingIndex] = note;
      else nextNotes.push(note);

      const previousIds = new Set(previousNotes.map((item) => item.id));
      const saved = await readerNotes.save({
        documentId: document.id,
        relativePath: document.relativePath,
        title: document.title,
        contentHash: document.contentHash,
        notes: nextNotes,
      });
      const savedNote = note?.id
        ? saved.notes.find((item) => item.id === note.id)
        : saved.notes.find((item) => !previousIds.has(item.id));
      return { saved, savedNote: savedNote ?? null };
    });
  }

  function deleteOneReaderNote(document, noteId) {
    return queueReaderNoteMutation(async () => {
      const existing = await readerNotes.get(document.id);
      const nextNotes = (existing?.notes ?? []).filter((note) => note.id !== noteId);
      if (!existing || nextNotes.length === existing.notes.length) return false;
      if (nextNotes.length === 0) {
        await readerNotes.delete(document.id);
      } else {
        await readerNotes.save({
          ...existing,
          title: document.title,
          relativePath: document.relativePath,
          contentHash: document.contentHash,
          notes: nextNotes,
        });
      }
      return true;
    });
  }

  function snapshotReaderNotes(document, snapshotId) {
    return queueReaderNoteMutation(async () => {
      const existing = await readerNotes.get(document.id);
      const saved = await readerNotes.save({
        documentId: document.id,
        relativePath: document.relativePath,
        title: document.title,
        contentHash: document.contentHash,
        notes: existing?.notes ?? [],
      });
      return createIngestSnapshot(saved, saved.notes, {
        vaultRoot,
        notesDirectory,
        jobId: snapshotId,
      });
    });
  }

  function refreshWhenIngestFinishes(jobId) {
    let unsubscribe = () => {};
    unsubscribe = wikiIngest.subscribeJob(jobId, (job) => {
      if (
        ![
          WIKI_INGEST_STATUS.COMPLETED,
          WIKI_INGEST_STATUS.FAILED,
          WIKI_INGEST_STATUS.CANCELLED,
        ].includes(job.status)
      ) {
        return;
      }
      queueMicrotask(async () => {
        unsubscribe();
        if (job.status === WIKI_INGEST_STATUS.COMPLETED) {
          await refreshIndex({
            reason: "wiki-ingest",
            paths: [vaultLayout.root("wiki")],
          }).catch(() => {});
        }
      });
    });
  }

  return {
    name: "personal-kb-workbench-api",
    async closeBundle() {
      await vaultSync.close();
      await readerExplanations.close?.();
    },
    configureServer(server) {
      vaultSync.attachWatcher(server.watcher);
      server.httpServer?.once("close", () => {
        void vaultSync.close();
      });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/api/")) return next();
        if (isIngestionProxyPath(url.pathname)) return next();

        try {
          assertLocalMutationRequest(req);
          assertWritableApiRequest(req, url, readOnly);
          if (
            url.pathname.startsWith("/api/brainstorm/") ||
            url.pathname === "/api/public-account/dashboard"
          ) {
            return json(res, 404, {
              code: "FEATURE_NOT_INCLUDED",
              message: "该模块未包含在公开版中。",
            });
          }
          if (req.method === "GET" && url.pathname === "/api/vault/events") {
            res.writeHead(200, {
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "Content-Type": "text/event-stream; charset=utf-8",
              "X-Accel-Buffering": "no",
            });
            res.write(": connected\n\n");
            const unsubscribe = vaultSync.subscribe((event) => {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            });
            req.on("close", unsubscribe);
            return;
          }

          if (req.method === "GET" && url.pathname === "/api/vault/sync") {
            return json(res, 200, vaultSync.getStatus());
          }

          if (req.method === "GET" && url.pathname === "/api/overview") {
            return json(res, 200, overviewPayload(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname === "/api/knowledge-work") {
            return json(res, 200, knowledgeWorkCandidates(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/knowledge-work/focus/")) {
            const id = decodeURIComponent(url.pathname.slice("/api/knowledge-work/focus/".length));
            const context = knowledgeWorkFocusContext(await currentIndex(), id);
            if (!context) {
              return json(res, 404, {
                error: { message: "该知识工作已不存在或当前不再需要处理。" },
              });
            }
            return json(res, 200, context);
          }

          if (req.method === "GET" && url.pathname === "/api/config/attention") {
            return json(res, 200, await loadAttentionStrategy(workbenchRoot));
          }

          if (req.method === "POST" && url.pathname === "/api/candidate-summary/generate") {
            try {
              const body = await readJson(req);
              const generated = await candidateSummaryProvider.generate(body?.prompt);
              return json(res, 200, generated);
            } catch (error) {
              const status = error?.code === "PROVIDER_UNAVAILABLE" ? 503 : 400;
              return json(res, status, {
                error: {
                  code: error?.code || "CANDIDATE_SUMMARY_FAILED",
                  message: error?.message || "无法生成 AI 候选摘要。",
                },
              });
            }
          }

          if (req.method === "POST" && url.pathname === "/api/material-review-backfill/prompt") {
            const body = await readJson(req);
            const document = await freshIndexedReaderDocument(body?.documentId);
            if (document.layer !== "raw") {
              const error = new Error("只有来源资料可以补做第一次 AI 总结。");
              error.code = "INVALID_MATERIAL_REVIEW_SOURCE";
              throw error;
            }
            const bodyText = typeof document.body === "string" ? document.body : "";
            const sourceSha256 = createHash("sha256").update(bodyText, "utf8").digest("hex");
            return json(res, 200, {
              prompt: buildHistoricalCandidateSummaryPrompt({
                sourceType: document.sourceType || document.type || "历史来源资料",
                sourceText: bodyText,
                sourceSha256,
                captureReason: document.frontmatter?.capture_reason || "",
              }),
              options: MATERIAL_REVIEW_OPTIONS,
            });
          }

          if (req.method === "POST" && url.pathname === "/api/material-review-backfill/validate-summary") {
            const body = await readJson(req, 64 * 1024);
            const content = validateHistoricalCandidateSummary(body?.content);
            return json(res, 200, {
              valid: true,
              content,
              suggestion: classificationSuggestionFromHistoricalSummary(content),
            });
          }

          if (req.method === "POST" && url.pathname === "/api/material-review-backfill/save") {
            const body = await readJson(req, 96 * 1024);
            const document = await indexedReaderDocument(body?.documentId);
            if (document.layer !== "raw") {
              const error = new Error("只有来源资料可以补齐审核信息。");
              error.code = "INVALID_MATERIAL_REVIEW_SOURCE";
              throw error;
            }
            const saved = await materialReviewBackfill.save({
              relativePath: document.relativePath,
              summary: body?.summary || "",
              classification: body?.classification || null,
              confirm: body?.confirm === true,
            });
            const refreshed = await refreshIndex({
              reason: "material-review-backfill",
              paths: [document.relativePath],
            });
            const updatedDocument = await indexedReaderDocument(body?.documentId);
            const readingState = await materialReadingState.list();
            const currentAdmission = materialsHomePayload(await currentIndex(), readingState).p2Admission;
            return json(res, 200, {
              ...saved,
              generatedAt: refreshed.generatedAt,
              document: updatedDocument,
              p2Admission: currentAdmission,
            });
          }

          if (req.method === "GET" && url.pathname === "/api/materials") {
            const [current, readingState] = await Promise.all([
              currentIndex(),
              materialReadingState.list(),
            ]);
            return json(res, 200, materialsHomePayload(current, readingState));
          }

          if (req.method === "GET" && url.pathname === "/api/books") {
            return json(res, 200, booksPayload(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname === "/api/materials/folder") {
            const [current, readingState] = await Promise.all([
              currentIndex(),
              materialReadingState.list(),
            ]);
            return json(
              res,
              200,
              materialFolderPayload(
                current,
                readingState,
                url.searchParams.get("path") || rawRoot,
              ),
            );
          }

          if (req.method === "GET" && url.pathname === "/api/material-reading-queue") {
            const [current, readingState] = await Promise.all([
              currentIndex(),
              materialReadingState.list(),
            ]);
            return json(res, 200, materialReadingQueuePayload(current, readingState));
          }

          if (req.method === "POST" && url.pathname === "/api/material-reading-queue") {
            const body = await readJson(req, 16 * 1024);
            assertAllowedObjectKeys(
              body,
              new Set(["documentId", "contentHash"]),
              "INVALID_MATERIAL_READING_REQUEST",
            );
            const document = await indexedReaderDocument(body.documentId);
            if (document.layer !== "raw") {
              const error = new Error("只有素材层文档可以加入待看。");
              error.code = "INVALID_MATERIAL_DOCUMENT";
              throw error;
            }
            if (
              body.contentHash != null &&
              document.contentHash != null &&
              body.contentHash !== document.contentHash
            ) {
              const error = new Error("素材内容已经变化，请载入最新版本后再加入待看。");
              error.code = "CONTENT_HASH_MISMATCH";
              throw error;
            }
            const item = await materialReadingState.add({
              id: document.id,
              relativePath: document.relativePath,
              contentHash: document.contentHash,
              contentFingerprint: `${document.sizeBytes ?? "unknown"}:${document.modifiedAt ?? "unknown"}`,
            });
            vaultSync.notifyPaths([materialReadingState.storePath]);
            return json(res, 200, item);
          }

          const materialQueueMatch = url.pathname.match(
            /^\/api\/material-reading-queue\/([^/]+)$/,
          );
          if (req.method === "DELETE" && materialQueueMatch) {
            const documentId = decodeURIComponent(materialQueueMatch[1]);
            const removed = await materialReadingState.remove({ documentId });
            if (removed) vaultSync.notifyPaths([materialReadingState.storePath]);
            return json(res, 200, { removed });
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/collections/")) {
            const kind = decodeURIComponent(url.pathname.slice("/api/collections/".length));
            return json(res, 200, collectionPayload(await currentIndex(), kind));
          }

          if (req.method === "GET" && url.pathname === "/api/search") {
            const query = url.searchParams.get("q") ?? "";
            const items = searchIndex(await currentIndex(), query, requestFilters(url));
            return json(res, 200, { query, total: items.length, items });
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/vault-images/")) {
            const id = decodeURIComponent(url.pathname.slice("/api/vault-images/".length));
            const current = await currentIndex();
            return serveVaultImage(res, current, vaultRoot, id);
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/reader-images/")) {
            const id = decodeURIComponent(url.pathname.slice("/api/reader-images/".length));
            const current = await currentIndex();
            return serveReaderImage(
              res,
              current,
              vaultRoot,
              id,
              url.searchParams.get("src"),
            );
          }

          if (req.method === "GET" && url.pathname.startsWith("/api/documents/")) {
            const id = decodeURIComponent(url.pathname.slice("/api/documents/".length));
            const document = documentPayload(await currentIndex(), id);
            if (!document) return json(res, 404, { error: { message: "文档不存在。" } });
            return json(res, 200, document);
          }

          if (req.method === "GET" && url.pathname === "/api/reader-notes") {
            const documentId = url.searchParams.get("documentId") ?? "";
            const document = await indexedReaderDocument(documentId);
            const saved = await readerNotes.get(document.id);
            const notes = saved?.notes ?? [];
            return json(res, 200, {
              documentId: document.id,
              relativePath: document.relativePath,
              title: document.title,
              contentHash: document.contentHash,
              notes,
              items: notes,
              updatedAt: saved?.updatedAt ?? null,
            });
          }

          if (req.method === "POST" && url.pathname === "/api/reader-notes") {
            const body = await readJson(req, 128 * 1024);
            const document = await indexedReaderDocument(body.documentId);
            const note = body.note && typeof body.note === "object"
              ? Object.fromEntries(
                  Object.entries(body.note).filter(
                    ([key]) => !["origin", "sourceAnalysisId"].includes(key),
                  ),
                )
              : body.note;
            const { saved, savedNote } = await saveOneReaderNote(document, note);
            return json(res, 200, {
              documentId: saved.documentId,
              contentHash: saved.contentHash,
              note: savedNote,
              notes: saved.notes,
              updatedAt: saved.updatedAt,
            });
          }

          const readerNoteMatch = url.pathname.match(/^\/api\/reader-notes\/([^/]+)$/);
          if (req.method === "DELETE" && readerNoteMatch) {
            const noteId = decodeURIComponent(readerNoteMatch[1]);
            const documentId = url.searchParams.get("documentId") ?? "";
            const document = await indexedReaderDocument(documentId);
            if (!(await deleteOneReaderNote(document, noteId))) {
              return json(res, 404, { error: { code: "NOTE_NOT_FOUND", message: "笔记不存在。" } });
            }
            return json(res, 200, { ok: true, documentId: document.id, noteId });
          }

          if (req.method === "GET" && url.pathname === "/api/reader-explanations") {
            const documentId = url.searchParams.get("documentId") ?? "";
            const document = await indexedReaderDocument(documentId);
            const items = await readerExplanations.list(document.id);
            return json(res, 200, {
              documentId: document.id,
              contentHash: document.contentHash,
              items,
              explanations: items,
            });
          }

          if (req.method === "POST" && url.pathname === "/api/reader-explanations") {
            const body = await readJson(req, 128 * 1024);
            assertAllowedObjectKeys(
              body,
              new Set(["documentId", "contentHash", "quoteText", "anchor", "mode", "question"]),
            );
            const document = await freshIndexedReaderDocument(body.documentId);
            if (body.contentHash !== document.contentHash) {
              const error = new Error("正文已变化，请重新选择需要理解的内容。");
              error.code = "CONTENT_HASH_MISMATCH";
              throw error;
            }
            const explanation = await readerExplanations.start({
              document,
              body: document.body,
              contentHash: body.contentHash,
              quoteText: body.quoteText,
              anchor: body.anchor,
              mode: body.mode,
              question: body.question,
            });
            return json(res, 202, { explanation });
          }

          const readerExplanationMatch = url.pathname.match(
            /^\/api\/reader-explanations\/([^/]+)(?:\/(follow-up|save-note))?$/,
          );
          if (readerExplanationMatch) {
            const analysisId = decodeURIComponent(readerExplanationMatch[1]);
            const action = readerExplanationMatch[2] || "read";

            if (req.method === "GET" && action === "read") {
              const documentId = url.searchParams.get("documentId") ?? "";
              const document = await indexedReaderDocument(documentId);
              const explanation = await readerExplanations.get(analysisId);
              if (readerExplanationDocumentId(explanation) !== document.id) {
                const error = new Error("解释记录不属于当前文档。");
                error.code = "EXPLANATION_NOT_FOUND";
                throw error;
              }
              return json(res, 200, {
                explanation,
              });
            }

            if (req.method === "POST" && action === "follow-up") {
              const body = await readJson(req, 32 * 1024);
              assertAllowedObjectKeys(
                body,
                new Set(["documentId", "contentHash", "mode", "question"]),
              );
              const document = await freshIndexedReaderDocument(body.documentId);
              if (body.contentHash !== document.contentHash) {
                const error = new Error("正文已变化，请重新选择内容后再提问。");
                error.code = "CONTENT_HASH_MISMATCH";
                throw error;
              }
              const explanation = await readerExplanations.followUp(analysisId, {
                document,
                body: document.body,
                contentHash: body.contentHash,
                mode: body.mode,
                question: body.question,
              });
              return json(res, 202, { explanation });
            }

            if (req.method === "POST" && action === "save-note") {
              const body = await readJson(req, 32 * 1024);
              assertAllowedObjectKeys(
                body,
                new Set(["documentId", "contentHash"]),
              );
              const document = await freshIndexedReaderDocument(body.documentId);
              const explanation = await readerExplanations.get(analysisId);
              if (readerExplanationDocumentId(explanation) !== document.id) {
                const error = new Error("解释记录不属于当前文档。");
                error.code = "INVALID_READER_EXPLANATION_DOCUMENT";
                throw error;
              }
              const explanationRecords = await readerExplanations.list(document.id);
              const thread = readerExplanationThread(explanationRecords, analysisId);
              const completedThread = thread.filter((record) =>
                record.status === "completed" && record.result,
              );
              const root = thread[0] || explanation;
              if (
                body.contentHash !== document.contentHash ||
                completedThread.some((record) => record.contentHash !== document.contentHash)
              ) {
                const error = new Error("正文已变化，请重新选择原文并生成解释后再保存。");
                error.code = "READER_EXPLANATION_SOURCE_CHANGED";
                throw error;
              }
              if (!completedThread.length || root.status !== "completed" || !root.result) {
                const error = new Error("本轮对话尚未形成完整回答，暂时不能保存到笔记。");
                error.code = "READER_EXPLANATION_NOT_COMPLETED";
                throw error;
              }

              const noteId = root.savedNoteId || `explanation-thread-${String(root.id)
                .replace(/[^A-Za-z0-9_-]/g, "-")
                .slice(0, 104)}`;
              const { savedNote } = await saveOneReaderNote(
                document,
                {
                  id: noteId,
                  type: "quote",
                  body: renderReaderExplanationNote(completedThread),
                  quoteText: root.quoteText,
                  anchor: root.anchor,
                  origin: "codex-explanation",
                  sourceAnalysisId: root.id,
                },
                { allowCodexExplanation: true },
              );
              const savedNoteId = savedNote?.id || noteId;
              const markedThread = typeof readerExplanations.markThreadSaved === "function"
                ? await readerExplanations.markThreadSaved(
                    completedThread.map((record) => record.id),
                    savedNoteId,
                  )
                : await Promise.all(completedThread.map((record) =>
                    readerExplanations.markSaved(record.id, savedNoteId),
                  ));
              const marked = markedThread.at(-1) || root;
              return json(res, 200, {
                analysisId: root.id,
                requestedAnalysisId: analysisId,
                savedNoteId,
                note: savedNote,
                explanation: marked,
                explanations: markedThread,
              });
            }
          }

          if (req.method === "POST" && url.pathname === "/api/wiki-ingest") {
            const body = await readJson(req);
            const document = await indexedReaderDocument(body.documentId);
            if (document.layer !== "raw") {
              const error = new Error(`只有素材层（${rawRoot}）的文档可以进入正式 Wiki Ingest。`);
              error.code = "INVALID_INGEST_SOURCE";
              throw error;
            }
            if (typeof document.body !== "string" || !document.body.trim()) {
              const error = new Error("当前来源没有可可靠读取的文本正文，不能开始入库评估。");
              error.code = "INVALID_INGEST_SOURCE";
              throw error;
            }

            const [current, readingState] = await Promise.all([
              currentIndex(),
              materialReadingState.list(),
            ]);
            const currentAdmission = materialsHomePayload(current, readingState).p2Admission;
            const admission = body?.p2Admission;
            const approved =
              admission?.decision === "approved" &&
              admission?.userConfirmed === true &&
              admission?.source === "user";
            if (!approved) {
              const error = new Error("P2 尚未经过当前用户明确批准，不能开始 Raw → Wiki 二次提炼。");
              error.code = "P2_ADMISSION_REQUIRED";
              throw error;
            }
            const approvedFingerprint = admission?.snapshot?.snapshotFingerprint;
            if (
              typeof approvedFingerprint !== "string" ||
              !approvedFingerprint ||
              approvedFingerprint !== currentAdmission?.snapshotFingerprint
            ) {
              const error = new Error("P2 批准时的真实 Raw 快照已经变化，请回到资料中心重新确认准入。");
              error.code = "P2_ADMISSION_STALE";
              throw error;
            }

            const snapshotId = `ingest-${randomUUID()}`;
            const snapshot = await snapshotReaderNotes(document, snapshotId);
            const job = await wikiIngest.startPlan({
              rawPath: document.relativePath,
              notesPath: snapshot.relativePath,
            });
            return json(res, 202, {
              ...job,
              p2AdmissionFingerprint: approvedFingerprint,
              notesSnapshotPath: snapshot.relativePath,
              noteCount: snapshot.noteCount,
            });
          }

          if (req.method === "GET" && url.pathname === "/api/wiki-ingest/jobs") {
            return json(res, 200, { items: await wikiIngest.listJobs() });
          }

          if (req.method === "GET" && url.pathname === "/api/wiki-ingest/recovery") {
            const document = await indexedReaderDocument(
              url.searchParams.get("documentId"),
            );
            if (document.layer !== "raw") {
              const error = new Error(`只有素材层（${rawRoot}）的文档可以恢复 Wiki Ingest 任务。`);
              error.code = "INVALID_INGEST_SOURCE";
              throw error;
            }
            const handoff = await wikiIngest.findClientHandoff(document.relativePath);
            return json(res, 200, { handoff });
          }

          const wikiIngestMatch = url.pathname.match(
            /^\/api\/wiki-ingest\/jobs\/([^/]+)(?:\/(events|message|manual-plan|manual-write|handoff|confirm|cancel))?$/,
          );
          if (wikiIngestMatch) {
            const jobId = decodeURIComponent(wikiIngestMatch[1]);
            const action = wikiIngestMatch[2] || "read";
            if (req.method === "GET" && action === "read") {
              return json(res, 200, wikiIngest.getJob(jobId));
            }
            if (req.method === "POST" && action === "message") {
              const body = await readJson(req, 32 * 1024);
              const job = body.kind === "query"
                ? wikiIngest.queryJob(jobId, { message: body.message })
                : wikiIngest.reviseJob(jobId, { message: body.message });
              return json(res, 202, job);
            }
            if (req.method === "POST" && action === "manual-plan") {
              const body = await readJson(req, 256 * 1024);
              return json(res, 200, await wikiIngest.setManualPlan(jobId, body));
            }
            if (req.method === "POST" && action === "manual-write") {
              const job = await wikiIngest.executeManualWrite(jobId);
              if (job.status === WIKI_INGEST_STATUS.COMPLETED) {
                await refreshIndex({
                  reason: "manual-wiki-ingest",
                  paths: [vaultLayout.root("wiki")],
                }).catch(() => {});
              }
              return json(res, job.status === WIKI_INGEST_STATUS.COMPLETED ? 200 : 202, job);
            }
            if (req.method === "POST" && action === "confirm") {
              const body = await readJson(req, 256 * 1024);
              const job = await wikiIngest.confirmJob(jobId, body);
              refreshWhenIngestFinishes(jobId);
              return json(res, 202, job);
            }
            if (req.method === "POST" && action === "handoff") {
              const body = await readJson(req, 32 * 1024);
              const job = await wikiIngest.createClientHandoffJob(jobId, body);
              return json(res, 201, job);
            }
            if (req.method === "POST" && action === "cancel") {
              return json(res, 200, wikiIngest.cancelJob(jobId));
            }
            if (req.method === "GET" && action === "events") {
              // Validate the in-memory job before committing SSE headers. After
              // a local server restart the browser may briefly retain an old
              // job id; a normal JSON 404 lets the client recover, while
              // throwing after writeHead would crash the dev server with
              // ERR_HTTP_HEADERS_SENT.
              wikiIngest.getJob(jobId);
              res.writeHead(200, {
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "Content-Type": "text/event-stream; charset=utf-8",
                "X-Accel-Buffering": "no",
              });
              res.write(": connected\n\n");
              let unsubscribe = () => {};
              unsubscribe = wikiIngest.subscribeJob(jobId, (job) => {
                res.write(`data: ${JSON.stringify(job)}\n\n`);
                if (
                  [
                    WIKI_INGEST_STATUS.AWAITING_REVIEW,
                    WIKI_INGEST_STATUS.HANDOFF_READY,
                    WIKI_INGEST_STATUS.COMPLETED,
                    WIKI_INGEST_STATUS.FAILED,
                    WIKI_INGEST_STATUS.CANCELLED,
                  ].includes(job.status)
                ) {
                  queueMicrotask(() => {
                    unsubscribe();
                    res.end();
                  });
                }
              });
              req.on("close", unsubscribe);
              return;
            }
          }

          if (req.method === "GET" && url.pathname === "/api/graph") {
            return json(res, 200, graphPayload(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname === "/api/douyin/works") {
            const current = await currentIndex();
            return json(res, 200, {
              generatedAt: current.generatedAt,
              total: current.douyin.works.length,
              items: current.douyin.works,
              comparableCount: current.douyin.comparableCount,
              summary: current.douyin.summary,
              summaryLowerBounds: current.douyin.summaryLowerBounds,
              contentLines: current.douyin.contentLines,
              formats: current.douyin.formats,
              roles: current.douyin.roles,
              monthly: current.douyin.monthly,
              reviewStatusCounts: current.douyin.reviewStatusCounts,
              available: current.douyin.available === true,
              sourcePath: current.douyin.sourcePath,
              sourceUpdatedAt: current.douyin.updatedAt,
              range: current.douyin.range,
              qualityIssues: current.douyin.qualityIssues,
              qualityFlags: current.douyin.qualityFlags,
              analytics: current.douyin.analytics,
              demoMode: current.douyin.demoMode === true,
            });
          }

          if (req.method === "GET" && url.pathname === "/api/social-insights") {
            return json(res, 200, listSocialInsights(await currentIndex()));
          }

          if (req.method === "GET" && url.pathname === "/api/social-trends") {
            return json(res, 200, listSocialTrends(await currentIndex()));
          }

          const socialInsightMatch = url.pathname.match(
            /^\/api\/social-insights\/([^/]+)$/,
          );
          if (req.method === "GET" && socialInsightMatch) {
            let reportId;
            try {
              reportId = decodeURIComponent(socialInsightMatch[1]);
            } catch {
              return json(res, 400, {
                error: {
                  code: "INVALID_SOCIAL_INSIGHT_ID",
                  message: "社媒洞察报告 ID 无法解析。",
                },
              });
            }
            const report = getSocialInsight(await currentIndex(), reportId);
            if (!report) {
              return json(res, 404, {
                error: {
                  code: "SOCIAL_INSIGHT_NOT_FOUND",
                  message: "社媒洞察报告不存在或已被移动。",
                },
              });
            }
            return json(res, 200, report);
          }

          const socialTrendMatch = url.pathname.match(
            /^\/api\/social-trends\/([^/]+)$/,
          );
          if (req.method === "GET" && socialTrendMatch) {
            let reportId;
            try {
              reportId = decodeURIComponent(socialTrendMatch[1]);
            } catch {
              return json(res, 400, {
                error: {
                  code: "INVALID_SOCIAL_TREND_ID",
                  message: "社媒风向报告 ID 无法解析。",
                },
              });
            }
            const report = getSocialTrend(await currentIndex(), reportId);
            if (!report) {
              return json(res, 404, {
                error: {
                  code: "SOCIAL_TREND_NOT_FOUND",
                  message: "社媒风向报告不存在或已被移动。",
                },
              });
            }
            return json(res, 200, report);
          }

          if (req.method === "POST" && url.pathname === "/api/refresh") {
            const refreshed = await refreshIndex({ reason: "manual" });
            return json(res, 200, {
              generatedAt: refreshed.generatedAt,
              stats: refreshed.stats,
              errors: refreshed.errors.length,
              sync: vaultSync.getStatus(),
            });
          }

          if (req.method === "GET" && url.pathname === "/api/runtime") {
            const [current, codex] = await Promise.all([currentIndex(), detectCodexCli()]);
            return json(res, 200, {
              vault: {
                connected: true,
                label: path.basename(vaultRoot),
                generatedAt: current.generatedAt,
                documents: current.stats.documents,
                errors: current.errors.length,
              },
              sync: vaultSync.getStatus(),
              codex: {
                available: codex.available,
                source: codex.source,
              },
            });
          }

          if (req.method === "GET" && url.pathname === "/api/system-health") {
            return json(res, 200, await systemHealthPayload());
          }

          if (req.method === "GET" && url.pathname === "/api/ai-provider-settings") {
            return json(res, 200, await aiProviderSettings.load());
          }

          if (req.method === "PUT" && url.pathname === "/api/ai-provider-settings") {
            try {
              const body = await readJson(req);
              return json(res, 200, await aiProviderSettings.save(body));
            } catch (error) {
              return json(res, 400, {
                error: {
                  code: error?.code || "AI_SETTINGS_SAVE_FAILED",
                  message: error?.message || "无法保存 AI Provider 设置。",
                },
              });
            }
          }

          if (req.method === "GET" && url.pathname === "/api/diagnostics") {
            const health = await systemHealthPayload();
            return json(res, 200, {
              generatedAt: health.generatedAt,
              overall: health.overall,
              readOnly: true,
              findings: buildDiagnostics(health),
            });
          }

          if (req.method === "GET" && url.pathname === "/api/maintenance/preview") {
            try {
              return json(res, 200, maintenancePreview(url.searchParams.get("action")));
            } catch (error) {
              return json(res, 400, {
                error: { code: error.code || "INVALID_MAINTENANCE_ACTION", message: error.message },
              });
            }
          }

          if (req.method === "POST" && url.pathname === "/api/maintenance/execute") {
            try {
              const body = await readJson(req);
              const preview = validateMaintenanceExecution(body);
              if (preview.action !== "rebuild-index") {
                return json(res, 400, {
                  error: { code: "MAINTENANCE_ACTION_NOT_ALLOWED", message: "不支持的维护动作。" },
                });
              }
              const refreshed = await refreshIndex({ reason: "maintenance-confirmed" });
              return json(res, 200, {
                ok: true,
                action: preview.action,
                generatedAt: refreshed.generatedAt,
                errors: refreshed.errors.length,
                sync: vaultSync.getStatus(),
              });
            } catch (error) {
              return json(res, 400, {
                error: { code: error.code || "MAINTENANCE_FAILED", message: error.message },
              });
            }
          }

          if (req.method === "POST" && url.pathname === "/api/open") {
            const body = await readJson(req);
            const current = await currentIndex();
            const document = getDocument(current, body.id);
            if (!document) return json(res, 404, { error: { message: "文档不存在。" } });
            if (!["obsidian", "finder"].includes(body.target)) {
              return json(res, 400, { error: { message: "不支持的打开方式。" } });
            }
            await openLocalDocument(vaultRoot, document, body.target);
            return json(res, 200, { ok: true });
          }

          if (req.method === "POST" && url.pathname === "/api/workflows/xiaohongshu") {
            const body = await readJson(req);
            return json(res, 202, await createXhsDraftJob(body));
          }

          if (req.method === "GET" && url.pathname === "/api/workflows/jobs") {
            return json(res, 200, { items: listJobs() });
          }

          const jobMatch = url.pathname.match(
            /^\/api\/workflows\/jobs\/([^/]+)(?:\/(events|cancel|confirm))?$/,
          );
          if (jobMatch) {
            const jobId = decodeURIComponent(jobMatch[1]);
            const action = jobMatch[2] || "read";

            if (req.method === "GET" && action === "read") {
              return json(res, 200, getJob(jobId));
            }
            if (req.method === "POST" && action === "cancel") {
              return json(res, 200, cancelJob(jobId));
            }
            if (req.method === "POST" && action === "confirm") {
              const confirmed = await confirmJob(jobId);
              await refreshIndex();
              return json(res, 200, confirmed);
            }
            if (req.method === "GET" && action === "events") {
              res.writeHead(200, {
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "Content-Type": "text/event-stream; charset=utf-8",
                "X-Accel-Buffering": "no",
              });
              res.write(": connected\n\n");
              let unsubscribe = () => {};
              unsubscribe = subscribeJob(jobId, (job) => {
                res.write(`data: ${JSON.stringify(job)}\n\n`);
                if (
                  ["awaiting_review", "completed", "failed", "cancelled"].includes(job.status)
                ) {
                  queueMicrotask(() => {
                    unsubscribe();
                    res.end();
                  });
                }
              });
              req.on("close", unsubscribe);
              return;
            }
          }

          return json(res, 404, { error: { message: "API 路径不存在。" } });
        } catch (error) {
          server.config.logger.error(error);
          return json(res, errorStatus(error), errorPayload(error));
        }
      });
    },
  };
}
