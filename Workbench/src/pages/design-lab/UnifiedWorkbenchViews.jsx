import { useState } from "react";
import {
  IconCheck,
  IconClock,
  IconDatabase,
  IconFileText,
  IconInbox,
  IconLink,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { StarfieldBackdrop } from "./StarfieldBackdrop.jsx";

const todayItems = [
  ["审核：AI 对知识判断的正确性", "判断复核 · 知识库", "开始"],
  ["补充证据：人工智能发展", "补充证据 · 知识库", "稍后"],
  ["分类：未分类 Raw 条目", "来源分类 · 原始资料", "开始"],
];

function Metric({ label, value }) {
  return <div className="lab-wb-metric"><strong>{value}</strong><span>{label}</span></div>;
}

function PrototypeView({ eyebrow, title, intro, children }) {
  return <div className="design-lab-view lab-wb-view"><header className="design-lab-page-head"><div><span>{eyebrow}</span><h1>{title}</h1><p>{intro}</p></div><span className="lab-wb-badge">仅合成演示</span></header>{children}</div>;
}

export function CommandCenterView({ onOpen }) {
  return (
    <div className="design-lab-view lab-wb-view lab-wb-cosmos lab-wb-cosmos--command">
      <StarfieldBackdrop variant="command" />
      <header className="lab-wb-hero">
        <div><span>个人 AI 工作台</span><h1>指挥中心</h1><p>把今日、专注、知识、复盘、明日计划和系统状态汇到一个日常工作入口。</p></div>
        <div className="lab-wb-hero__status"><IconShieldCheck /><strong>原型状态</strong><span>健康状态演示 · AI 状态演示</span></div>
      </header>
      <section className="lab-wb-quick" aria-label="快捷操作">
        <button onClick={() => onOpen("ingestion")} type="button"><IconInbox /><span>新建入库</span></button>
        <button onClick={() => onOpen("focus")} type="button"><IconPlayerPlay /><span>开始专注</span></button>
        <button onClick={() => onOpen("review")} type="button"><IconCheck /><span>每日复盘</span></button>
        <button onClick={() => onOpen("system")} type="button"><IconSettings /><span>系统中心</span></button>
      </section>
      <div className="lab-wb-grid">
        <section className="lab-wb-card lab-wb-card--wide">
          <div className="lab-wb-card__head"><div><span>今日</span><h2>今天最值得推进</h2></div><button onClick={() => onOpen("today")} type="button">打开队列</button></div>
          <div className="lab-wb-list">{todayItems.map(([title, meta, action], index) => <div key={title}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{title}</strong><small>{meta}</small></span><em>{action}</em></div>)}</div>
        </section>
        <section className="lab-wb-card"><div className="lab-wb-card__head"><div><span>专注</span><h2>42:18</h2></div><IconClock /></div><p>正在审核「AI 对知识判断的正确性」</p><div className="lab-wb-progress"><i /></div><button onClick={() => onOpen("focus")} type="button">继续专注</button></section>
        <section className="lab-wb-card"><div className="lab-wb-card__head"><div><span>知识</span><h2>知识概览</h2></div></div><div className="lab-wb-metrics"><Metric label="正式知识" value="126"/><Metric label="原始资料" value="58"/><Metric label="待处理" value="7"/></div></section>
        <section className="lab-wb-card"><div className="lab-wb-card__head"><div><span>复盘</span><h2>每日复盘</h2></div><button onClick={() => onOpen("review")} type="button">查看</button></div><div className="lab-wb-metrics"><Metric label="已核验" value="3"/><Metric label="待核验" value="1"/><Metric label="已延期" value="2"/></div></section>
        <section className="lab-wb-card"><div className="lab-wb-card__head"><div><span>明日计划</span><h2>建议</h2></div><IconSparkles /></div><div className="lab-wb-metrics"><Metric label="建议" value="3"/><Metric label="已确认" value="1"/><Metric label="已拒绝" value="1"/></div></section>
        <section className="lab-wb-card"><div className="lab-wb-card__head"><div><span>系统</span><h2>控制中心</h2></div><span className="lab-wb-badge">演示数据</span></div><p>知识库、索引器、知识图谱、AI 服务的原型状态入口。</p><button onClick={() => onOpen("system")} type="button">打开系统中心</button></section>
        <section className="lab-wb-card"><div className="lab-wb-card__head"><div><span>AI 洞察</span><h2>辅助层</h2></div><span className="lab-wb-badge">仅提供建议</span></div><p>有 7 个原始资料条目需要处理；明天建议优先补充证据。所有建议都遵守“用户决定优先”。</p></section>
        <section className="lab-wb-card lab-wb-card--wide"><div className="lab-wb-card__head"><div><span>最近活动</span><h2>今天发生了什么</h2></div></div><div className="lab-wb-activity"><span><b>21:20</b> 完成一轮判断复核</span><span><b>20:42</b> 新增一条显式知识关系</span><span><b>19:35</b> 专注 45 分钟</span></div></section>
      </div>
    </div>
  );
}

export function IngestionPrototypeView() {
  const [mode, setMode] = useState("link");
  const [draft, setDraft] = useState("https://example.com/ai-workbench-notes");
  const [queue, setQueue] = useState([
    { title: "本地优先 AI 工作台架构", meta: "网页 · 待分类", status: "待复核" },
    { title: "构建会持续复利的第二大脑", meta: "视频 · 已提取", status: "待分类" },
    { title: "知识对象化方法笔记", meta: "文档 · 已解析", status: "待提炼" },
  ]);

  const addDemoItem = () => {
    const title = draft.trim();
    if (!title) return;
    setQueue((current) => [
      { title: mode === "link" ? "新链接（合成演示）" : mode === "text" ? "新文本（合成演示）" : "演示文件.pdf", meta: `${mode === "link" ? "网页" : mode === "text" ? "文本" : "文件"} · 仅原型`, status: "待处理" },
      ...current,
    ]);
    setDraft("");
  };

  return (
    <PrototypeView eyebrow="入库" title="入库工作台" intro="采集、处理、分类、复核后再进入资料中心；这里仅演示流程，不调用正式入库接口。">
      <div className="lab-wb-ingestion">
        <section className="lab-wb-card lab-wb-card--wide lab-wb-ingestion__capture">
          <div className="lab-wb-card__head">
            <div><span>新建入库</span><h2>把新资料送进处理队列</h2></div>
            <span className="lab-wb-badge">仅演示，不上传</span>
          </div>
          <div className="lab-wb-ingestion__modes" aria-label="入库类型">
            {[["link", "链接", IconLink], ["text", "文本", IconFileText], ["file", "文件", IconInbox]].map(([key, label, Icon]) => (
              <button className={mode === key ? "is-active" : ""} key={key} onClick={() => { setMode(key); setDraft(key === "link" ? "https://example.com/ai-workbench-notes" : key === "text" ? "粘贴一段需要整理的演示文本。" : "研究笔记-demo.pdf"); }} type="button"><Icon />{label}</button>
            ))}
          </div>
          <div className="lab-wb-ingestion__composer">
            {mode === "text" ? (
              <textarea aria-label="入库文本演示" onChange={(event) => setDraft(event.target.value)} rows={5} value={draft} />
            ) : (
              <input aria-label="入库内容演示" onChange={(event) => setDraft(event.target.value)} readOnly={mode === "file"} type="text" value={draft} />
            )}
            <button onClick={addDemoItem} type="button">加入演示队列</button>
          </div>
          <small>原型不会抓取网页、读取本地文件、写入 Vault，也不会调用正式 `/ingestion` 服务。</small>
        </section>

        <section className="lab-wb-card lab-wb-card--wide">
          <div className="lab-wb-card__head"><div><span>处理队列</span><h2>入库中的资料</h2></div><span className="lab-wb-badge">合成演示</span></div>
          <div className="lab-wb-list lab-wb-ingestion__queue">
            {queue.map((item, index) => <div key={`${item.title}:${index}`}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.title}</strong><small>{item.meta}</small></span><em>{item.status}</em></div>)}
          </div>
        </section>
      </div>
    </PrototypeView>
  );
}

