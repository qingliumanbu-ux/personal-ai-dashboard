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
  IconTags,
  IconUpload,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { formatCompactDate } from "../lib/format";
import {
  cancelIngestionJob,
  createIngestionJob,
  loadIngestionHealth,
  loadIngestionJob,
  loadIngestionJobs,
  loadCandidateSummaryPrompt,
  loadTranscriptText,
  publishIngestionJob,
  retryIngestionJob,
  reviewIngestionJob,
  saveCandidateSummary,
} from "../lib/ingestion-api";
import {
  buildIngestionPayload,
  ingestionCaptureContext,
  ingestionSourceLocation,
  ingestionSourceName,
} from "../lib/ingestion-source";
import {
  candidateSummarySaveLabel,
  ingestionRefreshDelay,
} from "../lib/ingestion-ui";

const FILTERS = [
  ["all", "全部"],
  ["review", "待审核"],
  ["publish", "待发布"],
  ["attention", "需处理"],
];

const STATUS = {
  queued: { label: "排队中", tone: "neutral" },
  running: { label: "转写中", tone: "live" },
  waiting_review: { label: "待审核", tone: "review" },
  succeeded: { label: "已通过 · 待发布", tone: "ready" },
  changes_requested: { label: "待修改", tone: "attention" },
  rejected: { label: "未通过", tone: "muted" },
  failed: { label: "失败", tone: "danger" },
  cancelled: { label: "已取消", tone: "muted" },
};

function displayStatus(job) {
  if (job?.publication) return { label: "已发布", tone: "published" };
  if (job?.source_type === "web-page" && job?.status === "running") {
    return { label: "采集中", tone: "live" };
  }
  return STATUS[job?.status] || { label: job?.status || "未知", tone: "neutral" };
}

function stepLabel(value = "", sourceType = "local-video") {
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
  if (value === "Ready for review" && sourceType === "web-page") {
    return "网页正文已提取，等待审核";
  }
  return labels[value] || value;
}

