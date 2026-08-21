# personal-ai-dashboard 项目交接

更新时间：2026-08-19

## 当前任务

`P1.3.6 · Workbench 稳定化` 已于 2026-08-17 完成验收。`P1.3.7 · Knowledge Work Loop` 的工程实现已推进到 `p137-8` 验收记录阶段；最终通过仍要求连续至少 3 个真实工作日，不能由单测、合成日期或 AI 自动代替。完整阶段、步骤和验收标准以 `docs/roadmap/personal-ai-dashboard-roadmap.html` 为准；本文件只保存下一次对话继续工作所需的边界、近期决定和操作规则，避免重复 Roadmap 的完整内容。

## 项目路径

- Coding Tools MCP：`/workspace/personal-ai-dashboard`
- Windows 实际目录：`D:\work\personal\personal-ai-dashboard`
- 两者是同一份项目文件。

## Git 与修改安全规则

- 当前工作区包含未提交修改，不要因为工作区很脏而清理它。
- 禁止 `git reset`、`git clean`、`git checkout .`、`git restore .` 或其他整库回滚。
- 不要擅自 `commit` 或 `push`。
- 修改项目前先读取实际文件和相关 diff；项目文件修改使用 Coding Tools MCP `apply_patch`，不要用 shell 整文件重写。
- 不要擅自删除或重装 `node_modules`。

## 已冻结的 P1.3.6 能力

P1.3.6 必须包含以下系统可靠性能力：

- **System Health**：在 `/system` 汇总 Vault、Ingestion、索引、Graph、未分类数据、测试/隐私扫描和本地服务等健康状态。
- **One-click Diagnostics**：一次执行只读检查并汇总故障原因、影响范围和恢复指引；诊断动作本身不得修改 Vault、Git、来源原件或凭据。
- **Safe Maintenance Center**：只提供可预览、需确认、边界清楚的低风险维护动作。默认 dry-run；不可逆或危险操作不能伪装成“一键修复”，不能借维护流程删除或改写正式知识、Git 历史、来源原件和凭据。

对应 Roadmap 步骤保持既有 ID，新增 `p136-8c`，避免破坏已有进度状态。

### P1.3.6 最终验收记录

- `npm test` 已完成生产 build 与完整 Node 测试：`182/182` 通过。
- `npm run privacy:scan` 已通过。
- Hosted/public build 明确使用仓库内 synthetic demo Vault；本地开发继续尊重 `.env` 中的 `PERSONAL_DASHBOARD_VAULT_ROOT`。
- MCP Linux 与 Windows 共享 `node_modules` 时缺少 Linux 平台的 Rollup/esbuild 原生可选包；最终验收通过临时目录注入 `package-lock.json` 已锁定的同版本平台包完成，没有删除或重装共享 `node_modules`，也没有修改 `package.json` / `package-lock.json`。
- P1.3.6 已达到稳定化门槛；后续不要再把 Rollup/esbuild 记录当作代码阻塞，除非 MCP 环境本身需要长期修复跨平台依赖安装方式。

## 已冻结的 P1.3.7 能力

Knowledge Work Loop 的核心能力包括：

- Work Rules
- Today Knowledge Queue
- Daily Knowledge Review
- Tomorrow Suggestions
- User Override First
- Workbench State Store

现有 `Focus Workspace` 继续保留，它与上述能力不冲突。

### P1.3.7 当前进度

