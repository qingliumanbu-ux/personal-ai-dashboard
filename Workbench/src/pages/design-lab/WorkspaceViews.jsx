import { motion } from "framer-motion";
import { IconChevronRight, IconFileText, IconLibrary, IconPlus } from "@tabler/icons-react";

export function TodayView({ recentItems }) {
  return (
    <div className="design-lab-view design-lab-view--today">
      <header className="design-lab-page-head">
        <div>
          <span>8 月 17 日 · 周一</span>
          <h1>今天</h1>
          <p>先处理需要判断的内容，再回到浏览和探索。</p>
        </div>
        <button className="design-lab-primary" type="button"><IconPlus aria-hidden="true" /> 新建入库</button>
      </header>

      <section className="design-lab-status-strip" aria-label="今日状态">
        <div><strong>3</strong><span>待处理</span></div>
        <div><strong>2</strong><span>待复核</span></div>
        <div><strong>148</strong><span>知识对象</span></div>
        <div><strong>326</strong><span>关系</span></div>
      </section>

      <div className="design-lab-focus-layout">
        <section className="design-lab-focus-lane">
          <div className="design-lab-focus-lane__head">
            <div><span>专注</span><h2>今天先把这三件事推进</h2></div>
            <button type="button">查看全部</button>
          </div>
          <div className="design-lab-focus-stack">
            <button className="is-primary" type="button">
              <span className="design-lab-focus-stack__index">01</span>
              <div><strong>确认 2 条来源的分类与用途</strong><p>AI 已给出建议，确认后会进入知识提炼队列。</p><small>AI 与智能体 · 来源库</small></div>
              <IconChevronRight />
            </button>
            <button type="button">
              <span className="design-lab-focus-stack__index">02</span>
              <div><strong>复核 1 个待验证判断</strong><p>决定它是保留为判断，还是升级成长期知识。</p><small>知识库 · 待验证</small></div>
              <IconChevronRight />
            </button>
            <button type="button">
              <span className="design-lab-focus-stack__index">03</span>
              <div><strong>连接 6 个孤立知识对象</strong><p>补齐关系后，相关来源和知识会在星图中形成新的路径。</p><small>知识星图 · 关系整理</small></div>
              <IconChevronRight />
            </button>
          </div>
        </section>

        <aside className="design-lab-context-stream">
          <div className="design-lab-context-stream__head"><div><span>最近</span><h2>最近上下文</h2></div><button type="button">全部</button></div>
          <div className="design-lab-context-stream__list">
            {recentItems.map((item, index) => (
              <button key={item.id} type="button">
                <span className={`design-lab-context-stream__signal signal-${index + 1}`} />
                <div><strong>{item.title}</strong><small>{item.meta}</small></div>
                <time>{item.time}</time>
              </button>
            ))}
          </div>
        </aside>
      </div>

      <section className="design-lab-section design-lab-section--activity">
        <div className="design-lab-section__head"><h2>知识活动</h2><span>过去 7 天</span></div>
        <div className="design-lab-activity">
          {[42, 58, 36, 74, 52, 88, 66, 46, 78, 56, 92, 72, 54, 82].map((height, index) => (
            <motion.i
              animate={{ scaleY: 1, opacity: 1 }}
              initial={{ scaleY: 0.2, opacity: 0.35 }}
              key={index}
              style={{ "--activity-height": `${height}%` }}
              transition={{ delay: index * 0.018, duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export function SourcesView({ selected, onSelect, sourceItems }) {
  return (
    <div className="design-lab-view">
      <header className="design-lab-page-head">
        <div>
          <span>证据与来源</span>
          <h1>来源库</h1>
          <p>保存原始证据，用属性和筛选组织，而不是用文件夹制造层级。</p>
        </div>
        <button className="design-lab-primary" type="button"><IconPlus aria-hidden="true" /> 添加来源</button>
      </header>

      <div className="design-lab-toolbar">
        <div className="design-lab-filter-tabs">
          <button className="is-active" type="button">全部 <span>28</span></button>
          <button type="button">待复核 <span>3</span></button>
          <button type="button">未分类 <span>2</span></button>
        </div>
        <button className="design-lab-view-button" type="button">最近更新</button>
      </div>

      <section className="design-lab-evidence-stream">
        <div className="design-lab-evidence-stream__head">
          <span>证据流</span>
          <span>按最近更新排序 · {sourceItems.length} 项</span>
        </div>
        {sourceItems.map((item, index) => (
          <button
            className={`${selected?.id === item.id ? "is-selected " : ""}${item.status === "待复核" || item.status === "待补全" ? "is-review" : "is-classified"}`}
            key={item.id}
            onClick={() => onSelect(item)}
            type="button"
          >
            <div className="design-lab-evidence-stream__rail">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <i />
            </div>
            <div className="design-lab-evidence-stream__body">
              <div className="design-lab-evidence-stream__title">
                <span className="design-lab-file-icon"><IconFileText /></span>
                <div><strong>{item.title}</strong><small>{item.source} · {item.domain}</small></div>
              </div>
              <p>{item.summary}</p>
              <div className="design-lab-evidence-stream__meta">
                <span>{item.type}</span>
                <span>{item.useCase}</span>
                <span className={`design-lab-status ${item.status === "待复核" || item.status === "待补全" ? "is-pending" : ""}`}>{item.status}</span>
              </div>
            </div>
            <div className="design-lab-evidence-stream__time">
              <span>{item.updated}</span>
              <IconChevronRight aria-hidden="true" />
            </div>
          </button>
        ))}
      </section>
    </div>
  );
}

export function KnowledgeView({ selected, onSelect, knowledgeItems, constellationEdges }) {
  return (
    <div className="design-lab-view">
      <header className="design-lab-page-head">
        <div>
          <span>长期知识</span>
          <h1>知识库</h1>
          <p>知识对象有明确类型、状态和关系。阅读不是终点，复用和连接才是。</p>
        </div>
        <button className="design-lab-primary" type="button"><IconPlus aria-hidden="true" /> 新建知识</button>
      </header>

      <div className="design-lab-toolbar">
        <div className="design-lab-filter-tabs">
          <button className="is-active" type="button">全部</button>
          <button type="button">概念</button>
          <button type="button">方法</button>
          <button type="button">框架</button>
          <button type="button">判断</button>
        </div>
        <button className="design-lab-view-button" type="button">关系最多</button>
      </div>

      <section className="design-lab-constellation" aria-label="知识关系概览">
        <div className="design-lab-constellation__head">
          <div><strong>关系概览</strong><span>点击节点定位知识对象</span></div>
          <span>{knowledgeItems.reduce((sum, item) => sum + item.relations, 0)} 关系</span>
        </div>
        <div className="design-lab-constellation__scene">
          <svg aria-hidden="true" viewBox="0 0 760 150">
            {constellationEdges.map((edge) => (
              <path className={selected && edge.nodes.includes(selected.id) ? "is-active" : ""} d={edge.d} key={edge.id} />
            ))}
          </svg>
          {knowledgeItems.map((item, index) => (
            <button
              className={`design-lab-constellation__node design-lab-constellation__node--${index + 1}${selected?.id === item.id ? " is-selected" : ""}`}
              key={item.id}
              onClick={() => onSelect(item)}
              type="button"
            >
              <motion.i animate={selected?.id === item.id ? { scale: [1, 1.18, 1] } : { scale: 1 }} transition={{ duration: 0.32 }} />
              <span>{item.title}</span>
              <small>{item.relations}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="design-lab-object-list">
        {knowledgeItems.map((item) => (
          <button className={selected?.id === item.id ? "is-selected" : ""} key={item.id} onClick={() => onSelect(item)} type="button">
            <div className="design-lab-object-list__icon"><IconLibrary /></div>
            <div className="design-lab-object-list__copy">
              <div><strong>{item.title}</strong><span>{item.kind}</span></div>
              <p>{item.summary}</p>
            </div>
            <div className="design-lab-object-list__meta"><span>{item.relations} 关系</span><small>{item.status}</small></div>
            <IconChevronRight className="design-lab-object-list__arrow" />
          </button>
        ))}
      </div>
    </div>
  );
}
