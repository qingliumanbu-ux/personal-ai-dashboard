import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconFileText,
  IconPlayerPlay,
  IconRefresh,
  IconSend,
  IconUpload,
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
  loadTranscriptText,
  publishIngestionJob,
  retryIngestionJob,
  reviewIngestionJob,
} from "../lib/ingestion-api";

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
  return STATUS[job?.status] || { label: job?.status || "未知", tone: "neutral" };
}

function sourceName(path = "") {
  return path.split(/[\\/]/).pop() || "未命名视频";
}

function stepLabel(value = "") {
  const labels = {
    "Waiting in queue": "排队等待",
    "Starting transcription": "正在启动转写",
    "Loading local model": "正在加载本地模型",
    "Ready for review": "转写完成，等待审核",
    "Transcript approved": "内容已通过审核",
    "Changes requested": "已要求修改",
    "Transcript rejected": "内容未通过",
    "Transcription failed": "转写失败",
    "Cancellation requested": "正在取消",
    Cancelled: "已取消",
  };
  if (value.startsWith("Transcribing ")) {
    return `正在转写 ${value.slice("Transcribing ".length)}`;
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
  if (job.status === "waiting_review") return 63;
  if (job.status === "succeeded") return 82;
  if (["changes_requested", "rejected"].includes(job.status)) return 68;
  return Math.max(8, Math.round(Number(job.progress || 0) * 55));
}

function stepState(job, step) {
  const progress = flowProgress(job);
  const thresholds = { submit: 1, transcribe: 10, review: 63, publish: 82 };
  const doneThresholds = { submit: 7, transcribe: 63, review: 82, publish: 100 };
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
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sourcePath, setSourcePath] = useState("");
  const [useVad, setUseVad] = useState(true);
  const [reviewNote, setReviewNote] = useState("");
  const [transcript, setTranscript] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const transcriptArtifactId = detail?.artifacts?.find(
    (item) => item.kind === "transcript",
  )?.id;

  const refresh = useCallback(async () => {
    try {
      await loadIngestionHealth();
      setServiceOnline(true);
      const nextJobs = await loadIngestionJobs();
      setJobs(nextJobs);
      const nextSelected = selectedId || nextJobs[0]?.id || null;
      if (!selectedId && nextSelected) setSelectedId(nextSelected);
      if (nextSelected) setDetail(await loadIngestionJob(nextSelected));
      else setDetail(null);
      setError("");
    } catch (refreshError) {
      setServiceOnline(false);
      setError(refreshError.message || "无法连接采集服务");
    }
  }, [selectedId]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    setReviewNote("");
    setConfirmPublish(false);
    setTranscript("");
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
    const normalizedPath = sourcePath.trim();
    if (!normalizedPath) return;
    runAction(async () => {
      const created = await createIngestionJob({
        source_path: normalizedPath,
        language: "zh",
        model: "small",
        vad: useVad,
      });
      setSelectedId(created.id);
      setSourcePath("");
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

  const progress = flowProgress(detail);
  const state = displayStatus(detail);

  return (
    <div className="page page--ingestion">
      <PageHeader
        eyebrow="INGESTION DESK"
        title="采集与审核"
        description="把本地视频送入转写队列，审核内容后，再明确发布为来源资料。"
        aside={(
          <span className={`ingestion-service ingestion-service--${serviceOnline ? "online" : "offline"}`}>
            <span />
            {serviceOnline === null ? "正在连接" : serviceOnline ? "采集服务在线" : "采集服务未启动"}
          </span>
        )}
      />

      <form className="ingestion-submit" onSubmit={submit}>
        <div className="ingestion-submit__mark"><IconUpload aria-hidden="true" /></div>
        <label>
          <span>视频文件路径</span>
          <input
            disabled={!serviceOnline || busy}
            onChange={(event) => setSourcePath(event.target.value)}
            placeholder="粘贴批准目录内的视频完整路径"
            type="text"
            value={sourcePath}
          />
        </label>
        <label className="ingestion-vad">
          <input
            checked={useVad}
            disabled={!serviceOnline || busy}
            onChange={(event) => setUseVad(event.target.checked)}
            type="checkbox"
          />
          <span>过滤静音</span>
        </label>
        <button disabled={!serviceOnline || busy || !sourcePath.trim()} type="submit">
          <IconSend aria-hidden="true" />
          投递视频
        </button>
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
                    <strong>{sourceName(job.source_path)}</strong>
                    <span>{stepLabel(job.current_step)}</span>
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
                <strong>{jobs.length ? "这个筛选下没有任务" : "还没有投递视频"}</strong>
                <span>在上方粘贴本地视频路径，任务会出现在这里。</span>
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
                  <h2>{sourceName(detail.source_path)}</h2>
                  <span className="ingestion-detail__path" title={detail.source_path}>{detail.source_path}</span>
                </div>
                <time>{formatCompactDate(detail.updated_at)}</time>
              </header>

              <div className="ingestion-flow" style={{ "--flow-progress": `${progress}%` }}>
                <div className="ingestion-flow__track"><span /></div>
                {[
                  ["submit", "投递"],
                  ["transcribe", "转写"],
                  ["review", "审核"],
                  ["publish", "发布"],
                ].map(([key, label]) => (
                  <div className={`ingestion-flow__step is-${stepState(detail, key)}`} key={key}>
                    <span>{stepState(detail, key) === "done" ? <IconCheck /> : null}</span>
                    <strong>{label}</strong>
                  </div>
                ))}
                <div className="ingestion-flow__readout">
                  <span>{stepLabel(detail.current_step)}</span>
                  <strong>{progressReadout(detail)}</strong>
                </div>
              </div>

              {detail.status === "waiting_review" ? (
                <section className="ingestion-review">
                  <div className="ingestion-section-title">
                    <span>REVIEW GATE</span>
                    <h3>请判断这份转写是否可作为来源资料</h3>
                  </div>
                  <textarea
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="通过时可选填；要求修改或不通过时请说明原因"
                    value={reviewNote}
                  />
                  <div className="ingestion-review__actions">
                    <button className="ingestion-action ingestion-action--approve" disabled={busy} onClick={() => review("approved")} type="button">
                      <IconCircleCheck />内容通过
                    </button>
                    <button className="ingestion-action" disabled={busy || !reviewNote.trim()} onClick={() => review("changes_requested")} type="button">
                      要求修改
                    </button>
                    <button className="ingestion-action ingestion-action--reject" disabled={busy || !reviewNote.trim()} onClick={() => review("rejected")} type="button">
                      不通过
                    </button>
                  </div>
                </section>
              ) : null}

              {detail.status === "succeeded" && !detail.publication ? (
                <section className="ingestion-publish">
                  <div className="ingestion-section-title">
                    <span>PUBLISH GATE</span>
                    <h3>审核已通过，尚未写入知识库</h3>
                  </div>
                  <dl>
                    <div><dt>目标位置</dt><dd>{detail.publication_preview?.relative_path || "04-来源资料/视频"}</dd></div>
                    <div><dt>写入内容</dt><dd>仅 Markdown，不复制原视频</dd></div>
                    <div><dt>知识状态</dt><dd>来源资料，不是正式知识</dd></div>
                  </dl>
                  {!confirmPublish ? (
                    <button className="ingestion-action ingestion-action--publish" onClick={() => setConfirmPublish(true)} type="button">
                      <IconUpload />发布到知识库
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
                    <button disabled={busy} onClick={() => runAction(() => retryIngestionJob(detail.id))} type="button"><IconRefresh />重新排队</button>
                  ) : null}
                </div>
              ) : null}

              {detail.error ? <div className="ingestion-job-error">{detail.error}</div> : null}

              <section className="ingestion-transcript">
                <div className="ingestion-section-title">
                  <span>TRANSCRIPT</span>
                  <h3>转写正文</h3>
                </div>
                {transcript ? <pre>{transcript}</pre> : (
                  <div className="ingestion-transcript__empty">
                    <IconPlayerPlay aria-hidden="true" />
                    <span>{detail.status === "running" ? "转写进行中，完成后在这里审核全文。" : "当前还没有可阅读的转写文本。"}</span>
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
