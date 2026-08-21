import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const AI_PROVIDER_SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_AI_PROVIDER_SETTINGS = Object.freeze({
  schemaVersion: AI_PROVIDER_SETTINGS_SCHEMA_VERSION,
  summary: Object.freeze({ provider: "codex_cli", model: "default" }),
  knowledge: Object.freeze({ provider: "codex_cli", model: "default" }),
});

export const AI_PROVIDER_OPTIONS = Object.freeze([
  Object.freeze({
    id: "codex_cli",
    label: "Codex CLI",
    available: true,
    supports: Object.freeze(["summary", "knowledge"]),
    description: "调用本机已安装并已认证的 Codex CLI。",
  }),
  Object.freeze({
    id: "manual",
    label: "人工模式",
    available: true,
    supports: Object.freeze(["summary", "knowledge"]),
    description: "不调用模型；第一次总结可人工补录，第二次提炼可人工填写结构化方案。正式 Wiki 写入仍保持独立确认边界。",
  }),
  Object.freeze({
    id: "openai_api",
    label: "OpenAI API",
    available: false,
    supports: Object.freeze(["summary", "knowledge"]),
    description: "预留 Provider；当前尚未接入。",
  }),
  Object.freeze({
    id: "local",
    label: "本地模型",
    available: false,
    supports: Object.freeze(["summary", "knowledge"]),
    description: "预留 Ollama / llama.cpp / Qwen 等本地 Provider；当前尚未接入。",
  }),
]);

const PROVIDER_BY_ID = new Map(AI_PROVIDER_OPTIONS.map((provider) => [provider.id, provider]));
const MAX_MODEL_ID_LENGTH = 160;

export class AiProviderSettingsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AiProviderSettingsError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new AiProviderSettingsError(code, message, details);
}

function normalizeProvider(value, field, task) {
  const provider = String(value ?? "").trim();
  const option = PROVIDER_BY_ID.get(provider);
  if (!option?.available || !option.supports.includes(task)) {
    fail(
      "AI_PROVIDER_UNSUPPORTED",
      `${field} Provider 当前不可用：${provider || "未指定"}。`,
      {
        provider,
        task,
        availableProviders: AI_PROVIDER_OPTIONS
          .filter((item) => item.available && item.supports.includes(task))
          .map((item) => item.id),
      },
    );
  }
  return provider;
}

function normalizeModel(value, field) {
  const model = String(value ?? "default").trim() || "default";
  if (model.length > MAX_MODEL_ID_LENGTH) {
    fail("AI_MODEL_INVALID", `${field}模型名称过长。`);
  }
  if (/\0|[\r\n]/.test(model) || model.startsWith("-")) {
    fail("AI_MODEL_INVALID", `${field}模型名称包含不允许的字符。`);
  }
  return model;
}

function normalizeTask(value, field, task) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("AI_SETTINGS_INVALID", `${field}配置必须是对象。`);
  }
  const allowed = new Set(["provider", "model"]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    fail("AI_SETTINGS_INVALID", `${field}配置包含不允许的字段：${unexpected.join("、")}。`);
  }
  const provider = normalizeProvider(value.provider, field, task);
  return {
    provider,
    model: provider === "manual" ? "none" : normalizeModel(value.model, field),
  };
}

export function validateAiProviderSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("AI_SETTINGS_INVALID", "AI Provider 配置必须是对象。");
  }
  const allowed = new Set(["schemaVersion", "summary", "knowledge"]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    fail("AI_SETTINGS_INVALID", `AI Provider 配置包含不允许的字段：${unexpected.join("、")}。`);
  }
  const schemaVersion = Number(value.schemaVersion ?? AI_PROVIDER_SETTINGS_SCHEMA_VERSION);
  if (schemaVersion !== AI_PROVIDER_SETTINGS_SCHEMA_VERSION) {
    fail(
      "AI_SETTINGS_VERSION_UNSUPPORTED",
      `AI Provider 配置只支持 schemaVersion ${AI_PROVIDER_SETTINGS_SCHEMA_VERSION}。`,
    );
  }
  return {
    schemaVersion: AI_PROVIDER_SETTINGS_SCHEMA_VERSION,
    summary: normalizeTask(value.summary, "第一次资料总结", "summary"),
    knowledge: normalizeTask(value.knowledge, "第二次知识提炼", "knowledge"),
  };
}

function cloneDefaultSettings() {
  return {
    schemaVersion: DEFAULT_AI_PROVIDER_SETTINGS.schemaVersion,
    summary: { ...DEFAULT_AI_PROVIDER_SETTINGS.summary },
    knowledge: { ...DEFAULT_AI_PROVIDER_SETTINGS.knowledge },
  };
}

function publicPayload(settings, source) {
  return {
    ...settings,
    summary: { ...settings.summary },
    knowledge: { ...settings.knowledge },
    source,
    providers: AI_PROVIDER_OPTIONS.map((provider) => ({
      ...provider,
      supports: [...provider.supports],
    })),
  };
}

export function createAiProviderSettingsRepository({
  root = process.cwd(),
  filePath = path.join(path.resolve(root), "config", "ai-provider.local.json"),
} = {}) {
  const resolvedFilePath = path.resolve(filePath);
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const raw = await readFile(resolvedFilePath, "utf8");
      const parsed = JSON.parse(raw);
      return publicPayload(validateAiProviderSettings(parsed), "local");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return publicPayload(cloneDefaultSettings(), "default");
      }
      if (error instanceof AiProviderSettingsError) throw error;
      if (error instanceof SyntaxError) {
        fail("AI_SETTINGS_INVALID_JSON", "本地 AI Provider 配置不是有效 JSON。");
      }
      throw error;
    }
  }

  function save(value) {
    const operation = async () => {
      const validated = validateAiProviderSettings(value);
      await mkdir(path.dirname(resolvedFilePath), { recursive: true });
      const temporaryPath = `${resolvedFilePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      await rename(temporaryPath, resolvedFilePath);
      return publicPayload(validated, "local");
    };
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => {});
    return result;
  }

  return Object.freeze({
    filePath: resolvedFilePath,
    load,
    save,
  });
}
