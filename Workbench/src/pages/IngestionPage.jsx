import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconCopy,
  IconDeviceFloppy,
  IconFileText,
  IconPlayerPlay,
  IconRefresh,
  IconSend,
  IconSparkles,
  IconTags,
  IconUpload,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { loadAiProviderSettings } from "../lib/api";
import { formatCompactDate } from "../lib/format";
import {
  cancelIngestionJob,
  configureIngestionMediaRetention,
  createIngestionJob,
  generateCandidateSummary,
  ingestionArtifactUrl,
  loadIngestionHealth,
  loadIngestionJob,
  loadIngestionJobs,
  loadCandidateSummaryPrompt,
  loadTranscriptText,
  publishIngestionJob,
  retryIngestionJob,
  reviewIngestionJob,
  saveCandidateSummary,
  saveIngestionClassification,
} from "../lib/ingestion-api";
import {
  buildIngestionPayload,
  ingestionCaptureContext,
  ingestionContentKind,
  ingestionReadableContent,
  ingestionSourceLocation,
  ingestionSourceName,
} from "../lib/ingestion-source";
import {
  candidateSummarySaveLabel,
  ingestionRefreshDelay,
  MEDIA_RETENTION_OPTIONS,
  mediaRetentionStatusLabel,
} from "../lib/ingestion-ui";

const FILTERS = [
  ["all", "全部"],
  ["review", "待审核"],
  ["publish", "待归档"],
  ["attention", "需处理"],
];

const STATUS = {
  queued: { label: "排队中", tone: "neutral" },
  running: { label: "转写中", tone: "live" },
  waiting_review: { label: "待审核", tone: "review" },
  succeeded: { label: "已通过 · 待归档", tone: "ready" },
  changes_requested: { label: "待修改", tone: "attention" },
  rejected: { label: "未通过", tone: "muted" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "muted" },
};

function displayStatus(job) {
  if (job?.publication) return { label: "已归档", tone: "published" };
  if (["web-page", "douyin"].includes(job?.source_type) && job?.status === "running") {
    return { label: "采集中", tone: "live" };
  }
  return STATUS[job?.status] || { label: job?.status || "未知", tone: "neutral" };
}

function stepLabel(value = "", sourceType = "local-video", isDocument = false) {
  const labels = {
    "Waiting in queue": "排队等待",
    "Starting transcription": "正在启动转写",
    "Loading local model": "正在加载本地模型",
    "Ready for review": "转写完成，等待审核",
    "Transcript approved": "内容已通过审核",
    "Content approved": "内容已通过审核",
    "Changes requested": "已要求修改",
    "Transcript rejected": "内容未通过",
    "Content rejected": "内容未通过",
    "Transcription failed": "转写失败",
    "Starting ingestion": "正在启动处理",
    "Fetching webpage": "正在抓取网页",
    "Extracting webpage content": "正在提取网页正文",
    "Validating webpage artifacts": "正在校验网页产物",
    "Resolving Douyin post": "正在解析抖音帖子",
    "Downloading Douyin video": "正在下载抖音临时视频",
    "Starting local transcription": "正在启动本地转写",
    "Preparing Douyin image post": "正在整理抖音图文",
    "Validating Douyin image artifacts": "正在校验抖音图文产物",
    "Ingestion failed": "采集失败",
    "Cancellation requested": "正在取消",
    Cancelled: "已取消",
  };
  if (value.startsWith("Transcribing ")) {
    return `正在转写 ${value.slice("Transcribing ".length)}`;
  }
  if (value.startsWith("Downloading Douyin video ")) {
    return `正在下载抖音临时视频 ${value.slice("Downloading Douyin video ".length)}`;
  }
  if (value.startsWith("Downloading Douyin images ")) {
    return `正在下载抖音图片 ${value.slice("Downloading Douyin images ".length)}`;
  }
  if (value === "Ready for review" && (sourceType === "web-page" || isDocument)) {
    return sourceType === "web-page"
      ? "网页正文已提取，等待审核"
      : "抖音图文已提取，等待审核";
  }
  return labels[value] || value;
}

function progressReadout(job) {
  if (job?.publication) return "完成";
  if (job?.status === "running") return `${Math.round(job.progress * 100)}%`;
  if (job?.status === "waiting_review") return "等待审核";
  if (job?.status === "succeeded") return "等待归档";
  return displayStatus(job).label;
}

function flowProgress(job) {
  if (!job) return 0;
  if (job.publication) return 100;
  if (job.status === "queued") return 7;
  if (job.status === "running") return Math.round(10 + Number(job.progress || 0) * 45);
  if (job.status === "waiting_review") {
    return job.artifacts?.some((item) => item.kind === "candidate_summary") ? 72 : 60;
  }
  if (job.status === "succeeded") return 85;
  if (["changes_requested", "rejected"].includes(job.status)) return 76;
  return Math.max(8, Math.round(Number(job.progress || 0) * 55));
}

