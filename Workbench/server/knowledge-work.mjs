const SCHEMA_VERSION = 1;

export const KNOWLEDGE_WORK_SCHEMA_VERSION = SCHEMA_VERSION;

export const KNOWLEDGE_WORK_KINDS = Object.freeze({
  CLASSIFY_SOURCE: "classify_source",
  REVIEW_JUDGMENT: "review_judgment",
  CONNECT_ISOLATED_KNOWLEDGE: "connect_isolated_knowledge",
  ADD_EVIDENCE: "add_evidence",
  REVIEW_KNOWLEDGE: "review_knowledge",
  REVIEW_RELATION: "review_relation",
});

const ALLOWED_KINDS = new Set(Object.values(KNOWLEDGE_WORK_KINDS));
const REVIEW_STATUSES = new Set([
  "needs-review",
  "needs_review",
  "pending-review",
  "pending_review",
  "review",
]);

function compactString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  if (Array.isArray(value)) return value.filter((item) => item != null);
  return value == null || value === "" ? [] : [value];
}

function isKnowledgeDocument(document) {
  return Boolean(
    document &&
      document.layer === "wiki" &&
      document.kind === "knowledge" &&
      document.extension === "md" &&
      !document.isArchived,
  );
}

function isClassifiableRaw(document, rawRoot) {
  if (!document || document.layer !== "raw" || document.isArchived) return false;
  const relativePath = compactString(document.path);
  if (!relativePath || !relativePath.startsWith(`${rawRoot}/`)) return false;
  if (relativePath.startsWith(`${rawRoot}/books/`)) return false;
  if (relativePath.startsWith(`${rawRoot}/social-insights/`)) return false;
  return !relativePath.split("/").some((segment) => segment.startsWith("."));
}

function resolvedOutgoingCount(document) {
  return list(document?.wikiLinks).filter((link) => compactString(link?.resolvedId)).length;
}

function sourceReference(document) {
  return {
    kind: "document",
    documentId: document.id,
    path: document.path,
    title: document.title,
    layer: document.layer,
    section: document.section ?? null,
    type: document.type ?? null,
  };
}

function stableItemId(kind, documentId) {
  return `kw:v${SCHEMA_VERSION}:${kind}:${documentId}`;
}

function workItem({ kind, document, title, reason, signals, metadata = {} }) {
  const item = {
    schemaVersion: SCHEMA_VERSION,
    id: stableItemId(kind, document.id),
    kind,
    state: "candidate",
    origin: "explicit_state",
    title,
    reason,
    source: sourceReference(document),
    signals,
    metadata,
  };
  validateKnowledgeWorkItem(item);
  return item;
}