- `p137-1 · Knowledge Work Schema v1` 已完成。
- `p137-2 · Today Knowledge Queue v1` 已完成。
- `p137-3 · Focus Workspace v1` 已完成。
- `p137-4 · Daily Knowledge Review v1` 已完成。
- `p137-5 · Tomorrow Suggestions v1` 已完成。
- `p137-4 · Daily Knowledge Review v1` 已完成。
- 新增 `Workbench/server/knowledge-work.mjs`，只从 Vault 索引显式状态派生候选，不按标题或内容猜测任务。
- 当前 Work Item 类型包括：待分类来源、待复核判断、孤立知识、待补证据、到期复习、显式关系候选审核。
- 每个 Work Item 必须引用真实 `documentId/path`，带可解释 `signals` 与稳定 ID；普通生活 Todo 不进入模型。
- 新增只读 `GET /api/knowledge-work`；该接口不排序、不持久化、不执行完成/跳过，也不修改 Vault。
- Today 首页现在基于上述候选生成最多 5 项有限队列；支持人工上移/下移、完成、稍后、跳过，并显示每项进入原因。
- 当前 Today 人工状态存放在浏览器本地 `workbench:knowledge-work:today:v1`，只影响当天工作视图；刷新保留、跨日重置，不写 Vault。正式跨日 Workbench State Store 仍留在 `p137-7` 完成。
- Focus 使用正式 `/focus/:workItemId` 路由；`GET /api/knowledge-work/focus/:id` 会基于当前索引重新验证候选，只返回真实当前对象、来源证据、相关知识和显式关系；触发条件消失后旧 Focus 链接直接失效。
- Focus 进入/退出/结果追加到当日 `focusHistory`，完成/稍后/跳过仍只改变 Today Workbench 状态，不写 Vault；`p137-7` 已把这些日记录收进统一 Workbench State Store 并保留跨日历史。
- Workbench 日内状态新增最多 200 条 `events`，事件携带当时 Work Item 快照；Daily Review 因此可以在 Vault 状态变化后仍追溯“当时处理了什么”。
- 正式 `/review` 页面只从当日事件、Focus 历史、当前真实候选与人工备注生成复盘；“已标记完成”只有在当前索引中原显式触发条件已消失时才列入“已核验变化”，否则明确保留为未核验完成。
- Review 不根据文件修改时间猜测“新增来源”或知识变化；没有可追溯事件的变化不自动认领。人工备注标记为 `USER AUTHORED`，仅存当前日内 Workbench 状态，不写 Vault。
- Tomorrow Suggestions 仍只从当前未解决真实 Work Item 与当日 Review 状态生成。人工复盘只作为上下文，不可单独生成任务。旧 `workbench:knowledge-work:tomorrow:v1` 仅作为兼容迁移来源；当前正式持久化已收口到 `workbench:knowledge-work:state:v1` 的按 source day Tomorrow cycles。
- Tomorrow 候选支持改写、确认、拒绝、删除、全部拒绝；人工改写和状态决定在同一 source day 重算中保留。只有目标日期到达、用户已确认、且该 Work Item 仍真实存在时才进入 Today 优先序；Today 的人工排序优先于该自动优先序。
- `p137-6 · Work Rules v1` 已完成：新增正式 `/rules` 页面和独立 `workbench:knowledge-work:rules:v1` 本地状态。Starter Rules 只来自项目已冻结治理边界并明确标注非个人记忆；用户可编辑、启停、删除、新增（最多 10 条）。
- `enabledWorkRulesContext` 只导出可见且启用的规则；Tomorrow 保存当次 `rulesContext` 快照并在 Review 中公开展示参与建议的规则。规则不直接修改 Vault，删除/停用后也不存在隐藏替代规则。
- `p137-1` ~ `p137-6` 定向回归共 33 个测试通过，Work Rules/Review/Overview/App JSX 解析通过，`npm run privacy:scan` 通过。
- `p137-6b · User Override First` 当前阶段已完成：Today 人工状态/排序、Review 用户原文、Tomorrow 改写/确认/拒绝/删除、Work Rules 编辑/启停/新增都带统一 `userOverride` / `userConfirmed` / user-source provenance；Rules starter 删除增加 tombstone，旧 localStorage 继续向后兼容。正式 UI 已可见区分系统候选与用户决定，save-load / recompute 回归通过。Today 仍按本地日期展示独立日状态，但 `p137-7` 已将各日记录保存在统一 Workbench State Store 中，不再因跨日切换丢失上一日工作历史。
- `p137-6c · Unified Workbench Shell + Control Center` 已推进到**中文视觉验收版**：`/design-lab` 默认进入 synthetic-only 指挥中心，左侧导航按工作 / 知识 / 系统分组并覆盖今日 / 专注 / 复盘 / 明日计划 / 工作规则 / 入库 / 资料中心 / 知识库 / 知识图谱 / 系统与设置。指挥中心聚合今日、专注、知识、复盘、明日计划、系统、AI 洞察与最近活动；工作流页使用完整主舞台，旧 Inspector 只保留给今日 / 资料中心 / 知识库 / 知识图谱等对象型页面。
- p137-6c prototype 已增加本地组件级交互：专注暂停/继续、复盘用户原文编辑、明日计划确认/拒绝、工作规则启停，以及控制中心的系统健康 / 诊断 / 安全维护 / 接入与服务 tabs。所有状态都只存在于 synthetic prototype 组件中；安全维护仅提供 dry-run 预览，不调用正式维护接口。顶部和系统状态均明确标注原型/合成数据，避免把假状态冒充真实 System Health。
- p137-6c 前台文案采用 **中文优先**：主导航、指挥中心、专注、复盘、明日计划、工作规则、系统与设置、诊断/安全维护、命令面板、检查器以及 synthetic 资料标题/图谱节点都尽量使用中文；仅在必须保留的 AI / RAG / Git 等技术标识、代码术语或开发语义中保留英文。避免正式前台长期维持中英混杂。
- 中文视觉验收版已补中文长度与窄屏保护：导航标签和顶部面包屑安全省略；760px 以下顶栏收为两列并隐藏中间搜索框；规则状态、明日决策、系统服务状态不拆词，规则卡在窄屏改为纵向布局。2026-08-18 使用 MCP 对当时实际工作树复核后，p137-6b + p137-6c 联合定向回归为 `50/50` 通过；除 Rules starter 删除后的 user-authoritative tombstone 与“入库保持 synthetic-only”边界外，Design Lab 星空氛围继续收敛：指挥中心银河核心上移到上半区并向下衰减，卡片提高不透明度，让星云/星点主要从 Hero 周边、快捷入口和卡片缝隙露出；知识星图不再把星空铺在整页外层，而是只放进真正的图谱画布，语义视图使用低密度 `semantic` 弱版，全量网络使用高密度 `network` 强版与低频流星。三种视觉模式统一由 `StarfieldBackdrop.jsx` 提供 canvas 动效，支持 `prefers-reduced-motion` 静态降级与 `ResizeObserver` 自适应，只存在于 `src/pages/design-lab/`，不读取 formal Workbench state、Vault、localStorage 或网络 API。视觉方向参考公开 MIT licensed `qidianq2025/starry-workbench` 的 cosmos 处理方式，但本项目实现为隔离重写，不迁移其任务/状态逻辑。`/design-lab` 的入库页继续支持链接 / 文本 / 文件三种本地原型输入和合成处理队列，只使用组件内状态，不抓取网页、不读取本地文件、不写 Vault，也不调用正式 `/ingestion` 服务；指挥中心“新建入库”和全入口命令面板均可打开该页。Design Lab Workbench Shell、state boundary、CSS boundary、formal migration、real graph、Today/Review/Tomorrow/Rules 回归均通过。由于 MCP Linux 当前共享的 `node_modules` 中 esbuild 仍是 Windows 平台二进制，本轮没有删除或重装依赖，改用仓库现有 `@babel/parser` 对相关改动 JSX 做纯语法解析，`21/21` 通过；`npm run privacy:scan` 通过。该次代码级边界复核确认 `/design-lab` 明确标注原型/合成数据，当时正式 `/` 仍由 `OverviewPage` 提供且正式页面未导入 `design-lab/data.js`。Production build 的跨平台原生包环境限制保持既有记录，不能据该次验证声称最新完整 release gate 已重新通过。
- 2026-08-18 后续视觉收敛批次继续只改 `/design-lab` 全量知识网络：`network` 星空现在会按 Graph `pan/scale` 以约 18% 平移和极轻缩放做远景视差，避免拖拽时节点像浮在静止背景上；普通节点进一步降低填充亮度、描边和 glow，Hub / 当前焦点保留更明显发光层级。该批次没有改变 synthetic/formal 边界或正式 Graph；当时 p137-6b + p137-6c 联合定向回归为 `50/50`，相关 JSX 纯语法解析 `21/21`，`privacy:scan` 通过。
- 2026-08-18 用户已明确通过 p137-6c `/design-lab` 中文视觉与信息架构验收，随后完成正式 Unified Workbench Shell 迁移：正式 `/` 现在由新的真实数据 `CommandCenterPage` 提供指挥中心；原 Today 工作台迁到 `/today`；新增正式 `/focus` 选择页并保留 `/focus/:workItemId` 真实上下文路由；新增正式 `/tomorrow` 明日计划页，继续复用真实 Knowledge Work、Daily Review、Work Rules 与 Tomorrow Suggestions 状态，并保持 User Override First。`AppShell` 已按“工作 / 知识 / 系统”分组收口今日、专注、复盘、明日计划、工作规则、入库、资料中心、知识库、知识图谱、系统与设置；旧探索/洞察入口保留在折叠“其他”组。正式命令面板覆盖这些核心入口。正式迁移没有导入 `design-lab/data.js` 或 synthetic fixtures；指挥中心继续读取 `loadOverview/loadGraph/loadKnowledgeWork/loadSystemHealth`，Today/Focus/Review/Tomorrow/Rules 继续使用正式 API 与独立 Workbench state，Vault 写入边界未改变。迁移后 p137-6b + p137-6c 联合定向回归为 `52/52` 通过；使用仓库现有 `@babel/parser` 对 `src` 下全部 JSX 做语法解析 `48/48` 通过；`npm run privacy:scan` 通过。该批次没有运行 production build，因此不能据此声称最新完整 release gate 已重新通过。该记录描述的是 p137-6c 完成时点；随后已继续完成 p137-7。
- `p137-7 · Workbench State Store v1` 已于 2026-08-18 完成：新增 `src/lib/workbench-state-store.js`，统一使用 `workbench:knowledge-work:state:v1` 保存最多 90 个按日 Today/Focus/Review 记录与最多 90 个 Tomorrow source-day cycles。Today 页面仍只打开当前本地日期的工作状态，但前一日 Focus/history/events/review 会保留在 Store；Tomorrow 不再只有单一可覆盖周期，Today/Focus 在目标日会显式读取“前一 source day、targetDate=今天”的确认建议，因此今天生成新的 Tomorrow 计划不会覆盖昨天对今天的人工确认。旧 `workbench:knowledge-work:today:v1` 与 `workbench:knowledge-work:tomorrow:v1` 会在首次读取时非破坏迁移，新 Store 优先读取，旧副本暂不自动删除。提供 `clearWorkbenchStateStore()` 只清除统一 Store 与旧 lifecycle keys，不删除 `workbench:knowledge-work:rules:v1`，也不接触 Vault / API / 来源原件。新增 5 条 p137-7 回归覆盖跨日 save-load、Tomorrow 多周期、legacy migration、清除隔离和无网络/Vault 依赖；与 p137-6b/p137-6c 联合定向回归现为 `57/57` 通过，`src` 全部 JSX 纯语法解析 `48/48` 通过，`privacy:scan` 通过。p137-7 现已完成；下一门槛是 `p137-8 · Knowledge Work Loop 验收`，要求至少连续 3 个真实工作日使用，不能用 synthetic/unit test 冒充完成。
- 2026-08-18 用户重新确认“采集 → AI 第一次总结 → 人工审核 → 归档资料中心 → 后续再提炼为知识”的主链。已移除资料阅读器右侧重复的“手动入库审查 / 整理、复制并打开 Codex”主流程，改为“资料信息”，明确 Raw 已完成第一次归档且不是正式 Wiki。`IngestionPage` 的候选摘要主流程改为用户明确点击“生成 AI 总结”后，由 Workbench 受控 Provider 生成**仅进入编辑区、不自动保存**的候选草稿；旧标准提示词复制能力降级为可展开的 ManualProvider 备用方式。归档文案统一为“归档到资料中心”，不再把 Raw 发布描述成写入知识库。新增 `server/candidate-summary-provider.mjs`，当前实现复用可检测的 Codex CLI 作为受控 Provider，使用 ephemeral/read-only sandbox；Provider 缺失时失败关闭并保留手动方式。User Override First 继续有效：重新生成已有草稿需要显式确认，已保存版本不会被后台自动覆盖。Raw → Wiki 后续应使用独立“提炼为知识”二次审核链，不恢复 Reader 内 Codex client handoff。
- 2026-08-18 已继续完成 `p2-0 · P2 准入决定` 的**决策基础设施**，但没有替用户批准 P2。`materials.mjs` 会从真实 Raw 汇总来源类型、已审核 AI 候选总结覆盖、分类完整度、阅读/复用信号和基于 `source_sha256` / `summary_source_sha256` 的重复组；资料中心首页显示这份准入清单。新增浏览器本地 `workbench:p2-admission:v1`，只有用户在二次确认框中明确选择“批准进入 P2”才产生 `decision=approved + userConfirmed + source=user`；“暂不进入”也作为显式用户决定保存。没有真实 Raw、没有显式 confirm，或仅收到一般性的“继续”指令时，`p2AdmissionAllowsExtraction()` 始终返回 false。该状态不访问网络、不写 Vault，也不授权 Wiki 写入。资料阅读器中的“提炼为知识”仍仅做准备检查；真正概念候选 / 去重 / Wiki Diff 继续等待用户批准准入。本批次完整 release gate 已通过：全量 Node 测试 `256/256`、production build、`privacy:scan` 均通过；`src` 下 `87` 个 JS/JSX（其中 `51` 个 JSX）全部语法解析通过。
- 2026-08-18 `p2-0` 继续收敛为**可审计、快照绑定的准入状态机**：资料中心准入清单现在为当前真实 Raw 生成稳定 SHA-256 快照指纹，指纹覆盖 Raw 身份/路径、来源哈希、已审核摘要哈希、分类、用途和待看信号。用户批准后该快照与决定一并保存在浏览器本地；后续任一受控字段变化都会把旧批准标记为“需重确认”，并通过 `p2AdmissionAllowsExtractionForSnapshot()` 自动重新关闭 Raw → Wiki。准入状态保留最多 20 条批准 / 暂缓 / 撤销审计记录，撤销会立即回到 pending；旧决定不会被删除或静默覆盖。资料中心 UI 已显示“需重确认”、快照漂移说明、重新批准、撤销和审计记录入口。该机制仍不访问网络、不写 Vault、不触发 p2-1；当前会话中的“继续”依然不等于批准进入 P2。定向回归 `15/15` 通过；完整 release gate 使用临时 Linux Rollup/esbuild 平台包后通过：全量 Node 测试 `258/258`、production build、`privacy:scan` 均通过，`src` 下 `87` 个 JS/JSX（其中 `51` 个 JSX）全部语法解析通过；共享 `node_modules` 未删除、未重装、未修改。
- 2026-08-18 用户已在资料中心明确点击 **“批准进入 P2”**，因此 `p2-0` 当前用户准入门已通过；该批准仍绑定当时真实 Raw 快照，后续快照漂移、撤销或暂缓会自动失效。已开始并完成 `p2-1 · Raw → Wiki 二次提炼` 的首个可用闭环：Reader 的“提炼为知识”会先读取当前 `/api/materials` 快照并与浏览器内批准状态比较，后端 `/api/wiki-ingest` 再次强制校验 `approved + userConfirmed + source=user` 与相同 Raw 快照指纹，不能靠直接调用 API 绕过当前准入状态。通过后只启动既有 read-only Wiki ingest planning 状态，规划提示固定要求输出“内容适配与证据边界 / 概念候选 / 去重与关联 / Wiki Diff / 不入库内容与待验证问题 / 二次确认清单”；Reader 可显示方案、允许用户提问或要求修订。只有用户在具体方案处再次点击“确认这个方案并写入 Wiki”，才调用既有 `confirm` 路由进入 workspace-write；来源/笔记快照变化、方案版本过期都会 fail closed，执行后只按既有 Git delta 审计汇报实际变化。Codex client handoff 没有恢复为正常 UX。该批次定向回归 `20/20` 通过；完整 release gate 也已通过：全量 Node 测试 `261/261`、production build、`privacy:scan` 均通过，`src` 下 `87` 个 JS/JSX（其中 `51` 个 JSX）全部语法解析通过。Linux gate 继续只使用临时目录中的 lockfile 同版本 Rollup/esbuild 平台包，共享 `node_modules` 未删除、未重装、未修改。
- 2026-08-18 实际 Reader 截图暴露一个历史 Raw 迁移死路：早期来源已经归档，但没有 `summary_*` 审核标记和/或完整 `domain + content_kind` 分类，因此 P2 准备检查会正确阻止提炼，却没有就地补齐入口。现新增 `server/material-review-backfill.mjs` 与 Reader 内“补齐历史来源审核信息”流程：缺摘要时可由受控 Candidate Summary Provider 生成与现行第一次入库相同八段结构的候选草稿，用户可直接修改；缺分类时显示受控领域/内容类型/用途并允许人工确认。保存必须再次显式确认，只允许当前 Vault Layout 的 Raw 根目录下单文件，使用临时文件原子替换，只补缺失摘要/分类并拒绝覆盖已有审核结果；摘要、分类均做服务端结构/枚举校验。保存后重新索引并在 Reader 中立即显示补齐结果，但由于真实 Raw 快照发生变化，既有 P2 批准按设计自动失效，用户必须回资料中心重新确认 P2 后才可生成 Wiki 二次提炼方案。新增 4 条服务级回归验证确认门、原文保留、摘要/分类写入与禁止覆盖；联合定向回归 `14/14` 通过。完整 release gate 使用临时 Linux Rollup/esbuild 平台包后通过：全量 Node 测试 `265/265`、production build、`privacy:scan` 均通过，`src` 下 `87` 个 JS/JSX（`51` 个 JSX）全部语法解析通过；共享 `node_modules` 未删除、未重装、未修改。
- 2026-08-18 继续完成资料中心的 Raw → Wiki **只读准备层**：新增 `src/lib/material-knowledge-lifecycle.js`，只从已归档 Raw 的显式 `summary_origin / summary_sha256 / classification` 和 Markdown 中已存在的 `## 摘要说明` 区段读取第一次已审核 AI 候选总结，不根据正文临时生成或猜测总结。Reader 的“资料信息”现在直接展示该已审核总结、核心要点和不确定内容，并提供“提炼为知识”入口；点击后只显示来源路径、已审核总结、分类和来源哈希等准备检查，以及 P2 准入提示。该入口**不会调用 AI、不会生成概念、不会建立 Wiki Diff、不会写 Wiki**，即使准备条件满足也只表示“来源准备完整”；真正 Raw → Wiki 提炼仍受 `p2-0` 用户准入门控制。新增 lifecycle/边界测试，定向回归 `27/27` 通过；随后完整 release gate 已通过 production build、全量 Node `252/252`、`privacy:scan`，`src` 下 `86` 个 JS/JSX（`51` 个 JSX）全部语法解析通过。Linux Rollup/esbuild 仍只通过 MCP 临时目录注入 lockfile 同版本平台包，没有修改或重装共享 `node_modules`。
- `p137-8 · Knowledge Work Loop 验收` 的**记录基础设施**已于 2026-08-18 完成，但最终验收仍未完成：`/today` 会把真实进入次数写入当日本地 Workbench state，并对短时间重复挂载做去重；`/review` 新增明确的用户输入“复盘价值（1-5）”与“维护成本（分钟）”。`knowledge-work-loop-acceptance.js` 从最多 90 天 Store 汇总进入次数、人工完成知识工作数、Tomorrow 建议确认采用率、复盘价值与维护成本，只把字段记录完整的日期纳入统计。即使存在 3 天记录，汇总器仍显式要求人工确认这些日期确实是“连续真实工作日”，不会用合成数据或测试自动宣布通过。该记录层不访问网络、不读写 Vault、不改变正式知识事实，评价字段带 user provenance；本批次定向回归 `48/48` 通过，`src` 下 `85` 个 JS/JSX（`51` 个 JSX）全部语法解析通过，`privacy:scan` 通过。
- 2026-08-18 用户明确要求在进入 `p137-8` 前先补正式前台视觉迁移。本轮已将已验收 `/design-lab` 的指挥中心视觉语言迁入正式 `/`：正式 Command Center 继续读取 `loadOverview / loadGraph / loadKnowledgeWork / loadSystemHealth` 与真实 Workbench state，同时接入 state-isolated `StarfieldBackdrop` 的 command 银河/星点画布；Hero、快捷入口、卡片透明度/层级/间距，以及正式侧栏和顶栏的边框、搜索框、选中态和背景质感均继续对齐 Design Lab。快捷入口现为“新建入库 / 开始专注 / 每日复盘 / 系统中心”。没有导入 `design-lab/data.js`、synthetic fixtures 或原型组件状态，也没有改变 Vault/API 写入边界。正式迁移相关定向回归当前为 `55/55` 通过，`src` 下 JS/JSX 使用现有 `@babel/parser` 解析 `82/82` 通过，`privacy:scan` 通过。当前仍**不进入 p137-8**；下一步应先由用户从正式 `/` 做视觉确认，再决定是否需要继续收敛细节。
- 2026-08-18 用户进一步明确授权：当前正式前台数据本身仍属于演示/假数据，因此正式 `/` 可以直接使用已验收的 synthetic 展示数据或等价的本地 Demo fallback，不再要求为了形式上的 formal/synthetic 完全隔离而重复造一套内容。授权边界仅限**展示层**：真实 API / Vault 能力保留且有值时优先；没有真实 Today / Recent / Knowledge 指标或 System Health 不可确认时，可以显示明确标注的“合成演示 / Demo”内容；演示 Work Item 不伪装成真实可操作对象，假 System Health 必须明确说明“不代表真实 System Health”，且 Demo 不得写入 Vault、Workbench authoritative state 或调用维护 API。正式 `/` 已据此补齐与 `/design-lab` 一致的专注、知识、复盘、明日计划、系统、AI 洞察与最近活动层级，并继续使用同一银河/星空、Hero、快捷入口和卡片语言。最新相关定向回归 `56/56` 通过，`src` 下 JS/JSX `82/82` 语法解析通过，`privacy:scan` 通过。当前仍**不进入 p137-8**；下一步是用户对正式 `/` 做实际视觉验收。
- 2026-08-18 正式 `/graph` 视觉迁移已完成一个可回退代码批次：没有覆盖旧 `GraphPage.jsx`，而是新增 `FormalGraphPage.jsx` 并让正式 `/graph` 路由切换到它。新页面直接复用已验收 `/design-lab` 的语义图谱视觉语言与 synthetic graph fixtures 作为**明确标注的 Demo fallback**：默认提供“语义视图 / 全量网络”，语义视图支持“概览 / 领域 / 聚焦”三级密度、主题簇卡片、semantic 星空画布和右侧 Inspector；全量网络在真实 Graph 节点不足时复用 Design Lab 的 synthetic `NetworkGraph`，真实 Graph 足够时继续使用正式 `loadGraph()`、真实节点/双链、搜索/筛选和现有 graph performance budget。当前 Demo fallback 触发条件为真实 Graph 少于 4 个节点；UI 会显示 `Demo · 合成数据` 与“不会写入 Vault”的说明，且该页不访问 localStorage、不写 Workbench authoritative state、不调用 maintenance API。旧正式 Graph 实现保留未删除，便于快速回退。该批次联合定向回归 `63/63` 通过，`src` 下 JS/JSX `83/83` 语法解析通过，`privacy:scan` 通过。尚未由用户在 Windows 正式 `/graph` 做视觉验收，因此当前仍**不进入 p137-8**。
- 2026-08-18 最新用户指令覆盖此前正式 `/` 的 Demo fallback 授权：**正式根路由 `/` 必须继续只展示真实 API / Vault / Workbench state；无真实数据时显示明确空状态，不再用 synthetic 内容补位。** 本批次已将正式 `/` 改为双层结构：第一屏为沉浸式深色宇宙封面（独立 `CosmicCoverBackdrop.jsx`，仅 canvas 星点/银河视觉，不读取 API、Vault、localStorage 或 synthetic fixtures），包含实时本地日期时间、顶部快捷导航、星座式核心入口和“进入工作台”滚动入口；第二屏继续保留真实 `CommandCenterPage` 数据卡片。正式 `/` 的 Today、Focus、Knowledge、System Health、AI 辅助与 Recent 空状态已移除 `DEMO_*` 回退，真实数据缺失时只显示“暂无/待确认/正在读取”。根路由进入封面时隐藏正式 workspace topbar，侧栏仍可收起并保持正式导航。此次定向回归（formal migration + Design Lab CSS/state/shell）`28/28` 通过，`src` 下 JS/JSX `84/84` 解析通过，`privacy:scan` 通过。当前仍**不进入 p137-8**；下一步是用户在 Windows 正式 `/` 做视觉验收。
- 2026-08-18 用户实际查看正式 `/` 后反馈全屏深色封面与浅色 Shell 衔接突兀，随后完成嵌入式 Hero 收敛：正式 workspace topbar 已恢复，宇宙区不再强制占满整个工作区，而是作为带圆角、边框和浅色外部呼吸区的首页 Hero 嵌入正式画布；Hero 最大宽度收至约 1320px，高度压至约 64vh 上限 610px，标题/时间/星座区域同步缩小，底部到真实 Command Center 的间距减小。`CosmicCoverBackdrop` 星点与银河亮度适度提高，页面背景增加极弱紫蓝过渡，使深浅界面衔接更自然；纯视觉组件仍不读取 synthetic fixtures、API、Vault、localStorage 或 authoritative Workbench state。该收敛批次定向回归 `28/28`、`src` JS/JSX 解析 `84/84`、`privacy:scan` 均通过；仍不进入 `p137-8`，继续等待正式 `/` 的实际视觉确认。
- 2026-08-18 在上述嵌入式 Hero 基础上继续完成正式 `/` 的 **Shell 一体化视觉收敛**：仅当根路由处于指挥中心时，`AppShell` 增加 `app-shell--command` 视觉状态；侧栏改为更轻的冷灰蓝雾面背景与更弱右边界，搜索框透明度降低，当前导航项使用与宇宙 Hero 呼应的紫蓝渐变强调；workspace topbar 降至 48px，并改为更轻的半透明/blur 辅助层；首页主区上边距与 Hero 外部呼吸区缩小，Hero 最大宽度约 1360px、高度约 60vh 上限 580px，边框/圆角/阴影继续减弱，使它从“独立大卡片”收敛成正式首页头图。该批次只调整根路由视觉状态，不改变其他正式路由、真实 API/Vault/Workbench state、User Override First 或写入边界。定向回归 `33/33` 通过，`src` 下 JS/JSX 解析 `84/84` 通过，`privacy:scan` 通过；当前仍**不进入 p137-8**，等待用户查看正式 `/` 的实际视觉效果。
- 2026-08-18 用户截图复核后确认上一版仍显得“像三套界面叠在一起”。本轮继续做 **首页去重复与比例收敛**：移除宇宙 Hero 内重复的 `W / 个人 AI / PRIVATE KNOWLEDGE ORBIT` 品牌块和顶部“今日任务 / 专注基地 / 知识图谱 / 智能计划 / 每日复盘 / 系统”第二套导航，只保留正式 Shell 导航与 Hero 内真正有价值的起点文案、时间、星座入口和“进入工作台”；Hero 高度进一步压至约 `52vh`、上限 `500px`，标题/时间/星座区域同步缩小；Hero 与真实 Command Center 统一到约 `1360px` 内容宽度，纵向间距继续收紧。根路由侧栏恢复更中性的雾面灰，并把当前项从明显紫色整框改成低对比白色底 + 细紫蓝提示条，减少“后台侧栏 vs 宇宙首页”的冲突。定向回归 `33/33`、JS/JSX 解析 `84/84`、`privacy:scan` 均通过；正式 `/` 仍只使用真实 API/Vault/Workbench state，无 synthetic 数据补位，且当前仍**不进入 p137-8**。
- 2026-08-18 最新视觉收敛继续覆盖上述过渡版本：用户明确要求首页不再保留大字“起点”，并让首页与入库/资料/知识等正式页面使用同一套工作台标题语言。正式 `/` 已移除整块独立深色 `formal-cover`（包括“起点”、独立日期时间、星座入口与“进入工作台”滚动层），首页第一屏直接进入真实 `CommandCenterPage`；已验收星空不再作为第二套封面，而是通过共享、纯视觉 `StarfieldBackdrop` 的 `command` 变体嵌入 `formal-command-cosmos`，仅作为 Hero、快捷入口与卡片缝隙中的浅色氛围层。正式首页仍读取 `loadOverview / loadGraph / loadKnowledgeWork / loadSystemHealth` 和真实 Workbench state，无 synthetic Today/Recent/Knowledge/System Health 回退，不改变 User Override First 或 Vault/API 写入边界。该批次相关定向回归 `56/56` 通过，`src` 下 `84` 个 JS/JSX 源文件（其中 `51` 个 JSX）使用现有 `@babel/parser` 全部解析通过，`privacy:scan` 通过。当前仍**不进入 p137-8**；下一步继续从正式前台实际视觉效果收敛，而不是恢复独立封面。
- 2026-08-18 正式前台继续完成 **标题语言与知识页 Hero 统一**：资料中心首页从“来源，不只是收藏。”改为直接标题“资料中心”，知识库从“把信息变成可以再次调用的判断。”改为“知识库”，两页的英文展示型 kicker/指标文案改为中文优先，并将原先偏展示型的 Radar / Memory Constellation 压缩为右侧辅助信息层；Hero 高度、内边距、标题字号、边框和浅色表面进一步对齐正式 `PageHeader`，900px 以下改为单列、680px 以下隐藏辅助可视化，避免窄屏继续维持双列。入库页标题统一为“入库工作台”，系统页统一为“系统与设置”。同一批次还将正式工作流主标题与左侧导航名称对齐：`/today` 为“今日”、`/focus` 为“专注”、`/review` 为“复盘”、`/tomorrow` 为“明日计划”、`/rules` 为“工作规则”、`/graph` 为“知识图谱”；上下文 eyebrow 改为中文优先，不改变任何真实数据、Work Item、User Override First、Graph 数据或写入行为。最新联合定向回归 `58/58` 通过，`src` 下 `84` 个 JS/JSX 源文件（`51` 个 JSX）全部解析通过，`privacy:scan` 通过。当前仍**不进入 p137-8**；本轮没有运行 production build。
- 2026-08-18 按“继续直到全部完成”的收口批次，当前可立即完成的工程工作已全部推进到 `p137-8` 真实时间门槛：正式核心 Workbench 的用户可见状态/计数/provenance 文案进一步中文化，Today、KnowledgeCore、Focus、Review、Tomorrow、Rules、Materials、Knowledge、Ingestion、System 与 Command Center 不再混用 `LOCAL/READY/ITEMS/WORK RULES` 等展示型英文；技术名词如 AI / Git 只在确有必要时保留。`p137-8` 验收基础设施也已补齐：Today 记录真实打开次数，Review 记录用户 1-5 复盘价值与维护分钟数，Tomorrow cycle 汇总 AI 建议采用率，`knowledge-work-loop-acceptance.js` 汇总完整记录并新增连续日期 streak；三条不连续记录不会被误判为连续 3 日，同时仍保留“必须是连续真实工作日且由用户最终确认”的人工门槛，系统不会自行宣告验收通过。最终定向批次（formal migration / Design Lab boundaries / Today / Review / Tomorrow / Rules / State Store / p137-8 acceptance / safe maintenance / system health）`73/73` 通过；最新全量 Node 测试为 `233/234`，唯一失败是 `reader-api.test.mjs` 在 MCP Linux 启动 Vite 时缺少共享依赖的 `@rollup/rollup-linux-x64-gnu`，与源码逻辑无关。`npm run build` 同样在 Vite 启动前被该可选原生包阻塞；按约束未删除或重装共享 `node_modules`。最新 `src` 使用现有 `@babel/parser` 对 `85` 个 JS/JSX 源文件（`51` 个 JSX）全部解析通过，`privacy:scan` 通过。除 `p137-8` 需要真实连续使用至少 3 个工作日外，没有剩余可通过当前代码修改诚实完成的 P1.3.7 项目；不要用 unit/synthetic 数据替代该时间门槛，也不要提前启动 `P1.4`。
- 2026-08-19 完成启动器、正式按钮与 P2 主链的稳定化收口。根目录 `open-dashboard.cmd` 现在先调用安全的 `scripts/stop-dashboard.ps1`，只停止本项目已记录或可识别的旧 Vite/ingestion 进程，再调用 `start-dashboard.ps1`，因此不会因 5173 已健康而直接复用旧 Vite；对无关端口占用仍保持 fail-closed，不做任意进程杀除。正式 `src`（排除明确 synthetic-only 的 `/design-lab` 原型）静态审计共覆盖 254 个 `<button>`；修掉正式知识图谱中两个实际空操作控件：删除无行为“更多操作”，并把“查看直接关系”接到语义聚焦行为，其余正式按钮均有 `onClick` 或 submit 行为，Reader / Maintenance / System / Today / Tomorrow / Rules 等关键动作继续由现有行为回归覆盖。P2 正式主链现统一由 Vault Layout 驱动：正式布局使用 `04-来源资料 → 06-正式知识 / 08-智能体运行`，历史来源 AI 补录、分类、待看状态、阅读笔记与快照、Reader Explanation 存储、资料文件夹默认根、Wiki link 解析、Vault sync invalidation、Wiki ingest handoff、Git 审计范围和写后刷新都不再在正式路径中依赖固定 `10_raw/wiki/90_runs`；旧目录字面量仅保留在 `dashboard-v1` 公共 Demo/向后兼容默认和旧 Douyin 兼容数据契约中。正式 P2 仍保持两道人工门：P2 准入绑定真实 Raw 快照，第二次提炼只在 read-only 阶段生成“概念候选 / 去重与关联 / Wiki Diff / 二次确认清单”，只有具体方案再次确认才进入 workspace-write；来源、笔记、摘要或分类变化会令旧快照失效并 fail closed。最终关键链路定向回归 `73/73` 通过，分类单测 `4/4` 通过，全量 Node 为 `266/267`，唯一失败仍是 MCP Linux 缺 `@rollup/rollup-linux-x64-gnu` 导致 `reader-api.test.mjs` 无法启动 Vite；`npm run build` 受同一环境问题阻塞。`privacy:scan` 通过，`src` 下 `87` 个 JS/JSX（`51` 个 JSX）全部语法解析通过。MCP Python 全量 ingestion 测试因容器缺 `fastapi/httpx/psutil` 无法完整运行，未安装或修改共享环境。

