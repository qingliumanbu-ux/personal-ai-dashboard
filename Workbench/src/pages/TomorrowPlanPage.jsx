import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconCheck, IconEdit, IconExternalLink, IconSparkles, IconX } from "@tabler/icons-react";
import { loadKnowledgeWork } from "../lib/api";
import { buildDailyKnowledgeReview } from "../lib/daily-knowledge-review";
import { loadTodayKnowledgeQueueState } from "../lib/today-knowledge-queue-state";
import {
  buildTomorrowSuggestions,
  deleteTomorrowSuggestion,
  loadTomorrowSuggestionsState,
  rejectAllTomorrowSuggestions,
  saveTomorrowSuggestionsState,
  updateTomorrowSuggestion,
} from "../lib/tomorrow-knowledge-suggestions-state";
import { enabledWorkRulesContext, loadWorkRulesState } from "../lib/work-rules-state";

const KIND_LABELS = {
  classify_source: "来源分类",
  review_judgment: "判断复核",
  connect_isolated_knowledge: "知识连接",
  add_evidence: "证据补充",
  review_knowledge: "知识复习",
  review_relation: "关系审核",
};

export function TomorrowPlanPage({ onOpenDocument }) {
  const navigate = useNavigate();
  const [knowledgeWork, setKnowledgeWork] = useState(null);
  const [todayState] = useState(() => loadTodayKnowledgeQueueState());
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
    () => buildDailyKnowledgeReview(todayState, knowledgeWork?.data?.items ?? []),
    [knowledgeWork, todayState],
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

  useEffect(() => {
    if (!knowledgeWork) return;
    if (JSON.stringify(proposedTomorrow) === JSON.stringify(tomorrow)) return;
    saveTomorrowSuggestionsState(proposedTomorrow);
    setTomorrow(proposedTomorrow);
  }, [knowledgeWork, proposedTomorrow, tomorrow]);

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
  const open = (source) => source?.documentId && onOpenDocument?.({
    ...source,
    id: source.documentId,
    relativePath: source.path,
  });
  const visibleItems = tomorrow.items?.filter((item) => item.status !== "deleted") ?? [];

  return (
    <div className="daily-review tomorrow-plan-page">
      <header className="daily-review__head">
        <button onClick={() => navigate("/review")} type="button">← 返回复盘</button>
        <div>
          <span className="eyebrow">工作 / 明日计划 · {tomorrow.targetDate || "—"}</span>
          <h1>明日计划</h1>
          <p>只从当前仍存在的真实知识工作项生成候选。人工改写、确认、拒绝和删除都会作为用户决定保留。</p>
        </div>
      </header>

      <main className="daily-review__grid tomorrow-plan-page__grid">
        <section className="daily-review__section daily-review__tomorrow">
          <div className="daily-review__section-head">
            <div><IconSparkles aria-hidden="true" /><span><strong>明日建议</strong><small>AI 只建议，用户决定优先</small></span></div>
            <span className="mono">{visibleItems.length} 项</span>
          </div>
          {tomorrow.reviewContext ? (
            <p className="daily-review__tomorrow-context"><strong>人工复盘上下文：</strong>{tomorrow.reviewContext}</p>
          ) : null}
          <div className="daily-review__rules-context">
            <div>
              <strong>工作规则</strong>
              <span>{tomorrow.rulesContext?.enabledRuleCount ?? 0} 条启用 / {tomorrow.rulesContext?.visibleRuleCount ?? 0} 条可见</span>
            </div>
            <button onClick={() => navigate("/rules")} type="button">管理规则</button>
          </div>
          {visibleItems.length ? (
            <div className="daily-review__tomorrow-list">
              {visibleItems.map((item) => (
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
                    ) : <em>系统候选</em>}
                  </div>
                  <div className="daily-review__tomorrow-actions">
                    <button onClick={() => open(item.workItem.source)} type="button"><IconExternalLink aria-hidden="true" />对象</button>
                    <button className={item.status === "confirmed" ? "is-confirmed" : ""} onClick={() => updateSuggestion(item.id, { status: "confirmed" })} type="button">
                      <IconCheck aria-hidden="true" />{item.status === "confirmed" ? "已确认" : "确认明天继续"}
                    </button>
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
          <small className="daily-review__tomorrow-footnote">只有已确认、目标日期到达且知识工作项仍真实存在的条目才会进入今日优先序。人工修改不会被重算静默覆盖。</small>
        </section>
      </main>
    </div>
  );
}