function progressReadout(job) {
  if (job?.publication) return "完成";
  if (job?.status === "running") return `${Math.round(job.progress * 100)}%`;
  if (job?.status === "waiting_review") return "等待审核";
  if (job?.status === "succeeded") return "等待发布";
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
  const [summaryCopyState, setSummaryCopyState] = useState("idle");
  const [savingSummary, setSavingSummary] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const transcriptArtifactId = detail?.artifacts?.find(
    (item) => ["transcript", "content"].includes(item.kind),
  )?.id;
  const summaryArtifactId = detail?.artifacts?.find(
    (item) => item.kind === "candidate_summary",
  )?.id;
  const summaryRequired = detail?.params?.summary_required === "true";
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
    setSummaryCopyState("idle");
  }, [detail?.id]);

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

  const progress = flowProgress(detail);
  const state = displayStatus(detail);
  const captureContext = ingestionCaptureContext(detail);
  const hasCaptureContext = Boolean(
    captureContext.tags.length || captureContext.reason || captureContext.sharedText,
  );

  return (
    <div className="page page--ingestion">
      <PageHeader
        eyebrow="INGESTION DESK"
        title="采集与审核"
        description="粘贴抖音分享文案、公开网页或本地视频。统一经过本地处理、人工审核和明确发布。"
        aside={(
          <span className={`ingestion-service ingestion-service--${serviceOnline ? "online" : "offline"}`}>
            <span />
            {serviceOnline === null ? "正在连接" : serviceOnline ? "采集服务在线" : "采集服务未启动"}
          </span>
        )}
      />

      <form className="ingestion-submit" onSubmit={submit}>
        <div className="ingestion-submit__mark">
          {isWebSource ? <IconWorld aria-hidden="true" /> : isDouyinSource ? <IconPlayerPlay aria-hidden="true" /> : <IconUpload aria-hidden="true" />}
        </div>
        <label className="ingestion-source-type">
          <span>来源类型</span>
          <select
            disabled={!serviceOnline || busy}
            onChange={(event) => {
              setSourceType(event.target.value);
              setSourceValue("");
            }}
            value={sourceType}
          >
            <option value="douyin">抖音分享</option>
            <option value="web-page">网页链接</option>
            <option value="local-video">本地视频</option>
          </select>
        </label>
        <label className="ingestion-source-value">
          <span>{isDouyinSource ? "抖音链接或分享文案" : isWebSource ? "网页链接或分享文本" : "视频文件路径"}</span>
          {isTextSource ? (
            <textarea
              disabled={!serviceOnline || busy}
              maxLength="4000"
              onChange={(event) => setSourceValue(event.target.value)}
              placeholder={isDouyinSource ? "粘贴抖音分享文案或公开链接" : "粘贴网页链接，或包含链接的平台分享文本"}
              rows="2"
              value={sourceValue}
            />
          ) : (
            <input
              disabled={!serviceOnline || busy}
              onChange={(event) => setSourceValue(event.target.value)}
              placeholder="粘贴批准目录内的视频完整路径"
              type="text"
              value={sourceValue}
            />
          )}
        </label>
        <button disabled={!serviceOnline || busy || !sourceValue.trim()} type="submit">
          <IconSend aria-hidden="true" />
          {isDouyinSource ? "采集抖音" : isWebSource ? "采集网页" : "投递视频"}
        </button>
        <div className="ingestion-submit__context">
          <label>
            <span>标签（可选）</span>
            <input
              disabled={!serviceOnline || busy}
              onChange={(event) => setCaptureTags(event.target.value)}
              placeholder="多个标签用逗号分隔"
              type="text"
              value={captureTags}
            />
          </label>
          <label>
            <span>为什么收藏（可选）</span>
            <input
              disabled={!serviceOnline || busy}
              maxLength="500"
              onChange={(event) => setCaptureReason(event.target.value)}
              placeholder="例如：补充当前知识库方案"
              type="text"
              value={captureReason}
            />
          </label>
          {!isWebSource ? <label className="ingestion-vad">
            <input
              checked={useVad && vadAvailable}
              disabled={!serviceOnline || busy || !vadAvailable}
              onChange={(event) => setUseVad(event.target.checked)}
              title={!vadAvailable ? vadCapability?.reason : undefined}
              type="checkbox"
            />
            <span>{vadAvailable ? "过滤静音" : "静音过滤暂不可用"}</span>
          </label> : <span className="ingestion-web-note">自动提取首个公开链接，不使用登录态</span>}
          {isDouyinSource ? <span className="ingestion-web-note">媒体仅临时保存在 Run 目录，不上传云端</span> : null}
        </div>
      </form>

      {error ? (
        <div className="ingestion-alert" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <span>{error}</span>
          <button aria-label="关闭提示" onClick={() => setError("")} type="button"><IconX /></button>
        </div>
      ) : null}

      <div className="ingestion-workspace">
        <aside className="ingestion-queue">
          <div className="ingestion-queue__head">
            <div>
              <span className="eyebrow">QUEUE</span>
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
                  ["transcribe", detail.source_type === "web-page" ? "抓取" : "转写"],
                  ["summary", "AI 摘要"],
                  ["review", "审核"],
                  ["publish", "发布"],
                ].map(([key, label]) => (
                  <div className={`ingestion-flow__step is-${stepState(detail, key)}`} key={key}>
                    <span>{stepState(detail, key) === "done" ? <IconCheck /> : null}</span>
                    <strong>{label}</strong>
                  </div>
                ))}
                <div className="ingestion-flow__readout">
                  <span>{stepLabel(detail.current_step, detail.source_type)}</span>
                  <strong>{progressReadout(detail)}</strong>
                </div>
              </div>

              {["waiting_review", "succeeded"].includes(detail.status) && !detail.publication ? (
                <section className="ingestion-summary">
                  <div className="ingestion-section-title">
                    <span>AI SUMMARY CANDIDATE</span>
                    <h3>先理解资料，再决定是否发布</h3>
                  </div>
                  <p className="ingestion-summary__intro">
                    Dashboard 不绑定任何 AI。先复制标准提示词给你选择的 AI，再把结果粘贴回来；完整正文始终保留。
                  </p>
                  <div className="ingestion-summary__actions">
                    <button className="ingestion-action" disabled={busy} onClick={prepareSummaryPrompt} type="button">
                      <IconCopy />{summaryPrompt ? "重新生成提示词" : "生成并复制提示词"}
                    </button>
                    {summaryPrompt ? (
                      <button className="ingestion-action" disabled={busy} onClick={copySummaryPrompt} type="button">
                        <IconCopy />再次复制
                      </button>
                    ) : null}
                    {summaryArtifactId ? <span className="ingestion-summary__saved"><IconCheck />候选摘要已保存</span> : null}
                  </div>
                  {summaryCopyState === "copied" ? <p className="ingestion-summary__feedback">提示词已复制。可粘贴到任意 AI，生成后把结果放到下方。</p> : null}
                  {summaryCopyState === "manual" ? <p className="ingestion-summary__feedback">无法自动复制，请从提示词文本框中手动全选复制。</p> : null}
                  {summaryPrompt ? (
                    <details className="ingestion-summary__prompt">
                      <summary>查看标准提示词</summary>
                      <textarea aria-label="AI 候选摘要标准提示词" readOnly value={summaryPrompt} />
                    </details>
                  ) : null}
                  <label className="ingestion-summary__editor">
                    <span>粘贴或修改 AI 候选摘要</span>
                    <textarea
                      aria-label="AI 候选摘要"
                      onChange={(event) => {
                        setSummaryDraft(event.target.value);
                        setSummaryCopyState((current) => current === "saved" ? "idle" : current);
                      }}
                      placeholder={'必须依次包含：\n## AI 候选摘要\n## 核心要点\n## 建议标签\n## 可复用方向\n## 不确定内容'}
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
                    <h3>请判断这份{detail.source_type === "web-page" ? "网页正文" : "转写"}是否可作为来源资料</h3>
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
                  <dl>
                    <div><dt>目标位置</dt><dd>{detail.publication_preview?.relative_path || (detail.source_type === "web-page" ? "04-来源资料/网页" : "04-来源资料/视频")}</dd></div>
                    <div><dt>写入内容</dt><dd>{summaryArtifactId ? "候选摘要＋完整正文 Markdown" : detail.source_type === "web-page" ? "正文 Markdown，不写入原始 HTML" : "仅 Markdown，不复制原视频"}</dd></div>
                    <div><dt>知识状态</dt><dd>来源资料，不是正式知识</dd></div>
                  </dl>
                  {!confirmPublish ? (
                    <button className="ingestion-action ingestion-action--publish" onClick={() => setConfirmPublish(true)} type="button">
                      <IconUpload />发布为来源资料
                    </button>
                  ) : (
                    <div className="ingestion-confirm">
                      <IconAlertTriangle aria-hidden="true" />
                      <div>
                        <strong>确认写入以上路径？</strong>
                        <span>不会覆盖已有文件；重复点击不会创建副本。</span>
                      </div>
                      <button disabled={busy} onClick={() => runAction(() => publishIngestionJob(detail.id))} type="button">确认发布 Markdown</button>
                      <button disabled={busy} onClick={() => setConfirmPublish(false)} type="button">取消</button>
                    </div>
                  )}
                </section>
              ) : null}

              {detail.publication ? (
                <section className="ingestion-published">
                  <IconCircleCheck aria-hidden="true" />
                  <div><strong>已发布为来源资料</strong><span>{detail.publication.relative_path}</span></div>
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
                  <span>{detail.source_type === "web-page" ? "WEB CONTENT" : "TRANSCRIPT"}</span>
                  <h3>{detail.source_type === "web-page" ? "网页正文" : "转写正文"}</h3>
                </div>
                {transcript ? <pre>{transcript}</pre> : (
                  <div className="ingestion-transcript__empty">
                    {detail.source_type === "web-page" ? <IconWorld aria-hidden="true" /> : <IconPlayerPlay aria-hidden="true" />}
                    <span>{detail.status === "running"
                      ? detail.source_type === "web-page" ? "网页采集中，完成后在这里审核正文。" : "转写进行中，完成后在这里审核全文。"
                      : detail.source_type === "web-page" ? "当前还没有可阅读的网页正文。" : "当前还没有可阅读的转写文本。"}</span>
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="ingestion-detail__empty">
              <IconFileText aria-hidden="true" />
              <strong>选择一个任务查看处理详情</strong>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