### User Override First

这是强制产品规则，不是普通 UI 偏好：

> AI 只建议。用户一旦人工修改或确认某个结果，用户决定优先；后续 AI 不得自动覆盖、回滚或静默改写人工确认结果。

实现时应满足：

- 人工修改后的值成为当前优先版本，并留下用户覆盖状态。
- AI 后续可以解释原因、提出新的并列候选或请求再次确认，但不能直接替换人工确认值。
- AI 刷新、重新计算、应用重启和跨日流程都必须保留用户已确认的决定。
- 只有用户显式操作才可以改变已人工确认的结果。
- 该规则至少覆盖 Today、Daily Review、Tomorrow Suggestions 和 Work Rules；与正式 Vault 知识有关的写入仍需遵守现有人工审核/发布边界。

## 当前 Roadmap 文件状态

`docs/roadmap/personal-ai-dashboard-roadmap.html` 在本次任务开始前已经存在大量未提交修改，包括 P1.3.5、P1.3.6、P1.3.7 和 V2.5 Roadmap 更新。本次只在当前实际内容上补充上述能力，不应回退或覆盖其他已有修改。

## 下一次继续前先检查

1. 读取 `docs/roadmap/personal-ai-dashboard-roadmap.html` 当前 diff，不要假设文件仍与本交接完全一致。
2. 读取本文件确认 Git 安全规则和 User Override First 边界。
3. 再读取当前要实施的源码文件后才开始修改。
4. 正式根路由 `/` 继续只展示真实 API / Vault / Workbench state；无真实数据时显示明确空状态，不使用 synthetic Today / Recent / Knowledge / System Health 补位。`/design-lab` 和正式 Graph 明确标注的受限 Demo fallback 继续遵守既有隔离边界，不得写 Vault、Workbench authoritative state 或维护 API。