function stepState(job, step) {
  const progress = flowProgress(job);
  const thresholds = { submit: 1, transcribe: 10, summary: 60, review: 72, publish: 85 };
  const doneThresholds = { submit: 7, transcribe: 60, summary: 72, review: 85, publish: 100 };
  if (progress >= doneThresholds[step]) return "done";
  if (progress >= thresholds[step]) return "active";
  return "pending";
}

function matchesFilter(job, filter) {
  if (filter === "review") return job.status === "waiting_review";
  if (filter === "publish") return job.status === "succeeded" && !job.publication;
  if (filter === "attention") {
    return ["failed", "changes_requested", "rejected", "cancelled"].includes(job.status);
  }
  return true;
}

export function IngestionPage() {
  const [serviceOnline, setServiceOnline] = useState(null);
  const [serviceHealth, setServiceHealth] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sourceType, setSourceType] = useState("douyin");
  const [sourceValue, setSourceValue] = useState("");
  const [captureTags, setCaptureTags] = useState("");
  const [captureReason, setCaptureReason] = useState("");
  const [useVad, setUseVad] = useState(true);
  const [reviewNote, setReviewNote] = useState("");
  const [transcript, setTranscript] = useState("");
  const [summaryPrompt, setSummaryPrompt] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryProvenance, setSummaryProvenance] = useState(null);
  const [summaryProvider, setSummaryProvider] = useState("codex_cli");
  const [summaryCopyState, setSummaryCopyState] = useState("idle");
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [classificationDraft, setClassificationDraft] = useState({
    domain: "",
    topics: "",
    content_kind: "",
    use_cases: [],
  });
  const [savingClassification, setSavingClassification] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [retentionPolicy, setRetentionPolicy] = useState("delete_now");
  const [confirmRetention, setConfirmRetention] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contentKind = ingestionContentKind(detail);
  const isDocumentDetail = contentKind === "document";
  const transcriptArtifactId = detail?.artifacts?.find(
    (item) => item.kind === (isDocumentDetail ? "content" : "transcript"),
  )?.id;
  const imageArtifacts = detail?.artifacts?.filter(
    (item) => item.kind.startsWith("source_image_"),
  ) || [];
  const readableTranscript = ingestionReadableContent(transcript, detail);
  const summaryArtifactId = detail?.artifacts?.find(
    (item) => item.kind === "candidate_summary",
  )?.id;
  const summaryRequired = detail?.params?.summary_required === "true";
  const classificationRequired = detail?.classification?.required === true;
  const classificationConfirmed = detail?.classification?.confirmed || null;
  const classificationOptions = detail?.classification?.options || {
    domains: [],
    content_kinds: [],
    use_cases: [],
  };
  const vadCapability = serviceHealth?.capabilities?.vad;
  const vadAvailable = vadCapability?.available !== false;
  const isWebSource = sourceType === "web-page";
  const isDouyinSource = sourceType === "douyin";
  const isTextSource = isWebSource || isDouyinSource;
  const refreshDelay = ingestionRefreshDelay(detail);

  const refresh = useCallback(async () => {
    try {
      const health = await loadIngestionHealth();
      setServiceHealth(health);
      setServiceOnline(true);
      const nextJobs = await loadIngestionJobs();
      setJobs(nextJobs);
      const nextSelected = selectedId || nextJobs[0]?.id || null;
      if (!selectedId && nextSelected) setSelectedId(nextSelected);
      if (nextSelected) setDetail(await loadIngestionJob(nextSelected));
      else setDetail(null);
    } catch (refreshError) {
      setServiceHealth(null);
      setServiceOnline(false);
      setError(refreshError.message || "无法连接采集服务");
    }
  }, [selectedId]);

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
    let timer = null;
    const poll = async () => {
      await refresh();
      if (!cancelled) timer = window.setTimeout(poll, refreshDelay);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [refresh, refreshDelay]);

  useEffect(() => {
    setReviewNote("");
    setConfirmPublish(false);
    setTranscript("");
    setSummaryPrompt("");
    setSummaryDraft("");
    setSummaryProvenance(null);
    setSummaryCopyState("idle");
    setClassificationDraft({ domain: "", topics: "", content_kind: "", use_cases: [] });
  }, [detail?.id]);

  useEffect(() => {
    if (!detail?.id) return;
    const source = detail.classification?.confirmed || detail.classification?.suggestion;
    if (!source) return;
    setClassificationDraft({
      domain: source.domain || "",
      topics: (source.topics || []).join("，"),
      content_kind: source.content_kind || "",
      use_cases: source.use_cases || [],
    });
  }, [detail?.id, detail?.classification?.confirmed, detail?.classification?.suggestion]);

  useEffect(() => {
    setRetentionPolicy(detail?.media_retention?.policy || "delete_now");
    setConfirmRetention(false);
  }, [detail?.id, detail?.media_retention?.policy]);

  useEffect(() => {
    if (!transcriptArtifactId || !detail?.id) return undefined;
    let cancelled = false;
    loadTranscriptText(detail.id, transcriptArtifactId)
      .then((text) => {
        if (!cancelled) setTranscript(text);
      })
      .catch(() => {
        if (!cancelled) setTranscript("");
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.id, transcriptArtifactId]);

  useEffect(() => {
    if (!summaryArtifactId || !detail?.id) return undefined;
    let cancelled = false;
    loadTranscriptText(detail.id, summaryArtifactId)
      .then((text) => {
        if (!cancelled) setSummaryDraft(text);
      })
      .catch(() => {
        if (!cancelled) setSummaryDraft("");
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.id, summaryArtifactId]);

  const visibleJobs = useMemo(
    () => jobs.filter((job) => matchesFilter(job, filter)),
    [filter, jobs],
  );

  const runAction = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (actionError) {
      setError(actionError.message || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (!sourceValue.trim()) return;
    runAction(async () => {
      const created = await createIngestionJob(buildIngestionPayload({
        sourceType,
        value: sourceValue,
        useVad,
        vadAvailable,
        captureTags,
        captureReason,
      }));
      setSelectedId(created.id);
      setSourceValue("");
      setCaptureTags("");
      setCaptureReason("");
    });
  };

  const review = (decision) => runAction(async () => {
    await reviewIngestionJob(
      detail.id,
      decision,
      reviewNote.trim() || (decision === "approved" ? "内容通过" : ""),
    );
    setReviewNote("");
  });

  const prepareSummaryPrompt = () => runAction(async () => {
    const prepared = await loadCandidateSummaryPrompt(detail.id);
    setSummaryPrompt(prepared.prompt);
    if (globalThis.navigator?.clipboard?.writeText) {
      try {
        await globalThis.navigator.clipboard.writeText(prepared.prompt);
        setSummaryCopyState("copied");
        return;
      } catch {
        // Keep the prompt visible for manual selection.
      }
    }
    setSummaryCopyState("manual");
  });

  const generateSummary = async () => {
    if (
      summaryDraft.trim()
      && !globalThis.confirm?.("重新生成会替换当前编辑区中的候选总结，但不会改动已经保存的版本。继续吗？")
    ) return;
    setBusy(true);
    setGeneratingSummary(true);
    setError("");
    setSummaryCopyState("idle");
    try {
      const prepared = await loadCandidateSummaryPrompt(detail.id);
      setSummaryPrompt(prepared.prompt);
      const generated = await generateCandidateSummary(prepared.prompt);
      setSummaryDraft(generated.content || "");
      setSummaryProvenance({
        provider: generated.provider || "unknown",
        model: generated.model || "default",
        promptVersion: generated.promptVersion || null,
        generatedAt: generated.generatedAt || null,
      });
      setSummaryCopyState("generated");
    } catch (actionError) {
      setError(`${actionError.message || "AI 总结生成失败"}。你仍可以展开备用方式，复制标准提示词给任意 AI。`);
    } finally {
      setGeneratingSummary(false);
      setBusy(false);
    }
  };

  const copySummaryPrompt = async () => {
    if (!summaryPrompt || !globalThis.navigator?.clipboard?.writeText) {
      setSummaryCopyState("manual");
      return;
    }
    try {
      await globalThis.navigator.clipboard.writeText(summaryPrompt);
      setSummaryCopyState("copied");
    } catch {
      setSummaryCopyState("manual");
    }
  };

  const saveSummary = async () => {
    setBusy(true);
    setSavingSummary(true);
    setError("");
    try {
      const saved = await saveCandidateSummary(detail.id, summaryDraft.trim());
      setDetail((current) => current?.id === detail.id
        ? {
            ...current,
            artifacts: [
              saved,
              ...(current.artifacts || []).filter((item) => item.kind !== "candidate_summary"),
            ],
          }
        : current);
      setSummaryCopyState("saved");
    } catch (actionError) {
      setError(actionError.message || "操作失败");
    } finally {
      setSavingSummary(false);
      setBusy(false);
    }
  };

  const saveClassification = async () => {
    setBusy(true);
    setSavingClassification(true);
    setError("");
    try {
      await saveIngestionClassification(detail.id, {
        domain: classificationDraft.domain,
        topics: classificationDraft.topics
          .split(/[，,；;\n]/)
          .map((item) => item.trim())
          .filter(Boolean),
        content_kind: classificationDraft.content_kind,
        use_cases: classificationDraft.use_cases,
      });
      await refresh();
    } catch (actionError) {
      setError(actionError.message || "分类保存失败");
    } finally {
      setSavingClassification(false);
      setBusy(false);
    }
  };

  const saveMediaRetention = () => runAction(async () => {
    await configureIngestionMediaRetention(detail.id, retentionPolicy);
    setConfirmRetention(false);
  });

  const progress = flowProgress(detail);
  const state = displayStatus(detail);
  const captureContext = ingestionCaptureContext(detail);
  const hasCaptureContext = Boolean(
    captureContext.tags.length || captureContext.reason || captureContext.sharedText,
  );

  return (
    <div className="page page--ingestion">
      <PageHeader
        eyebrow="知识 / 入库"
        title="入库工作台"
        description="把值得保留的资料交给工作台。系统负责本地提取与 AI 候选总结，你负责审核、分类和最终归档到资料中心。"
      />

      <section className="ingestion-cockpit">
        <form className="ingestion-capture" onSubmit={submit}>
          <div className="ingestion-capture__head">
            <div>
              <span className="eyebrow">快速入库</span>
              <h2>添加一条来源</h2>
              <p>先把原始资料保存下来，分类和正式知识都在审核阶段再决定。</p>
            </div>
            <span className="ingestion-capture__local">LOCAL FIRST</span>
          </div>

          <div className="ingestion-source-tabs" role="tablist" aria-label="选择来源类型">
            {[
              ["douyin", "抖音", IconPlayerPlay],
              ["web-page", "网页", IconWorld],
              ["local-video", "本地视频", IconUpload],
            ].map(([value, label, Icon]) => (
              <button
                aria-selected={sourceType === value}
                className={sourceType === value ? "is-active" : ""}
                disabled={!serviceOnline || busy}
                key={value}
                onClick={() => {
                  setSourceType(value);
                  setSourceValue("");
                }}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <label className="ingestion-capture__input">
            <span>{isDouyinSource ? "抖音链接或分享文案" : isWebSource ? "网页链接或分享文本" : "视频文件路径"}</span>
            {isTextSource ? (
              <textarea
                disabled={!serviceOnline || busy}
                maxLength="4000"
                onChange={(event) => setSourceValue(event.target.value)}
                placeholder={isDouyinSource ? "粘贴抖音分享文案或公开链接…" : "粘贴网页链接，或包含链接的平台分享文本…"}
                rows="3"
                value={sourceValue}
              />
            ) : (
              <input
                disabled={!serviceOnline || busy}
                onChange={(event) => setSourceValue(event.target.value)}
                placeholder="例如 D:\\Personal-AI\\Sources\\video.mp4"
                type="text"
                value={sourceValue}
              />
            )}
          </label>

          <div className="ingestion-capture__actions">
            <button className="ingestion-capture__submit" disabled={!serviceOnline || busy || !sourceValue.trim()} type="submit">
              <IconSend aria-hidden="true" />
              <span>{isDouyinSource ? "开始采集" : isWebSource ? "采集网页" : "投递视频"}</span>
            </button>
            <span className="ingestion-capture__privacy">
              {isDouyinSource ? "媒体只临时保存在本地 Run 目录" : isWebSource ? "只抓取公开页面，不使用登录态" : "只读取已批准的本地目录"}
            </span>
          </div>

          <details className="ingestion-capture__extras">
            <summary>
              <span>补充入库信息</span>
              <small>标签、收藏原因与处理选项</small>
            </summary>
            <div className="ingestion-capture__extras-grid">
              <label>
                <span>临时标签</span>
                <input
                  disabled={!serviceOnline || busy}
                  onChange={(event) => setCaptureTags(event.target.value)}
                  placeholder="多个标签用逗号分隔"
                  type="text"
                  value={captureTags}
                />
              </label>
              <label>
                <span>为什么收藏</span>
                <input
                  disabled={!serviceOnline || busy}
                  maxLength="500"
                  onChange={(event) => setCaptureReason(event.target.value)}
                  placeholder="例如：补充当前知识库方案"
                  type="text"
                  value={captureReason}
                />
              </label>
              {!isWebSource ? (
                <label className="ingestion-vad">
                  <input
                    checked={useVad && vadAvailable}
                    disabled={!serviceOnline || busy || !vadAvailable}
                    onChange={(event) => setUseVad(event.target.checked)}
                    title={!vadAvailable ? vadCapability?.reason : undefined}
                    type="checkbox"
                  />
                  <span>{vadAvailable ? "转写时过滤静音" : "静音过滤暂不可用"}</span>
                </label>
              ) : null}
            </div>
          </details>
        </form>

        <aside className="ingestion-runtime-card">
          <div className="ingestion-runtime-card__head">
            <span className="eyebrow">本地处理流程</span>
            <span className={`ingestion-service ingestion-service--${serviceOnline ? "online" : "offline"}`}>
              <span />
              {serviceOnline === null ? "连接中" : serviceOnline ? "服务在线" : "服务离线"}
            </span>
          </div>
          <h2>本地入库流水线</h2>
          <p>采集、AI 候选总结、审核、分类、归档都在你的本地工作台完成。</p>
          <dl className="ingestion-runtime-card__facts">
            <div><dt>处理方式</dt><dd>本地优先</dd></div>
            <div><dt>归档门槛</dt><dd>人工确认</dd></div>
            <div><dt>事实源</dt><dd>Markdown</dd></div>
          </dl>
          {error ? (
            <div className="ingestion-runtime-card__error" role="alert">
              <IconAlertTriangle aria-hidden="true" />
              <span>{error}</span>
              <button aria-label="关闭提示" onClick={() => setError("")} type="button"><IconX /></button>
            </div>
          ) : null}
        </aside>
      </section>

      <div className="ingestion-workspace">
        <aside className="ingestion-queue">
          <div className="ingestion-queue__head">
            <div>
              <span className="eyebrow">处理队列</span>
              <h2>处理队列</h2>
            </div>
            <span className="ingestion-queue__count">{jobs.length}</span>
          </div>
          <div className="ingestion-filters" role="tablist" aria-label="筛选任务">
            {FILTERS.map(([value, label]) => (
              <button
                aria-selected={filter === value}
                className={filter === value ? "is-active" : ""}
                key={value}
                onClick={() => setFilter(value)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ingestion-job-list">
            {visibleJobs.map((job) => {
              const jobState = displayStatus(job);
              return (
                <button
                  className={`ingestion-job${selectedId === job.id ? " is-active" : ""}`}
                  key={job.id}
                  onClick={() => setSelectedId(job.id)}
                  type="button"
                >
                  <span className={`ingestion-job__signal ingestion-tone--${jobState.tone}`} />
                  <span className="ingestion-job__body">
                    <strong>{ingestionSourceName(job)}</strong>
                    <span>{stepLabel(job.current_step, job.source_type)}</span>
                  </span>
                  <span className={`ingestion-status ingestion-tone--${jobState.tone}`}>
                    {jobState.label}
                  </span>
                  <time>{formatCompactDate(job.updated_at)}</time>
                </button>
              );
            })}
            {visibleJobs.length === 0 ? (
              <div className="ingestion-empty">
                <IconFileText aria-hidden="true" />
                <strong>{jobs.length ? "这个筛选下没有任务" : "还没有采集任务"}</strong>
                <span>在上方粘贴抖音分享文案、网页链接或本地视频路径，任务会出现在这里。</span>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="ingestion-detail">
          {detail ? (
            <>
              <header className="ingestion-detail__head">
                <div>
                  <span className={`ingestion-status ingestion-tone--${state.tone}`}>{state.label}</span>
                  <h2>{ingestionSourceName(detail)}</h2>
                  <span className="ingestion-detail__path" title={ingestionSourceLocation(detail)}>{ingestionSourceLocation(detail)}</span>
                </div>
                <time>{formatCompactDate(detail.updated_at)}</time>
              </header>

              {hasCaptureContext ? (
                <section className="ingestion-capture-context">
                  <div className="ingestion-capture-context__title">
                    <IconTags aria-hidden="true" />
                    <strong>收藏上下文</strong>
                  </div>
                  {captureContext.tags.length ? (
                    <div className="ingestion-capture-context__tags">
                      {captureContext.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  ) : null}
                  {captureContext.reason ? <p>{captureContext.reason}</p> : null}
                  {captureContext.sharedText ? (
                    <details>
                      <summary>查看原始分享文本</summary>
                      <p>{captureContext.sharedText}</p>
                    </details>
                  ) : null}
                </section>
              ) : null}

              <div className="ingestion-flow" style={{ "--flow-progress": `${progress}%` }}>
                <div className="ingestion-flow__track"><span /></div>
                {[
                  ["submit", "投递"],
                  ["transcribe", isDocumentDetail ? "抓取" : "转写"],
                  ["summary", "AI 摘要"],
                  ["review", "审核"],
                  ["publish", "归档"],
                ].map(([key, label]) => (
                  <div className={`ingestion-flow__step is-${stepState(detail, key)}`} key={key}>
                    <span>{stepState(detail, key) === "done" ? <IconCheck /> : null}</span>
                    <strong>{label}</strong>
                  </div>
                ))}
                <div className="ingestion-flow__readout">
                  <span>{stepLabel(detail.current_step, detail.source_type, isDocumentDetail)}</span>
                  <strong>{progressReadout(detail)}</strong>
                </div>
              </div>

              {["waiting_review", "succeeded"].includes(detail.status) && !detail.publication ? (
                <section className="ingestion-summary">
                  <div className="ingestion-section-title">
                    <span>AI 候选总结</span>
                    <h3>AI 先总结，你审核后再归档</h3>
                  </div>
                  <p className="ingestion-summary__intro">
                    {summaryProvider === "manual"
                      ? "当前使用人工模式：Workbench 不会调用任何模型。你可以复制标准提示词给任意 AI，或直接手工填写候选总结；结果仍需你审核后保存。"
                      : "Workbench 会在你点击后调用受控 AI Provider 生成候选总结。结果只进入可编辑草稿，不会自动保存，也不会直接成为正式知识；完整正文始终保留。"}
                  </p>
                  <div className="ingestion-summary__actions">
                    {summaryProvider !== "manual" ? (
                      <button className="ingestion-action ingestion-action--approve" disabled={busy} onClick={generateSummary} type="button">
                        <IconSparkles />{generatingSummary ? "AI 正在总结…" : summaryDraft.trim() ? "重新生成 AI 总结" : "生成 AI 总结"}
                      </button>
                    ) : (
                      <button className="ingestion-action ingestion-action--approve" disabled={busy} onClick={prepareSummaryPrompt} type="button">
                        <IconCopy />准备人工总结提示词
                      </button>
                    )}
                    {summaryArtifactId ? <span className="ingestion-summary__saved"><IconCheck />候选摘要已保存</span> : null}
                  </div>
                  {summaryCopyState === "generated" ? <p className="ingestion-summary__feedback">AI 候选总结已生成。请直接在下方修改，确认后再保存。</p> : null}
                  {summaryProvenance ? (
                    <p className="ingestion-summary__feedback">
                      本次草稿：{summaryProvenance.provider} · {summaryProvenance.model === "default" ? "默认模型" : summaryProvenance.model}
                      {summaryProvenance.promptVersion ? ` · ${summaryProvenance.promptVersion}` : ""}
                    </p>
                  ) : null}
                  {summaryCopyState === "copied" ? <p className="ingestion-summary__feedback">提示词已复制。可粘贴到任意 AI，生成后把结果放到下方。</p> : null}
                  {summaryCopyState === "manual" ? <p className="ingestion-summary__feedback">无法自动复制，请从提示词文本框中手动全选复制。</p> : null}
                  <details className="ingestion-summary__prompt">
                    <summary>备用方式：复制标准提示词给其他 AI</summary>
                    <div className="ingestion-summary__actions">
                      <button className="ingestion-action" disabled={busy} onClick={prepareSummaryPrompt} type="button">
                        <IconCopy />{summaryPrompt ? "重新生成并复制提示词" : "生成并复制提示词"}
                      </button>
                      {summaryPrompt ? (
                        <button className="ingestion-action" disabled={busy} onClick={copySummaryPrompt} type="button">
                          <IconCopy />再次复制
                        </button>
                      ) : null}
                    </div>
                    {summaryPrompt ? <textarea aria-label="AI 候选摘要标准提示词" readOnly value={summaryPrompt} /> : null}
                  </details>
                  <label className="ingestion-summary__editor">
                    <span>审核并修改 AI 候选总结</span>
                    <textarea
                      aria-label="AI 候选摘要"
                      onChange={(event) => {
                        setSummaryDraft(event.target.value);
                        setSummaryCopyState((current) => current === "saved" ? "idle" : current);
                      }}
                      placeholder={'必须依次包含：\n## AI 候选摘要\n## 核心要点\n## 建议标签\n## 可复用方向\n## 不确定内容\n## 建议领域\n## 建议内容类型\n## 建议用途'}
                      value={summaryDraft}
                    />
                  </label>
                  <div className="ingestion-summary__actions">
                    <button className="ingestion-action ingestion-action--approve" disabled={busy || !summaryDraft.trim()} onClick={saveSummary} type="button">
                      <IconDeviceFloppy />{candidateSummarySaveLabel(savingSummary, Boolean(summaryArtifactId))}
                    </button>
                    {summaryCopyState === "saved" ? <span className="ingestion-summary__saved" role="status"><IconCheck />已保存</span> : null}
                  </div>
                </section>
              ) : null}

              {detail.status === "waiting_review" ? (
                <section className="ingestion-review">
                  <div className="ingestion-section-title">
                    <span>REVIEW GATE</span>
                    <h3>请判断这份{isDocumentDetail ? (detail.source_type === "web-page" ? "网页正文" : "抖音图文") : "转写"}是否可作为来源资料</h3>
                  </div>
                  <textarea
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="通过时可选填；要求修改或不通过时请说明原因"
                    value={reviewNote}
                  />
                  <div className="ingestion-review__actions">
                    <button className="ingestion-action ingestion-action--approve" disabled={busy || (summaryRequired && !summaryArtifactId)} onClick={() => review("approved")} type="button">
                      <IconCircleCheck />内容通过
                    </button>
                    <button className="ingestion-action" disabled={busy || !reviewNote.trim()} onClick={() => review("changes_requested")} type="button">
                      要求修改
                    </button>
                    <button className="ingestion-action ingestion-action--reject" disabled={busy || !reviewNote.trim()} onClick={() => review("rejected")} type="button">
                      不通过
                    </button>
                  </div>
                  {summaryRequired && !summaryArtifactId ? <p className="ingestion-summary__feedback">保存候选摘要后才能通过审核。</p> : null}
                </section>
              ) : null}

              {detail.status === "succeeded" && !detail.publication ? (
                <section className="ingestion-publish">
                  <div className="ingestion-section-title">
                    <span>PUBLISH GATE</span>
                    <h3>审核已通过，尚未写入知识库</h3>
                  </div>
                  {classificationRequired ? (
                    <div className="ingestion-classification">
                      <div className="ingestion-section-title">
                        <span>CLASSIFICATION</span>
                        <h3>{classificationConfirmed ? "分类已确认，可继续归档" : "确认这份资料应该如何归类"}</h3>
                      </div>
                      <div className="ingestion-classification__grid">
                        <label>
                          <span>领域</span>
                          <select
                            disabled={busy}
                            onChange={(event) => setClassificationDraft((current) => ({ ...current, domain: event.target.value }))}
                            value={classificationDraft.domain}
                          >
                            <option value="">请选择</option>
                            {classificationOptions.domains.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </label>
                        <label>
                          <span>内容类型</span>
                          <select
                            disabled={busy}
                            onChange={(event) => setClassificationDraft((current) => ({ ...current, content_kind: event.target.value }))}
                            value={classificationDraft.content_kind}
                          >
                            <option value="">请选择</option>
                            {classificationOptions.content_kinds.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </label>
                        <label className="ingestion-classification__topics">
                          <span>主题</span>
                          <input
                            disabled={busy}
                            onChange={(event) => setClassificationDraft((current) => ({ ...current, topics: event.target.value }))}
                            placeholder="多个主题用逗号分隔"
                            type="text"
                            value={classificationDraft.topics}
                          />
                        </label>
                      </div>
                      <div className="ingestion-classification__uses">
                        <span>用途</span>
                        <div>
                          {classificationOptions.use_cases.map((item) => (
                            <label key={item}>
                              <input
                                checked={classificationDraft.use_cases.includes(item)}
                                disabled={busy}
                                onChange={(event) => setClassificationDraft((current) => ({
                                  ...current,
                                  use_cases: event.target.checked
                                    ? [...current.use_cases, item]
                                    : current.use_cases.filter((value) => value !== item),
                                }))}
                                type="checkbox"
                              />
                              <span>{item}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="ingestion-summary__actions">
                        <button
                          className="ingestion-action ingestion-action--approve"
                          disabled={busy || !classificationDraft.domain || !classificationDraft.content_kind}
                          onClick={saveClassification}
                          type="button"
                        >
                          <IconTags />{savingClassification ? "正在保存…" : classificationConfirmed ? "更新分类" : "确认分类"}
                        </button>
                        {classificationConfirmed ? <span className="ingestion-summary__saved"><IconCheck />归档分类已确认</span> : null}
                      </div>
                    </div>
                  ) : null}
                  <dl>
                    <div><dt>目标位置</dt><dd>{detail.publication_preview?.relative_path || (detail.source_type === "web-page" ? "04-来源资料/网页" : "04-来源资料/视频")}</dd></div>
                    <div><dt>写入内容</dt><dd>{summaryArtifactId ? "候选摘要＋完整正文 Markdown" : isDocumentDetail ? "正文 Markdown，图片副本留在任务 Run" : "仅 Markdown，不复制原视频"}</dd></div>
                    <div><dt>知识状态</dt><dd>来源资料，不是正式知识</dd></div>
                  </dl>
                  {!confirmPublish ? (
                    <button
                      className="ingestion-action ingestion-action--publish"
                      disabled={classificationRequired && !classificationConfirmed}
                      onClick={() => setConfirmPublish(true)}
                      type="button"
                    >
                      <IconUpload />归档到资料中心
                    </button>
                  ) : (
                    <div className="ingestion-confirm">
                      <IconAlertTriangle aria-hidden="true" />
                      <div>
                        <strong>确认写入以上路径？</strong>
                        <span>不会覆盖已有文件；重复点击不会创建副本。</span>
                      </div>
                      <button disabled={busy} onClick={() => runAction(() => publishIngestionJob(detail.id))} type="button">确认归档来源资料</button>
                      <button disabled={busy} onClick={() => setConfirmPublish(false)} type="button">取消</button>
                    </div>
                  )}
                  {classificationRequired && !classificationConfirmed ? <p className="ingestion-summary__feedback">请先确认分类，再归档到资料中心。</p> : null}
                </section>
              ) : null}

              {detail.publication ? (
                <section className="ingestion-published">
                  <IconCircleCheck aria-hidden="true" />
                  <div><strong>已归档到资料中心</strong><span>{detail.publication.relative_path}</span></div>
                </section>
              ) : null}

              {detail.publication && detail.media_retention ? (
                <section className="ingestion-retention">
                  <div className="ingestion-section-title">
                    <span>MEDIA RETENTION</span>
                    <h3>临时源视频保留策略</h3>
                  </div>
                  <div className={`ingestion-retention__status ingestion-retention__status--${detail.media_retention.state}`}>
                    <strong>{mediaRetentionStatusLabel(detail.media_retention)}</strong>
                    <span>
                      {detail.media_retention.state === "cleaned"
                        ? `已释放约 ${(detail.media_retention.source_size / 1024 / 1024).toFixed(1)} MB；转写、摘要、字幕、哈希和审核记录仍保留。`
                        : detail.media_retention.delete_after
                          ? `保留期限至 ${formatCompactDate(detail.media_retention.delete_after)}；到期后仍需手动确认清理。`
                          : "这里只管理抖音源视频，不会删除图文图片或已经归档的 Markdown。"}
                    </span>
                  </div>
                  {detail.media_retention.state !== "cleaned" ? (
                    <>
                      <fieldset className="ingestion-retention__options" disabled={busy}>
                        <legend>选择策略</legend>
                        {MEDIA_RETENTION_OPTIONS.map((option) => (
                          <label className={retentionPolicy === option.value ? "is-selected" : ""} key={option.value}>
                            <input
                              checked={retentionPolicy === option.value}
                              name="media-retention"
                              onChange={() => {
                                setRetentionPolicy(option.value);
                                setConfirmRetention(false);
                              }}
                              type="radio"
                              value={option.value}
                            />
                            <span><strong>{option.label}</strong><small>{option.description}</small></span>
                          </label>
                        ))}
                      </fieldset>
                      {!confirmRetention ? (
                        <button className="ingestion-action" disabled={busy} onClick={() => setConfirmRetention(true)} type="button">
                          {retentionPolicy === "delete_now" ? "清理临时视频" : "保存保留策略"}
                        </button>
                      ) : (
                        <div className="ingestion-confirm ingestion-retention__confirm">
                          <IconAlertTriangle aria-hidden="true" />
                          <div>
                            <strong>{retentionPolicy === "delete_now" ? "确认删除任务 Run 中的源视频？" : "确认保存这项保留策略？"}</strong>
                            <span>{retentionPolicy === "delete_now" ? "视频删除后无法从本地恢复，图文图片和 Markdown 不受影响。" : "以后仍可在这里修改；30 天到期不会自动删除。"}</span>
                          </div>
                          <button disabled={busy} onClick={saveMediaRetention} type="button">确认</button>
                          <button disabled={busy} onClick={() => setConfirmRetention(false)} type="button">取消</button>
                        </div>
                      )}
                    </>
                  ) : null}
                </section>
              ) : null}

              {["queued", "running", "failed", "cancelled"].includes(detail.status) ? (
                <div className="ingestion-runtime-actions">
                  {["queued", "running"].includes(detail.status) ? (
                    <button disabled={busy} onClick={() => runAction(() => cancelIngestionJob(detail.id))} type="button"><IconX />取消任务</button>
                  ) : null}
                  {["failed", "cancelled"].includes(detail.status) ? (
                    <button
                      disabled={busy}
                      onClick={() => runAction(() => retryIngestionJob(
                        detail.id,
                        ["local-video", "douyin"].includes(detail.source_type) && detail.params?.vad === "true" && !vadAvailable ? false : undefined,
                      ))}
                      type="button"
                    >
                      <IconRefresh />
                      {["local-video", "douyin"].includes(detail.source_type) && detail.params?.vad === "true" && !vadAvailable
                        ? "关闭静音过滤后重试"
                        : "重新排队"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {detail.error ? <div className="ingestion-job-error">{detail.error}</div> : null}

              <section className="ingestion-transcript">
                <div className="ingestion-section-title">
                  <span>{isDocumentDetail ? "SOURCE CONTENT" : "TRANSCRIPT"}</span>
                  <h3>{isDocumentDetail ? (detail.source_type === "web-page" ? "网页正文" : "抖音图文正文") : "转写正文"}</h3>
                </div>
                {readableTranscript ? <pre>{readableTranscript}</pre> : (
                  <div className="ingestion-transcript__empty">
                    {isDocumentDetail ? <IconWorld aria-hidden="true" /> : <IconPlayerPlay aria-hidden="true" />}
                    <span>{detail.status === "running"
                      ? isDocumentDetail ? "正文采集中，完成后在这里审核。" : "转写进行中，完成后在这里审核全文。"
                      : isDocumentDetail ? "当前还没有可阅读的正文。" : "当前还没有可阅读的转写文本。"}</span>
                  </div>
                )}
              </section>

              {imageArtifacts.length ? (
                <section className="ingestion-images">
                  <div className="ingestion-section-title">
                    <span>SOURCE IMAGES</span>
                    <h3>图文图片 · {imageArtifacts.length} 张</h3>
                  </div>
                  <div className="ingestion-images__grid">
                    {imageArtifacts.map((artifact, index) => (
                      <figure key={artifact.id}>
                        <img
                          alt={`抖音图文图片 ${index + 1}`}
                          loading="lazy"
                          src={ingestionArtifactUrl(artifact)}
                        />
                        <figcaption>图 {index + 1}</figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="ingestion-detail__empty">
              <IconFileText aria-hidden="true" />
              <strong>{jobs.length ? "选择一个任务查看处理详情" : "从上方添加第一条来源"}</strong>
              <span>{jobs.length ? "转写、AI 总结、审核、分类和归档记录都会集中显示在这里。" : "任务创建后，这里会显示完整处理进度和审核步骤。"}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
