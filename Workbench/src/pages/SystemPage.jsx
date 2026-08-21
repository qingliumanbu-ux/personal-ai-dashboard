import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IconChecklist, IconChevronRight } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import {
  executeMaintenance,
  loadAiProviderSettings,
  loadSystemHealth,
  previewMaintenance,
  runSystemDiagnostics,
  saveAiProviderSettings,
} from "../lib/api";
import { formatFullDate } from "../lib/format";

const STATUS_LABELS = {
  healthy: "正常",
  degraded: "需关注",
  unavailable: "不可用",
  unknown: "未确认",
};

const PROJECT_CODES = [
  {
    code: "P1.3.7",
    name: "知识工作闭环",
    status: "待最终实机验收",
    purpose: "今日、专注、复盘、明日计划与工作规则的完整使用闭环。",
    confirmation: "需要最终人工验收",
  },
  {
    code: "p137-8",
    name: "知识工作闭环验收",
    status: "等待真实时间门槛",
    purpose: "至少连续 3 个真实工作日记录完整后再做最终验收。",
    confirmation: "需要用户确认真实工作日",
  },
  {
    code: "P2",
    name: "资料提炼与扩展",
    status: "进行中",
    purpose: "把已审核 Raw 资料受控提炼为长期正式知识。",
    confirmation: "阶段内包含多个人工门",
  },
  {
    code: "p2-0",
    name: "允许进入二次提炼",
    status: "按 Raw 快照决定",
    purpose: "确认当前资料快照是否允许生成第二次知识提炼方案。",
    confirmation: "必须用户明确批准",
  },
  {
    code: "p2-1",
    name: "Raw → Wiki 二次提炼",
    status: "代码已实现，继续实机验收",
    purpose: "先只读生成概念候选、去重关系与 Wiki Diff，再按具体方案写入。",
    confirmation: "写入前必须二次确认",
  },
];

function statusClass(status) {
  if (status === "healthy") return "is-healthy";
  if (status === "degraded") return "is-degraded";
  if (status === "unavailable") return "is-unavailable";
  return "is-unknown";
}