### 2026-08-19 夜间补充：Windows 实机与明日待办

- 用户已确认 **5173 最新前台能够成功拉起**。这只代表最新 Vite 前台已成功启动，不自动等价于 Reader 按钮、历史 Raw 补录、P2、第二次提炼与 Wiki 写入均已完成 Windows 实机验收。
- 8766 仍可能复用一个由更高 Windows 权限启动的旧 Ingestion 进程；当前启动器已为这种“已确认是本项目服务但普通权限无法停止”的情况提供安全复用路径。后续若该高权限旧进程被管理员结束、注销或重启系统，再由启动器拉起当前新版 Ingestion。
- **明日新增优先事项：把 AI 模型 / Provider 配置正式放进“系统与设置”页面。** 目标不是把业务代码绑定到某个固定模型，而是增加可替换配置层：
  - 第一次资料总结：可配置 Provider 与 Model；默认可继续使用 Codex CLI 当前默认模型，也允许后续指定模型。
  - 第二次知识提炼：独立配置 Provider 与 Model，可与第一次使用不同模型。
  - 后续 Provider 方向保留 Codex CLI / OpenAI API / Local Provider 等扩展位，但不要因此改写 Raw、Reader、P2、Wiki 等业务状态机。
  - AI 产物需要逐步补齐 provenance：`ai_provider`、`ai_model`、`prompt_version`、`generated_at`；模型切换不得静默覆盖用户已审核/修改结果，重跑应走“新结果 → Diff → 用户决定是否采用”。
  - 在 UI 中不要声称当前第一次/第二次 AI 一定使用某个固定模型；当前准确描述仍是 Workbench 调用本机已认证、可用的 Codex CLI，由 CLI 当前配置/默认后端决定具体模型，除非后续显式配置模型。
