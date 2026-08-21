import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  IconClock,
  IconInbox,
  IconLibrary,
  IconListCheck,
  IconPlayerPlay,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconStack2,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { StarfieldBackdrop } from "../components/StarfieldBackdrop.jsx";
import { loadGraph, loadKnowledgeWork, loadOverview, loadSystemHealth } from "../lib/api";
import {
  buildTodayKnowledgeQueue,
  loadTodayKnowledgeQueueState,
} from "../lib/today-knowledge-queue-state";
import {
  confirmedTomorrowWorkItemIds,
  loadTomorrowSuggestionsState,
} from "../lib/tomorrow-knowledge-suggestions-state";
import { loadWorkRulesState } from "../lib/work-rules-state";

const localWorkbench = import.meta.env.VITE_WORKBENCH_HOSTED !== "true";

const HEALTH_LABELS = {
  healthy: "正常",
  degraded: "需关注",
  unavailable: "不可用",
  unknown: "未确认",
};

function Stat({ label, value }) {
  return (
    <div className="formal-command-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function CommandCenterPage({ onOpenDocument }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [graph, setGraph] = useState(null);
  const [knowledgeWork, setKnowledgeWork] = useState(null);
  const [systemHealth, setSystemHealth] = useState(null);
  const [todayState] = useState(() => loadTodayKnowledgeQueueState());
  const [tomorrow] = useState(() => loadTomorrowSuggestionsState());
  const [rules] = useState(() => loadWorkRulesState());

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadOverview(), loadGraph(), loadKnowledgeWork(), loadSystemHealth()]).then(
      ([nextOverview, nextGraph, nextKnowledgeWork, nextSystemHealth]) => {
        if (cancelled) return;
        setOverview(nextOverview);
        setGraph(nextGraph);
        setKnowledgeWork(nextKnowledgeWork);
        setSystemHealth(nextSystemHealth);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const preferredIds = useMemo(
    () => confirmedTomorrowWorkItemIds(tomorrow, new Date()),
    [tomorrow],
  );
  const todayQueue = useMemo(
    () => buildTodayKnowledgeQueue(knowledgeWork?.data?.items ?? [], todayState, {
      limit: 3,
      preferredIds,
    }),
    [knowledgeWork, preferredIds, todayState],
  );

  const metrics = overview?.data?.metrics ?? {};
  const graphStats = graph?.data?.stats ?? {};
  const recent = overview?.data?.recent ?? [];
  const health = systemHealth?.data;
  const visibleTomorrow = tomorrow.items?.filter((item) => item.status !== "deleted") ?? [];
  const confirmedTomorrow = visibleTomorrow.filter((item) => item.status === "confirmed").length;
  const rejectedTomorrow = visibleTomorrow.filter((item) => item.status === "rejected").length;
  const enabledRules = rules.rules?.filter((rule) => rule.enabled).length ?? 0;
  const todayEvents = todayState.events?.length ?? 0;
  const focusSessions = todayState.focusHistory?.length ?? 0;
  const healthIsLive = systemHealth?.source === "live";
  const knowledgeWorkCount = knowledgeWork?.data?.items?.length ?? 0;
  const todayDate = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  const quickActions = [
    ...(localWorkbench
      ? [{ label: "新建入库", to: "/ingestion", icon: IconInbox }]
      : [{ label: "资料中心", to: "/materials", icon: IconStack2 }]),
    { label: "开始专注", to: "/focus", icon: IconPlayerPlay },
    { label: "每日复盘", to: "/review", icon: IconListCheck },
    { label: "系统中心", to: "/system", icon: IconSettings },
  ];

  return (
    <div className="formal-command-page">
      <section className="formal-command-center formal-command-cosmos" id="command-workbench">
        <StarfieldBackdrop variant="command" />
        <header className="formal-command-hero">
          <div>
            <span className="eyebrow">个人 AI 工作台 · {todayDate}</span>
            <h1>指挥中心</h1>
            <p>把今日、专注、知识、复盘、明日计划和系统状态汇到一个真实数据入口。</p>
          </div>
          <div className={`formal-command-health is-${healthIsLive ? health?.overall || "unknown" : "unknown"}`}>
            <IconShieldCheck aria-hidden="true" />
            <strong>{healthIsLive ? HEALTH_LABELS[health?.overall] || "检查中" : "状态待确认"}</strong>
            <small>{healthIsLive ? "本地系统状态" : "尚未取得真实 System Health"}</small>
          </div>
        </header>

        <section className="formal-command-quick" aria-label="常用入口">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.to} onClick={() => navigate(item.to)} type="button">
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </section>

        <div className="formal-command-grid">
          <section className="formal-command-card formal-command-card--wide">
            <div className="formal-command-card__head">
              <div><span className="eyebrow">今日</span><h2>今天最值得推进</h2></div>
              <button onClick={() => navigate("/today")} type="button">打开今日</button>
            </div>
            {todayQueue.visible.length ? (
              <div className="formal-command-list">
                {todayQueue.visible.map((item, index) => (
                  <button key={item.id} onClick={() => navigate(`/focus/${encodeURIComponent(item.id)}`)} type="button">
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span><strong>{item.title}</strong><small>{item.reason}</small></span>
                    <em>开始</em>
                  </button>
                ))}
              </div>
            ) : (
              <p className="formal-command-empty">{knowledgeWork ? "当前没有显式待处理的知识工作。" : "正在读取真实知识工作队列…"}</p>
            )}
          </section>

          <section className="formal-command-card">
            <div className="formal-command-card__head">
              <div><span className="eyebrow">专注</span><h2>{focusSessions ? `${focusSessions} 次` : "未开始"}</h2></div>
              <IconClock aria-hidden="true" />
            </div>
            <p>{focusSessions ? `今天已经记录 ${focusSessions} 次专注上下文。` : "今天还没有真实专注记录。"}</p>
            <button className="formal-command-text-action" onClick={() => navigate("/focus")} type="button">{focusSessions ? "打开专注" : "开始专注"}</button>
          </section>

          <section className="formal-command-card">
            <div className="formal-command-card__head">
              <div><span className="eyebrow">知识</span><h2>知识概览</h2></div>
              <button onClick={() => navigate("/wiki")} type="button">知识库</button>
            </div>
            <div className="formal-command-stats">
              <Stat label="正式知识" value={metrics.wiki ?? "—"} />
              <Stat label="原始资料" value={metrics.raw ?? "—"} />
              <Stat label="显式关系" value={graphStats.edgeCount ?? "—"} />
            </div>
            <div className="formal-command-links">
              <button onClick={() => navigate("/materials")} type="button"><IconStack2 />资料中心</button>
              <button onClick={() => navigate("/wiki")} type="button"><IconLibrary />知识库</button>
              <button onClick={() => navigate("/graph")} type="button"><IconTopologyStar3 />知识图谱</button>
            </div>
          </section>

          <section className="formal-command-card">
            <div className="formal-command-card__head">
              <div><span className="eyebrow">复盘</span><h2>每日复盘</h2></div>
              <button onClick={() => navigate("/review")} type="button">查看</button>
            </div>
            <div className="formal-command-stats">
              <Stat label="工作事件" value={todayEvents} />
              <Stat label="专注记录" value={focusSessions} />
              <Stat label="待处理" value={todayQueue.totalCandidates ?? 0} />
            </div>
            <p>复盘只认真实工作事件与当前索引核验，不会把“任务完成”自动写成知识事实。</p>
          </section>

          <section className="formal-command-card">
            <div className="formal-command-card__head">
              <div><span className="eyebrow">明日计划</span><h2>建议</h2></div>
              <button onClick={() => navigate("/tomorrow")} type="button">打开</button>
            </div>
            <div className="formal-command-stats">
              <Stat label="建议" value={visibleTomorrow.length} />
              <Stat label="已确认" value={confirmedTomorrow} />
              <Stat label="已拒绝" value={rejectedTomorrow} />
            </div>
            <p>只有用户确认、目标日期到达且真实 Work Item 仍存在的建议才会进入 Today 优先序。</p>
          </section>

          <section className="formal-command-card">
            <div className="formal-command-card__head">
              <div><span className="eyebrow">系统</span><h2>控制中心</h2></div>
            </div>
            <p>{healthIsLive ? `当前系统健康状态：${HEALTH_LABELS[health?.overall] || "未确认"}。` : "系统状态尚未取得真实检测结果。"}</p>
            <button className="formal-command-text-action" onClick={() => navigate("/system")} type="button">打开系统中心</button>
          </section>

          <section className="formal-command-card">
            <div className="formal-command-card__head">
              <div><span className="eyebrow">AI 辅助</span><h2>建议边界</h2></div>
              <span className="formal-command-badge">仅提供建议</span>
            </div>
            <p><IconSparkles aria-hidden="true" className="formal-command-inline-icon" />{knowledgeWork ? `当前索引存在 ${knowledgeWorkCount} 个真实知识工作候选。` : "正在读取真实知识工作数据。"} 当前启用 {enabledRules} 条可见工作规则，用户决定始终优先。</p>
          </section>

          <section className="formal-command-card formal-command-card--wide">
            <div className="formal-command-card__head">
              <div><span className="eyebrow">最近活动</span><h2>今天发生了什么</h2></div>
              <span>{overview?.source === "live" ? "本地索引" : "数据待确认"}</span>
            </div>
            {recent.length ? (
              <div className="formal-command-recent">
                {recent.slice(0, 4).map((item) => (
                  <button key={item.id} onClick={() => onOpenDocument?.(item)} type="button">
                    <span><strong>{item.title}</strong><small>{item.section || item.type}</small></span>
                    <small className="formal-command-recent__time">{item.time || "最近"}</small>
                  </button>
                ))}
              </div>
            ) : <p className="formal-command-empty">暂无来自真实索引的最近活动。</p>}
          </section>
        </div>
      </section>
    </div>
  );
}