export function SystemPage() {
  const navigate = useNavigate();
  const [health, setHealth] = useState({ data: null, source: "loading", error: null });
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [maintenancePlan, setMaintenancePlan] = useState(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [aiSettings, setAiSettings] = useState({ data: null, loading: true, saving: false, message: "" });

  const loadHealth = async () => {
    const response = await loadSystemHealth();
    setHealth(response);
  };

  useEffect(() => {
    let cancelled = false;
    loadSystemHealth().then((response) => {
      if (!cancelled) setHealth(response);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAiProviderSettings()
      .then((data) => {
        if (!cancelled) setAiSettings({ data, loading: false, saving: false, message: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          setAiSettings({ data: null, loading: false, saving: false, message: error.message || "AI 设置读取失败" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAiTask = (task, field, value) => {
    setAiSettings((current) => current.data ? ({
      ...current,
      message: "",
      data: {
        ...current.data,
        [task]: {
          ...current.data[task],
          [field]: value,
        },
      },
    }) : current);
  };

  const handleSaveAiSettings = async () => {
    if (!aiSettings.data || aiSettings.saving) return;
    setAiSettings((current) => ({ ...current, saving: true, message: "" }));
    try {
      const saved = await saveAiProviderSettings({
        schemaVersion: aiSettings.data.schemaVersion,
        summary: aiSettings.data.summary,
        knowledge: aiSettings.data.knowledge,
      });
      setAiSettings({ data: saved, loading: false, saving: false, message: "AI Provider 设置已保存。" });
    } catch (error) {
      setAiSettings((current) => ({
        ...current,
        saving: false,
        message: `保存失败：${error.message || "未知错误"}`,
      }));
    }
  };

  const handleDiagnostics = async () => {
    setDiagnosing(true);
    setActionError(null);
    try {
      setDiagnostics(await runSystemDiagnostics());
      await loadHealth();
    } catch (error) {
      setActionError(error);
    } finally {
      setDiagnosing(false);
    }
  };

  const handleMaintenancePreview = async () => {
    setMaintenanceBusy(true);
    setActionError(null);
    try {
      setMaintenancePlan(await previewMaintenance("rebuild-index"));
    } catch (error) {
      setActionError(error);
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const handleMaintenanceExecute = async () => {
    if (!maintenancePlan?.action) return;
    setMaintenanceBusy(true);
    setActionError(null);
    try {
      await executeMaintenance(maintenancePlan.action);
      setMaintenancePlan(null);
      await loadHealth();
    } catch (error) {
      setActionError(error);
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const data = health.data;
  const isLoading = health.source === "loading";
  const components = data?.components ?? [];
  const vault = data?.vault;
  const sync = data?.sync;
  const graph = data?.graph;
  const classification = data?.classification;
  const ingestion = data?.ingestion;
  const vaultConnected = vault?.connected === true;

  return (
    <div className="page page--system">
      <PageHeader
        eyebrow="系统"
        title="系统与设置"
        description="集中检查正式知识库、采集、索引、知识图谱与本地服务。诊断只读，维护动作单独确认。"
        aside={
          <span className={`system-overall ${statusClass(data?.overall)}`}>
            {isLoading ? "检查中" : STATUS_LABELS[data?.overall] || "未确认"}
          </span>
        }
      />

      {health.error && !data ? (
        <div className="error-note">系统健康信息不可用：{health.error.message || "未知错误"}</div>
      ) : null}

      <section className="system-health-grid" aria-label="系统组件健康状态">
        {isLoading ? (
          <>
            <div className="skeleton system-health-card" />
            <div className="skeleton system-health-card" />
            <div className="skeleton system-health-card" />
          </>
        ) : components.map((component) => (
          <article className={`system-health-card ${statusClass(component.status)}`} key={component.id}>
            <div className="system-health-card__head">
              <span className="status-dot" aria-hidden="true" />
              <strong>{component.label}</strong>
              <span>{STATUS_LABELS[component.status] || component.status}</span>
            </div>
            <p>{component.detail}</p>
          </article>
        ))}
      </section>

      <section className="panel system-settings-links" aria-label="系统设置入口">
        <div className="system-settings-links__head">
          <div>
            <span className="eyebrow">设置</span>
            <h2>系统与规则</h2>
            <p>长期工作原则收进系统设置，不再占用左侧主工作流导航。</p>
          </div>
        </div>
        <button className="system-settings-link" onClick={() => navigate("/rules")} type="button">
          <span className="system-settings-link__icon"><IconChecklist aria-hidden="true" /></span>
          <span>
            <strong>工作规则</strong>
            <small>查看、编辑、启停长期知识工作规则；用户修改始终优先。</small>
          </span>
          <IconChevronRight aria-hidden="true" />
        </button>
      </section>

      <section className="panel system-ai-settings" aria-label="AI Provider 与模型设置">
        <div className="system-ai-settings__head">
          <div>
            <span className="eyebrow">AI 设置</span>
            <h2>Provider 与模型</h2>
            <p>第一次资料总结和第二次知识提炼可以独立选择模型。项目只保存 Provider / Model 名称，不在这里保存账号密码、Token 或 API Key。</p>
          </div>
          <button
            className="graph-filter graph-filter--on"
            disabled={aiSettings.loading || aiSettings.saving || !aiSettings.data}
            onClick={handleSaveAiSettings}
            type="button"
          >
            {aiSettings.saving ? "正在保存…" : "保存 AI 设置"}
          </button>
        </div>

        {aiSettings.loading ? (
          <div className="system-ai-settings__empty">正在读取当前 AI 设置…</div>
        ) : aiSettings.data ? (
          <div className="system-ai-settings__grid">
            {[
              ["summary", "第一次资料总结", "理解来源资料并生成可编辑候选摘要；不会自动保存为正式事实。"],
              ["knowledge", "第二次知识提炼", "Raw → Wiki 的只读规划与确认后写入；与第一次总结可使用不同模型。"],
            ].map(([task, label, description]) => (
              <article className="system-ai-task" key={task}>
                <div>
                  <strong>{label}</strong>
                  <p>{description}</p>
                </div>
                <label>
                  <span>Provider</span>
                  <select
                    value={aiSettings.data[task].provider}
                    onChange={(event) => {
                      const nextProvider = event.target.value;
                      updateAiTask(task, "provider", nextProvider);
                      if (nextProvider === "manual") updateAiTask(task, "model", "none");
                    }}
                  >
                    {aiSettings.data.providers.map((provider) => (
                      <option
                        disabled={!provider.available || !provider.supports?.includes(task)}
                        key={provider.id}
                        value={provider.id}
                      >
                        {provider.label}{
                          !provider.available
                            ? "（尚未接入）"
                            : provider.supports?.includes(task)
                              ? ""
                              : "（不支持此阶段）"
                        }
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Model</span>
                  <input
                    aria-label={`${label}模型`}
                    disabled={aiSettings.data[task].provider === "manual"}
                    onChange={(event) => updateAiTask(task, "model", event.target.value)}
                    placeholder="default"
                    type="text"
                    value={aiSettings.data[task].model}
                  />
                </label>
                <small>
                  {aiSettings.data[task].provider === "manual"
                    ? task === "summary"
                      ? "人工模式不会调用任何模型；你可以自己填写，也可以把标准提示词交给任意 AI 后再粘贴结果。"
                      : "人工模式不会调用任何模型；你可以手工填写第二次提炼方案并完成二次审核。方案确认后还会单独列出目标文件，只有再次点击“执行写入 Wiki”并确认，才会真正修改正式 Wiki。"
                    : aiSettings.data[task].model === "default"
                    ? "default = 跟随当前 Codex CLI 的默认模型。"
                    : `将显式请求模型：${aiSettings.data[task].model}`}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <div className="error-note">AI 设置不可用。</div>
        )}

        {aiSettings.message ? <div className="system-ai-settings__message" aria-live="polite">{aiSettings.message}</div> : null}
        <p className="provenance">
          第一次资料总结和第二次知识提炼都可选 Codex CLI 或人工模式。第二次人工模式只替代“提炼方案生成”，不会把“用户确认了方案”伪装成“Wiki 已经写入”；正式写入仍单独受控。OpenAI API 与本地模型仍是扩展位。切换 Provider / 模型不会自动重跑或覆盖已经审核过的资料与知识。
        </p>
      </section>

      <section className="panel system-codebook" aria-label="阶段与代号说明">
        <div className="system-codebook__head">
          <div>
            <span className="eyebrow">项目说明</span>
            <h2>阶段与代号说明</h2>
            <p>业务页面优先使用中文名称；下面的代号只用于 Roadmap、开发定位和交接追踪。</p>
          </div>
        </div>
        <div className="system-codebook__table-wrap">
          <table className="system-codebook__table">
            <thead>
              <tr>
                <th>代号</th>
                <th>中文名称</th>
                <th>当前状态</th>
                <th>作用</th>
                <th>是否需要你确认</th>
              </tr>
            </thead>
            <tbody>
              {PROJECT_CODES.map((item) => (
                <tr key={item.code}>
                  <td><code>{item.code}</code></td>
                  <td>{item.name}</td>
                  <td>{item.status}</td>
                  <td>{item.purpose}</td>
                  <td>{item.confirmation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="provenance">
          Roadmap 里仍有一套较早的 “P2 · 15–30 天受控自进化”编号，与当前 “P2 · Raw → Wiki 提炼与扩展”重名。后续会在 Roadmap 中加命名空间或重命名，避免同一个 p2-* 表示两件事。
        </p>
      </section>

      <div className="system-grid system-grid--details">
        <section className="panel">
          <div className="panel__head"><h2 className="panel__title">数据与索引</h2></div>
          <dl>
            <div className="system-kv"><dt>正式知识库</dt><dd>{vault?.label || "本地知识库"}</dd></div>
            <div className="system-kv"><dt>文档数</dt><dd>{vault?.documents ?? "—"}</dd></div>
            <div className="system-kv"><dt>索引时间</dt><dd>{formatFullDate(vault?.generatedAt)}</dd></div>
            <div className="system-kv"><dt>索引错误</dt><dd>{vault?.errors ?? "—"}</dd></div>
            <div className="system-kv"><dt>文件同步</dt><dd>{sync?.status || "—"}</dd></div>
            <div className="system-kv"><dt>索引版本</dt><dd>{sync?.indexVersion ?? "—"}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel__head"><h2 className="panel__title">知识与采集</h2></div>
          <dl>
            <div className="system-kv"><dt>图谱节点</dt><dd>{graph?.nodeCount ?? "—"}</dd></div>
            <div className="system-kv"><dt>显式关系</dt><dd>{graph?.edgeCount ?? "—"}</dd></div>
            <div className="system-kv"><dt>孤岛</dt><dd>{graph?.isolatedCount ?? "—"}</dd></div>
            <div className="system-kv"><dt>分类覆盖</dt><dd>{classification?.coveragePct == null ? "—" : `${classification.coveragePct}%`}</dd></div>
            <div className="system-kv"><dt>待补全分类</dt><dd>{classification?.unclassified ?? "—"}</dd></div>
            <div className="system-kv"><dt>入库服务</dt><dd>{ingestion?.available ? "在线" : "离线"}</dd></div>
          </dl>
        </section>
      </div>

      <section className="panel system-diagnostics">
        <div className="system-diagnostics__head">
          <div>
            <span className="eyebrow">只读诊断</span>
            <h2>一键诊断</h2>
            <p>重新读取健康状态并给出原因、影响与恢复指引。不会刷新索引、改写正式知识库、修改 Git、来源原件或凭据。</p>
          </div>
          <button className="graph-filter graph-filter--on" disabled={diagnosing} onClick={handleDiagnostics} type="button">
            {diagnosing ? "诊断中…" : "运行只读诊断"}
          </button>
        </div>

        {actionError ? <div className="error-note">操作失败：{actionError.message || "未知错误"}</div> : null}

        {diagnostics ? (
          <div className="system-diagnostics__results" aria-live="polite">
            <div className="system-diagnostics__summary">
              <strong>{diagnostics.findings.length === 0 ? "未发现需要处理的项目" : `发现 ${diagnostics.findings.length} 个需要确认的项目`}</strong>
              <span>{diagnostics.readOnly ? "本次检查零修改" : "检查模式未知"}</span>
            </div>
            {diagnostics.findings.map((finding) => (
              <article className={`system-finding ${statusClass(finding.status)}`} key={finding.component}>
                <div><strong>{finding.label}</strong><span>{STATUS_LABELS[finding.status] || finding.status}</span></div>
                <dl>
                  <div><dt>原因</dt><dd>{finding.cause}</dd></div>
                  <div><dt>影响</dt><dd>{finding.impact}</dd></div>
                  <div><dt>恢复</dt><dd>{finding.recovery}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        ) : <div className="system-diagnostics__empty">尚未运行本次诊断。</div>}
      </section>

      <section className="panel system-maintenance-preview">
        <div>
          <span className="eyebrow">安全维护</span>
          <h2>维护入口</h2>
          <p>维护默认先只读预览。当前只开放重建可派生索引；删除正式知识库、清理 Git、来源原件和凭据不在这里提供。</p>
        </div>
        <button className="graph-filter" disabled={maintenanceBusy || !vaultConnected} onClick={handleMaintenancePreview} type="button">
          {maintenanceBusy && !maintenancePlan ? "正在预览…" : "预览重建索引"}
        </button>
      </section>

      {maintenancePlan ? (
        <section className="panel system-maintenance-plan" aria-live="polite">
          <div className="system-maintenance-plan__head">
            <div>
              <span className="eyebrow">只读预览</span>
              <h2>{maintenancePlan.title}</h2>
            </div>
            <span>{maintenancePlan.dryRun ? "尚未执行" : "状态未知"}</span>
          </div>
          <dl>
            <div><dt>目标</dt><dd>{maintenancePlan.target}</dd></div>
            <div><dt>影响</dt><dd>{maintenancePlan.impact}</dd></div>
            <div><dt>保留</dt><dd>{maintenancePlan.preserves.join("、")}</dd></div>
            <div><dt>回退</dt><dd>{maintenancePlan.rollback}</dd></div>
          </dl>
          <div className="system-maintenance-plan__actions">
            <button className="graph-filter" disabled={maintenanceBusy} onClick={() => setMaintenancePlan(null)} type="button">
              取消
            </button>
            <button className="graph-filter graph-filter--on" disabled={maintenanceBusy} onClick={handleMaintenanceExecute} type="button">
              {maintenanceBusy ? "正在执行…" : "确认执行重建"}
            </button>
          </div>
        </section>
      ) : null}

      <p className="provenance system-boundary-note">
        健康页不展示真实本地路径、凭据或来源正文；缺少检测记录时显示“未确认”，不做估算。
      </p>
    </div>
  );
}