- **代号可见性要求**：如果项目继续保留 `P1.3.7`、`p137-8`、`P2`、`p2-0`、`p2-1` 等内部代号，则“系统与设置”里增加一个可读的“阶段与代号说明”页/区域，至少展示“代号 / 中文名称 / 当前状态 / 作用 / 是否需要用户确认”，并明确区分内部工程编号和用户实际操作名称。正常业务页面优先显示中文，不要求用户记住内部代号；代号只作为辅助定位和开发追踪信息。
- 2026-08-19 晚间继续收口 Reader 实机问题：右侧 Annotation Desk/资料信息/历史补录/P2/Wiki Diff 等持续阅读区域的字号底线再次上调，Reader 正文辅助文字和表单/审核区以约 12–13px 为主要底线，并适当加宽桌面右侧面板。阅读器顶栏新增“主页”快捷按钮，离开前仍先 flush 阅读笔记，成功后关闭 Reader 并返回 `/`；不再要求先关 Reader 再手动导航。
- 第二次知识提炼现已增加**人工 Provider**，用于 Codex CLI 不可用时继续验证并执行第二阶段：人工模式不会启动 Codex；P2/Raw 快照门仍照常校验；进入后用户必须按固定六章节填写“内容适配与证据边界 / 概念候选 / 去重与关联 / Wiki Diff / 不入库内容与待验证问题 / 二次确认清单”。其中 `Wiki Diff` 的可执行部分采用显式的“创建文件 / 更新文件 + markdown 完整内容块”格式。保存方案后仍需第二道人工确认；确认后先冻结方案并列出将写入的正式 Wiki 文件，再由用户单独点击“执行写入 Wiki”并再次确认。后端只允许写当前 Vault Layout 的正式 Wiki 根目录，拒绝 Raw/Runs/任意越界路径、符号链接目标、创建时已存在文件、更新时不存在文件，以及确认后又发生变化的目标文件。真正落盘后状态才进入 `completed` 并记录实际文件列表。第一次资料总结与第二次知识提炼现在都可在“系统与设置 → Provider 与模型”选择人工模式。
- 本批次定向回归覆盖 AI Provider 设置、人工二次提炼状态机、Reader 按钮、Reader 可读性、历史摘要格式修复和系统设置；人工 Wiki 写入加入后，最新相关定向集 `21/21` 通过，JSX 解析与 `privacy:scan` 通过。该结果仍不等于 Windows 实机视觉/点击验收；需要用户在最新 5173 上实际确认字号、主页按钮、人工二次提炼和真实 Wiki 落盘。
- 同时清理 Roadmap 中容易混淆的重复编号问题：当前存在不止一套 `P2/p2-*` 命名体系，后续应统一或加命名空间/说明，避免同一个 `p2-1` 同时代表不同事项。
- 2026-08-19 本会话已完成上述 **AI Provider / Model 设置第一版工程实现**，但尚未做完整 Windows 实机点击验收：
  - 新增 `Workbench/server/ai-provider-settings.mjs`，本地配置写入被 Git 忽略的 `Workbench/config/ai-provider.local.json`；只保存 Provider / Model 标识，不保存账号密码、Token 或 API Key。
  - “系统与设置”现有两组独立配置：第一次资料总结、第二次知识提炼。两者当前都可选 `codex_cli` 或 `manual`；`openai_api` 与 `local` 仍只是明确标记“尚未接入”的扩展位，服务端会 fail closed，不能伪装可用。
  - Model 使用 `default` 时不由 Workbench 显式固定；填写具体模型名时，第一次总结与第二次提炼的新 Codex 调用会分别加入显式模型参数。第二次提炼在一个任务创建时冻结 Provider / Model，同一审核线程和二次确认后的 workspace-write 保持同一模型选择，不会中途随设置变化静默切换。
  - 第一次 AI 候选摘要返回本次 `provider / model / promptVersion / generatedAt`，入库页会显示本次草稿的 Provider / Model；第二次知识提炼 Job 对外状态包含 `provider / model / promptVersion`。长期持久化到每一份正式 AI 产物的 provenance 仍属于后续收口，不应误写成已经全部完成。
  - “系统与设置”新增“阶段与代号说明”，展示 `P1.3.7 / p137-8 / P2 / p2-0 / p2-1` 的中文名称、状态、作用和是否需要用户确认，并明确指出 Roadmap 里旧“P2 · 15–30 天受控自进化”和当前“P2 · Raw → Wiki 提炼与扩展”的编号重名问题。
  - 新增/更新相关测试后，AI 设置 + Candidate Summary + Ingestion 边界 + System 页面 + Wiki Ingest 定向回归 `26/26` 通过；修改的 `SystemPage.jsx`、`IngestionPage.jsx` 使用现有 `@babel/parser` 解析通过；`privacy:scan` 通过。`npm run build` 仍在 Vite 启动前因 MCP Linux 缺 `@rollup/rollup-linux-x64-gnu` 失败，按现有约束未删除或重装共享 `node_modules`。
