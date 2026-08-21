import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconEdit,
  IconExternalLink,
  IconHistory,
  IconPlayerSkipForward,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { loadKnowledgeWork } from "../lib/api";
import { buildDailyKnowledgeReview } from "../lib/daily-knowledge-review";
import { buildKnowledgeWorkLoopAcceptanceReport } from "../lib/knowledge-work-loop-acceptance";
import {
  loadTodayKnowledgeQueueState,
  saveTodayKnowledgeQueueState,
  updateDailyReviewEvaluation,
  updateDailyReviewNote,
} from "../lib/today-knowledge-queue-state";
import {
  buildTomorrowSuggestions,
  deleteTomorrowSuggestion,
  loadTomorrowSuggestionsState,
  rejectAllTomorrowSuggestions,
  saveTomorrowSuggestionsState,
  updateTomorrowSuggestion,
} from "../lib/tomorrow-knowledge-suggestions-state";
import { enabledWorkRulesContext, loadWorkRulesState } from "../lib/work-rules-state";
import { loadWorkbenchStateStore } from "../lib/workbench-state-store";

const KIND_LABELS = {
  classify_source: "来源分类",
  review_judgment: "判断复核",
  connect_isolated_knowledge: "知识连接",
  add_evidence: "证据补充",
  review_knowledge: "知识复习",
  review_relation: "关系审核",
};

const WORK_OUTCOME_LABELS = {
  active: "进行中",
  completed: "完成",
  later: "稍后",
  skipped: "跳过",
};

