import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  IconArrowRight,
  IconCalendarClock,
  IconChecklist,
  IconClock,
  IconHome,
  IconInbox,
  IconLibrary,
  IconListCheck,
  IconSearch,
  IconSettings,
  IconStack2,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { searchVault } from "../lib/api";
import { layerLabel } from "../lib/format";

const localWorkbench = import.meta.env.VITE_WORKBENCH_HOSTED !== "true";

const quickActions = [
  {
    label: "打开指挥中心",
    description: "查看今日工作、知识状态、复盘、明日计划与系统健康",
    to: "/",
    icon: IconHome,
    shortcut: "HOME",
  },
  {
    label: "打开今日",
    description: "进入有限、可解释的今日知识工作队列",
    to: "/today",
    icon: IconHome,
    shortcut: "TODAY",
  },
  {
    label: "打开专注",
    description: "从当前真实 Work Item 中选择一项进入 Focus",
    to: "/focus",
    icon: IconClock,
    shortcut: "FOCUS",
  },
  {
    label: "打开复盘",
    description: "核验今天真正发生的知识变化",
    to: "/review",
    icon: IconListCheck,
    shortcut: "REVIEW",
  },
  {
    label: "打开明日计划",
    description: "检查、修改、确认或拒绝明日建议",
    to: "/tomorrow",
    icon: IconCalendarClock,
    shortcut: "NEXT",
  },
  {
    label: "打开工作规则",
    description: "管理当前可见且允许进入建议上下文的规则",
    to: "/rules",
    icon: IconChecklist,
    shortcut: "RULES",
  },
  {
    label: localWorkbench ? "新建入库" : "浏览来源",
    description: localWorkbench ? "采集链接或文本，进入审核流程" : "打开已经归档的来源资料",
    to: localWorkbench ? "/ingestion" : "/materials",
    icon: IconInbox,
    shortcut: "CAPTURE",
  },
  {
    label: "打开资料中心",
    description: "按领域、主题、用途和来源类型浏览",
    to: "/materials",
    icon: IconStack2,
    shortcut: "SOURCES",
  },
  {
    label: "打开知识库",
    description: "进入概念、方法、框架与判断索引",
    to: "/wiki",
    icon: IconLibrary,
    shortcut: "KNOWLEDGE",
  },
  {
    label: "打开知识图谱",
    description: "从双链关系探索知识连接",
    to: "/graph",
    icon: IconTopologyStar3,
    shortcut: "GRAPH",
  },
  {
    label: "打开系统与设置",
    description: "查看系统健康、诊断和安全维护入口",
    to: "/system",
    icon: IconSettings,
    shortcut: "SYSTEM",
  },
];

