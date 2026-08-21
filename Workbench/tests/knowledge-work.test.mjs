import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  KNOWLEDGE_WORK_KINDS,
  knowledgeWorkCandidates,
  knowledgeWorkFocusContext,
  validateKnowledgeWorkItem,
} from "../server/knowledge-work.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginSource = readFileSync(join(ROOT, "server", "vite-plugin-workbench.mjs"), "utf8");

function document(overrides = {}) {
  return {
    id: "doc-1",
    path: "wiki/concepts/example.md",
    title: "示例知识",
    extension: "md",
    layer: "wiki",
    kind: "knowledge",
    section: "concepts",
    type: "concept",
    status: "active",
    domain: "知识管理",
    contentKind: "concept",
    isArchived: false,
    frontmatter: { sources: ["10_raw/articles/source.md"] },
    wikiLinks: [{ resolvedId: "doc-2" }],
    backlinks: [],
    ...overrides,
  };
}

function index(documents) {
  return {
    generatedAt: "2026-08-17T00:00:00.000Z",
    layout: { roots: { raw: "10_raw" } },
    documents,
  };
}

test("derives only traceable knowledge-work candidates from explicit Vault state", () => {
  const source = document({
    id: "source-1",
    path: "10_raw/articles/source.md",
    title: "来源",
    layer: "raw",
    kind: "material",
    section: "articles",
    domain: null,
    contentKind: null,
    frontmatter: {},
    wikiLinks: [],
  });
  const knowledge = document({
    id: "wiki-1",
    status: "needs-review",
    frontmatter: {
      sources: [],
      review_after: "2026-08-16",
      relation_candidates: ["另一条知识"],
    },
    wikiLinks: [],
    backlinks: [],
  });

  const payload = knowledgeWorkCandidates(index([source, knowledge]), {
    now: new Date("2026-08-17T12:00:00.000Z"),
  });
  const kinds = new Set(payload.items.map((item) => item.kind));

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.total, 6);
  assert.deepEqual(kinds, new Set(Object.values(KNOWLEDGE_WORK_KINDS)));
  for (const item of payload.items) {
    assert.equal(item.origin, "explicit_state");
    assert.equal(item.state, "candidate");
    assert.equal(item.source.kind, "document");
    assert.ok(["source-1", "wiki-1"].includes(item.source.documentId));
    assert.doesNotThrow(() => validateKnowledgeWorkItem(item));
  }
});

test("does not turn ordinary files, archived knowledge, or healthy objects into tasks", () => {
  const healthySource = document({
    id: "source-healthy",
    path: "10_raw/articles/healthy.md",
    title: "已分类来源",
    layer: "raw",
    kind: "material",
    section: "articles",
    domain: "知识管理",
    contentKind: "article",
    frontmatter: {},
    wikiLinks: [],
  });
  const healthyKnowledge = document({
    id: "wiki-healthy",
    frontmatter: { sources: [healthySource.path] },
    wikiLinks: [{ resolvedId: "other-wiki" }],
  });
  const ordinaryFile = document({
    id: "ordinary",
    path: "notes/todo.md",
    title: "买牛奶",
    layer: "other",
    kind: "note",
    domain: null,
    contentKind: null,
    frontmatter: {},
    wikiLinks: [],
  });
  const archivedKnowledge = document({
    id: "archived",
    title: "旧知识",
    isArchived: true,
    frontmatter: { sources: [] },
    wikiLinks: [],
  });

  const payload = knowledgeWorkCandidates(
    index([healthySource, healthyKnowledge, ordinaryFile, archivedKnowledge]),
  );

  assert.equal(payload.total, 0);
});

test("keeps candidate identifiers stable across index rebuild timestamps", () => {
  const source = document({
    id: "source-stable",
    path: "10_raw/articles/stable.md",
    title: "待分类来源",
    layer: "raw",
    kind: "material",
    section: "articles",
    domain: null,
    contentKind: "article",
    frontmatter: {},
    wikiLinks: [],
  });
  const first = knowledgeWorkCandidates(index([source])).items[0];
  const rebuilt = {
    ...index([source]),
    generatedAt: "2026-08-18T00:00:00.000Z",
  };
  const second = knowledgeWorkCandidates(rebuilt).items[0];

  assert.equal(first.id, second.id);
  assert.match(first.id, /^kw:v1:classify_source:/);
});

test("rejects generic todo-shaped work that is not tied to a real Vault object", () => {
  assert.throws(
    () =>
      validateKnowledgeWorkItem({
        schemaVersion: 1,
        id: "todo-1",
        kind: "todo",
        state: "candidate",
        origin: "explicit_state",
        title: "买牛奶",
        reason: "普通生活任务",
        source: null,
        signals: [{ code: "manual", label: "手工输入" }],
      }),
    /kind is not allowed/,
  );
});

test("Focus context revalidates a current work item and returns only real evidence and explicit relations", () => {
  const source = document({
    id: "source-focus",
    path: "10_raw/articles/focus-source.md",
    title: "真实来源",
    layer: "raw",
    kind: "material",
    section: "articles",
    domain: "知识管理",
    contentKind: "article",
    frontmatter: {},
    wikiLinks: [],
  });
  const related = document({
    id: "wiki-related",
    path: "wiki/concepts/related.md",
    title: "相邻知识",
    frontmatter: { sources: [source.path] },
  });
  const target = document({
    id: "wiki-focus",
    path: "wiki/concepts/focus.md",
    title: "待复核知识",
    status: "needs-review",
    frontmatter: { sources: [source.path] },
    wikiLinks: [{ resolvedId: related.id }],
  });
  const vault = index([source, target, related]);
  const candidate = knowledgeWorkCandidates(vault).items.find(
    (item) => item.kind === KNOWLEDGE_WORK_KINDS.REVIEW_JUDGMENT && item.source.documentId === target.id,
  );
  const focus = knowledgeWorkFocusContext(vault, candidate.id);

  assert.equal(focus.readOnly, true);
  assert.equal(focus.primary.id, target.id);
  assert.deepEqual(focus.evidence.resolved.map((item) => item.id), [source.id]);
  assert.deepEqual(focus.relations.outgoing.map((item) => item.id), [related.id]);
  assert.equal(focus.workItem.id, candidate.id);
});

test("Focus context fails closed after the explicit work signal disappears", () => {
  const target = document({ id: "wiki-current", status: "needs-review" });
  const before = index([target]);
  const candidate = knowledgeWorkCandidates(before).items.find(
    (item) => item.kind === KNOWLEDGE_WORK_KINDS.REVIEW_JUDGMENT,
  );
  const after = index([{ ...target, status: "active" }]);
  assert.equal(knowledgeWorkFocusContext(after, candidate.id), null);
});

test("exposes Knowledge Work candidates through a read-only GET API", () => {
  assert.match(
    pluginSource,
    /req\.method === "GET" && url\.pathname === "\/api\/knowledge-work"/,
  );
  const route = pluginSource.match(
    /if \(req\.method === "GET" && url\.pathname === "\/api\/knowledge-work"\) \{([\s\S]*?)\n\s*\}/,
  );
  assert.ok(route, "knowledge-work route should exist");
  assert.match(route[1], /knowledgeWorkCandidates\(await currentIndex\(\)\)/);
  assert.doesNotMatch(route[1], /refresh|write|spawn|confirm|persist|save|unlink|rename/i);
});
