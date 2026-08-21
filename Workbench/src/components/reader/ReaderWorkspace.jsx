import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconBulb,
  IconInfoCircle,
  IconLoader2,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconNotes,
  IconPlus,
  IconQuote,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import {
  cancelWikiIngestJob,
  confirmWikiIngestJob,
  createWikiIngestEventSource,
  deleteReaderNote,
  executeManualWikiIngest,
  loadAiProviderSettings,
  loadMaterialReviewBackfillPrompt,
  loadMaterialsHome,
  loadWikiIngestJobs,
  loadWikiIngestJob,
  loadReaderNotes,
  saveMaterialReviewBackfill,
  saveManualWikiIngestPlan,
  saveReaderNote,
  sendWikiIngestMessage,
  startWikiIngest,
  validateMaterialReviewBackfillSummary,
} from "../../lib/api";
import { generateCandidateSummary } from "../../lib/ingestion-api";
import { buildMaterialKnowledgeReadiness } from "../../lib/material-knowledge-lifecycle";
import {
  decideP2Admission,
  loadP2AdmissionState,
  p2AdmissionAllowsExtractionForSnapshot,
  saveP2AdmissionState,
} from "../../lib/p2-admission-state";
import { ReaderExplanationPanel } from "./ReaderExplanationPanel";

const SAVE_DELAY = 650;
const MANUAL_WIKI_PLAN_TEMPLATE = [
  "## 内容适配与证据边界",
  "",
  "请人工填写。",
  "",
  "## 概念候选",
  "",
  "请人工填写。",
  "",
  "## 去重与关联",
  "",
  "请人工填写。",
  "",
  "## Wiki Diff",
  "",
  "如果需要创建 Wiki 文件，请严格按下面格式填写；可以有多个文件块：",
  "",
  "### [示例] 创建文件：`06-正式知识/示例.md`",
  "```markdown",
  "# 示例",
  "",
  "这里填写完整 Markdown 内容。",
  "```",
  "",
  "如果需要更新已有 Wiki 文件，请使用“更新文件”，并粘贴确认后的完整新文件内容：",
  "",
  "### [示例] 更新文件：`06-正式知识/已有页面.md`",
  "```markdown",
  "# 已有页面",
  "",
  "这里填写更新后的完整 Markdown 内容。",
  "```",
  "",
  "真正执行时，请复制需要的示例块，并把标题改成不带“[示例]”的“### 创建文件：...”或“### 更新文件：...”。如果本轮不应写入任何 Wiki 文件，请删除示例块并明确写“本轮无 Wiki 写入”。",
  "",
  "## 不入库内容与待验证问题",
  "",
  "请人工填写。",
  "",
  "## 二次确认清单",
  "",
  "请人工填写。",
].join("\n");

