import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { IconArrowLeft, IconCheck, IconClock, IconExternalLink, IconPlayerSkipForward } from "@tabler/icons-react";
import { loadKnowledgeWorkFocus } from "../lib/api";
import {
  finishTodayFocusSession,
  loadTodayKnowledgeQueueState,
  saveTodayKnowledgeQueueState,
  startTodayFocusSession,
  updateTodayKnowledgeQueueItem,
} from "../lib/today-knowledge-queue-state";

function ContextList({ items = [], empty, onOpen }) {
  if (!items.length) return <p className="focus-workspace__empty">{empty}</p>;
  return <div className="focus-workspace__list">{items.map((item) => (
    <button key={item.id || item.path} onClick={() => onOpen(item)} type="button">
      <span><strong>{item.title}</strong><small>{item.path}</small></span><IconExternalLink aria-hidden="true" />
    </button>
  ))}</div>;
}

export function FocusWorkspacePage({ onOpenDocument }) {
  const { workItemId = "" } = useParams();
  const navigate = useNavigate();
  const decodedId = workItemId;
  const [response, setResponse] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadKnowledgeWorkFocus(decodedId).then((result) => {
      if (cancelled) return;
      setResponse(result);
      if (result?.source !== "fallback" && result?.data?.workItem) {
        saveTodayKnowledgeQueueState(
          startTodayFocusSession(
            loadTodayKnowledgeQueueState(),
            decodedId,
            new Date(),
            result.data.workItem,
          ),
        );
      }
    });
    return () => { cancelled = true; };
  }, [decodedId]);

  const currentWorkItem = response?.data?.workItem ?? null;
  const leave = (outcome = "active") => {
    let state = finishTodayFocusSession(
      loadTodayKnowledgeQueueState(),
      decodedId,
      outcome,
      new Date(),
      currentWorkItem,
    );
    if (outcome !== "active") {
      state = updateTodayKnowledgeQueueItem(state, decodedId, outcome, new Date(), currentWorkItem);
    }
    saveTodayKnowledgeQueueState(state);
    navigate("/today");
  };
  const open = (item) => item?.id && onOpenDocument?.({ ...item, relativePath: item.path });

  if (!response) return <div className="focus-workspace focus-workspace--state">正在准备专注上下文…</div>;
  const context = response.data;
  if (!context || response.source === "fallback") return (
    <div className="focus-workspace focus-workspace--state"><h1>这项知识工作当前已失效</h1><p>专注页会重新验证当前正式知识索引，不继续展示过期任务。</p><button onClick={() => leave()} type="button"><IconArrowLeft />返回今日</button></div>
  );

  const relations = [...(context.relations?.outgoing ?? []), ...(context.relations?.incoming ?? [])]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
  return <div className="focus-workspace">
    <header className="focus-workspace__head">
      <button onClick={() => leave()} type="button"><IconArrowLeft />返回今日</button>
      <div><span className="eyebrow">工作 / 专注 · 只读上下文</span><h1>{context.workItem.title}</h1><p>{context.workItem.reason}</p></div>
      <div className="focus-workspace__signals">{context.workItem.signals.map((signal) => <span key={signal.code}>{signal.label}</span>)}</div>
    </header>
    <main className="focus-workspace__grid">
      <section><div className="focus-workspace__section-head"><h2>当前对象</h2><button onClick={() => open(context.primary)} type="button">打开原文</button></div><h3>{context.primary.title}</h3><p>{context.primary.excerpt || "暂无摘要"}</p><dl><div><dt>领域</dt><dd>{context.primary.domain || "未确认"}</dd></div><div><dt>类型</dt><dd>{context.primary.contentKind || context.primary.type || "未确认"}</dd></div><div><dt>状态</dt><dd>{context.primary.status || "未设置"}</dd></div></dl></section>
      <section><h2>来源与证据</h2><ContextList empty="当前没有解析成功的来源证据。" items={context.evidence?.resolved} onOpen={open} />{context.relatedKnowledge?.length ? <><h3>引用该来源的知识</h3><ContextList items={context.relatedKnowledge} onOpen={open} /></> : null}</section>
      <section><h2>必要关系</h2><ContextList empty="当前没有已解析的一跳显式关系。" items={relations} onOpen={open} />{context.relations?.candidates?.length ? <div className="focus-workspace__signals">{context.relations.candidates.map((item) => <span key={item}>{item}</span>)}</div> : null}</section>
    </main>
    <footer className="focus-workspace__footer"><span>这里只记录工作状态；退出专注不会修改未确认知识。</span><div><button onClick={() => leave("later")} type="button"><IconClock />稍后</button><button onClick={() => leave("skipped")} type="button"><IconPlayerSkipForward />跳过</button><button className="is-primary" onClick={() => leave("completed")} type="button"><IconCheck />完成并返回今日</button></div></footer>
  </div>;
}
