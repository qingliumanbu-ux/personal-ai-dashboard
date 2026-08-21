import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  IconChevronRight,
  IconFileText,
  IconLibrary,
  IconLink,
  IconTags,
  IconTopologyStar3,
} from "@tabler/icons-react";

export function Inspector({
  collapsed,
  knowledgeItems,
  knowledgeLinks,
  mode,
  item,
  onOpenGraph,
  onOpenKnowledge,
  onOpenSource,
  onToggleCollapsed,
  originSource,
  sourceItems,
  sourceKnowledgeLinks,
}) {
  const content = useMemo(() => {
    if (mode === "graph") {
      return {
        eyebrow: "知识星图",
        title: "未选择节点",
        rows: [
          ["状态", "自由探索"],
          ["操作", "点击节点查看详情"],
          ["缩放", "以鼠标位置为中心"],
          ["空白区域", "点击取消焦点"],
        ],
        note: "当前没有锁定知识节点。你可以自由缩放和平移；只有明确点击节点后，星图才进入该节点的关系聚焦。",
      };
    }
    if (mode === "sources") {
      const current = item || sourceItems[0];
      return {
        eyebrow: "来源详情",
        title: current.title,
        rows: [
          ["来源", current.source],
          ["领域", current.domain],
          ["内容类型", current.type],
          ["状态", current.status],
        ],
        note: "保留原始证据，同时把分类和后续用途作为可编辑属性，而不是写进正文。",
      };
    }
    if (mode === "knowledge" || mode === "network") {
      const current = item || knowledgeItems[0];
      const isNetworkNode = mode === "network";
      return {
        eyebrow: isNetworkNode ? "网络节点" : "知识对象",
        title: current.title,
        rows: isNetworkNode ? [
          ["主题", current.domain],
          ["类型", current.kind],
          ["直接关系", `${current.relations} 条`],
          ["状态", current.status],
        ] : [
          ["类型", current.kind],
          ["状态", current.status],
          ["关联", `${current.relations} 条关系`],
          ["更新时间", "今天 08:42"],
        ],
        note: current.summary,
      };
    }
    return {
      eyebrow: "当前上下文",
      title: "今天的知识工作",
      rows: [
        ["待处理", "3 项"],
        ["待复核", "2 项"],
        ["最近更新", "4 项"],
        ["知识关系", "326 条"],
      ],
      note: "优先处理需要判断的内容，再进入浏览和探索。AI 建议只作为辅助，不抢占工作区。",
    };
  }, [item, knowledgeItems, mode, sourceItems]);

  if (collapsed) {
    return (
      <motion.aside
        animate={{ opacity: 1, width: 44 }}
        className="design-lab-inspector design-lab-inspector--collapsed"
        initial={{ opacity: 0, width: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <button aria-label="展开检查器" className="design-lab-inspector__toggle" onClick={onToggleCollapsed} type="button">
          <IconChevronRight aria-hidden="true" />
        </button>
        <span className="design-lab-inspector__rail-label">检查</span>
      </motion.aside>
    );
  }

  return (
    <motion.aside
      animate={{ opacity: 1, x: 0 }}
      className="design-lab-inspector"
      initial={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="design-lab-inspector__head">
        <span>{content.eyebrow}</span>
        <div>
          <button aria-label="收起检查器" className="design-lab-inspector__toggle" onClick={onToggleCollapsed} type="button">
            <IconChevronRight aria-hidden="true" />
          </button>
          <button aria-label="更多操作" type="button">•••</button>
        </div>
      </div>
      <h2>{content.title}</h2>
      <p>{content.note}</p>
      <dl>
        {content.rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {mode === "network" ? (
        <div className="design-lab-inspector__section">
          <span>网络上下文</span>
          <button type="button"><IconLink aria-hidden="true" /> 查看直接关系 <IconChevronRight aria-hidden="true" /></button>
          {item?.knowledgeId ? (
            <button onClick={() => onOpenKnowledge?.(knowledgeItems.find((entry) => entry.id === item.knowledgeId))} type="button">
              <IconLibrary aria-hidden="true" /> 打开对应知识对象 <IconChevronRight aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : mode !== "graph" ? (
        <div className="design-lab-inspector__section">
          <span>关联</span>
          <button type="button"><IconLink aria-hidden="true" /> 查看双链 <IconChevronRight aria-hidden="true" /></button>
          <button type="button"><IconTags aria-hidden="true" /> 管理属性 <IconChevronRight aria-hidden="true" /></button>
        </div>
      ) : null}
      {mode === "sources" ? (
        <div className="design-lab-inspector__section design-lab-inspector__section--related">
          <span>提炼出的知识</span>
          {(sourceKnowledgeLinks[item?.id] || []).map((knowledgeId) => {
            const knowledge = knowledgeItems.find((entry) => entry.id === knowledgeId);
            return knowledge ? (
              <button key={knowledge.id} onClick={() => onOpenKnowledge?.(knowledge, item)} type="button">
                <IconLibrary aria-hidden="true" /> {knowledge.title} <IconChevronRight aria-hidden="true" />
              </button>
            ) : null;
          })}
        </div>
      ) : null}
      {mode === "knowledge" ? (
        <div className="design-lab-inspector__section design-lab-inspector__section--related">
          <span>相邻知识</span>
          {(knowledgeLinks[item?.id] || []).map((knowledgeId) => {
            const knowledge = knowledgeItems.find((entry) => entry.id === knowledgeId);
            return knowledge ? (
              <button key={knowledge.id} onClick={() => onOpenKnowledge?.(knowledge)} type="button">
                <IconTopologyStar3 aria-hidden="true" /> {knowledge.title} <IconChevronRight aria-hidden="true" />
              </button>
            ) : null;
          })}
        </div>
      ) : null}
      {mode === "knowledge" && originSource ? (
        <div className="design-lab-inspector__section design-lab-inspector__section--context">
          <span>来源上下文</span>
          <button onClick={() => onOpenSource?.(originSource)} type="button">
            <IconFileText aria-hidden="true" /> {originSource.title} <IconChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {mode === "knowledge" ? (
        <div className="design-lab-inspector__section design-lab-inspector__section--context">
          <span>探索</span>
          <button onClick={() => onOpenGraph?.(item)} type="button">
            <IconTopologyStar3 aria-hidden="true" /> 在知识星图中查看 <IconChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </motion.aside>
  );
}