function clientKey() {
  return globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function unwrapNotes(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.notes ?? payload?.items ?? payload?.data?.notes ?? [];
  return Array.isArray(rows) ? rows : [];
}

function unwrapNote(payload) {
  return payload?.note ?? payload?.data?.note ?? payload?.data ?? payload;
}

function asMessage(error, fallback) {
  if (!error) return fallback;
  try {
    const parsed = JSON.parse(error.message);
    return parsed?.error?.message || parsed?.message || fallback;
  } catch {
    return error.message || fallback;
  }
}

function formatWikiOperationTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function wikiOperationStatusLabel(job) {
  if (!job) return "未开始";
  if (job.status === "completed") return "已完成并写入 Wiki";
  if (job.status === "handoff_ready" && job.ai?.provider === "manual") return "人工方案已确认，等待写入 Wiki";
  if (job.status === "awaiting_review") return "等待二次审核";
  if (job.status === "failed") return "失败";
  if (job.status === "cancelled") return "已取消";
  return "处理中";
}

function wikiEventLabel(event) {
  if (!event) return "状态更新";
  if (event.type === "planning.requested") return "开始第二次提炼";
  if (event.type === "manual-plan.requested") return "进入人工二次提炼";
  if (event.type === "manual-plan.saved") return "保存人工提炼方案";
  if (event.type === "manual-wiki-write.completed") return "人工 Wiki 写入完成";
  if (event.type === "status.changed") {
    const next = event.data?.to;
    if (next === "awaiting_review") return "进入二次审核";
    if (next === "handoff_ready") return "人工方案确认完成";
    if (next === "completed") return "Wiki 写入完成";
    if (next === "failed") return "任务失败";
    if (next === "cancelled") return "任务取消";
    return `状态变更：${next || "未知"}`;
  }
  return event.type;
}

function normalizeNote(note, index = 0) {
  return {
    ...note,
    id: note?.id ?? null,
    type: note?.type === "quote" ? "quote" : "free",
    body: String(note?.body ?? ""),
    quoteText: note?.quoteText ? String(note.quoteText) : null,
    anchor: note?.anchor ?? null,
    _key: note?._key || note?.id || `loaded-${index}`,
    _revision: Number(note?._revision) || 0,
    _savedRevision: Number(note?._savedRevision) || 0,
    _saveState: note?._saveState || "saved",
  };
}

function notePayload(note) {
  return {
    ...(note.id ? { id: note.id } : {}),
    type: note.type,
    body: note.body,
    ...(note.type === "quote"
      ? {
          quoteText: note.quoteText,
          anchor: note.anchor,
        }
      : {}),
  };
}

function noteNeedsSave(note) {
  if (!note) return false;
  if (note.type === "free" && !note.body.trim() && !note.id) return false;
  return (
    note._revision > note._savedRevision ||
    note._saveState === "pending" ||
    note._saveState === "failed" ||
    note._saveState === "saving"
  );
}

function noteStatusLabel(note) {
  if (note._saveState === "saving") return "保存中";
  if (note._saveState === "pending") return "等待保存";
  if (note._saveState === "failed") return "保存失败";
  return "已保存";
}

function NotesPanel({
  notes,
  loading,
  error,
  pendingDelete,
  onAdd,
  onChange,
  onBlur,
  onJump,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}) {
  return (
    <div className="reader-notes">
      <div className="reader-workspace__section-head">
        <div>
          <span className="reader-workspace__eyebrow">READER NOTES</span>
          <h2>文档笔记</h2>
        </div>
        <button
          type="button"
          className="reader-workspace__quiet-button"
          onClick={onAdd}
          disabled={loading}
        >
          <IconPlus aria-hidden="true" />
          自由笔记
        </button>
      </div>

      <p className="reader-workspace__hint">选中正文可创建带原文锚点的引用笔记。</p>

      {error ? (
        <div className="reader-workspace__error" role="status">
          <IconAlertTriangle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="reader-notes__loading" aria-label="正在读取笔记">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : notes.length ? (
        <div className="reader-notes__list">
          {notes.map((note, index) => (
            <motion.article
              className={`reader-note-card reader-note-card--${note.type}`}
              data-note-key={note._key}
              key={note._key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(index, 4) * 0.025 }}
            >
              <header className="reader-note-card__head">
                <span>
                  {note.origin === "codex-explanation"
                    ? <IconSparkles aria-hidden="true" />
                    : note.type === "quote"
                      ? <IconQuote aria-hidden="true" />
                      : <IconNotes aria-hidden="true" />}
                  {note.origin === "codex-explanation"
                    ? "AI 阅读辅助"
                    : note.type === "quote"
                      ? "引用笔记"
                      : "自由笔记"}
                </span>
                <span
                  className={`reader-note-card__save reader-note-card__save--${note._saveState}`}
                  aria-live="polite"
                >
                  {note._saveState === "saving" ? <IconLoader2 aria-hidden="true" /> : null}
                  {noteStatusLabel(note)}
                </span>
              </header>

              {note.type === "quote" ? (
                <button
                  type="button"
                  className="reader-note-card__quote"
                  onClick={() => onJump({
                    ...note.anchor,
                    quoteText: note.anchor?.quoteText || note.quoteText,
                  })}
                  title="回到原文位置"
                >
                  “{note.quoteText}”
                </button>
              ) : null}

              {note.origin === "codex-explanation" ? (
                <p className="reader-note-card__origin">
                  Codex 原始解释保持只读；你的核对、反对或补充请另建自由笔记。
                </p>
              ) : null}

              <label className="reader-note-card__editor">
                <span className="sr-only">
                  {note.type === "quote" ? "补充引用笔记" : "自由笔记内容"}
                </span>
                <textarea
                  autoFocus={note._focus === true}
                  value={note.body}
                  onChange={(event) => onChange(note._key, event.target.value)}
                  onBlur={() => onBlur(note._key)}
                  readOnly={note.origin === "codex-explanation"}
                  placeholder={note.origin === "codex-explanation"
                    ? "补充你的核对、反对或个人判断…"
                    : note.type === "quote"
                      ? "补充你为什么标记这段…"
                      : "写下想法、疑问或下一步…"}
                  rows={note.type === "quote" ? 3 : 4}
                />
              </label>

              {note._saveState === "failed" && note._saveError ? (
                <p className="reader-note-card__error">{note._saveError}</p>
              ) : null}

              <footer className="reader-note-card__footer">
                {pendingDelete === note._key ? (
                  <div className="reader-note-card__confirm">
                    <span>删除后不可恢复</span>
                    <button type="button" onClick={() => onConfirmDelete(note)}>确认删除</button>
                    <button type="button" onClick={onCancelDelete}>取消</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="reader-note-card__delete"
                    onClick={() => onRequestDelete(note._key)}
                    aria-label="删除这条笔记"
                  >
                    <IconTrash aria-hidden="true" />
                    删除
                  </button>
                )}
              </footer>
            </motion.article>
          ))}
        </div>
      ) : (
        <div className="reader-notes__empty">
          <IconNotes aria-hidden="true" />
          <strong>这篇文档还没有笔记</strong>
          <span>自由记录，或从正文中选择一句话开始。</span>
        </div>
      )}
    </div>
  );
}


function MaterialInfoPanel({ document, notes }) {
  const noteCount = Array.isArray(notes) ? notes.length : 0;
  const [reviewDocument, setReviewDocument] = useState(document);
  const [showKnowledgePreview, setShowKnowledgePreview] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillSummary, setBackfillSummary] = useState("");
  const [backfillOptions, setBackfillOptions] = useState({ domains: [], contentKinds: [], useCases: [] });
  const [backfillClassification, setBackfillClassification] = useState({ domain: "", topics: "", contentKind: "", useCases: [] });
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillError, setBackfillError] = useState(null);
  const [backfillSaved, setBackfillSaved] = useState(false);
  const [backfillPrompt, setBackfillPrompt] = useState("");
  const [summaryProvider, setSummaryProvider] = useState("codex_cli");
  const [wikiJob, setWikiJob] = useState(null);
  const [wikiError, setWikiError] = useState(null);
  const [wikiMessage, setWikiMessage] = useState("");
  const [wikiManualPlan, setWikiManualPlan] = useState("");
  const [recentWikiJobs, setRecentWikiJobs] = useState([]);
  const [manualWriteConfirming, setManualWriteConfirming] = useState(false);
  const [wikiConfirming, setWikiConfirming] = useState(false);
  const [wikiBusy, setWikiBusy] = useState(false);
  const [currentP2Snapshot, setCurrentP2Snapshot] = useState(null);
  const [p2Admission, setP2Admission] = useState(() => loadP2AdmissionState());
  const readiness = useMemo(
    () => buildMaterialKnowledgeReadiness(reviewDocument, notes),
    [reviewDocument, notes],
  );
  const summary = readiness.summary;
  const classificationReady = readiness.checks.find((item) => item.id === "classification")?.ready === true;
  const p2Open = p2AdmissionAllowsExtractionForSnapshot(p2Admission, currentP2Snapshot);

  useEffect(() => {
    setReviewDocument(document);
  }, [document]);

  useEffect(() => {
    let cancelled = false;
    void loadAiProviderSettings()
      .then((settings) => {
        if (!cancelled) setSummaryProvider(settings?.summary?.provider || "codex_cli");
      })
      .catch(() => {
        if (!cancelled) setSummaryProvider("codex_cli");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMaterialsHome().then((result) => {
      if (cancelled) return;
      setCurrentP2Snapshot(result.data?.p2Admission || null);
      setP2Admission(loadP2AdmissionState());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshP2Admission = async () => {
    const result = await loadMaterialsHome();
    const latestSnapshot = result.data?.p2Admission || null;
    const storedAdmission = loadP2AdmissionState();
    setCurrentP2Snapshot(latestSnapshot);
    setP2Admission(storedAdmission);
    return {
      snapshot: latestSnapshot,
      admission: storedAdmission,
      open: p2AdmissionAllowsExtractionForSnapshot(storedAdmission, latestSnapshot),
    };
  };

  const refreshRecentWikiJobs = async () => {
    try {
      const payload = await loadWikiIngestJobs();
      const sourcePath = document.relativePath ?? document.path;
      const matching = (payload?.items || [])
        .filter((item) => item?.sourcePath === sourcePath)
        .slice(0, 5);
      setRecentWikiJobs(matching);
      return matching;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    void refreshRecentWikiJobs();
  }, [document.id, document.path, document.relativePath]);

  const approveCurrentP2Snapshot = async () => {
    if (!currentP2Snapshot || currentP2Snapshot.totalRaw < 1) return;
    const next = decideP2Admission(
      p2Admission,
      {
        decision: "approved",
        snapshot: currentP2Snapshot,
        confirm: true,
      },
    );
    saveP2AdmissionState(next);
    setP2Admission(next);
    await refreshP2Admission();
  };

  useEffect(() => {
    if (!wikiJob?.id || !["planning", "revising", "executing"].includes(wikiJob.status)) return undefined;
    const events = createWikiIngestEventSource(wikiJob.id);
    events.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data);
        setWikiJob(next);
      } catch {
        // Ignore malformed SSE data; the normal polling fallback below can still recover.
      }
    };
    events.onerror = () => {
      events.close();
      void loadWikiIngestJob(wikiJob.id)
        .then((next) => setWikiJob(next))
        .catch(() => {});
    };
    return () => events.close();
  }, [wikiJob?.id, wikiJob?.status]);

  const beginKnowledgeExtraction = async () => {
    setWikiError(null);
    try {
      const latest = await refreshP2Admission();
      if (!latest.open) {
        setShowKnowledgePreview(true);
        return;
      }
      setWikiBusy(true);
      const next = await startWikiIngest(document.id, latest.admission);
      setWikiJob(next);
      if (next.ai?.provider === "manual" && !next.reviewPlan) {
        setWikiManualPlan(MANUAL_WIKI_PLAN_TEMPLATE);
      }
      setShowKnowledgePreview(true);
    } catch (error) {
      if (["P2_ADMISSION_REQUIRED", "P2_ADMISSION_STALE"].includes(error?.code)) {
        await refreshP2Admission().catch(() => {});
        setShowKnowledgePreview(true);
        return;
      }
      setWikiError(asMessage(error, "无法生成二次提炼方案。"));
    } finally {
      setWikiBusy(false);
    }
  };

  const retryKnowledgeExtraction = async () => {
    setWikiJob(null);
    setWikiError(null);
    await beginKnowledgeExtraction();
  };

  const saveManualKnowledgePlan = async () => {
    if (!wikiJob?.id || !wikiManualPlan.trim()) return;
    setWikiBusy(true);
    setWikiError(null);
    try {
      const next = await saveManualWikiIngestPlan(wikiJob.id, wikiManualPlan.trim());
      setWikiJob(next);
      setWikiManualPlan(next.reviewPlan || wikiManualPlan.trim());
    } catch (error) {
      setWikiError(asMessage(error, "无法保存人工二次提炼方案。"));
    } finally {
      setWikiBusy(false);
    }
  };

  const generateHistoricalSummary = async () => {
    setBackfillBusy(true);
    setBackfillError(null);
    try {
      const prepared = await loadMaterialReviewBackfillPrompt(document.id);
      setBackfillPrompt(prepared.prompt || "");
      setBackfillOptions(prepared.options || { domains: [], contentKinds: [], useCases: [] });
      const generated = await generateCandidateSummary(prepared.prompt);
      const content = generated.content || "";
      setBackfillSummary(content);
      const checked = await validateMaterialReviewBackfillSummary(content);
      const suggestion = checked.suggestion || {};
      setBackfillClassification({
        domain: suggestion.domain || "",
        topics: (suggestion.topics || []).join("，"),
        contentKind: suggestion.contentKind || "",
        useCases: suggestion.useCases || [],
      });
      setShowBackfill(true);
    } catch (error) {
      setBackfillError(asMessage(error, "无法为历史来源生成 AI 候选总结。"));
    } finally {
      setBackfillBusy(false);
    }
  };

  const openManualSummaryBackfill = async () => {
    setBackfillBusy(true);
    setBackfillError(null);
    try {
      const prepared = await loadMaterialReviewBackfillPrompt(document.id);
      setBackfillPrompt(prepared.prompt || "");
      setBackfillOptions(prepared.options || { domains: [], contentKinds: [], useCases: [] });
      setShowBackfill(true);
    } catch (error) {
      setBackfillError(asMessage(error, "无法打开人工补录模式。"));
    } finally {
      setBackfillBusy(false);
    }
  };

  const copyBackfillPrompt = async () => {
    if (!backfillPrompt || !globalThis.navigator?.clipboard?.writeText) return;
    try {
      await globalThis.navigator.clipboard.writeText(backfillPrompt);
    } catch {
      // Prompt remains visible for manual selection when clipboard access is unavailable.
    }
  };

  const openClassificationBackfill = async () => {
    setBackfillBusy(true);
    setBackfillError(null);
    try {
      const prepared = await loadMaterialReviewBackfillPrompt(document.id);
      setBackfillOptions(prepared.options || { domains: [], contentKinds: [], useCases: [] });
      setShowBackfill(true);
    } catch (error) {
      setBackfillError(asMessage(error, "无法打开历史来源分类补齐。"));
    } finally {
      setBackfillBusy(false);
    }
  };

  const validateBackfillDraft = async () => {
    if (summary) return true;
    setBackfillBusy(true);
    setBackfillError(null);
    try {
      const checked = await validateMaterialReviewBackfillSummary(backfillSummary.trim());
      if (checked.content && checked.content !== backfillSummary.trim()) {
        setBackfillSummary(checked.content);
      }
      const suggestion = checked.suggestion || {};
      setBackfillClassification((current) => ({
        domain: current.domain || suggestion.domain || "",
        topics: current.topics || (suggestion.topics || []).join("，"),
        contentKind: current.contentKind || suggestion.contentKind || "",
        useCases: current.useCases.length ? current.useCases : (suggestion.useCases || []),
      }));
      return true;
    } catch (error) {
      setBackfillError(asMessage(error, "AI 候选总结格式仍需调整。"));
      return false;
    } finally {
      setBackfillBusy(false);
    }
  };

  const saveHistoricalReview = async () => {
    const valid = await validateBackfillDraft();
    if (!valid) return;
    if (!backfillClassification.domain || !backfillClassification.contentKind) {
      setBackfillError("还需要确认资料领域和内容类型。");
      return;
    }
    if (!globalThis.confirm?.("确认保存这份 AI 候选总结和资料分类吗？保存后它们会作为你审核过的来源资料说明写回 Raw，但不会成为正式 Wiki。")) return;
    setBackfillBusy(true);
    setBackfillError(null);
    try {
      const saved = await saveMaterialReviewBackfill(document.id, {
        summary: summary ? "" : backfillSummary.trim(),
        classification: classificationReady
          ? null
          : {
              domain: backfillClassification.domain,
              topics: backfillClassification.topics
                .split(/[，,；;\n]/)
                .map((item) => item.trim())
                .filter(Boolean),
              contentKind: backfillClassification.contentKind,
              useCases: backfillClassification.useCases,
            },
        confirm: true,
      });
      if (saved.document) setReviewDocument(saved.document);
      if (saved.p2Admission) setCurrentP2Snapshot(saved.p2Admission);
      setBackfillSaved(true);
      setShowBackfill(false);
    } catch (error) {
      setBackfillError(asMessage(error, "无法保存历史来源审核信息。"));
    } finally {
      setBackfillBusy(false);
    }
  };

  const submitWikiReview = async (kind) => {
    const message = wikiMessage.trim();
    if (!wikiJob?.id || !message) return;
    setWikiError(null);
    setWikiBusy(true);
    try {
      const next = await sendWikiIngestMessage(wikiJob.id, message, kind);
      setWikiJob(next);
      setWikiMessage("");
    } catch (error) {
      setWikiError(asMessage(error, "无法提交审核意见。"));
    } finally {
      setWikiBusy(false);
    }
  };

  const confirmWikiWrite = async () => {
    if (!wikiJob?.id || !Number.isInteger(wikiJob.reviewVersion)) return;
    setWikiError(null);
    setWikiBusy(true);
    try {
      const next = await confirmWikiIngestJob(wikiJob.id, wikiJob.reviewVersion);
      setWikiJob(next);
      setWikiConfirming(false);
      await refreshRecentWikiJobs();
    } catch (error) {
      setWikiError(asMessage(error, "无法确认 Wiki 写入。"));
    } finally {
      setWikiBusy(false);
    }
  };

  const executeManualWikiWrite = async () => {
    if (!wikiJob?.id || wikiJob.ai?.provider !== "manual") return;
    setWikiError(null);
    setWikiBusy(true);
    try {
      const next = await executeManualWikiIngest(wikiJob.id);
      setWikiJob(next);
      setManualWriteConfirming(false);
      await refreshRecentWikiJobs();
    } catch (error) {
      setWikiError(asMessage(error, "人工 Wiki 写入失败。"));
    } finally {
      setWikiBusy(false);
    }
  };

  const cancelWikiWork = async () => {
    if (!wikiJob?.id) return;
    setWikiError(null);
    setWikiBusy(true);
    try {
      const next = await cancelWikiIngestJob(wikiJob.id);
      setWikiJob(next);
      setWikiConfirming(false);
    } catch (error) {
      setWikiError(asMessage(error, "无法取消当前提炼任务。"));
    } finally {
      setWikiBusy(false);
    }
  };
  return (
    <div className="reader-ingest reader-ingest--manual">
      <div className="reader-workspace__section-head">
        <div>
          <span className="reader-workspace__eyebrow">来源资料</span>
          <h2>资料信息</h2>
        </div>
      </div>

      <p className="reader-workspace__hint">
        这份内容已经完成第一次入库并作为来源资料保存。这里不再重复执行 Wiki 入库，也不会打开 Codex 客户端。
      </p>

      <div className="reader-ingest__manual-card">
        <div className="reader-ingest__manual-intro">
          <span><IconInfoCircle aria-hidden="true" /></span>
          <div>
            <h3>已归档来源资料</h3>
            <p>完整原文继续作为事实来源；AI 候选总结和你的审核结果用于理解资料，但不会自动成为正式知识。</p>
          </div>
        </div>

        <ol className="reader-ingest__manual-list">
          <li>
            <span>01</span>
            <div><strong>资料路径</strong><code>{reviewDocument.relativePath ?? reviewDocument.path ?? "—"}</code></div>
            <IconCheck aria-hidden="true" />
          </li>
          <li>
            <span>02</span>
            <div><strong>知识状态</strong><small>来源资料 · 非正式知识</small></div>
            <IconInfoCircle aria-hidden="true" />
          </li>
          <li>
            <span>03</span>
            <div><strong>阅读笔记</strong><small>{noteCount} 条</small></div>
            <IconNotes aria-hidden="true" />
          </li>
        </ol>

        {summary ? (
          <section className="reader-material-summary" aria-label="已审核 AI 候选总结">
            <div className="reader-material-summary__head">
              <span><IconSparkles aria-hidden="true" /></span>
              <div>
                <strong>已审核 AI 候选总结</strong>
                <small>来自第一次入库，保留为来源资料说明，不等于正式知识</small>
              </div>
            </div>
            <p>{summary.summary}</p>
            <details>
              <summary>查看核心要点与不确定内容</summary>
              {summary.keyPoints ? <div><strong>核心要点</strong><pre>{summary.keyPoints}</pre></div> : null}
              {summary.uncertainties ? <div><strong>不确定内容</strong><pre>{summary.uncertainties}</pre></div> : null}
            </details>
          </section>
        ) : (
          <div className="reader-material-summary reader-material-summary--missing">
            <IconInfoCircle aria-hidden="true" />
            <span>这份历史来源没有可确认的已审核 AI 候选总结；系统不会根据正文临时伪造一份。</span>
          </div>
        )}

        {(!summary || !classificationReady) ? (
          <section className="reader-backfill">
            <div className="reader-backfill__head">
              <strong>补齐历史来源审核信息</strong>
              <span>旧资料可以在这里补做第一次 AI 总结和人工分类，不需要退回入库页。</span>
            </div>

            {!showBackfill ? (
              <div className="reader-backfill__actions">
                {!summary ? (
                  <>
                    {summaryProvider !== "manual" ? (
                      <button disabled={backfillBusy} onClick={generateHistoricalSummary} type="button">
                        {backfillBusy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconSparkles aria-hidden="true" />}
                        补做 AI 总结并审核
                      </button>
                    ) : null}
                    <button disabled={backfillBusy} onClick={openManualSummaryBackfill} type="button">
                      人工补录总结
                    </button>
                  </>
                ) : null}
                {summary && !classificationReady ? (
                  <button disabled={backfillBusy} onClick={openClassificationBackfill} type="button">补齐资料分类</button>
                ) : null}
              </div>
            ) : (
              <div className="reader-backfill__editor">
                {!summary ? (
                  <>
                    <label>
                      <span>{summaryProvider === "manual" ? "人工填写候选总结" : "审核并修改 AI 候选总结"}</span>
                      <textarea
                        onChange={(event) => setBackfillSummary(event.target.value)}
                        placeholder={'必须依次包含：\n## AI 候选摘要\n## 核心要点\n## 建议标签\n## 可复用方向\n## 不确定内容\n## 建议领域\n## 建议内容类型\n## 建议用途'}
                        rows={12}
                        value={backfillSummary}
                      />
                    </label>
                    <small className="reader-backfill__format-hint">
                      固定需要 8 个章节。若从 ChatGPT 或网页复制时标题里的 Markdown 符号被去掉，保存前会自动把这些章节标题恢复为标准的“## 标题”格式。
                    </small>
                    {backfillPrompt ? (
                      <details className="reader-backfill__prompt" open={summaryProvider === "manual" ? true : undefined}>
                        <summary>标准提示词（可交给任意 AI）</summary>
                        <button onClick={copyBackfillPrompt} type="button">复制提示词</button>
                        <textarea readOnly rows={8} value={backfillPrompt} />
                      </details>
                    ) : null}
                  </>
                ) : null}

                {!classificationReady ? (
                  <div className="reader-backfill__classification">
                    <label>
                      <span>领域</span>
                      <select
                        onChange={(event) => setBackfillClassification((current) => ({ ...current, domain: event.target.value }))}
                        value={backfillClassification.domain}
                      >
                        <option value="">请选择</option>
                        {backfillOptions.domains.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>内容类型</span>
                      <select
                        onChange={(event) => setBackfillClassification((current) => ({ ...current, contentKind: event.target.value }))}
                        value={backfillClassification.contentKind}
                      >
                        <option value="">请选择</option>
                        {backfillOptions.contentKinds.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="reader-backfill__wide">
                      <span>主题</span>
                      <input
                        onChange={(event) => setBackfillClassification((current) => ({ ...current, topics: event.target.value }))}
                        placeholder="多个主题用逗号分隔"
                        value={backfillClassification.topics}
                      />
                    </label>
                    <div className="reader-backfill__wide">
                      <span>用途</span>
                      <div className="reader-backfill__checks">
                        {backfillOptions.useCases.map((item) => (
                          <label key={item}>
                            <input
                              checked={backfillClassification.useCases.includes(item)}
                              onChange={(event) => setBackfillClassification((current) => ({
                                ...current,
                                useCases: event.target.checked
                                  ? [...current.useCases, item]
                                  : current.useCases.filter((value) => value !== item),
                              }))}
                              type="checkbox"
                            />
                            {item}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="reader-backfill__actions">
                  <button disabled={backfillBusy} onClick={saveHistoricalReview} type="button">确认保存审核结果</button>
                  <button disabled={backfillBusy} onClick={() => setShowBackfill(false)} type="button">暂不保存</button>
                </div>
              </div>
            )}

            {backfillError ? <p className="reader-backfill__error">{backfillError}</p> : null}
          </section>
        ) : null}

        {backfillSaved ? (
          <div className="reader-backfill__saved">
            <IconCheck aria-hidden="true" />
            <span>审核信息已补齐。Raw 快照已变化，请回到资料中心重新确认 P2 后再生成二次提炼方案。</span>
          </div>
        ) : null}

        <button
          type="button"
          className="reader-ingest__manual-action"
          onClick={() => setShowKnowledgePreview((current) => !current)}
          aria-expanded={showKnowledgePreview}
        >
          <IconBulb aria-hidden="true" />
          {showKnowledgePreview ? "收起知识提炼准备" : "提炼为知识"}
        </button>

        {showKnowledgePreview ? (
          <section className="reader-knowledge-preview" aria-live="polite">
            <div className="reader-knowledge-preview__head">
              <span><IconBulb aria-hidden="true" /></span>
              <div>
                <strong>第二次提炼准备</strong>
                <p>这里先检查来源资料是否足以进入 Raw → Wiki 二次审核，不会运行自动提炼，也不会写入 Wiki。</p>
              </div>
            </div>
            <ul>
              {readiness.checks.map((check) => (
                <li key={check.id} className={check.ready ? "is-ready" : "is-missing"}>
                  {check.ready ? <IconCheck aria-hidden="true" /> : <IconInfoCircle aria-hidden="true" />}
                  <span>{check.label}{check.optional ? "（可选）" : ""}</span>
                </li>
              ))}
            </ul>
            <div className="reader-knowledge-preview__gate">
              <strong>{readiness.requiredReady ? "来源准备已满足" : "还需要补齐来源审核信息"}</strong>
              <p>{p2Open
                ? "P2 准入已打开。现在可以生成概念候选、去重/关联方案和 Wiki Diff；生成方案不会写入 Wiki。"
                : "P2 准入未打开或批准快照已失效；请先回到资料中心重新确认。"}</p>
              {!p2Open && readiness.requiredReady && currentP2Snapshot ? (
                <div className="reader-knowledge-preview__gate-actions">
                  <button onClick={approveCurrentP2Snapshot} type="button">
                    重新批准当前资料快照
                  </button>
                  <button onClick={refreshP2Admission} type="button">
                    刷新准入状态
                  </button>
                </div>
              ) : null}
            </div>

            {!wikiJob ? (
              <button
                className="reader-knowledge-preview__primary"
                disabled={!readiness.requiredReady || !p2Open || wikiBusy}
                onClick={beginKnowledgeExtraction}
                type="button"
              >
                {wikiBusy ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconSparkles aria-hidden="true" />}
                生成二次提炼方案
              </button>
            ) : (
              <section className="reader-wiki-review" aria-label="Wiki 二次提炼审核">
                <div className="reader-wiki-review__status">
                  <strong>{wikiJob.status === "awaiting_review" ? "等待你的二次审核" : wikiJob.status === "completed" ? "Wiki 写入完成" : wikiJob.status === "handoff_ready" && wikiJob.ai?.provider === "manual" ? "人工方案已确认" : wikiJob.status === "failed" ? "任务失败" : wikiJob.status === "cancelled" ? "任务已取消" : "处理中"}</strong>
                  <span>{wikiJob.progress || wikiJob.status}</span>
                </div>

                {wikiJob.status === "handoff_ready" && wikiJob.ai?.provider === "manual" ? (
                  <div className="reader-wiki-review__completion" role="status">
                    <IconCheck aria-hidden="true" />
                    <div>
                      <strong>人工提炼方案已确认，等待写入 Wiki</strong>
                      <span>完成时间：{formatWikiOperationTime(wikiJob.finishedAt || wikiJob.updatedAt)}</span>
                      <span>当前结果：第二次提炼和方案确认已完成；正式 Wiki 文件还没有修改。</span>
                    </div>
                  </div>
                ) : null}

                {wikiJob.status === "completed" ? (
                  <div className="reader-wiki-review__completion" role="status">
                    <IconCheck aria-hidden="true" />
                    <div>
                      <strong>第二次提炼已完成，Wiki 写入也已完成</strong>
                      <span>完成时间：{formatWikiOperationTime(wikiJob.finishedAt || wikiJob.updatedAt)}</span>
                      <span>{wikiJob.result?.deltaFiles?.length ? `实际变更 ${wikiJob.result.deltaFiles.length} 个文件。` : "没有检测到新的 Wiki 文件差异。"}</span>
                    </div>
                  </div>
                ) : null}

                {wikiJob.status === "failed" ? (
                  <div className="reader-wiki-review__error" role="alert">
                    <IconAlertTriangle aria-hidden="true" />
                    <div>
                      <strong>{wikiJob.error?.message || "二次提炼任务执行失败。"}</strong>
                      {wikiJob.error?.code ? <span className="mono">{wikiJob.error.code}</span> : null}
                    </div>
                    <button disabled={wikiBusy} onClick={retryKnowledgeExtraction} type="button">重新生成方案</button>
                  </div>
                ) : null}

                {wikiJob.ai?.provider === "manual" && wikiJob.status === "awaiting_review" ? (
                  <div className="reader-wiki-review__manual-plan">
                    <div>
                      <strong>人工二次提炼方案</strong>
                      <span>不调用 Codex。请按固定 6 个章节填写；可以自己写，也可以把模板交给任意 AI 后粘贴回来。</span>
                    </div>
                    <textarea
                      aria-label="人工二次提炼方案"
                      onChange={(event) => setWikiManualPlan(event.target.value)}
                      rows={18}
                      value={wikiManualPlan}
                    />
                    <button disabled={wikiBusy || !wikiManualPlan.trim()} onClick={saveManualKnowledgePlan} type="button">
                      {wikiJob.reviewPlan ? "保存人工方案修改" : "保存人工提炼方案"}
                    </button>
                  </div>
                ) : null}

                {wikiJob.reviewPlan ? (
                  <div className="reader-wiki-review__plan">
                    <strong>概念候选 · 去重/关联 · Wiki Diff</strong>
                    <pre>{wikiJob.reviewPlan}</pre>
                  </div>
                ) : (
                  ["planning", "revising"].includes(wikiJob.status) ? (
                    <div className="reader-wiki-review__loading"><IconLoader2 className="spin" aria-hidden="true" />AI 正在生成只读提炼方案…</div>
                  ) : null
                )}

                {wikiJob.status === "awaiting_review" ? (
                  <>
                    {wikiJob.reviewPlan ? (
                      <>
                        {wikiJob.ai?.provider !== "manual" ? (
                          <textarea
                            aria-label="二次提炼审核意见"
                            onChange={(event) => setWikiMessage(event.target.value)}
                            placeholder="可以要求补证据、修改概念、调整目标 Wiki，或询问为什么这样建议…"
                            rows={4}
                            value={wikiMessage}
                          />
                        ) : null}
                        <div className="reader-wiki-review__actions">
                          {wikiJob.ai?.provider !== "manual" ? (
                            <>
                              <button disabled={!wikiMessage.trim() || wikiBusy} onClick={() => submitWikiReview("revise")} type="button">按我的意见修订</button>
                              <button disabled={!wikiMessage.trim() || wikiBusy} onClick={() => submitWikiReview("query")} type="button">只提问</button>
                            </>
                          ) : (
                            <button onClick={() => setWikiManualPlan(wikiJob.reviewPlan || MANUAL_WIKI_PLAN_TEMPLATE)} type="button">重新编辑人工方案</button>
                          )}
                          <button className="is-danger" onClick={() => setWikiConfirming(true)} type="button">
                            {wikiJob.ai?.provider === "manual" ? "确认人工方案" : "确认这个方案并写入 Wiki"}
                          </button>
                          <button onClick={cancelWikiWork} type="button">取消本轮</button>
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}

                {wikiConfirming ? (
                  <div className="reader-wiki-review__confirm">
                    <IconAlertTriangle aria-hidden="true" />
                    <div>
                      <strong>这是第二道人工确认</strong>
                      <span>{wikiJob.ai?.provider === "manual"
                        ? "确认后会冻结这份人工计划并校验 Wiki Diff 中的具体文件。确认完成后，系统会再提供一个独立的“执行写入 Wiki”按钮。"
                        : "确认后才会按上面的具体 Wiki Diff 执行受控写入。来源或审核快照若已变化，后端会拒绝执行。"}</span>
                    </div>
                    <button disabled={wikiBusy} onClick={confirmWikiWrite} type="button">{wikiJob.ai?.provider === "manual" ? "确认人工方案" : "确认写入"}</button>
                    <button disabled={wikiBusy} onClick={() => setWikiConfirming(false)} type="button">返回审核</button>
                  </div>
                ) : null}

                {wikiJob.status === "handoff_ready" && wikiJob.ai?.provider === "manual" ? (
                  <div className="reader-wiki-review__manual-write-ready">
                    <div className="reader-wiki-review__result">
                      <strong>人工方案已确认</strong>
                      <span>{wikiJob.handoff?.message || "方案已冻结，等待执行 Wiki 写入。"}</span>
                    </div>
                    {wikiJob.manualWrite?.targets?.length ? (
                      <>
                        <div className="reader-wiki-review__targets">
                          <strong>将写入 {wikiJob.manualWrite.targets.length} 个正式 Wiki 文件</strong>
                          <ul>
                            {wikiJob.manualWrite.targets.map((target) => (
                              <li key={target.relativePath}>
                                <span>{target.operation === "create" ? "创建" : "更新"}</span>
                                <code>{target.relativePath}</code>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {!manualWriteConfirming ? (
                          <button className="is-danger" onClick={() => setManualWriteConfirming(true)} type="button">
                            执行写入 Wiki
                          </button>
                        ) : (
                          <div className="reader-wiki-review__confirm">
                            <IconAlertTriangle aria-hidden="true" />
                            <div>
                              <strong>确认执行人工 Wiki 写入</strong>
                              <span>只会写上面列出的正式 Wiki 文件。若来源、阅读笔记或目标文件自确认后发生变化，系统会停止执行。</span>
                            </div>
                            <button disabled={wikiBusy} onClick={executeManualWikiWrite} type="button">确认写入</button>
                            <button disabled={wikiBusy} onClick={() => setManualWriteConfirming(false)} type="button">取消</button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="reader-wiki-review__error" role="status">
                        当前 Wiki Diff 没有可执行文件块。请重新生成一轮人工二次提炼，并按“创建文件 / 更新文件 + markdown 代码块”的格式填写。
                      </div>
                    )}
                  </div>
                ) : null}

                {wikiJob.status === "completed" && wikiJob.result ? (
                  <div className="reader-wiki-review__result">
                    <strong>实际变更</strong>
                    <span>{wikiJob.result.deltaFiles?.length ? wikiJob.result.deltaFiles.join(" · ") : "没有检测到新的 Wiki 文件差异"}</span>
                  </div>
                ) : null}

                <details className="reader-wiki-review__history" open={wikiJob.status === "handoff_ready" || wikiJob.status === "completed"}>
                  <summary>本轮操作记录</summary>
                  <div className="reader-wiki-review__history-meta">
                    <span>状态：{wikiOperationStatusLabel(wikiJob)}</span>
                    <span>Provider：{wikiJob.ai?.provider || "—"}</span>
                    <span>任务 ID：{wikiJob.id}</span>
                    <span>开始：{formatWikiOperationTime(wikiJob.createdAt)}</span>
                  </div>
                  <ol>
                    {(wikiJob.events || []).map((event) => (
                      <li key={event.id}>
                        <time>{formatWikiOperationTime(event.at)}</time>
                        <span>{wikiEventLabel(event)}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </section>
            )}

            {recentWikiJobs.length ? (
              <details className="reader-wiki-history" open={!wikiJob}>
                <summary>最近的二次提炼记录</summary>
                <div className="reader-wiki-history__list">
                  {recentWikiJobs.map((job) => (
                    <div key={job.id} className="reader-wiki-history__item">
                      <strong>{wikiOperationStatusLabel(job)}</strong>
                      <span>{formatWikiOperationTime(job.finishedAt || job.updatedAt || job.createdAt)}</span>
                      <span>{job.ai?.provider === "manual" ? "人工模式" : `Provider：${job.ai?.provider || "—"}`}</span>
                      <code>{job.id}</code>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {wikiError ? <div className="reader-wiki-review__error" role="alert">{wikiError}</div> : null}
          </section>
        ) : null}

        <small className="reader-ingest__manual-boundary">
          后续如需沉淀为长期知识，应从资料中心发起“提炼为知识”，经过第二轮 AI 提炼、差异检查和人工确认后再写入 Wiki。
        </small>
      </div>
    </div>
  );
}

export const ReaderWorkspace = forwardRef(function ReaderWorkspace({
  document,
  contentHash,
  canExplain,
  quoteDraft,
  explanationDraft,
  onQuoteConsumed,
  onExplanationConsumed,
  onJumpToAnchor,
  collapsed = false,
  onToggleCollapsed,
}, ref) {
  const readableBody = document.body ?? document.bodyText;
  const eligibleForExplanation = Boolean(canExplain);
  const eligibleForMaterialInfo =
    document.layer === "raw" &&
    typeof readableBody === "string" &&
    Boolean(readableBody.trim());
  const [tab, setTab] = useState("notes");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [notesVersion, setNotesVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const notesRef = useRef([]);
  const timersRef = useRef(new Map());
  const inFlightRef = useRef(new Map());
  const identityRef = useRef(null);
  const consumedQuotesRef = useRef(new Set());

  const identity = useMemo(
    () => ({
      documentId: document.id,
      relativePath: document.relativePath ?? document.path,
      title: document.title,
      contentHash: contentHash || document.contentHash || null,
    }),
    [contentHash, document.contentHash, document.id, document.path, document.relativePath, document.title],
  );
  identityRef.current = identity;

  const updateNotes = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(notesRef.current) : updater;
    notesRef.current = next;
    setNotes(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    notesRef.current = [];
    setNotes([]);
    setNotesVersion(0);
    setLoading(true);
    setLoadError(null);
    setPendingDelete(null);
    setTab("notes");

    loadReaderNotes(document.id)
      .then((payload) => {
        if (cancelled) return;
        updateNotes(unwrapNotes(payload).map(normalizeNote));
      })
      .catch((requestError) => {
        if (!cancelled) setLoadError(asMessage(requestError, "笔记服务暂时不可用。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    };
  }, [document.id, updateNotes]);

  const persistNote = useCallback((key) => {
    const existing = inFlightRef.current.get(key);
    if (existing) return existing;
    const snapshot = notesRef.current.find((note) => note._key === key);
    if (!noteNeedsSave(snapshot)) return Promise.resolve({ ok: true, skipped: true });
    const identity = { ...identityRef.current };

    const task = (async () => {
      updateNotes((current) => current.map((note) =>
        note._key === key
          ? { ...note, _saveState: "saving", _saveError: null }
          : note,
      ));

      try {
        const response = await saveReaderNote({
          ...identity,
          note: notePayload(snapshot),
        });
        const saved = normalizeNote(unwrapNote(response) || snapshot);
        updateNotes((current) => current.map((note) => {
          if (note._key !== key) return note;
          const changedWhileSaving = note._revision > snapshot._revision;
          return {
            ...note,
            id: saved.id || note.id,
            createdAt: saved.createdAt || note.createdAt,
            updatedAt: saved.updatedAt || note.updatedAt,
            _savedRevision: snapshot._revision,
            _saveState: changedWhileSaving ? "pending" : "saved",
            _focus: false,
          };
        }));
        return { ok: true };
      } catch (requestError) {
        const message = asMessage(requestError, "保存失败，请稍后重试。");
        updateNotes((current) => current.map((note) =>
          note._key === key
            ? { ...note, _saveState: "failed", _saveError: message }
            : note,
        ));
        return { ok: false, error: new Error(message) };
      } finally {
        inFlightRef.current.delete(key);
        const latest = notesRef.current.find((note) => note._key === key);
        if (latest && latest._revision > snapshot._revision) {
          const timer = window.setTimeout(() => {
            timersRef.current.delete(key);
            persistNote(key);
          }, SAVE_DELAY);
          timersRef.current.set(key, timer);
        }
      }
    })();

    inFlightRef.current.set(key, task);
    return task;
  }, [updateNotes]);

  const scheduleSave = useCallback((key, delay = SAVE_DELAY) => {
    const previous = timersRef.current.get(key);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      timersRef.current.delete(key);
      persistNote(key);
    }, delay);
    timersRef.current.set(key, timer);
  }, [persistNote]);

  const flush = useCallback(async () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();

    for (let pass = 0; pass < 8; pass += 1) {
      const keys = new Set([
        ...inFlightRef.current.keys(),
        ...notesRef.current.filter(noteNeedsSave).map((note) => note._key),
      ]);
      if (!keys.size) return;

      const results = await Promise.all(
        [...keys].map((key) => inFlightRef.current.get(key) || persistNote(key)),
      );
      const failure = results.find((result) => result?.ok === false);
      if (failure) throw failure.error || new Error("笔记保存失败。");

      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    }

    if (notesRef.current.some(noteNeedsSave) || inFlightRef.current.size) {
      throw new Error("笔记仍在持续更新，请稍后再试。");
    }
  }, [persistNote]);

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  useEffect(() => {
    if (loading || !quoteDraft || consumedQuotesRef.current.has(quoteDraft.clientKey)) return;
    consumedQuotesRef.current.add(quoteDraft.clientKey);
    const next = normalizeNote({
      _key: quoteDraft.clientKey,
      type: "quote",
      body: "",
      quoteText: quoteDraft.quoteText,
      anchor: quoteDraft.anchor,
      _saveState: "pending",
      _revision: 1,
      _focus: true,
    });
    updateNotes((current) => [next, ...current]);
    setNotesVersion((current) => current + 1);
    setTab("notes");
    setMobileOpen(true);
    onQuoteConsumed?.(quoteDraft.clientKey);
    const frame = window.requestAnimationFrame(() => scheduleSave(next._key));
    return () => window.cancelAnimationFrame(frame);
  }, [loading, onQuoteConsumed, quoteDraft, scheduleSave, updateNotes]);

  useEffect(() => {
    if (!explanationDraft || !eligibleForExplanation) return;
    setTab("explain");
    setMobileOpen(true);
  }, [eligibleForExplanation, explanationDraft]);

  useEffect(() => {
    if (tab === "explain" && !eligibleForExplanation) {
      setTab("notes");
    } else if (tab === "info" && !eligibleForMaterialInfo) {
      setTab("notes");
    }
  }, [eligibleForExplanation, eligibleForMaterialInfo, tab]);

  const addFreeNote = () => {
    const next = normalizeNote({
      _key: clientKey(),
      type: "free",
      body: "",
      _saveState: "pending",
      _revision: 0,
      _focus: true,
    });
    updateNotes((current) => [next, ...current.map((note) => ({ ...note, _focus: false }))]);
    setNotesVersion((current) => current + 1);
    setMobileOpen(true);
  };

  const changeNote = (key, body) => {
    updateNotes((current) => current.map((note) =>
      note._key === key
        ? {
            ...note,
            body,
            _revision: note._revision + 1,
            _saveState: "pending",
            _focus: false,
          }
        : note,
    ));
    setNotesVersion((current) => current + 1);
    scheduleSave(key);
  };

  const blurNote = (key) => {
    const note = notesRef.current.find((item) => item._key === key);
    if (note?._saveState === "pending" || note?._saveState === "failed") scheduleSave(key, 0);
  };

  const confirmDelete = async (note) => {
    const key = note._key;
    const timer = timersRef.current.get(key);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(key);
    const currentSave = inFlightRef.current.get(key);
    if (currentSave) await currentSave;
    const latestNote = notesRef.current.find((item) => item._key === key) || note;
    if (!latestNote.id) {
      updateNotes((current) => current.filter((item) => item._key !== key));
      setNotesVersion((current) => current + 1);
      setPendingDelete(null);
      return;
    }

    updateNotes((current) => current.map((item) =>
      item._key === key ? { ...item, _saveState: "saving" } : item,
    ));
    try {
      await deleteReaderNote(latestNote.id, document.id);
      updateNotes((current) => current.filter((item) => item._key !== key));
      setNotesVersion((current) => current + 1);
      setPendingDelete(null);
    } catch (requestError) {
      updateNotes((current) => current.map((item) =>
        item._key === key
          ? { ...item, _saveState: "failed", _saveError: asMessage(requestError, "删除失败。") }
          : item,
      ));
    }
  };

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setMobileOpen(true);
  };

  const handleTabKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const availableTabs = [
      "notes",
      ...(eligibleForExplanation ? ["explain"] : []),
      ...(eligibleForMaterialInfo ? ["info"] : []),
    ];
    if (availableTabs.length < 2) return;
    event.preventDefault();
    const currentIndex = Math.max(0, availableTabs.indexOf(tab));
    const nextTab = event.key === "Home"
      ? availableTabs[0]
      : event.key === "End"
        ? availableTabs.at(-1)
        : availableTabs[
            (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + availableTabs.length) %
              availableTabs.length
          ];
    const tablist = event.currentTarget;
    switchTab(nextTab);
    window.requestAnimationFrame(() => {
      tablist.querySelector(`[data-reader-tab="${nextTab}"]`)?.focus();
    });
  };

  return (
    <aside className={`reader-workspace${mobileOpen ? " reader-workspace--open" : ""}${collapsed ? " reader-workspace--desktop-collapsed" : ""}`} aria-label="编辑批注台">
      <button
        type="button"
        className="reader-workspace__collapse-toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "展开右侧工具栏" : "收起右侧工具栏"}
        aria-pressed={collapsed}
        title={collapsed ? "展开右侧工具栏" : "收起右侧工具栏"}
      >
        {collapsed ? (
          <IconLayoutSidebarRightExpand aria-hidden="true" />
        ) : (
          <IconLayoutSidebarRightCollapse aria-hidden="true" />
        )}
      </button>
      <div className="reader-workspace__topbar">
        <div className="reader-workspace__desk-label">
          <span>ANNOTATION DESK</span>
          <small>编辑批注台</small>
        </div>
        <div className="reader-workspace__tabs" role="tablist" aria-label="阅读工作台功能" onKeyDown={handleTabKeyDown}>
          <button
            id="reader-notes-tab"
            type="button"
            role="tab"
            aria-selected={tab === "notes"}
            aria-controls="reader-notes-panel"
            data-reader-tab="notes"
            tabIndex={tab === "notes" ? 0 : -1}
            className={tab === "notes" ? "reader-workspace__tab reader-workspace__tab--active" : "reader-workspace__tab"}
            onClick={() => switchTab("notes")}
          >
            <IconNotes aria-hidden="true" />
            笔记
            {notes.length ? <span>{notes.length}</span> : null}
          </button>
          {eligibleForExplanation ? (
            <button
              id="reader-explain-tab"
              type="button"
              role="tab"
              aria-selected={tab === "explain"}
              aria-controls="reader-explain-panel"
              data-reader-tab="explain"
              tabIndex={tab === "explain" ? 0 : -1}
              className={tab === "explain" ? "reader-workspace__tab reader-workspace__tab--active" : "reader-workspace__tab"}
              onClick={() => switchTab("explain")}
            >
              <IconSparkles aria-hidden="true" />
              理解
            </button>
          ) : null}
          {eligibleForMaterialInfo ? (
            <button
              id="reader-info-tab"
              type="button"
              role="tab"
              aria-selected={tab === "info"}
              aria-controls="reader-info-panel"
              data-reader-tab="info"
              tabIndex={tab === "info" ? 0 : -1}
              className={tab === "info" ? "reader-workspace__tab reader-workspace__tab--active" : "reader-workspace__tab"}
              onClick={() => switchTab("info")}
            >
              <IconInfoCircle aria-hidden="true" />
              资料信息
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="reader-workspace__mobile-toggle"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "收起阅读工作台" : "展开阅读工作台"}
        >
          {mobileOpen ? <IconChevronDown aria-hidden="true" /> : <IconChevronUp aria-hidden="true" />}
        </button>
      </div>

      <div className="reader-workspace__body">
        <section
          id="reader-notes-panel"
          role="tabpanel"
          aria-labelledby="reader-notes-tab"
          hidden={tab !== "notes"}
        >
          <NotesPanel
            notes={notes}
            loading={loading}
            error={loadError}
            pendingDelete={pendingDelete}
            onAdd={addFreeNote}
            onChange={changeNote}
            onBlur={blurNote}
            onJump={onJumpToAnchor}
            onRequestDelete={setPendingDelete}
            onConfirmDelete={confirmDelete}
            onCancelDelete={() => setPendingDelete(null)}
          />
        </section>
        {eligibleForExplanation ? (
          <section
            id="reader-explain-panel"
            role="tabpanel"
            aria-labelledby="reader-explain-tab"
            hidden={tab !== "explain"}
          >
            <ReaderExplanationPanel
              document={document}
              contentHash={contentHash}
              explanationDraft={explanationDraft}
              onDraftConsumed={onExplanationConsumed}
              onJumpToAnchor={onJumpToAnchor}
              onCloseForJump={() => setMobileOpen(false)}
              onSavedNote={(savedNote) => {
                const next = normalizeNote(savedNote);
                updateNotes((current) => {
                  const existingIndex = current.findIndex((note) => note.id === next.id);
                  if (existingIndex < 0) return [next, ...current];
                  return current.map((note, index) => index === existingIndex ? next : note);
                });
                setNotesVersion((current) => current + 1);
              }}
            />
          </section>
        ) : null}
        {eligibleForMaterialInfo ? (
          <section
            id="reader-info-panel"
            role="tabpanel"
            aria-labelledby="reader-info-tab"
            hidden={tab !== "info"}
          >
            <MaterialInfoPanel
              document={document}
              notes={notes}
            />
          </section>
        ) : null}
      </div>
    </aside>
  );
});
