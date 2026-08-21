import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconArrowRight, IconClock } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { loadKnowledgeWork } from "../lib/api";
import {
  buildTodayKnowledgeQueue,
  loadTodayKnowledgeQueueState,
} from "../lib/today-knowledge-queue-state";
import {
  confirmedTomorrowWorkItemIds,
  loadTomorrowSuggestionsForTargetDate,
} from "../lib/tomorrow-knowledge-suggestions-state";

export function FocusLandingPage() {
  const navigate = useNavigate();
  const [knowledgeWork, setKnowledgeWork] = useState(null);
  const [todayState] = useState(() => loadTodayKnowledgeQueueState());
  const [tomorrow] = useState(() => loadTomorrowSuggestionsForTargetDate());

  useEffect(() => {
    let cancelled = false;
    loadKnowledgeWork().then((result) => {
      if (!cancelled) setKnowledgeWork(result);
    });
    return () => { cancelled = true; };
  }, []);

  const preferredIds = useMemo(
    () => confirmedTomorrowWorkItemIds(tomorrow, new Date()),
    [tomorrow],
  );
  const queue = useMemo(
    () => buildTodayKnowledgeQueue(knowledgeWork?.data?.items ?? [], todayState, {
      limit: 5,
      preferredIds,
    }),
    [knowledgeWork, preferredIds, todayState],
  );

  return (
    <div className="page focus-landing">
      <PageHeader
        eyebrow="工作 / 专注"
        title="专注"
        description="从今天仍真实存在的知识工作里选择一项进入专注。专注页只提供上下文和工作状态，不修改正式知识。"
      />
      <section className="focus-landing__list" aria-label="可进入专注的今日知识工作">
        {queue.visible.length ? queue.visible.map((item, index) => (
          <article key={item.id}>
            <div className="focus-landing__index">{String(index + 1).padStart(2, "0")}</div>
            <div>
              <span>{item.kind}</span>
              <strong>{item.title}</strong>
              <small>{item.reason}</small>
            </div>
            <button onClick={() => navigate(`/focus/${encodeURIComponent(item.id)}`)} type="button">
              <IconClock aria-hidden="true" />开始专注<IconArrowRight aria-hidden="true" />
            </button>
          </article>
        )) : (
          <div className="focus-landing__empty">
            <strong>{knowledgeWork ? "今天没有可进入专注的显式知识工作" : "正在读取今日知识工作…"}</strong>
            <button onClick={() => navigate("/today")} type="button">返回今日</button>
          </div>
        )}
      </section>
    </div>
  );
}
