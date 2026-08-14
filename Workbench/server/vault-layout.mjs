import path from "node:path";

const FORMAL_WIKI_SECTIONS = new Set([
  "analyses",
  "cases",
  "comparisons",
  "concepts",
  "conflicts",
  "diagnoses",
  "frameworks",
  "questions",
  "sources",
  "topics",
]);

const LAYOUTS = Object.freeze({
  "dashboard-v1": Object.freeze({
    roots: Object.freeze({
      raw: "10_raw",
      candidate: null,
      wiki: "wiki",
      topics: "40_topics",
      scripts: "50_scripts",
      runs: "90_runs",
      selfMedia: "30_self_media",
    }),
    flatWiki: false,
    wikiIndexFiles: new Set(["index.md"]),
  }),
  "personal-ai-vault-v1": Object.freeze({
    roots: Object.freeze({
      raw: "04-来源资料",
      candidate: "05-候选知识",
      wiki: "06-正式知识",
      topics: "03-领域",
      scripts: "07-创作输出",
      runs: "08-智能体运行",
      selfMedia: null,
    }),
    flatWiki: true,
    wikiIndexFiles: new Set(["正式知识索引.md"]),
  }),
});

export class VaultLayoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VaultLayoutError";
    this.code = code;
  }
}

export function createVaultLayout(id = "dashboard-v1") {
  const spec = LAYOUTS[id];
  if (!spec) {
    throw new VaultLayoutError("UNKNOWN_VAULT_LAYOUT", `不支持的 Vault 布局：${id}`);
  }

  function root(layer) {
    return spec.roots[layer] ?? null;
  }

  function classify(relativePath) {
    const parts = String(relativePath).split("/");
    const top = parts[0] || "";
    const section = parts.length > 2 ? parts[1] : null;
    const fileName = path.posix.basename(relativePath);

    if (top === "Brainstorm") {
      const kind = relativePath === "Brainstorm/使用手册.md"
        ? "brainstorm-manual"
        : fileName === "brainstorm.md"
          ? "brainstorm-session"
          : fileName === "knowledge-delta.md"
            ? "knowledge-delta"
            : fileName === "wiki-writeback-plan.md"
              ? "wiki-writeback-plan"
              : "brainstorm-artifact";
      return { layer: "brainstorm", section, kind };
    }

    if (top === spec.roots.raw) {
      return { layer: "raw", section, kind: "material" };
    }
    if (spec.roots.candidate && top === spec.roots.candidate) {
      return {
        layer: "candidate",
        section,
        kind: fileName.includes("索引") ? "candidate-system" : "knowledge-candidate",
      };
    }
    if (top === spec.roots.topics) {
      return { layer: "topics", section, kind: "topic" };
    }
    if (top === spec.roots.scripts) {
      return { layer: "scripts", section, kind: "script" };
    }
    if (top === spec.roots.runs) {
      return { layer: "runs", section, kind: "run" };
    }
    if (top === spec.roots.wiki) {
      const kind = spec.wikiIndexFiles.has(fileName)
        ? "wiki-system"
        : spec.flatWiki || FORMAL_WIKI_SECTIONS.has(section)
          ? "knowledge"
          : section === "templates"
            ? "template"
            : section === "usage"
              ? "usage"
              : "wiki-system";
      return { layer: "wiki", section, kind };
    }
    return { layer: "other", section: top || null, kind: "file" };
  }

  function summary() {
    return { id, roots: { ...spec.roots } };
  }

  return Object.freeze({ id, root, classify, summary });
}