- 2026-08-19 同一批次继续收敛 Reader Windows 本地打开动作：Explorer 定位改为单个 `/select,<absolutePath>` 参数，避免 `/select,` 与路径被拆成两个参数；Obsidian Windows 打开改用系统注册 URI handler `rundll32.exe url.dll,FileProtocolHandler obsidian://...`，不再依赖 `cmd.exe start` 的 shell/URL quoting。Reader 的用户可见文案从“在 Finder 显示”改为跨平台的“在文件夹中定位”。这只是**代码与自动测试通过**，仍需用户在 Windows 实机分别点击“在 Obsidian 打开 / 在文件夹中定位”后才能标记为实机通过。
- 当前更完整的 Raw/P2/Reader/AI 设置联合定向回归为 `63/63`；全量 Node 为 `277/278`，唯一失败仍是 `reader-api.test.mjs` 在 MCP Linux 导入 Vite/Rollup 时缺 `@rollup/rollup-linux-x64-gnu`，不是测试断言或当前源码逻辑失败。最新修改的 `SystemPage.jsx / IngestionPage.jsx / DocumentDrawer.jsx` JSX 解析通过，`privacy:scan` 再次通过。production build 仍受同一 Rollup 平台可选包阻塞。
- 后续仍先完成现有真实链路验收，不扩展无关新功能：Reader 的“在 Obsidian 打开 / 在文件夹中定位”、`04-来源资料` 历史补录、Raw 修改导致二次提炼准入失效、重新确认当前资料、人工/自动第二次提炼、Wiki Diff、第二次确认、真实 Wiki 写入与文件差异核对。继续严格区分“代码存在 / 单测通过 / Windows 实机通过”。

