import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  IconArrowLeft,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import {
  addWorkRule,
  deleteWorkRule,
  enabledWorkRulesContext,
  loadWorkRulesState,
  saveWorkRulesState,
  updateWorkRule,
} from "../lib/work-rules-state";

export function WorkRulesPage() {
  const navigate = useNavigate();
  const [state, setState] = useState(() => loadWorkRulesState());
  const [draft, setDraft] = useState({ title: "", body: "" });
  const context = useMemo(() => enabledWorkRulesContext(state), [state]);

  const persist = (next) => {
    saveWorkRulesState(next);
    setState(next);
  };

  const addRule = () => {
    if (!draft.title.trim() || !draft.body.trim()) return;
    persist(addWorkRule(state, draft));
    setDraft({ title: "", body: "" });
  };

  return (
    <div className="work-rules">
      <header className="work-rules__head">
        <button onClick={() => navigate("/review")} type="button"><IconArrowLeft />返回复盘</button>
        <div>
          <span className="eyebrow">工作 / 规则</span>
          <h1>工作规则</h1>
          <p>这里只有你能看见、编辑和停用的长期原则。AI 与明日计划只能读取当前启用规则，不存在额外隐藏规则。</p>
        </div>
        <div className="work-rules__summary mono">
          <span>{context.enabledRuleCount} 条启用</span>
          <span>{context.visibleRuleCount} 条可见</span>
        </div>
      </header>

      <section className="work-rules__notice">
        <strong>初始规则不是个人记忆。</strong>
        <span>初始规则只来自当前项目已经公开冻结的知识治理边界；你可以删除、改写或全部停用。</span>
      </section>

      <main className="work-rules__list">
        {state.rules.map((rule, index) => (
          <article className={rule.enabled ? "is-enabled" : "is-disabled"} key={rule.id}>
            <header>
              <div>
                <span className="mono">规则 {String(index + 1).padStart(2, "0")} · {rule.origin === "user" ? "用户创建" : "初始规则"}{rule.userOverride ? " · 人工决定" : rule.userEdited ? " · 人工修改" : ""}</span>
                <label>
                  <input
                    checked={rule.enabled}
                    onChange={(event) => persist(updateWorkRule(state, rule.id, { enabled: event.target.checked }))}
                    type="checkbox"
                  />
                  <span>{rule.enabled ? "启用" : "停用"}</span>
                </label>
              </div>
              <button aria-label={`删除规则 ${rule.title}`} onClick={() => persist(deleteWorkRule(state, rule.id))} type="button"><IconTrash /></button>
            </header>
            <input
              aria-label={`规则 ${index + 1} 标题`}
              maxLength={80}
              onChange={(event) => {
                const value = event.target.value;
                if (value.trim()) persist(updateWorkRule(state, rule.id, { title: value }));
              }}
              value={rule.title}
            />
            <textarea
              aria-label={`规则 ${index + 1} 内容`}
              maxLength={500}
              onChange={(event) => {
                const value = event.target.value;
                if (value.trim()) persist(updateWorkRule(state, rule.id, { body: value }));
              }}
              rows={3}
              value={rule.body}
            />
          </article>
        ))}
      </main>

      <section className="work-rules__add">
        <div><span className="eyebrow">新增规则</span><h2>新增一条长期规则</h2></div>
        <input
          maxLength={80}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder="规则标题"
          value={draft.title}
        />
        <textarea
          maxLength={500}
          onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
          placeholder="描述这条规则什么时候应该影响知识工作建议。"
          rows={4}
          value={draft.body}
        />
        <button disabled={!draft.title.trim() || !draft.body.trim() || state.rules.length >= 10} onClick={addRule} type="button"><IconPlus />新增规则</button>
        <small>最多 10 条。规则只影响工作台建议上下文，不会直接修改正式知识库。已人工修改、停用或删除的规则不会被系统静默恢复。</small>
      </section>
    </div>
  );
}
