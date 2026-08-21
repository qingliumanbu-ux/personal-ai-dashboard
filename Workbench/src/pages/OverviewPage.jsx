import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import gsap from "gsap";
import {
  IconArrowRight,
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconInbox,
  IconLibrary,
  IconPlayerSkipForward,
  IconStack2,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { KnowledgeCore } from "../components/KnowledgeCore";
import { KnowledgeGraph } from "../components/KnowledgeGraph";
import { loadGraph, loadKnowledgeWork, loadOverview } from "../lib/api";
import { formatCompactDate } from "../lib/format";
import {
  buildTodayKnowledgeQueue,
  loadTodayKnowledgeQueueState,
  moveTodayKnowledgeQueueItem,
  recordTodayKnowledgeQueueVisit,
  saveTodayKnowledgeQueueState,
  updateTodayKnowledgeQueueItem,
} from "../lib/today-knowledge-queue-state";
import {
  confirmedTomorrowWorkItemIds,
  loadTomorrowSuggestionsForTargetDate,
} from "../lib/tomorrow-knowledge-suggestions-state";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const REFRESH_INTERVAL_MS = 60_000;
const localWorkbench = import.meta.env.VITE_WORKBENCH_HOSTED !== "true";

let overviewEntranceHasCompleted = false;

const STAGE_LABELS = {
  filmed: "已拍",
  material_validating: "素材验证",
  framework_ready: "框架就绪",
  ready_to_shoot: "准备完成",
  published: "已发布",
  selected: "已确认",
  idea: "候选",
};

export function OverviewPage({ onOpenDocument }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [graph, setGraph] = useState(null);
  const [knowledgeWork, setKnowledgeWork] = useState(null);
  const [todayQueueState, setTodayQueueState] = useState(() => loadTodayKnowledgeQueueState());
  const rootRef = useRef(null);

  useEffect(() => {
    setTodayQueueState((current) => {
      const next = recordTodayKnowledgeQueueVisit(current);
      saveTodayKnowledgeQueueState(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshOverview = () => {
      loadOverview().then((res) => {
        if (!cancelled) setOverview(res);
      });
      loadKnowledgeWork().then((res) => {
        if (!cancelled) setKnowledgeWork(res);
      });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshOverview();
    };
    refreshOverview();
    loadGraph().then((res) => {
      if (!cancelled) setGraph(res);
    });
    const interval = window.setInterval(refreshOverview, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshOverview);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOverview);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  // 入场编排只保留轻量层级提示，避免工作台出现营销页式的大幅位移。
  useEffect(() => {
    if (!overview || overviewEntranceHasCompleted) return undefined;
    if (prefersReducedMotion()) {
      overviewEntranceHasCompleted = true;
      return undefined;
    }
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power1.out" } });
      tl.from(
        ".studio-dashboard__head, .studio-dashboard__actions, .studio-dashboard__grid",
        { y: 10, opacity: 0, duration: 0.34, stagger: 0.05 },
      )
        .from(
          "[data-panel]",
          { y: 8, opacity: 0, duration: 0.3, stagger: 0.05 },
          "-=0.12",
        );
      tl.eventCallback("onComplete", () => {
        overviewEntranceHasCompleted = true;
      });
    }, rootRef);
    return () => ctx.revert();
  }, [overview]);

  const metrics = overview?.data?.metrics ?? {};
  const demoMode = overview?.data?.demoMode === true;
  const recent = overview?.data?.recent ?? [];
  const activity = overview?.data?.activity ?? [];
  const provenance = overview?.data?.qualityNotices ?? [];
  const graphData = graph?.data;
  const workCandidates = knowledgeWork?.data?.items ?? [];
  const tomorrowPreferredIds = useMemo(
    () => confirmedTomorrowWorkItemIds(loadTomorrowSuggestionsForTargetDate(), new Date()),
    [knowledgeWork],
  );
  const todayQueue = useMemo(
    () => buildTodayKnowledgeQueue(workCandidates, todayQueueState, {
      limit: 5,
      preferredIds: tomorrowPreferredIds,
    }),
    [todayQueueState, tomorrowPreferredIds, workCandidates],
  );
  const graphHasRelations = Boolean(
    graphData &&
    (graphData.stats?.edgeCount ?? 0) > 0 &&
    (graphData.nodes?.length ?? 0) > 1,
  );

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date()),
    [],
  );

  const fromFallback = overview?.source === "fallback";
  const overviewLoading = !overview;
  const liveDataReady = Boolean(overview && !fromFallback);

  const launchpad = [
    {
      label: localWorkbench ? "入库资料" : "浏览来源",
      description: localWorkbench ? "粘贴链接、审核并归档" : "查看已归档的原始来源",
      to: localWorkbench ? "/ingestion" : "/materials",
      icon: IconInbox,
      meta: "入库",
    },
    {
      label: "来源库",
      description: "按领域、主题和用途重新找到资料",
      to: "/materials",
      icon: IconStack2,
      meta: metrics.raw == null ? "来源" : `${metrics.raw} 份`,
    },
    {
      label: "知识库",
      description: "查看已经提炼的概念、方法与判断",
      to: "/wiki",
      icon: IconLibrary,
      meta: metrics.wiki == null ? "知识" : `${metrics.wiki} 条`,
    },
    {
      label: "知识图谱",
      description: "从关系网络发现知识连接",
      to: "/graph",
      icon: IconTopologyStar3,
      meta: graphData?.stats?.edgeCount == null ? "关系" : `${graphData.stats.edgeCount} 连接`,
    },
  ];

  const updateTodayItem = (item, status) => {
    setTodayQueueState((current) => {
      const next = updateTodayKnowledgeQueueItem(current, item.id, status, new Date(), item);
      saveTodayKnowledgeQueueState(next);
      return next;
    });
  };

  const moveTodayItem = (itemId, direction) => {
    setTodayQueueState((current) => {
      const next = moveTodayKnowledgeQueueItem(
        current,
        todayQueue.visible.map((item) => item.id),
        itemId,
        direction,
      );
      saveTodayKnowledgeQueueState(next);
      return next;
    });
  };

  const openWorkItem = (item) => {
    if (!item?.id) return;
    navigate(`/focus/${encodeURIComponent(item.id)}`);
  };

  const updateDeckPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty("--deck-x", `${x.toFixed(1)}%`);
    event.currentTarget.style.setProperty("--deck-y", `${y.toFixed(1)}%`);
  };

  const resetDeckPointer = (event) => {
    event.currentTarget.style.setProperty("--deck-x", "68%");
    event.currentTarget.style.setProperty("--deck-y", "36%");
  };

  return (
    <div className="overview-page" ref={rootRef}>
      <section
        className="studio-dashboard"
        data-hero
        onPointerLeave={resetDeckPointer}
        onPointerMove={updateDeckPointer}
      >
        <header className="studio-dashboard__head">
          <span className="studio-dashboard__deck-id mono">
            个人 AI / 知识工作台
          </span>
          <div className="studio-dashboard__particles" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
          </div>
          <div>
            <div className="studio-dashboard__kicker mono">
              <span>{today}</span>
              <span aria-hidden="true">/</span>
              <span>{demoMode ? "演示知识库" : "本地知识库"}</span>
            </div>
            <h1>今日</h1>
            <p>从待处理开始，把新输入变成可检索、可复用、彼此连接的长期知识。</p>
          </div>
          <KnowledgeCore
            edges={graphData?.edges ?? []}
            metrics={metrics}
            nodes={graphData?.nodes ?? []}
            onOpenGraph={() => navigate("/graph")}
            ready={liveDataReady}
          />
          <div className={`studio-dashboard__connection${liveDataReady ? " is-ready" : fromFallback ? " is-offline" : ""}`}>
            <span className="status-dot" aria-hidden="true" />
            <span>{liveDataReady ? "本地索引已就绪" : overviewLoading ? "正在连接本地索引" : "当前使用离线数据"}</span>
          </div>
        </header>

        <div className="studio-dashboard__actions" aria-label="常用工作入口">
          {launchpad.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.to + item.label} onClick={() => navigate(item.to)} type="button">
                <span className="studio-dashboard__action-icon"><Icon aria-hidden="true" stroke={1.7} /></span>
                <span className="studio-dashboard__action-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="studio-dashboard__action-meta mono">{item.meta}</span>
                <IconArrowRight aria-hidden="true" className="studio-dashboard__action-arrow" />
              </button>
            );
          })}
        </div>

        <div className="studio-dashboard__grid">
          <section className="studio-dashboard__queue" aria-labelledby="today-queue-title">
            <div className="studio-dashboard__section-head">
              <div>
                <span className="eyebrow">今日队列</span>
                <h2 id="today-queue-title">今天最值得推进</h2>
                {todayQueueState.orderOverride?.userOverride ? (
                  <small className="mono">人工决定 · 排序优先</small>
                ) : null}
              </div>
              <span className="mono">
                {knowledgeWork?.source === "fallback"
                  ? "本地接口不可用"
                  : `${todayQueue.visible.length}/${todayQueue.totalCandidates} 待推进`}
              </span>
            </div>
            <div className="studio-dashboard__queue-list">
              {todayQueue.visible.length === 0 ? (
                <div className="studio-dashboard__queue-empty">
                  <strong>{knowledgeWork ? "今天没有待推进的显式知识工作" : "正在生成今日知识队列"}</strong>
                  <small>
                    {knowledgeWork
                      ? "只有真实来源或知识对象出现明确待处理状态时才会进入这里。"
                      : "队列只读取本地索引，不会修改 Vault。"}
                  </small>
                </div>
              ) : (
                todayQueue.visible.map((item, index) => (
                  <article className="studio-dashboard__work-item" key={item.id}>
                    <button
                      className="studio-dashboard__work-open"
                      onClick={() => openWorkItem(item)}
                      type="button"
                    >
                      <span className="studio-dashboard__queue-value mono">{String(index + 1).padStart(2, "0")}</span>
                      <span className="studio-dashboard__work-copy">
                        <strong>{item.title}</strong>
                        <small>{item.reason}</small>
                      </span>
                      <IconArrowRight aria-hidden="true" />
                    </button>
                    <div className="studio-dashboard__work-actions" aria-label={`${item.title} 的今日操作`}>
                      <button
                        aria-label="提高优先级"
                        disabled={index === 0}
                        onClick={() => moveTodayItem(item.id, "up")}
                        title="提高优先级"
                        type="button"
                      >
                        <IconChevronUp aria-hidden="true" />
                      </button>
                      <button
                        aria-label="降低优先级"
                        disabled={index === todayQueue.visible.length - 1}
                        onClick={() => moveTodayItem(item.id, "down")}
                        title="降低优先级"
                        type="button"
                      >
                        <IconChevronDown aria-hidden="true" />
                      </button>
                      <button onClick={() => updateTodayItem(item, "completed")} type="button">
                        <IconCheck aria-hidden="true" /> 完成
                      </button>
                      <button onClick={() => updateTodayItem(item, "later")} type="button">
                        <IconClock aria-hidden="true" /> 稍后
                      </button>
                      <button onClick={() => updateTodayItem(item, "skipped")} type="button">
                        <IconPlayerSkipForward aria-hidden="true" /> 跳过
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
            <footer className="studio-dashboard__queue-summary mono">
              {Object.values(todayQueueState.overrides ?? {}).some((item) => item?.userOverride) ? (
                <span>人工决定已保留</span>
              ) : null}
              <span>完成 {todayQueue.completed}</span>
              <span>稍后 {todayQueue.later}</span>
              <span>跳过 {todayQueue.skipped}</span>
              {todayQueue.remaining > 0 ? <span>另有 {todayQueue.remaining} 项候选</span> : null}
              <button onClick={() => navigate("/review")} type="button">查看今日复盘</button>
            </footer>
          </section>

          <section className="studio-dashboard__recent" aria-labelledby="recent-title">
            <div className="studio-dashboard__section-head">
              <div>
                <span className="eyebrow">最近</span>
                <h2 id="recent-title">最近使用</h2>
              </div>
              <span className="mono">{recent.length} 条记录</span>
            </div>
            <div className="studio-dashboard__recent-list">
              {recent.length === 0 ? (
                <div className="collection-empty">暂无最近记录</div>
              ) : (
                recent.slice(0, 5).map((item) => (
                  <button key={item.id} onClick={() => onOpenDocument?.(item)} type="button">
                    <span className={`status-dot${item.type === "Wiki" ? " status-dot--accent" : ""}`} aria-hidden="true" />
                    <span className="studio-dashboard__recent-copy">
                      <strong>{item.title}</strong>
                      <small>{item.section || item.type}</small>
                    </span>
                    <time className="mono" dateTime={item.updatedAt}>{formatCompactDate(item.updatedAt, false)}</time>
                  </button>
                ))
              )}
            </div>
          </section>

          <aside className="studio-dashboard__pulse" aria-label="知识库状态">
            <div className="studio-dashboard__pulse-head">
              <span className="eyebrow">知识状态</span>
              <strong className={liveDataReady ? "is-ready" : fromFallback ? "is-offline" : ""}>
                {liveDataReady ? "已就绪" : overviewLoading ? "连接中" : "离线"}
              </strong>
            </div>
            <dl>
              <div><dt>来源</dt><dd>{metrics.raw ?? "—"}</dd></div>
              <div><dt>知识</dt><dd>{metrics.wiki ?? "—"}</dd></div>
              <div><dt>连接</dt><dd>{graphData?.stats?.edgeCount ?? "—"}</dd></div>
              <div><dt>选题</dt><dd>{metrics.topics ?? "—"}</dd></div>
            </dl>
            <button onClick={() => navigate("/graph")} type="button">
              查看知识网络 <IconArrowUpRight aria-hidden="true" />
            </button>
          </aside>
        </div>
      </section>

      <div className="overview-grid">
        <div className="overview-stack">
          <section className={`panel graph-preview${graphHasRelations ? " panel--hover" : " overview-graph-empty"}`} data-panel>
            <div className="graph-preview__overlay">
              <span className="eyebrow">知识图谱</span>
            </div>
            {graphHasRelations ? (
              <>
                <KnowledgeGraph
                  edges={graphData.edges}
                  nodes={graphData.nodes}
                  preview
                />
                <span className="graph-preview__stats">
                  {graphData.stats.nodeCount} 个节点 · {graphData.stats.edgeCount} 条连接
                </span>
              </>
            ) : graphData ? (
              <div className="overview-graph-empty__content">
                <strong>知识网络正在形成</strong>
                <p>当前有 {graphData.stats?.nodeCount ?? 0} 个知识页、{graphData.stats?.edgeCount ?? 0} 条连接。继续沉淀和建立双链后，这里会出现可探索的关系网络。</p>
              </div>
            ) : (
              <div className="collection-empty">图谱数据加载中…</div>
            )}
            <button
              className="graph-preview__cta graph-filter graph-filter--on"
              onClick={() => navigate("/graph")}
              type="button"
            >
              打开知识图谱 <IconArrowUpRight size={14} />
            </button>
          </section>

        </div>

        <div className="overview-stack">
          <section className="panel" data-panel>
            <div className="panel__head">
              <div>
                <span className="eyebrow">内容生产</span>
                <h2 className="panel__title" style={{ marginTop: 8 }}>
                  生产动态
                </h2>
              </div>
              <button
                className="graph-filter"
                onClick={() => navigate("/content")}
                type="button"
              >
                内容中心
              </button>
            </div>
            <div className="pipeline">
              {activity.length === 0 ? (
                <div className="collection-empty">暂无拍摄动态</div>
              ) : (
                activity.map((item) => (
                  <div
                    className="pipeline__row"
                    key={item.id}
                    onClick={() => onOpenDocument?.(item.documentId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpenDocument?.(item.documentId);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="status-dot status-dot--accent status-dot--pulse" />
                    <span className="pipeline__title">{item.title}</span>
                    <span className="pipeline__stage">
                      {STAGE_LABELS[item.status] ?? item.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel" data-panel>
            <div className="panel__head">
              <div>
                <span className="eyebrow">知识状态</span>
                <h2 className="panel__title" style={{ marginTop: 8 }}>
                  知识层健康度
                </h2>
              </div>
            </div>
            <div className="pipeline">
              {[
                ["active", "活跃", overview?.data?.wikiStatus?.active],
                ["needsReview", "待复核", overview?.data?.wikiStatus?.needsReview],
                ["deprecated", "已弃用", overview?.data?.wikiStatus?.deprecated],
              ].map(([key, label, count]) => (
                <div className="pipeline__row" key={key}>
                  <span
                    className={`status-dot${
                      key === "active"
                        ? " status-dot--ok"
                        : key === "needsReview"
                          ? " status-dot--warn"
                          : ""
                    }`}
                  />
                  <span className="pipeline__title">{label}</span>
                  <span className="pipeline__stage mono">{count ?? "—"}</span>
                </div>
              ))}
            </div>
            {provenance.length > 0 ? (
              <div className="provenance">
                {provenance.slice(0, 2).map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