export function SearchPalette({ open, onClose, onOpenDocument }) {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [contentKind, setContentKind] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const showCommandHome = !query.trim() && !domain && !contentKind;

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setDomain("");
    setContentKind("");
    setResults([]);
    setActiveIndex(0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (showCommandHome) {
      setLoading(false);
      setResults([]);
      setActiveIndex(0);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setActiveIndex(0);

    const timer = window.setTimeout(async () => {
      const response = await searchVault(query, {
        ...(domain ? { domain } : {}),
        ...(contentKind ? { contentKind } : {}),
      });
      if (!cancelled) {
        setResults(response.data?.items ?? []);
        setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, domain, contentKind, showCommandHome]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      const target = event.target;
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        const itemCount = showCommandHome ? quickActions.length : results.length;
        if (itemCount > 0) setActiveIndex((prev) => (prev + 1) % itemCount);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const itemCount = showCommandHome ? quickActions.length : results.length;
        if (itemCount > 0) setActiveIndex((prev) => (prev - 1 + itemCount) % itemCount);
      } else if (
        event.key === "Enter" &&
        !(target instanceof HTMLButtonElement) &&
        !(target instanceof HTMLSelectElement)
      ) {
        if (showCommandHome && quickActions[activeIndex]) {
          event.preventDefault();
          navigate(quickActions[activeIndex].to);
          onClose();
        } else if (results[activeIndex]) {
          event.preventDefault();
          onOpenDocument(results[activeIndex]);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, onOpenDocument, results, activeIndex, navigate, showCommandHome]);

  if (!open) return null;

  const showEmpty = !loading && results.length === 0;

  const runQuickAction = (to) => {
    navigate(to);
    onClose();
  };

  return (
    <>
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.16 }}
        aria-label="关闭搜索"
        className="palette-backdrop"
        onClick={onClose}
        type="button"
      />
      <motion.div
        initial={{ y: prefersReducedMotion ? 0 : -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: prefersReducedMotion ? 0 : -8, opacity: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
      >
        <div className="palette__chrome">
          <div>
            <span className="mono">COMMAND PALETTE / GLOBAL INDEX</span>
            <strong>命令面板</strong>
          </div>
          <span aria-live="polite" className="palette__chrome-status mono" role="status">
            {showCommandHome ? "命令模式" : loading ? "正在索引…" : `${results.length} 个匹配`}
          </span>
        </div>

        <div className="palette__input-row">
          <IconSearch aria-hidden="true" />
          <input
            ref={inputRef}
            className="palette__input"
            type="text"
            name="global-search"
            autoComplete="off"
            spellCheck={false}
            placeholder="搜索知识，或从下方打开工作台入口…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索输入框"
          />
        </div>

        <div className="palette__filters" aria-label="分类筛选">
          <label>
            <span>领域</span>
            <select autoComplete="off" name="search-domain" onChange={(event) => setDomain(event.target.value)} value={domain}>
              <option value="">全部领域</option>
              {[
                "AI与智能体",
                "程序开发",
                "自媒体",
                "AI视频",
                "小说剧本",
                "学习考试",
                "个人成长",
                "其他",
              ].map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>内容类型</span>
            <select autoComplete="off" name="search-content-kind" onChange={(event) => setContentKind(event.target.value)} value={contentKind}>
              <option value="">全部类型</option>
              {["方法", "教程", "案例", "观点", "数据", "清单", "参考资料"].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          {(domain || contentKind) ? (
            <button onClick={() => { setDomain(""); setContentKind(""); }} type="button">清除筛选</button>
          ) : null}
        </div>

        <div className="palette__results">
          {showCommandHome ? (
            <div className="palette__command-home">
              <div className="palette__command-label mono">QUICK ACTIONS</div>
              <div className="palette__command-list">
                {quickActions.map((action, index) => {
                  const Icon = action.icon;
                  return (
                    <button
                      className={index === activeIndex ? "palette__command-item--active" : ""}
                      key={action.to + action.label}
                      onClick={() => runQuickAction(action.to)}
                      onFocus={() => setActiveIndex(index)}
                      onMouseEnter={() => setActiveIndex(index)}
                      type="button"
                    >
                      <span className="palette__command-icon"><Icon aria-hidden="true" /></span>
                      <span className="palette__command-copy">
                        <strong>{action.label}</strong>
                        <small>{action.description}</small>
                      </span>
                      <span className="palette__command-code mono">{action.shortcut}</span>
                      <IconArrowRight aria-hidden="true" className="palette__command-arrow" />
                    </button>
                  );
                })}
              </div>
              <p>直接输入关键词后，会切换到全局知识搜索。</p>
            </div>
          ) : showEmpty ? (
            <div className="palette__empty">
              没有匹配「{query}」的内容。尝试更短的关键词，或清除分类筛选。
            </div>
          ) : null}

          {!showCommandHome ? results.map((item, index) => (
            <button
              key={item.id}
              className={`palette__item${index === activeIndex ? " palette__item--active" : ""}`}
              onClick={() => onOpenDocument(item)}
              type="button"
            >
              <span className="badge">{layerLabel(item.layer)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="palette__item-title">{item.title}</div>
                {(item.domain || item.topics?.length || item.contentKind || item.sourceType) ? (
                  <div className="palette__item-meta">
                    {[item.domain, ...(item.topics || []).slice(0, 2), item.contentKind, item.sourceType]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
                {item.excerpt && (
                  <div className="palette__item-snippet">{item.excerpt}</div>
                )}
              </div>
            </button>
          )) : null}
        </div>

        <div className="palette__footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 打开</span>
          <span><kbd>Esc</kbd> 关闭</span>
          <strong className="mono">LOCAL VAULT SEARCH</strong>
        </div>
      </motion.div>
    </>
  );
}
