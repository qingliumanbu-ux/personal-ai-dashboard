export const WORK_RULES_STORAGE_KEY = "workbench:knowledge-work:rules:v1";
export const WORK_RULES_VERSION = 1;

const MAX_RULES = 10;
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 500;

export const STARTER_WORK_RULES = Object.freeze([
  {
    id: "rule:search-before-creating",
    title: "新增概念前先检索已有名称与别名",
    body: "准备新增 topic、概念或框架前，先检查是否已有同义对象，避免重复知识。",
  },
  {
    id: "rule:evidence-before-judgment",
    title: "重要判断必须保留可回溯证据",
    body: "高价值判断应能回到真实来源、引用或证据路径；没有证据时保持为待补证据候选。",
  },
  {
    id: "rule:explicit-relations-only",
    title: "关系必须显式且可解释",
    body: "只把用户确认或 Markdown 中可解析的显式关系当作知识关系，不把相似度或推断关系冒充事实。",
  },
  {
    id: "rule:raw-is-not-wiki",
    title: "Raw 来源不等于正式知识",
    body: "来源资料先保持 Raw；只有经过提炼、证据检查和人工确认后才进入正式 Wiki。",
  },
  {
    id: "rule:human-confirmed-publishing",
    title: "正式知识写入必须经过人工确认",
    body: "AI 和工作台可以提出候选、解释和差异，但不能自动修改正式知识或越过发布审核边界。",
  },
  {
    id: "rule:work-state-is-not-knowledge",
    title: "工作状态不等于知识事实",
    body: "完成、跳过、稍后和 Focus 历史只属于 Workbench 状态，不能自动写成 Vault 中的知识变化。",
  },
]);

function nowIso(now = new Date()) {
  return now.toISOString();
}

function starterState() {
  return {
    version: WORK_RULES_VERSION,
    updatedAt: null,
    deletedRuleIds: [],
    rules: STARTER_WORK_RULES.map((rule) => ({
      ...rule,
      enabled: true,
      origin: "starter",
      userEdited: false,
      userOverride: false,
      userConfirmed: false,
      overrideSource: null,
      createdAt: null,
      updatedAt: null,
    })),
  };
}

function cleanText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeRule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = cleanText(value.id, 160);
  const title = cleanText(value.title, MAX_TITLE_LENGTH);
  const body = cleanText(value.body, MAX_BODY_LENGTH);
  if (!id || !title || !body) return null;
  return {
    id,
    title,
    body,
    enabled: value.enabled !== false,
    origin: value.origin === "user" ? "user" : "starter",
    userEdited: value.userEdited === true,
    userOverride: value.userOverride === true || value.userEdited === true || value.origin === "user",
    userConfirmed: value.userConfirmed === true || value.userEdited === true || value.origin === "user",
    overrideSource:
      value.overrideSource === "user" || value.userEdited === true || value.origin === "user"
        ? "user"
        : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function normalizeWorkRulesState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== WORK_RULES_VERSION) {
    return starterState();
  }
  const seen = new Set();
  const rules = Array.isArray(value.rules)
    ? value.rules
        .map(normalizeRule)
        .filter((rule) => {
          if (!rule || seen.has(rule.id)) return false;
          seen.add(rule.id);
          return true;
        })
        .slice(0, MAX_RULES)
    : [];
  return {
    version: WORK_RULES_VERSION,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    deletedRuleIds: Array.isArray(value.deletedRuleIds)
      ? [...new Set(value.deletedRuleIds.filter((id) => typeof id === "string" && id).slice(0, MAX_RULES))]
      : [],
    rules,
  };
}

export function loadWorkRulesState(storage = globalThis.localStorage) {
  if (!storage) return starterState();
  try {
    const raw = storage.getItem(WORK_RULES_STORAGE_KEY);
    return normalizeWorkRulesState(raw ? JSON.parse(raw) : null);
  } catch {
    return starterState();
  }
}

export function saveWorkRulesState(state, storage = globalThis.localStorage) {
  if (!storage) return state;
  try {
    storage.setItem(WORK_RULES_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Work Rules remain optional when browser storage is unavailable.
  }
  return state;
}

export function updateWorkRule(state, ruleId, patch, now = new Date()) {
  const current = normalizeWorkRulesState(state);
  const timestamp = nowIso(now);
  const rules = current.rules.map((rule) => {
    if (rule.id !== ruleId) return rule;
    const next = {
      ...rule,
      updatedAt: timestamp,
      userEdited: true,
      userOverride: true,
      userConfirmed: true,
      overrideSource: "user",
    };
    if (typeof patch?.title === "string") {
      const title = cleanText(patch.title, MAX_TITLE_LENGTH);
      if (!title) throw new TypeError("Work Rule title cannot be empty");
      next.title = title;
    }
    if (typeof patch?.body === "string") {
      const body = cleanText(patch.body, MAX_BODY_LENGTH);
      if (!body) throw new TypeError("Work Rule body cannot be empty");
      next.body = body;
    }
    if (typeof patch?.enabled === "boolean") next.enabled = patch.enabled;
    return next;
  });
  return { ...current, updatedAt: timestamp, rules };
}

export function addWorkRule(state, values, now = new Date()) {
  const current = normalizeWorkRulesState(state);
  if (current.rules.length >= MAX_RULES) throw new TypeError("Work Rules cannot exceed 10 items");
  const title = cleanText(values?.title, MAX_TITLE_LENGTH);
  const body = cleanText(values?.body, MAX_BODY_LENGTH);
  if (!title || !body) throw new TypeError("Work Rule title and body are required");
  const timestamp = nowIso(now);
  const id = `rule:user:${timestamp}:${current.rules.length + 1}`;
  return {
    ...current,
    updatedAt: timestamp,
    rules: [
      ...current.rules,
      {
        id,
        title,
        body,
        enabled: true,
        origin: "user",
        userEdited: true,
        userOverride: true,
        userConfirmed: true,
        overrideSource: "user",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

export function deleteWorkRule(state, ruleId, now = new Date()) {
  const current = normalizeWorkRulesState(state);
  const timestamp = nowIso(now);
  const existing = current.rules.find((rule) => rule.id === ruleId);
  if (!existing) return current;
  return {
    ...current,
    updatedAt: timestamp,
    deletedRuleIds: existing.origin === "starter"
      ? [...new Set([...current.deletedRuleIds, ruleId])].slice(-MAX_RULES)
      : current.deletedRuleIds,
    rules: current.rules.filter((rule) => rule.id !== ruleId),
  };
}

export function enabledWorkRulesContext(state) {
  const current = normalizeWorkRulesState(state);
  const rules = current.rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ id: rule.id, title: rule.title, body: rule.body }));
  return {
    version: WORK_RULES_VERSION,
    visibleRuleCount: current.rules.length,
    enabledRuleCount: rules.length,
    rules,
  };
}