export function FocusPrototypeView() {
  const [running, setRunning] = useState(true);
  const [note, setNote] = useState("需要回到原始来源核对第二条证据。");
  return <PrototypeView eyebrow="专注" title="专注工作空间" intro="围绕一个真实工作项集中处理；完成专注不会自动改变正式知识。"><div className="lab-wb-focus"><section><span>当前工作</span><h2>审核：AI 对知识判断的正确性</h2><p>判断复核 · 今日 #1</p><div className="lab-wb-context-lines"><small>12 条证据</small><small>8 条显式关系</small><small>2 个风险提示</small></div></section><div className="lab-wb-timer"><strong>42:18</strong><small>/ 60 分钟</small><button onClick={() => setRunning((value) => !value)} type="button">{running ? <IconPlayerPause /> : <IconPlayerPlay />}{running ? "暂停" : "继续"}</button></div><section><span>专注笔记</span><textarea aria-label="专注笔记演示" onChange={(event) => setNote(event.target.value)} rows={6} value={note} /><small>仅存在于当前原型组件状态。</small></section></div></PrototypeView>;
}

export function ReviewPrototypeView() {
  const [note, setNote] = useState("今天确认了两条判断，还需要补一条证据。");
  return <PrototypeView eyebrow="复盘" title="每日复盘" intro="区分工作状态和知识事实；用户原文永远单独保留。"><div className="lab-wb-grid"><section className="lab-wb-card"><Metric label="已核验变化" value="3"/><p>当前索引确认触发条件已经消失。</p></section><section className="lab-wb-card"><Metric label="未核验完成" value="1"/><p>用户点了完成，但工作项仍存在。</p></section><section className="lab-wb-card lab-wb-card--wide"><span className="lab-wb-badge">用户决定已保留</span><h3>人工备注</h3><textarea aria-label="复盘备注演示" onChange={(event) => setNote(event.target.value)} rows={4} value={note} /><small>AI 可以提出候选润色，但不能覆盖这段用户原文。</small></section></div></PrototypeView>;
}