function normalizedReviewDate(document) {
  const raw =
    document?.frontmatter?.review_after ??
    document?.frontmatter?.review_at ??
    document?.frontmatter?.next_review ??
    null;
  if (!raw) return null;
  const timestamp = Date.parse(String(raw));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function relationCandidates(document) {
  return list(
    document?.frontmatter?.relation_candidates ??
      document?.frontmatter?.relationship_candidates ??
      document?.frontmatter?.link_candidates,
  );
}

function sourcePaths(document) {
  return list(document?.frontmatter?.sources)
    .map((value) => compactString(value))
    .filter(Boolean);
}

function focusDocument(document) {
  if (!document) return null;
  return {
    id: document.id,
    path: document.path,
    title: document.title,
    layer: document.layer,
    section: document.section ?? null,
    type: document.type ?? null,
    status: document.status ?? null,
    domain: document.domain ?? null,
    topics: list(document.topics),
    contentKind: document.contentKind ?? null,
    updatedAt: document.updatedAt ?? null,
    excerpt: compactString(document.excerpt),
  };
}

function uniqueFocusDocuments(documents) {
  const seen = new Set();
  return documents
    .filter(Boolean)
    .filter((document) => {
      if (!document.id || seen.has(document.id)) return false;
      seen.add(document.id);
      return true;
    })
    .map(focusDocument);
}

export function validateKnowledgeWorkItem(item) {
  if (!item || typeof item !== "object") {
    throw new TypeError("Knowledge Work Item must be an object");
  }
  if (item.schemaVersion !== SCHEMA_VERSION) {
    throw new TypeError("Knowledge Work Item schemaVersion is invalid");
  }
  if (!ALLOWED_KINDS.has(item.kind)) {
    throw new TypeError("Knowledge Work Item kind is not allowed");
  }
  if (item.state !== "candidate") {
    throw new TypeError("Knowledge Work Item v1 only models derived candidates");
  }
  if (item.origin !== "explicit_state") {
    throw new TypeError("Knowledge Work Item v1 must come from explicit state");
  }
  if (!compactString(item.id) || !compactString(item.title) || !compactString(item.reason)) {
    throw new TypeError("Knowledge Work Item id, title, and reason are required");
  }
  if (
    item.source?.kind !== "document" ||
    !compactString(item.source.documentId) ||
    !compactString(item.source.path) ||
    !compactString(item.source.title) ||
    !["raw", "wiki"].includes(item.source.layer)
  ) {
    throw new TypeError("Knowledge Work Item must reference one real source or knowledge document");
  }
  if (!Array.isArray(item.signals) || item.signals.length === 0) {
    throw new TypeError("Knowledge Work Item requires at least one explicit signal");
  }
  for (const signal of item.signals) {
    if (!signal || !compactString(signal.code) || !compactString(signal.label)) {
      throw new TypeError("Knowledge Work Item signals must be explicit and labeled");
    }
  }
  return item;
}

/**
 * Build read-only Knowledge Work candidates from the current Vault index.
 *
 * This function intentionally does not rank, persist, complete, skip, or mutate
 * anything. P1.3.7 Today/Focus state is layered on top of these traceable
 * candidates and remains separate from Vault knowledge state.
 */
export function knowledgeWorkCandidates(index, { now = new Date() } = {}) {
  const documents = Array.isArray(index?.documents) ? index.documents : [];
  const rawRoot = compactString(index?.layout?.roots?.raw) || "10_raw";
  const byPath = new Map(documents.map((document) => [compactString(document.path), document]));
  const currentTime = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const items = [];

  for (const document of documents) {
    if (isClassifiableRaw(document, rawRoot)) {
      const missing = [
        !compactString(document.domain) ? { code: "missing_domain", label: "缺少领域分类" } : null,
        !compactString(document.contentKind)
          ? { code: "missing_content_kind", label: "缺少内容类型" }
          : null,
      ].filter(Boolean);
      if (missing.length > 0) {
        items.push(
          workItem({
            kind: KNOWLEDGE_WORK_KINDS.CLASSIFY_SOURCE,
            document,
            title: `补全来源分类：${document.title}`,
            reason: `该来源仍有 ${missing.length} 个显式分类字段未确认。`,
            signals: missing,
            metadata: { missingFields: missing.map((signal) => signal.code.replace("missing_", "")) },
          }),
        );
      }
    }

    if (!isKnowledgeDocument(document)) continue;

    const normalizedStatus = compactString(document.status).toLowerCase();
    if (REVIEW_STATUSES.has(normalizedStatus)) {
      items.push(
        workItem({
          kind: KNOWLEDGE_WORK_KINDS.REVIEW_JUDGMENT,
          document,
          title: `复核知识判断：${document.title}`,
          reason: "该知识对象的显式状态仍是待复核。",
          signals: [{ code: "needs_review_status", label: `状态：${document.status}` }],
          metadata: { status: document.status },
        }),
      );
    }

    const sources = sourcePaths(document);
    const resolvedSources = sources.filter((sourcePath) => byPath.has(sourcePath));
    if (sources.length === 0 || resolvedSources.length === 0) {
      const signal = sources.length === 0
        ? { code: "missing_source_evidence", label: "未登记来源证据" }
        : { code: "unresolved_source_evidence", label: "来源引用当前无法解析" };
      items.push(
        workItem({
          kind: KNOWLEDGE_WORK_KINDS.ADD_EVIDENCE,
          document,
          title: `补充证据：${document.title}`,
          reason:
            sources.length === 0
              ? "该知识对象没有显式来源引用。"
              : "该知识对象已有来源字段，但当前索引中没有可解析的来源对象。",
          signals: [signal],
          metadata: {
            declaredSourceCount: sources.length,
            resolvedSourceCount: resolvedSources.length,
          },
        }),
      );
    }

    const outgoing = resolvedOutgoingCount(document);
    const incoming = list(document.backlinks).length;
    if (outgoing === 0 && incoming === 0) {
      items.push(
        workItem({
          kind: KNOWLEDGE_WORK_KINDS.CONNECT_ISOLATED_KNOWLEDGE,
          document,
          title: `检查孤立知识：${document.title}`,
          reason: "该知识对象当前没有解析成功的显式双链或反向链接。",
          signals: [{ code: "isolated_graph_node", label: "显式关系数为 0" }],
          metadata: { outgoingResolved: 0, incomingResolved: 0 },
        }),
      );
    }

    const reviewAt = normalizedReviewDate(document);
    if (reviewAt && Number.isFinite(currentTime) && Date.parse(reviewAt) <= currentTime) {
      items.push(
        workItem({
          kind: KNOWLEDGE_WORK_KINDS.REVIEW_KNOWLEDGE,
          document,
          title: `复习知识：${document.title}`,
          reason: "该知识对象的显式复习日期已经到期。",
          signals: [{ code: "review_due", label: `复习日期：${reviewAt.slice(0, 10)}` }],
          metadata: { reviewAt },
        }),
      );
    }

    const candidates = relationCandidates(document);
    if (candidates.length > 0) {
      items.push(
        workItem({
          kind: KNOWLEDGE_WORK_KINDS.REVIEW_RELATION,
          document,
          title: `审核关系候选：${document.title}`,
          reason: `该知识对象有 ${candidates.length} 条显式关系候选等待人工判断。`,
          signals: [{ code: "relation_candidates_present", label: `${candidates.length} 条关系候选` }],
          metadata: { candidateCount: candidates.length },
        }),
      );
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: index?.generatedAt ?? null,
    total: items.length,
    items,
  };
}

/**
 * Revalidate one Work Item against the current index and assemble the minimum
 * real context required by Focus Workspace. Nothing here mutates Vault or
 * persists Workbench state.
 */
export function knowledgeWorkFocusContext(index, workItemId, { now = new Date() } = {}) {
  const id = compactString(workItemId);
  if (!id) return null;

  const candidates = knowledgeWorkCandidates(index, { now });
  const item = candidates.items.find((candidate) => candidate.id === id);
  if (!item) return null;

  const documents = Array.isArray(index?.documents) ? index.documents : [];
  const byId = new Map(documents.map((document) => [document.id, document]));
  const byPath = new Map(documents.map((document) => [compactString(document.path), document]));
  const primary = byId.get(item.source.documentId) ?? byPath.get(item.source.path) ?? null;
  if (!primary) return null;

  const declaredEvidencePaths = sourcePaths(primary);
  const resolvedEvidence = declaredEvidencePaths.map((relativePath) => byPath.get(relativePath));
  const unresolvedEvidence = declaredEvidencePaths.filter((relativePath) => !byPath.has(relativePath));

  const outgoing = list(primary.wikiLinks)
    .map((link) => byId.get(compactString(link?.resolvedId)))
    .filter((document) => isKnowledgeDocument(document));
  const incoming = list(primary.backlinks)
    .map((link) => byId.get(compactString(link?.id)))
    .filter((document) => isKnowledgeDocument(document));
  const relatedByEvidence = primary.layer === "raw"
    ? documents.filter(
        (document) =>
          isKnowledgeDocument(document) && sourcePaths(document).includes(primary.path),
      )
    : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: index?.generatedAt ?? null,
    readOnly: true,
    workItem: item,
    primary: focusDocument(primary),
    evidence: {
      resolved: uniqueFocusDocuments(resolvedEvidence),
      unresolvedPaths: unresolvedEvidence,
    },
    relatedKnowledge: uniqueFocusDocuments(relatedByEvidence),
    relations: {
      outgoing: uniqueFocusDocuments(outgoing).slice(0, 12),
      incoming: uniqueFocusDocuments(incoming).slice(0, 12),
      candidates: relationCandidates(primary).map((value) => String(value)).slice(0, 12),
    },
  };
}
