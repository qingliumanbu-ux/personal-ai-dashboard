import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { IconChevronRight, IconSearch } from "@tabler/icons-react";

export function LabCommandPalette({ knowledgeItems, open, query, onClose, onQueryChange, onSelect, sourceItems, views }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const commands = useMemo(() => {
    const items = [
      ...views.map((view) => ({ id: `view:${view.key}`, label: view.label, meta: "打开工作区", action: { type: "view", value: view.key } })),
      ...sourceItems.map((item) => ({ id: `source:${item.id}`, label: item.title, meta: `来源 · ${item.domain}`, action: { type: "source", value: item } })),
      ...knowledgeItems.map((item) => ({ id: `knowledge:${item.id}`, label: item.title, meta: `知识 · ${item.kind}`, action: { type: "knowledge", value: item } })),
    ];
    const normalized = query.trim().toLowerCase();
    if (normalized) {
      return items.filter((item) => `${item.label} ${item.meta}`.toLowerCase().includes(normalized)).slice(0, 8);
    }
    return [
      items.find((item) => item.id === "view:today"),
      items.find((item) => item.id === "view:sources"),
      items.find((item) => item.id === "view:knowledge"),
      items.find((item) => item.id === "knowledge:k1"),
      items.find((item) => item.id === "knowledge:k3"),
      items.find((item) => item.id === "source:s1"),
      items.find((item) => item.id === "source:s5"),
    ].filter(Boolean);
  }, [knowledgeItems, query, sourceItems, views]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  if (!open) return null;

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="design-lab-command-backdrop"
      initial={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <motion.div
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="design-lab-command"
        initial={{ opacity: 0, y: -8, scale: 0.985 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="design-lab-command__input">
          <IconSearch aria-hidden="true" />
          <input
            aria-activedescendant={commands[activeIndex] ? `lab-command-${commands[activeIndex].id}` : undefined}
            aria-controls="design-lab-command-results"
            aria-label="搜索知识、来源或命令"
            autoFocus
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => commands.length ? (index + 1) % commands.length : 0);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => commands.length ? (index - 1 + commands.length) % commands.length : 0);
              }
              if (event.key === "Enter" && commands[activeIndex]) {
                event.preventDefault();
                onSelect(commands[activeIndex].action);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="搜索知识、来源或打开工作区…"
            role="combobox"
            value={query}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="design-lab-command__label">{query.trim() ? "搜索结果" : "最近与快捷入口"}</div>
        <div className="design-lab-command__results" id="design-lab-command-results" role="listbox">
          {commands.map((command, index) => (
            <button
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "is-active" : ""}
              id={`lab-command-${command.id}`}
              key={command.id}
              onClick={() => onSelect(command.action)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span>{command.label}</span>
              <small>{command.meta}</small>
              <IconChevronRight aria-hidden="true" />
            </button>
          ))}
          {commands.length === 0 ? <div className="design-lab-command__empty">没有匹配结果</div> : null}
        </div>
        <div className="design-lab-command__footer"><span>本地知识索引</span><span>↑↓ 选择 · 回车打开</span></div>
      </motion.div>
    </motion.div>
  );
}