export function TomorrowPrototypeView() {
  const [items, setItems] = useState([
    { title: "继续审核 AI 判断的正确性", status: "confirmed" },
    { title: "补充证据：人工智能发展", status: "candidate" },
    { title: "分类：部分 Raw 条目", status: "rejected" },
  ]);
  const update = (index, status) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, status } : item));
  return <PrototypeView eyebrow="明日计划" title="明日建议" intro="确认、拒绝、删除、人工改写都属于用户权威值。"><div className="lab-wb-list lab-wb-list--interactive">{items.map((item,index)=><div key={item.title}><b>{String(index+1).padStart(2,"0")}</b><span><strong>{item.title}</strong><small>来源：真实工作项的合成演示映射</small></span><div className="lab-wb-decision"><em>{item.status === "confirmed" ? "已确认" : item.status === "rejected" ? "已拒绝" : "待确认"}</em><button onClick={() => update(index, "confirmed")} type="button"><IconCheck />确认</button><button onClick={() => update(index, "rejected")} type="button"><IconX />拒绝</button></div></div>)}</div></PrototypeView>;
}

export function RulesPrototypeView() {
  const [rules, setRules] = useState([
    { text: "AI 只能提出候选，不自动写正式知识", enabled: true },
    { text: "重要判断必须保留可回溯证据", enabled: true },
    { text: "工作状态不等于知识事实", enabled: true },
    { text: "用户关闭规则后 AI 不得自动打开", enabled: false },
  ]);
  return <PrototypeView eyebrow="工作规则" title="工作规则 / 逻辑卡片" intro="长期规则全部可见、可编辑、可停用；不存在隐藏替代规则。"><div className="lab-wb-rules">{rules.map((rule,index)=><button className={rule.enabled ? "is-on" : "is-off"} key={rule.text} onClick={() => setRules((current) => current.map((item,itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item))} type="button"><span>{rule.text}</span><b>{rule.enabled ? "启用 · 用户" : "停用 · 用户"}</b></button>)}</div></PrototypeView>;
}

export function SystemPrototypeView() {
  const [tab, setTab] = useState("health");
  const [preview, setPreview] = useState(false);
  return <PrototypeView eyebrow="系统与设置" title="控制中心" intro="吸收 Starry 的控制中心体验，但维持诊断与安全维护的正式边界。"><div className="lab-wb-tabs">{[["health","系统健康"],["diagnostics","诊断"],["maintenance","安全维护"],["providers","接入与服务"]].map(([key,label])=><button className={tab === key ? "is-active" : ""} key={key} onClick={() => setTab(key)} type="button">{label}</button>)}</div>{tab === "health" ? <div className="lab-wb-system-grid"><section className="lab-wb-card lab-wb-card--wide"><div className="lab-wb-card__head"><div><span>状态演示</span><h2>合成健康状态</h2></div><span className="lab-wb-badge">不是真实检测结果</span></div><div className="lab-wb-service-list">{["知识库连接","索引服务","知识图谱引擎","AI 服务","存储"].map((service)=><div key={service}><span><i />{service}</span><b>演示正常</b></div>)}</div></section></div> : null}{tab === "diagnostics" ? <section className="lab-wb-card lab-wb-card--wide"><IconShieldCheck /><h3>一键诊断</h3><p>正式实现只读：汇总故障原因、影响范围与恢复指引，不修改知识库、Git、来源原件或凭据。</p><button type="button">运行合成诊断</button></section> : null}{tab === "maintenance" ? <section className="lab-wb-card lab-wb-card--wide"><IconRefresh /><h3>安全维护</h3><p>默认仅预览。这里只演示确认与预览流程，不执行任何真实维护。</p><button onClick={() => setPreview((value) => !value)} type="button">{preview ? "关闭维护预览" : "预览重建索引"}</button>{preview ? <div className="lab-wb-dry-run"><strong>仅预览 · 合成演示</strong><span>预计只重建索引元数据。</span><span>不写知识库 · 不改 Git · 不删除来源原件。</span></div> : null}</section> : null}{tab === "providers" ? <section className="lab-wb-card lab-wb-card--wide"><IconDatabase /><h3>接入与服务</h3><div className="lab-wb-service-list"><div><span>AI 服务</span><b>已配置演示</b></div><div><span>本地资料入库</span><b>原型</b></div><div><span>搜索 / 索引</span><b>原型</b></div></div><p>凭据不会在这里展示或输出。</p></section> : null}</PrototypeView>;
}