### 2026-08-19 人工 Summary Provider 补充

- 第一次资料总结新增真正可用的 **人工模式（Manual Provider）**，用于 Codex CLI 不存在、未认证或用户不想让工作台自动调用模型时继续完成来源审核。
- “系统与设置 → Provider 与模型”中，第一次资料总结和第二次知识提炼现在都可在 `Codex CLI` 与 `人工模式` 之间切换。第二次人工模式不调用模型，但仍保留 P2 准入、方案审核、独立写入确认、正式 Wiki 根目录限制和写前快照/目标文件复核，不把“确认方案”伪装成“已写入”。
- 人工模式不会调用任何模型：新入库页提供“准备人工总结提示词”，历史 Raw Reader 提供“人工补录总结”；标准提示词始终可见/可复制，用户可以自行填写，或交给任意 AI 后粘贴回来。
- 人工结果继续使用与 AI 结果相同的摘要章节校验、人工审核和保存门；不会因为使用人工模式而绕过 User Override First、Raw/Wiki 分层或 P2 人工准入。
- 本批次定向测试覆盖 Provider 配置、Manual Provider 不触发 Codex、系统设置、Reader 历史补录和 Ingestion 入口；相关测试全部通过，3 个修改后的 JSX 均通过 Babel 语法解析，`privacy:scan` 通过。Windows 实机仍需用户在最新 5173 上切换“人工模式”并实际完成一次历史 Raw 补录后再标记为实机通过。