function ReviewList({ items, empty, onOpen, tone = "" }) {
  if (!items.length) return <p className="daily-review__empty">{empty}</p>;
  return (
    <div className="daily-review__list">
      {items.map((item) => (
        <article className={tone ? `is-${tone}` : ""} key={item.workItemId}>
          <div>
            <span className="mono">{KIND_LABELS[item.kind] || "知识工作"}</span>
            <strong>{item.title}</strong>
            <small>
              {item.focusSessions ? `${item.focusSessions} 次 Focus · ` : ""}
              {item.source?.path || "缺少对象快照"}
            </small>
          </div>
          {item.source?.documentId ? (
            <button onClick={() => onOpen(item.source)} title="打开真实对象" type="button">
              <IconExternalLink aria-hidden="true" />
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function DailyKnowledgeReviewPage({ onOpenDocument }) {
  const navigate = useNavigate();
  const [knowledgeWork, setKnowledgeWork] = useState(null);
  const [state, setState] = useState(() => loadTodayKnowledgeQueueState());
  const [tomorrow, setTomorrow] = useState(() => loadTomorrowSuggestionsState());
  const [workRules] = useState(() => loadWorkRulesState());
  const rulesContext = useMemo(() => enabledWorkRulesContext(workRules), [workRules]);

  useEffect(() => {
    let cancelled = false;
    loadKnowledgeWork().then((result) => {
      if (!cancelled) setKnowledgeWork(result);
    });
    return () => { cancelled = true; };
  }, []);

  const review = useMemo(
    () => buildDailyKnowledgeReview(state, knowledgeWork?.data?.items ?? []),
    [knowledgeWork, state],
  );
  const proposedTomorrow = useMemo(
    () => buildTomorrowSuggestions(
      review,
      knowledgeWork?.data?.items ?? [],
      tomorrow,
      { now: new Date(), rulesContext },
    ),
    [knowledgeWork, review, rulesContext, tomorrow],
  );
  const acceptance = useMemo(
    () => buildKnowledgeWorkLoopAcceptanceReport(loadWorkbenchStateStore()),
    [state, tomorrow],
  );

  useEffect(() => {
    if (!knowledgeWork) return;
    if (JSON.stringify(proposedTomorrow) === JSON.stringify(tomorrow)) return;
    saveTomorrowSuggestionsState(proposedTomorrow);
    setTomorrow(proposedTomorrow);
  }, [knowledgeWork, proposedTomorrow, tomorrow]);

  const saveNote = (value) => {
    const next = updateDailyReviewNote(state, value);
    saveTodayKnowledgeQueueState(next);
    setState(next);
  };
  const saveEvaluation = (patch) => {
    const next = updateDailyReviewEvaluation(state, patch);
    saveTodayKnowledgeQueueState(next);
    setState(next);
  };
  const open = (source) => source?.documentId && onOpenDocument?.({
    ...source,
    id: source.documentId,
    relativePath: source.path,
  });
  const updateSuggestion = (suggestionId, patch) => {
    const next = updateTomorrowSuggestion(tomorrow, suggestionId, patch);
    saveTomorrowSuggestionsState(next);
    setTomorrow(next);
  };
  const rejectAll = () => {
    const next = rejectAllTomorrowSuggestions(tomorrow);
    saveTomorrowSuggestionsState(next);
    setTomorrow(next);
  };
  const deleteSuggestion = (suggestionId) => {
    const next = deleteTomorrowSuggestion(tomorrow, suggestionId);
    saveTomorrowSuggestionsState(next);
    setTomorrow(next);
  };

  return (
    <div className="daily-review">
      <header className="daily-review__head">
        <button onClick={() => navigate("/today")} type="button"><IconArrowLeft />返回今日</button>
        <div>
          <span className="eyebrow">工作 / 复盘 · {review.date || "今日"}</span>
          <h1>复盘</h1>
          <p>只整理今天真实记录过的工作事件。系统核验与人工备注分开显示，不把“完成任务”冒充成“知识已经改变”。</p>
        </div>
      </header>

      <section className="daily-review__stats" aria-label="今日知识工作统计">
        <div><strong>{review.stats.touched}</strong><span>处理过</span></div>
        <div><strong>{review.stats.focusSessions}</strong><span>专注次数</span></div>
        <div><strong>{review.stats.completed}</strong><span>标记完成</span></div>
        <div><strong>{review.stats.verifiedChanges}</strong><span>当前已核验解决</span></div>
        <div><strong>{review.stats.remaining}</strong><span>仍待处理</span></div>
      </section>

      <main className="daily-review__grid">
        <section className="daily-review__section">
          <div className="daily-review__section-head">
            <div><IconCheck aria-hidden="true" /><span><strong>已核验变化</strong><small>当前索引确认原知识工作项的触发条件已经消失</small></span></div>
            <span className="mono">当前索引已核验</span>
          </div>
          <ReviewList
            empty="今天还没有可由当前索引核验为“已解决”的知识工作。"
            items={review.verifiedChanges}
            onOpen={open}
            tone="verified"
          />
          {review.unverifiedCompletions.length ? (
            <div className="daily-review__notice">
              <strong>{review.unverifiedCompletions.length} 项虽然被标记“完成”，但原触发条件仍存在。</strong>
              <span>这些只算工作状态完成，不算知识变化。</span>
            </div>
          ) : null}
        </section>

        <section className="daily-review__section">
          <div className="daily-review__section-head">
            <div><IconClock aria-hidden="true" /><span><strong>仍待处理</strong><small>稍后、跳过或尚未处理的真实候选</small></span></div>
            <span className="mono">不会自动顺延</span>
          </div>
          <ReviewList empty="当前没有稍后项目。" items={review.deferred} onOpen={open} />
          <ReviewList empty="" items={review.active} onOpen={open} />
          {review.skipped.length ? (
            <details className="daily-review__details">
              <summary><IconPlayerSkipForward aria-hidden="true" />今天跳过 {review.skipped.length} 项</summary>
              <ReviewList empty="" items={review.skipped} onOpen={open} />
            </details>
          ) : null}
        </section>

        <section className="daily-review__section daily-review__note">
          <div className="daily-review__section-head">
            <div><span><strong>人工备注</strong><small>这是你的文字，不是 AI 生成事实</small></span></div>
            <span className="mono">{state.review?.userOverride ? "人工决定 · 已保留" : "用户原文"}</span>
          </div>
          <textarea
            aria-label="今日知识复盘人工备注"
            maxLength={4000}
            onChange={(event) => saveNote(event.target.value)}
            placeholder="例如：今天为什么跳过某项、哪条判断还需要证据、明天值得继续什么……"
            rows={7}
            value={review.note}
          />
          <small>备注只保存在当前工作台日内状态，不写入正式知识库。</small>
        </section>

        <section className="daily-review__section daily-review__acceptance">
          <div className="daily-review__section-head">
            <div><span><strong>P1.3.7 真实使用验收</strong><small>记录真实工作日体验，不用单测或合成数据替代</small></span></div>
            <span className="mono">连续记录 {Math.min(acceptance.consecutiveRecordedDayStreak, 3)}/3 天</span>
          </div>
          <div className="daily-review__acceptance-grid">
            <div><span>今日进入 Today</span><strong>{state.usage?.todayOpenCount ?? 0} 次</strong></div>
            <div><span>今日完成知识工作</span><strong>{review.stats.completed} 项</strong></div>
            <label>
              <span>今日复盘价值</span>
              <select
                aria-label="今日复盘价值"
                onChange={(event) => saveEvaluation({ reviewValue: event.target.value ? Number(event.target.value) : null })}
                value={state.evaluation?.reviewValue ?? ""}
              >
                <option value="">未记录</option>
                <option value="1">1 · 很低</option>
                <option value="2">2 · 较低</option>
                <option value="3">3 · 一般</option>
                <option value="4">4 · 有价值</option>
                <option value="5">5 · 很有价值</option>
              </select>
            </label>
            <label>
              <span>今日维护成本</span>
              <div className="daily-review__minutes-input">
                <input
                  aria-label="今日维护成本分钟"
                  max="1440"
                  min="0"
                  onChange={(event) => {
                    const raw = event.target.value;
                    const parsed = Number(raw);
                    if (raw === "" || Number.isInteger(parsed)) {
                      saveEvaluation({ maintenanceMinutes: raw === "" ? null : parsed });
                    }
                  }}
                  step="1"
                  type="number"
                  value={state.evaluation?.maintenanceMinutes ?? ""}
                />
                <em>分钟</em>
              </div>
            </label>
          </div>
          <div className="daily-review__acceptance-summary">
            <span>累计完成 <strong>{acceptance.summary.completedKnowledgeWork}</strong> 项</span>
            <span>AI 建议采用率 <strong>{acceptance.summary.aiSuggestionAdoptionRate == null ? "—" : `${Math.round(acceptance.summary.aiSuggestionAdoptionRate * 100)}%`}</strong></span>
            <span>累计维护 <strong>{acceptance.summary.maintenanceMinutes}</strong> 分钟</span>
            <span>平均复盘价值 <strong>{acceptance.summary.averageReviewValue == null ? "—" : acceptance.summary.averageReviewValue.toFixed(1)}</strong></span>
          </div>
          <small className="daily-review__acceptance-note">
            只有至少 3 个连续真实工作日都完成上述记录后，才能进入最终验收；系统只汇总记录，不会自行把“3 天有数据”宣告成验收通过。
          </small>
        </section>

        <section className="daily-review__section daily-review__tomorrow">
          <div className="daily-review__section-head">
            <div><IconSparkles aria-hidden="true" /><span><strong>明日建议</strong><small>只从当前仍存在的真实知识工作项生成</small></span></div>
            <span className="mono">目标 {tomorrow.targetDate || "—"}</span>
          </div>
          {tomorrow.reviewContext ? (
            <p className="daily-review__tomorrow-context">
              <strong>人工复盘上下文：</strong>{tomorrow.reviewContext}
            </p>
          ) : null}
          <div className="daily-review__rules-context">
            <div>
              <strong>工作规则</strong>
              <span>{tomorrow.rulesContext?.enabledRuleCount ?? 0} 条启用 / {tomorrow.rulesContext?.visibleRuleCount ?? 0} 条可见</span>
            </div>
            <button onClick={() => navigate("/rules")} type="button">管理规则</button>
          </div>
          {tomorrow.rulesContext?.rules?.length ? (
            <div className="daily-review__rules-list">
              {tomorrow.rulesContext.rules.map((rule) => <span key={rule.id}>{rule.title}</span>)}
            </div>
          ) : (
            <p className="daily-review__empty">当前没有启用的工作规则；明日计划不会读取任何隐藏长期规则。</p>
          )}
          {tomorrow.items.length ? (
            <div className="daily-review__tomorrow-list">
              {tomorrow.items.filter((item) => item.status !== "deleted").map((item) => (
                <article className={`is-${item.status}`} key={item.id}>
                  <div className="daily-review__tomorrow-head">
                    <span className="mono">{KIND_LABELS[item.workItem.kind] || "知识工作"}</span>
                    <small>{item.reason}</small>
                  </div>
                  <textarea
                    aria-label={`${item.workItem.title} 的明日安排`}
                    maxLength={500}
                    onChange={(event) => updateSuggestion(item.id, { planText: event.target.value })}
                    rows={2}
                    value={item.planText}
                  />
                  <div className="daily-review__tomorrow-meta">
                    <span>{item.workItem.source.path}</span>
                    {item.userOverride ? (
                      <em><IconEdit aria-hidden="true" />用户决定 · 保留</em>
                    ) : item.userEdited ? (
                      <em><IconEdit aria-hidden="true" />人工修改</em>
                    ) : (
                      <em>系统候选</em>
                    )}
                  </div>
                  <div className="daily-review__tomorrow-actions">
                    <button onClick={() => open(item.workItem.source)} type="button"><IconExternalLink aria-hidden="true" />对象</button>
                    <button
                      className={item.status === "confirmed" ? "is-confirmed" : ""}
                      onClick={() => updateSuggestion(item.id, { status: "confirmed" })}
                      type="button"
                    ><IconCheck aria-hidden="true" />{item.status === "confirmed" ? "已确认" : "确认明天继续"}</button>
                    <button onClick={() => updateSuggestion(item.id, { status: "rejected" })} type="button"><IconX aria-hidden="true" />拒绝</button>
                    <button onClick={() => deleteSuggestion(item.id)} type="button">删除</button>
                  </div>
                </article>
              ))}
              <button className="daily-review__reject-all" onClick={rejectAll} type="button">全部拒绝这些建议</button>
            </div>
          ) : (
            <p className="daily-review__empty">没有可追溯到真实未解决知识工作项的明日建议。</p>
          )}
          <small className="daily-review__tomorrow-footnote">只有“已确认”且明天仍真实存在的知识工作项才会进入明日计划 → 今日优先队列。人工修改的文案不会被重新生成覆盖。</small>
        </section>

        <section className="daily-review__section">
          <div className="daily-review__section-head">
            <div><IconHistory aria-hidden="true" /><span><strong>原始工作事件</strong><small>复盘结论可逐项回到这些记录</small></span></div>
            <span className="mono">{review.rawEvents.length} 条事件</span>
          </div>
          {review.rawEvents.length ? (
            <ol className="daily-review__events">
              {review.rawEvents.map((event, index) => (
                <li key={`${event.at}-${event.type}-${index}`}>
                  <time dateTime={event.at}>{String(event.at).slice(11, 19)}</time>
                  <span>{event.type === "focus_started" ? "进入专注" : event.type === "focus_finished" ? "退出专注" : `状态 → ${WORK_OUTCOME_LABELS[event.outcome] || event.outcome || "进行中"}`}</span>
                  <strong>{event.workItem?.title || event.workItemId}</strong>
                </li>
              ))}
            </ol>
          ) : <p className="daily-review__empty">今天还没有工作台事件。</p>}
        </section>
      </main>
    </div>
  );
}
