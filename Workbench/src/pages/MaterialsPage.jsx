import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useSearchParams } from "react-router-dom";
import {
  IconBookmark,
  IconCheck,
  IconChevronRight,
  IconFolder,
  IconInfoCircle,
  IconSearch,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import { MaterialDocumentRow } from "../components/materials/MaterialDocumentRow";
import { PageHeader } from "../components/PageHeader";
import {
  addMaterialToReadingQueue,
  loadMaterialFolder,
  loadMaterialReadingQueue,
  loadMaterialsHome,
  removeMaterialFromReadingQueue,
} from "../lib/api";
import {
  decideP2Admission,
  loadP2AdmissionState,
  p2AdmissionAllowsExtractionForSnapshot,
  p2AdmissionSnapshotDrift,
  resetP2AdmissionDecision,
  saveP2AdmissionState,
} from "../lib/p2-admission-state";

const ROOT_PATH = "";

function loadingResult() {
  return { data: null, source: "loading", error: null };
}

function FolderCard({ folder, onOpen }) {
  return (
    <button className="material-folder" onClick={() => onOpen(folder.relativePath)} type="button">
      <span className="material-folder__icon" aria-hidden="true">
        <IconFolder size={20} stroke={1.7} />
      </span>
      <span className="material-folder__body">
        <strong>{folder.displayName || folder.name}</strong>
        <span className="mono">{folder.relativePath}</span>
      </span>
      <span className="material-folder__stats">
        <span>{folder.descendantFileCount} 份素材</span>
        {folder.childFolderCount > 0 ? <span>{folder.childFolderCount} 个子目录</span> : null}
        {folder.queuedCount > 0 ? <em>{folder.queuedCount} 待看</em> : null}
      </span>
      <IconChevronRight aria-hidden="true" className="material-folder__arrow" size={18} />
    </button>
  );
}

function EmptyState({ queue = false }) {
  return (
    <div className="materials-empty">
      <span className="materials-empty__mark" aria-hidden="true">
        {queue ? <IconBookmark size={22} /> : <IconFolder size={22} />}
      </span>
      <strong>{queue ? "待看队列还是空的" : "这个文件夹暂时没有素材"}</strong>
      <span>
        {queue
          ? "在任意素材行点击“待看”，它会留在这里等你回来。"
          : "新增到真实 Vault 文件夹的内容会自动出现在这里。"}
      </span>
    </div>
  );
}

export function MaterialsPage({ onOpenDocument }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [result, setResult] = useState(loadingResult);
  const [query, setQuery] = useState("");
  const [queuedOnly, setQueuedOnly] = useState(false);
  const [classificationFilter, setClassificationFilter] = useState({
    unclassified: false,
    domain: "",
    topic: "",
    contentKind: "",
    useCase: "",
    sourceType: "",
  });
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [mutationError, setMutationError] = useState(null);
  const [p2Admission, setP2Admission] = useState(() => loadP2AdmissionState());
  const [p2Note, setP2Note] = useState("");
  const [p2Confirm, setP2Confirm] = useState(null);
  const [rootPath, setRootPath] = useState(ROOT_PATH);
  const folderPath = searchParams.get("folder") || rootPath;
  const view = searchParams.get("view") === "queue"
    ? "queue"
    : folderPath === rootPath
      ? "home"
      : "folder";

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setResult(loadingResult());
    const response = view === "queue"
      ? await loadMaterialReadingQueue()
      : view === "folder"
        ? await loadMaterialFolder(folderPath)
        : await loadMaterialsHome();
    const nextRootPath = response.data?.root?.relativePath ??
      response.data?.breadcrumbs?.[0]?.relativePath;
    if (nextRootPath) setRootPath(nextRootPath);
    setResult(response);
  }, [folderPath, view]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setResult(loadingResult());
      const response = view === "queue"
        ? await loadMaterialReadingQueue()
        : view === "folder"
          ? await loadMaterialFolder(folderPath)
          : await loadMaterialsHome();
      if (!cancelled) {
        const nextRootPath = response.data?.root?.relativePath ??
          response.data?.breadcrumbs?.[0]?.relativePath;
        if (nextRootPath) setRootPath(nextRootPath);
        setResult(response);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [folderPath, view]);

  const openFolder = (path) => {
    setSearchParams(path === rootPath ? {} : { folder: path });
    setQuery("");
    setQueuedOnly(false);
  };

  const openQueue = () => {
    setSearchParams({ view: "queue" });
    setQuery("");
    setQueuedOnly(false);
  };

  const toggleQueue = async (item) => {
    if (!item?.id || pendingIds.has(item.id)) return;
    setMutationError(null);
    setPendingIds((current) => new Set(current).add(item.id));
    try {
      if (item.isQueued) {
        await removeMaterialFromReadingQueue(item.id);
      } else {
        await addMaterialToReadingQueue(item.id, item.contentHash);
      }
      await reload({ quiet: true });
    } catch (error) {
      setMutationError(error);
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const data = result.data;
  const isLoading = result.source === "loading";
  const hasError = Boolean(result.error && !data);
  const isHome = view === "home";
  const isQueue = view === "queue";
  const folders = data?.folders ?? [];
  const homeQueue = data?.queuePreview ?? [];
  const sourceItems = isQueue ? data?.items ?? [] : data?.items ?? [];
  const classification = data?.classification || {
    classified: 0,
    unclassified: 0,
    coveragePct: 100,
    domains: [],
    topics: [],
    contentKinds: [],
    useCases: [],
    sourceTypes: [],
    audit: [],
  };
  const p2Readiness = data?.p2Admission || {
    totalRaw: 0,
    reviewedSummaryCount: 0,
    classificationCompleteCount: 0,
    reuseSignalCount: 0,
    duplicateGroupCount: 0,
    snapshotFingerprint: "",
    sourceTypes: [],
    readyForDecision: false,
    checks: [],
  };
  const p2Snapshot = useMemo(() => ({
    totalRaw: p2Readiness.totalRaw,
    reviewedSummaryCount: p2Readiness.reviewedSummaryCount,
    classificationCompleteCount: p2Readiness.classificationCompleteCount,
    reuseSignalCount: p2Readiness.reuseSignalCount,
    duplicateGroupCount: p2Readiness.duplicateGroupCount,
    snapshotFingerprint: p2Readiness.snapshotFingerprint,
    sourceTypes: p2Readiness.sourceTypes,
  }), [p2Readiness]);
  const p2Drift = useMemo(
    () => p2AdmissionSnapshotDrift(p2Admission, p2Snapshot),
    [p2Admission, p2Snapshot],
  );
  const p2ExtractionOpen = p2AdmissionAllowsExtractionForSnapshot(p2Admission, p2Snapshot);
  const p2NeedsReconfirmation = p2Drift.drifted && p2Admission.decision === "approved";
  const p2StatusTitle = p2NeedsReconfirmation
    ? "资料有变化，需要重新确认"
    : p2ExtractionOpen
      ? "已允许二次提炼"
      : p2Admission.decision === "deferred"
        ? "当前暂不进行二次提炼"
        : "尚未允许二次提炼";
  const p2StatusDescription = p2NeedsReconfirmation
    ? "你之前已经批准过，但真实 Raw 后来发生了变化。旧批准只保留在记录里，不再继续授权新的提炼任务。"
    : p2ExtractionOpen
      ? "新的 Raw → Wiki 提炼任务可以开始；每一篇资料仍要单独审核，正式写入 Wiki 仍需要第二次确认。"
      : p2Admission.decision === "deferred"
        ? "Raw 会继续保留和积累，不会删除资料，也不会自动生成或修改 Wiki。"
        : "确认当前资料库已经准备好后，再打开二次提炼。这个操作只打开流程，不会直接写 Wiki。";
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return sourceItems.filter((item) => {
      if (queuedOnly && !item.isQueued) return false;
      if (!normalizedQuery) return true;
      const haystack = `${item.title ?? ""} ${item.path ?? item.relativePath ?? ""} ${item.domain ?? ""} ${(item.topics || []).join(" ")} ${item.contentKind ?? ""} ${(item.useCases || []).join(" ")} ${item.sourceType ?? ""}`
        .toLocaleLowerCase("zh-CN");
      return haystack.includes(normalizedQuery);
    });
  }, [query, queuedOnly, sourceItems]);

  const classifiedItems = useMemo(() => {
    if (!isHome) return [];
    return sourceItems.filter((item) => {
      if (classificationFilter.unclassified && item.domain && item.contentKind) return false;
      if (classificationFilter.domain && item.domain !== classificationFilter.domain) return false;
      if (classificationFilter.topic && !(item.topics || []).includes(classificationFilter.topic)) return false;
      if (classificationFilter.contentKind && item.contentKind !== classificationFilter.contentKind) return false;
      if (classificationFilter.useCase && !(item.useCases || []).includes(classificationFilter.useCase)) return false;
      if (classificationFilter.sourceType && item.sourceType !== classificationFilter.sourceType) return false;
      return true;
    });
  }, [classificationFilter, isHome, sourceItems]);

  const activeClassificationLabels = [
    classificationFilter.unclassified ? "未分类" : null,
    classificationFilter.domain,
    classificationFilter.topic,
    classificationFilter.contentKind,
    classificationFilter.useCase,
    classificationFilter.sourceType,
  ].filter(Boolean);
  const classificationTitle = activeClassificationLabels.length
    ? activeClassificationLabels.join(" + ")
    : "全部来源资料";

  const clearClassificationFilters = () => setClassificationFilter({
    unclassified: false,
    domain: "",
    topic: "",
    contentKind: "",
    useCase: "",
    sourceType: "",
  });

  const toggleClassificationFilter = (dimension, value) => {
    setClassificationFilter((current) => ({
      ...current,
      unclassified: false,
      [dimension]: current[dimension] === value ? "" : value,
    }));
  };

  const title = isHome
    ? "来源库"
    : isQueue
      ? "我的待看"
      : data?.folder?.displayName || folderPath.split("/").pop();
  const description = isHome
    ? "所有已归档来源的统一入口。优先按领域、主题和用途浏览，真实文件夹保留为辅助视图。"
    : isQueue
      ? "你亲自留下的阅读队列。打开不会自动移除，读完后再明确处理。"
      : `${data?.folder?.directFileCount ?? 0} 份直属素材 · ${data?.folder?.descendantFileCount ?? 0} 份含子目录`;

  const evidenceTopics = classification.topics.slice(0, 4);
  const coverage = Math.max(0, Math.min(100, Number(classification.coveragePct) || 0));
  const updateObservatoryPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty("--observatory-x", `${x.toFixed(1)}%`);
    event.currentTarget.style.setProperty("--observatory-y", `${y.toFixed(1)}%`);
  };

  const showUnclassified = () => setClassificationFilter({
    unclassified: true,
    domain: "",
    topic: "",
    contentKind: "",
    useCase: "",
    sourceType: "",
  });

  const commitP2Decision = (decision) => {
    const next = decideP2Admission(
      p2Admission,
      { decision, note: p2Note, snapshot: p2Snapshot, confirm: true },
    );
    saveP2AdmissionState(next);
    setP2Admission(next);
    setP2Confirm(null);
  };

  const revokeP2Decision = () => {
    const next = resetP2AdmissionDecision(p2Admission);
    saveP2AdmissionState(next);
    setP2Admission(next);
    setP2Confirm(null);
  };

  return (
    <div className={`page page--materials${isHome ? " page--evidence-observatory" : ""}`}>
      {isHome ? (
        <motion.section
          animate={{ opacity: 1, y: 0 }}
          className="materials-observatory"
          initial={{ opacity: 0, y: 10 }}
          onPointerMove={updateObservatoryPointer}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="materials-observatory__copy">
            <div className="materials-observatory__kicker mono">
              <span aria-hidden="true" />
              知识 / 资料中心
            </div>
            <h1>资料中心</h1>
            <p>保存、分类和回看原始资料；优先按领域、主题和用途组织，真实文件夹继续作为辅助视图。</p>

            <div className="materials-observatory__actions">
              <button onClick={openQueue} type="button">
                <IconBookmark aria-hidden="true" size={16} />
                待看队列
                <span className="mono">{homeQueue.length}</span>
              </button>
              <button className="is-secondary" onClick={showUnclassified} type="button">
                待补全分类
                <span className="mono">{classification.unclassified}</span>
              </button>
            </div>

            <div className="materials-observatory__metrics" aria-label="来源库状态">
              <div><span>已归档</span><strong>{data?.total ?? 0}</strong><small>真实来源</small></div>
              <div><span>已分类</span><strong>{classification.classified}</strong><small>已建立分类</small></div>
              <div className={classification.unclassified > 0 ? "is-attention" : ""}><span>待补全</span><strong>{classification.unclassified}</strong><small>需要治理</small></div>
            </div>
          </div>

          <div className="materials-observatory__radar" aria-label={`分类覆盖率 ${coverage}%`} role="img">
            <div className="evidence-radar__rings" aria-hidden="true" />
            <div className="evidence-radar__core">
              <strong>{coverage}%</strong>
              <span>分类覆盖</span>
            </div>
            {evidenceTopics.map((topic, index) => (
              <span className={`evidence-radar__node evidence-radar__node--${index + 1}`} key={topic.value}>
                <em>{topic.value}</em>
                <b className="mono">{topic.count}</b>
              </span>
            ))}
            <span className="evidence-radar__status"><i aria-hidden="true" />本地证据</span>
          </div>
        </motion.section>
      ) : (
        <PageHeader
          eyebrow="知识 / 资料"
          title={title}
          description={description}
          aside={
            <div className="materials-total mono">
              <span>{isQueue ? data?.total ?? 0 : data?.total ?? data?.folder?.descendantFileCount ?? 0}</span>
              <small>{isQueue ? "待看" : "文件"}</small>
            </div>
          }
        />
      )}

      {!isHome ? (
        <nav aria-label="素材路径" className="materials-breadcrumbs">
          <button onClick={() => openFolder(rootPath)} type="button">素材</button>
          {isQueue ? (
            <>
              <IconChevronRight aria-hidden="true" size={14} />
              <span>我的待看</span>
            </>
          ) : (
            (data?.breadcrumbs ?? []).slice(1).map((crumb, index, crumbs) => (
              <span className="materials-breadcrumbs__part" key={crumb.id}>
                <IconChevronRight aria-hidden="true" size={14} />
                {index === crumbs.length - 1 ? (
                  <span>{crumb.displayName}</span>
                ) : (
                  <button onClick={() => openFolder(crumb.relativePath)} type="button">
                    {crumb.displayName}
                  </button>
                )}
              </span>
            ))
          )}
        </nav>
      ) : null}

      {mutationError ? (
        <div className="materials-notice materials-notice--error" role="alert">
          <span>待看状态未更新：{mutationError.message || "请稍后重试"}</span>
          <button aria-label="关闭错误提示" onClick={() => setMutationError(null)} type="button">
            <IconX aria-hidden="true" size={15} />
          </button>
        </div>
      ) : null}

      {result.error && data ? (
        <div className="materials-notice" role="status">
          本地 Workbench 暂未连接，当前不展示模拟素材数据。
        </div>
      ) : null}

      {isLoading ? (
        <div className="materials-loading" aria-label="素材加载中">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : hasError ? (
        <div className="error-note">加载失败：{result.error?.message || "未知错误"}</div>
      ) : isHome ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="materials-home"
          initial={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.28 }}
        >
          <section className="materials-p2-admission" aria-label="二次提炼准入">
            <div className="materials-p2-admission__head">
              <div>
                <span className="eyebrow">二次提炼总开关</span>
                <h2>是否允许资料进入知识提炼</h2>
                <p>这里只决定能不能开始第二次提炼，不会因为这里点了批准就自动修改 Wiki。</p>
              </div>
              <span className={`materials-p2-admission__status ${p2NeedsReconfirmation ? "is-stale" : p2ExtractionOpen ? "is-approved" : p2Admission.decision === "deferred" ? "is-deferred" : "is-pending"}`}>
                {p2NeedsReconfirmation ? "需要重新确认" : p2ExtractionOpen ? "已允许" : p2Admission.decision === "deferred" ? "暂不进入" : "未开启"}
              </span>
            </div>

            <div className={`materials-p2-admission__summary ${p2NeedsReconfirmation ? "is-stale" : p2ExtractionOpen ? "is-open" : "is-closed"}`}>
              <span className="materials-p2-admission__summary-icon" aria-hidden="true">
                {p2ExtractionOpen && !p2NeedsReconfirmation ? <IconShieldCheck /> : <IconInfoCircle />}
              </span>
              <div>
                <strong>{p2StatusTitle}</strong>
                <p>{p2StatusDescription}</p>
              </div>
              {p2NeedsReconfirmation ? (
                <button
                  className="is-primary"
                  disabled={!p2Readiness.readyForDecision}
                  onClick={() => setP2Confirm("approved")}
                  type="button"
                >
                  重新确认当前资料
                </button>
              ) : !p2ExtractionOpen && p2Admission.decision !== "deferred" ? (
                <button
                  className="is-primary"
                  disabled={!p2Readiness.readyForDecision}
                  onClick={() => setP2Confirm("approved")}
                  type="button"
                >
                  允许二次提炼
                </button>
              ) : null}
            </div>

            <div className="materials-p2-admission__body">
              <details className="materials-p2-admission__details" open={!p2Readiness.readyForDecision}>
                <summary>查看为什么现在能 / 不能开始</summary>
                <div className="materials-p2-admission__metrics">
                  <div><span>来源资料</span><strong>{p2Readiness.totalRaw}</strong><small>当前真实 Raw 数量</small></div>
                  <div><span>已审核总结</span><strong>{p2Readiness.reviewedSummaryCount}</strong><small>完成第一次总结并审核</small></div>
                  <div><span>分类完整</span><strong>{p2Readiness.classificationCompleteCount}</strong><small>领域、类型、用途等已补齐</small></div>
                  <div><span>有复用价值</span><strong>{p2Readiness.reuseSignalCount}</strong><small>适合项目、学习、创作等</small></div>
                  <div><span>重复资料组</span><strong>{p2Readiness.duplicateGroupCount}</strong><small>用于提醒后续去重，不自动删除</small></div>
                </div>
                <div className="materials-p2-admission__checks">
                  {p2Readiness.checks.map((check) => (
                    <div className={check.ready ? "is-ready" : "is-missing"} key={check.id}>
                      {check.ready ? <IconCheck aria-hidden="true" /> : <IconInfoCircle aria-hidden="true" />}
                      <span>{check.label}</span>
                    </div>
                  ))}
                  {p2Readiness.sourceTypes.length ? (
                    <div className="materials-p2-admission__sources">
                      <strong>来源构成</strong>
                      <span>{p2Readiness.sourceTypes.map((item) => `${item.value} × ${item.count}`).join(" · ")}</span>
                    </div>
                  ) : null}
                </div>
              </details>

              <div className="materials-p2-admission__decision">
                {p2Admission.decidedAt ? (
                  <small>最近一次：{p2Admission.decision === "approved" ? "允许二次提炼" : "暂不进入"} · {new Date(p2Admission.decidedAt).toLocaleString("zh-CN")}</small>
                ) : null}
                {p2Confirm ? (
                  <div className="materials-p2-admission__confirm">
                    <IconShieldCheck aria-hidden="true" />
                    <div>
                      <strong>{p2Confirm === "approved" ? "确认允许二次提炼？" : "确认暂不进行二次提炼？"}</strong>
                      <span>{p2Confirm === "approved" ? "只打开第二次提炼流程；每篇资料仍要审核，正式写 Wiki 还需要再次确认。" : "资料继续保留和积累，系统不会自动写 Wiki。"}</span>
                    </div>
                    <button onClick={() => commitP2Decision(p2Confirm)} type="button">确认</button>
                    <button onClick={() => setP2Confirm(null)} type="button">取消</button>
                  </div>
                ) : (
                  <details className="materials-p2-admission__advanced">
                    <summary>更多选项与记录</summary>
                    <label className="materials-p2-admission__note">
                      <span>备注（可选）</span>
                      <textarea
                        aria-label="二次提炼准入备注"
                        onChange={(event) => setP2Note(event.target.value)}
                        placeholder="例如：为什么现在允许，或为什么先继续积累资料"
                        value={p2Note}
                      />
                    </label>
                    <div className="materials-p2-admission__actions">
                      {!p2ExtractionOpen && !p2NeedsReconfirmation ? (
                        <button
                          className="is-primary"
                          disabled={!p2Readiness.readyForDecision}
                          onClick={() => setP2Confirm("approved")}
                          type="button"
                        >允许二次提炼</button>
                      ) : null}
                      <button onClick={() => setP2Confirm("deferred")} type="button">暂不进行二次提炼</button>
                      {p2Admission.decision !== "pending" ? (
                        <button className="is-reset" onClick={revokeP2Decision} type="button">清除当前决定</button>
                      ) : null}
                    </div>
                    <small className="materials-p2-admission__code-note">内部工程代号：P2 准入 / Raw → Wiki。日常使用不需要记这个代号。</small>
                    {p2Admission.history.length ? (
                      <details className="materials-p2-admission__audit">
                        <summary>历史确认记录（{p2Admission.history.length}）</summary>
                        <ol>
                          {[...p2Admission.history].reverse().map((entry, index) => (
                            <li key={`${entry.decidedAt || "unknown"}-${index}`}>
                              <strong>{entry.decision === "approved" ? "允许" : entry.decision === "deferred" ? "暂不进入" : "清除决定"}</strong>
                              <span>{entry.decidedAt ? new Date(entry.decidedAt).toLocaleString("zh-CN") : "时间未知"}</span>
                              {entry.note ? <small>{entry.note}</small> : null}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </details>
                )}
              </div>
            </div>
          </section>

          <section className="materials-section materials-section--classification">
            <div className="materials-section__head">
              <div>
                <span className="eyebrow">分类浏览</span>
                <h2>按分类浏览</h2>
              </div>
              <span className="materials-section__meta">分类覆盖 {classification.coveragePct}% · {classification.unclassified} 份待补全</span>
            </div>

            <div className="materials-facets">
              <div className="materials-facet-group">
                <strong>快速入口</strong>
                <div>
                  <button
                    className={activeClassificationLabels.length === 0 ? "is-active" : ""}
                    onClick={clearClassificationFilters}
                    type="button"
                  >全部 <span>{data?.total ?? 0}</span></button>
                  <button
                    className={classificationFilter.unclassified ? "is-active" : ""}
                    onClick={() => setClassificationFilter((current) => ({
                      ...current,
                      unclassified: !current.unclassified,
                      domain: "",
                      topic: "",
                      contentKind: "",
                      useCase: "",
                      sourceType: "",
                    }))}
                    type="button"
                  >未分类 <span>{classification.unclassified}</span></button>
                </div>
              </div>

              {[
                ["领域", "domain", classification.domains],
                ["主题", "topic", classification.topics.slice(0, 12)],
                ["内容类型", "contentKind", classification.contentKinds],
                ["用途", "useCase", classification.useCases],
                ["来源", "sourceType", classification.sourceTypes],
              ].map(([label, dimension, values]) => values.length > 0 ? (
                <div className="materials-facet-group" key={dimension}>
                  <strong>{label}</strong>
                  <div>
                    {values.map((item) => (
                      <button
                        className={classificationFilter[dimension] === item.value ? "is-active" : ""}
                        key={item.value}
                        onClick={() => toggleClassificationFilter(dimension, item.value)}
                        type="button"
                      >{item.value} <span>{item.count}</span></button>
                    ))}
                  </div>
                </div>
              ) : null)}
            </div>

            <div className="materials-classified-results">
              <div className="materials-classified-results__head">
                <strong>{classificationTitle}</strong>
                <span>{classifiedItems.length} 份</span>
              </div>
              {classifiedItems.length > 0 ? (
                <div className="material-list">
                  {classifiedItems.slice(0, 40).map((item) => (
                    <MaterialDocumentRow
                      item={item}
                      key={item.id}
                      onOpen={onOpenDocument}
                      onToggleQueue={toggleQueue}
                      pending={pendingIds.has(item.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="materials-empty materials-empty--compact">这个分类下还没有资料</div>
              )}
              {classifiedItems.length > 40 ? (
                <div className="materials-classified-results__more">先显示最近 40 份，可继续用全局搜索缩小范围。</div>
              ) : null}
            </div>
          </section>

          <section className="materials-section materials-section--queue">
            <div className="materials-section__head">
              <div>
                <span className="eyebrow">待看队列</span>
                <h2>我的待看</h2>
              </div>
              <button className="materials-section__link" onClick={openQueue} type="button">
                查看全部 <IconChevronRight size={15} />
              </button>
            </div>
            {homeQueue.length > 0 ? (
              <div className="material-list">
                {homeQueue.map((item) => (
                  <MaterialDocumentRow
                    item={item}
                    key={item.id}
                    onOpen={onOpenDocument}
                    onToggleQueue={toggleQueue}
                    pending={pendingIds.has(item.id)}
                    showQueuedAt
                  />
                ))}
              </div>
            ) : <EmptyState queue />}
          </section>

          <section className="materials-section">
            <div className="materials-section__head">
              <div>
                <span className="eyebrow">真实文件夹</span>
                <h2>按文件夹浏览</h2>
              </div>
              <span className="materials-section__meta mono">{rootPath}/ · {folders.length} folders</span>
            </div>
            {folders.length > 0 ? (
              <div className="material-folder-grid">
                {folders.map((folder) => <FolderCard folder={folder} key={folder.id} onOpen={openFolder} />)}
              </div>
            ) : <EmptyState />}
          </section>

          <section className="materials-section">
            <div className="materials-section__head">
              <div>
                <span className="eyebrow">最近变化</span>
                <h2>最近变化</h2>
              </div>
              <span className="materials-section__meta">最近新增不等于待看</span>
            </div>
            {(data?.recent ?? []).length > 0 ? (
              <div className="material-list">
                {data.recent.map((item) => (
                  <MaterialDocumentRow
                    item={item}
                    key={item.id}
                    onOpen={onOpenDocument}
                    onToggleQueue={toggleQueue}
                    pending={pendingIds.has(item.id)}
                  />
                ))}
              </div>
            ) : <EmptyState />}
          </section>
        </motion.div>
      ) : (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="materials-browser"
          initial={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.24 }}
        >
          {!isQueue && folders.length > 0 ? (
            <section className="materials-section">
              <div className="materials-section__head">
                <div>
                  <span className="eyebrow">子文件夹</span>
                  <h2>下一层</h2>
                </div>
              </div>
              <div className="material-folder-grid">
                {folders.map((folder) => <FolderCard folder={folder} key={folder.id} onOpen={openFolder} />)}
              </div>
            </section>
          ) : null}

          <section className="materials-section materials-section--files">
            <div className="materials-section__head materials-section__head--files">
              <div>
                <span className="eyebrow">{isQueue ? "待看队列" : "当前文件"}</span>
                <h2>{isQueue ? "全部待看" : "当前文件夹"}</h2>
              </div>
              <div className="materials-tools">
                <label className="materials-search">
                  <IconSearch aria-hidden="true" size={16} />
                  <span className="sr-only">搜索当前素材</span>
                  <input
                    autoComplete="off"
                    name="materials-search"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索当前列表…"
                    spellCheck={false}
                    type="search"
                    value={query}
                  />
                </label>
                {!isQueue ? (
                  <button
                    aria-pressed={queuedOnly}
                    className={`materials-filter${queuedOnly ? " materials-filter--on" : ""}`}
                    onClick={() => setQueuedOnly((current) => !current)}
                    type="button"
                  >
                    <IconBookmark size={15} /> 只看待看
                  </button>
                ) : null}
              </div>
            </div>

            {visibleItems.length > 0 ? (
              <div className="material-list">
                {visibleItems.map((item) => (
                  <MaterialDocumentRow
                    item={item}
                    key={item.id}
                    onOpen={onOpenDocument}
                    onToggleQueue={toggleQueue}
                    pending={pendingIds.has(item.id)}
                    showQueuedAt={isQueue}
                  />
                ))}
              </div>
            ) : (
              query || queuedOnly
                ? <div className="materials-empty materials-empty--compact">没有符合当前筛选的素材</div>
                : <EmptyState queue={isQueue} />
            )}
          </section>
        </motion.div>
      )}
    </div>
  );
}