### 2026-08-19 晚间：人工二次提炼真实 Wiki 写入与审计补充

- **人工第二次提炼已从“只确认方案”升级为真正可执行 Wiki 写入。** 当前流程为：人工填写固定六章节方案 → 保存 → 第二道人工确认 → 冻结方案并解析 `## Wiki Diff` → 页面明确列出将创建/更新的 Wiki 文件 → 用户再点击“执行写入 Wiki”并确认 → 后端真实落盘 → 重新核对文件差异 → 状态进入 `completed`。
- `Wiki Diff` 的可执行格式使用显式文件块：`### 创建文件：\`<正式 Wiki 相对路径>\`` 或 `### 更新文件：\`<正式 Wiki 相对路径>\``，后接完整 `markdown` 代码块。人工写入不调用 Codex，也不把普通自然语言 Diff 猜测成文件写入指令。
- 写入边界：只允许当前 Vault Layout 的正式 Wiki 根目录（当前 personal-ai-vault-v1 为 `06-正式知识`）内的 `.md` 文件；拒绝 Raw/Runs/任意越界路径、绝对路径、`..`、符号链接目标/经过符号链接的父目录；`创建`遇到已有文件拒绝，`更新`遇到不存在文件拒绝。
- 第二次确认后会冻结目标文件指纹。点击真正写入前再次复核来源、阅读笔记和目标 Wiki 文件；任何一个发生变化都 fail closed，要求重新生成/确认方案，避免静默覆盖用户后续修改。
- 人工写入完成后 Job 的 `result.deltaFiles / changedFiles` 会记录真实写入路径，Reader 明确显示“Wiki 写入完成”和实际变更文件；任务事件加入 `manual-wiki-write.completed`。
- 第二次提炼操作历史已持久化到当前 Runs 根下的 `wiki_ingest_history`，Reader 可显示“本轮操作记录 / 最近的二次提炼记录”。重启 Vite 后仍可读取历史状态，能区分“等待审核 / 方案已确认等待写入 / 已写入 Wiki / 失败 / 取消”。
- 资料中心的 P2 工程化面板已开始用户化：主状态优先显示“尚未允许二次提炼 / 已允许二次提炼 / 资料有变化，需要重新确认”；统计、原因、备注、清除决定和历史确认记录折叠到详情中，内部 `P2 / Raw → Wiki` 代号只放辅助说明。
- 最新人工 Wiki 写入相关定向回归 `21/21` 通过，包含：人工模式不调用 Codex、确认方案不提前写文件、最后确认后真实创建 Wiki、越界到 Raw 被拒绝、现有 Codex workspace-write 路径不回归、Vault Layout 自定义根可用；Reader JSX 解析与 `privacy:scan` 均通过。
- **仍未完成的实机验收**：需要用户在 Windows 最新 5173 上重新走一轮人工二次提炼，使用新的可执行 `Wiki Diff` 格式，实际点击“执行写入 Wiki”，然后核对 `06-正式知识` 中真实文件和 Reader 显示的 delta。旧逻辑生成的 `handoff_ready / 尚未写入 Wiki` 历史任务不会自动升级为新可写任务，需要重新生成一轮。
5. `p137-8` 仍停在真实时间门槛：从 `/today` 正常工作，并在 `/review` 每个真实工作日填写复盘价值与维护分钟数。只有连续至少 3 个真实工作日后才能完成 P1.3.7 最终验收；在此之前不要提前启动 `P1.4`。P2 的 `p2-0` 用户准入与 `p2-1` 受控 Raw → Wiki 二次提炼已实现并经过当前批次收口，但每次真实写入仍必须满足当前 Raw 快照有效且用户对具体 Wiki Diff 再次确认。始终遵守 User Override First，并保持 Workbench 工作状态与 Vault 正式知识分离。

## Suggested skills

- `handoff`：下一次需要重新生成会话交接时使用，并优先引用本文件与 Roadmap，不重复复制完整规格。
- `implement`：按已冻结 Roadmap 实施具体功能。
- `code-review`：在完成一个稳定化步骤后检查回归、权限边界和维护风险。
- `diagnosing-bugs`：System Health / Diagnostics 或正式页面出现故障时使用。
- `frontend-design` / `ui-ux-pro-max`：只用于既定 V7 方向下的局部可用性优化，不重新设计 V8。
