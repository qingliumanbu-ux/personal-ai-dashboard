import { createHash } from "node:crypto";
import path from "node:path";

const MATERIAL_ROOT = "10_raw";
const DISPLAY_NAMES = Object.freeze({
  articles: "文章",
  "codex-sessions": "Codex 活动",
  "deep-reading": "深度阅读",
  "diagnosis-cases": "诊断案例",
  douyin: "抖音资料",
  "my-thoughts": "我的想法",
  "personal-reviews": "个人复盘",
  podcasts: "播客",
  "user-questions": "用户问题",
  "web-search": "网页研究",
  weixin: "微信资料",
  youtube: "YouTube",
});

export class MaterialsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "MaterialsError";
    this.code = code;
    this.details = details;
  }
}

function folderId(relativePath) {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function materialRoot(index) {
  return index?.layout?.roots?.raw || MATERIAL_ROOT;
}

function normalizedFolderPath(value, root = MATERIAL_ROOT) {
  const input = String(value || root).normalize("NFC").trim();
  if (
    path.posix.isAbsolute(input) ||
    input.includes("\\") ||
    input.includes("\0") ||
    input.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    (input !== root && !input.startsWith(`${root}/`))
  ) {
    throw new MaterialsError("INVALID_MATERIAL_FOLDER", "素材目录路径无效。");
  }
  return input;
}

function displayNameFor(relativePath) {
  const name = path.posix.basename(relativePath);
  return DISPLAY_NAMES[name] || name;
}

function updatedTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortDocuments(items) {
  return [...items].sort((left, right) => {
    const dateDifference = updatedTime(right.updatedAt) - updatedTime(left.updatedAt);
    return dateDifference || left.title.localeCompare(right.title, "zh-CN");
  });
}

function countValues(items, readValues) {
  const counts = new Map();
  for (const item of items) {
    const values = readValues(item);
    for (const raw of Array.isArray(values) ? values : [values]) {
      const value = String(raw || "").trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "zh-CN"));
}

function classificationSummary(items) {
  const unclassifiedItems = items.filter((item) => !item.domain || !item.contentKind);
  const classified = items.length - unclassifiedItems.length;
  return {
    classified,
    unclassified: unclassifiedItems.length,
    coveragePct: items.length ? Math.round((classified / items.length) * 100) : 100,
    domains: countValues(items, (item) => item.domain),
    topics: countValues(items, (item) => item.topics || []),
    contentKinds: countValues(items, (item) => item.contentKind),
    useCases: countValues(items, (item) => item.useCases || []),
    sourceTypes: countValues(items, (item) => item.sourceType),
    audit: unclassifiedItems.slice(0, 100).map((item) => ({
      id: item.id,
      path: item.path,
      title: item.title,
      missing: [
        !item.domain ? "domain" : null,
        !item.contentKind ? "content_kind" : null,
      ].filter(Boolean),
      topicCandidates: (item.tags || []).slice(0, 12),
      currentDomain: item.domain || null,
      currentContentKind: item.contentKind || null,
    })),
  };
}

function p2AdmissionSummary(items) {
  const sourceTypes = countValues(items, (item) => item.sourceType || "未标注来源");
  const reviewedSummaryItems = items.filter((item) =>
    item.frontmatter?.summary_sha256 && item.frontmatter?.summary_source_sha256,
  );
  const classifiedItems = items.filter((item) => item.domain && item.contentKind);
  const reuseSignalItems = items.filter((item) =>
    item.isQueued || (Array.isArray(item.useCases) && item.useCases.length > 0),
  );

  const duplicateBuckets = new Map();
  for (const item of items) {
    const key = String(
      item.frontmatter?.summary_source_sha256 ||
      item.frontmatter?.source_sha256 ||
      item.frontmatter?.source_url ||
      "",
    ).trim();
    if (!key) continue;
    const bucket = duplicateBuckets.get(key) || [];
    bucket.push(item);
    duplicateBuckets.set(key, bucket);
  }
  const duplicateGroups = [...duplicateBuckets.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      count: group.length,
      items: group.slice(0, 8).map((item) => ({
        id: item.id,
        path: item.path,
        title: item.title,
      })),
    }));

  const snapshotFingerprint = createHash("sha256")
    .update(
      items
        .map((item) => [
          item.id,
          item.path,
          item.frontmatter?.summary_source_sha256 || item.frontmatter?.source_sha256 || item.frontmatter?.source_url || "",
          item.frontmatter?.summary_sha256 || "",
          item.domain || "",
          item.contentKind || "",
          Array.isArray(item.useCases) ? [...item.useCases].sort().join(",") : "",
          item.isQueued ? "queued" : "",
        ].join("\u001f"))
        .sort()
        .join("\u001e"),
      "utf8",
    )
    .digest("hex");

  const readyForDecision = items.length > 0;
  const recommendedForApproval =
    reviewedSummaryItems.length > 0 &&
    classifiedItems.length > 0 &&
    reuseSignalItems.length > 0;

  return {
    totalRaw: items.length,
    snapshotFingerprint,
    sourceTypes,
    reviewedSummaryCount: reviewedSummaryItems.length,
    classificationCompleteCount: classifiedItems.length,
    reuseSignalCount: reuseSignalItems.length,
    duplicateGroupCount: duplicateGroups.length,
    duplicateItemCount: duplicateGroups.reduce((sum, group) => sum + group.count, 0),
    duplicateGroups: duplicateGroups.slice(0, 20),
    readyForDecision,
    recommendedForApproval,
    userDecisionRequired: true,
    automaticApproval: false,
    checks: [
      {
        id: "real-raw",
        label: "已有真实来源资料可供评测",
        ready: items.length > 0,
        value: items.length,
      },
      {
        id: "reviewed-summary",
        label: "已有经过第一次审核的 AI 候选总结",
        ready: reviewedSummaryItems.length > 0,
        value: reviewedSummaryItems.length,
      },
      {
        id: "classification",
        label: "已有完成分类的来源资料",
        ready: classifiedItems.length > 0,
        value: classifiedItems.length,
      },
      {
        id: "reuse-signal",
        label: "已有明确复用信号（用途或待看）",
        ready: reuseSignalItems.length > 0,
        value: reuseSignalItems.length,
      },
    ],
  };
}

function queueMaps(readingState) {
  const byId = new Map();
  const byPath = new Map();
  for (const item of readingState?.items ?? []) {
    byId.set(item.documentId, item);
    byPath.set(item.relativePath, item);
  }
  return { byId, byPath };
}

function decorateDocument(document, maps) {
  const queue = maps.byId.get(document.id) ?? maps.byPath.get(document.path) ?? null;
  return {
    ...document,
    relativePath: document.path,
    isQueued: Boolean(queue),
    queuedAt: queue?.queuedAt ?? null,
    readingStateUpdatedAt: queue?.updatedAt ?? null,
  };
}

function rawDocuments(index, readingState) {
  const root = materialRoot(index);
  const maps = queueMaps(readingState);
  return (index?.documents ?? [])
    .filter(
      (item) =>
        item.layer === "raw" &&
        !item.path.startsWith(`${root}/books/`) &&
        !item.path.startsWith(`${root}/social-insights/`) &&
        !item.path.split("/").some((segment) => segment.startsWith(".")),
    )
    .map((item) => decorateDocument(item, maps));
}

function createFolder(relativePath, root = MATERIAL_ROOT) {
  return {
    id: folderId(relativePath),
    relativePath,
    name: path.posix.basename(relativePath),
    displayName: relativePath === root ? "素材" : displayNameFor(relativePath),
    parentPath: relativePath === root ? null : path.posix.dirname(relativePath),
    depth: relativePath === root ? 0 : relativePath.split("/").length - 1,
    directFiles: [],
    childPaths: new Set(),
    descendantFileCount: 0,
    queuedCount: 0,
    updatedAt: null,
  };
}

export function buildMaterialFolderIndex(index, readingState = { items: [] }) {
  const root = materialRoot(index);
  const documents = rawDocuments(index, readingState);
  const folders = new Map([[root, createFolder(root, root)]]);

  function ensureFolder(relativePath) {
    const normalized = normalizedFolderPath(relativePath, root);
    if (!folders.has(normalized)) folders.set(normalized, createFolder(normalized, root));
    return folders.get(normalized);
  }

  for (const document of documents) {
    const parentPath = path.posix.dirname(document.path);
    const relativeParts = parentPath === root
      ? []
      : parentPath.slice(`${root}/`.length).split("/");
    let currentPath = root;
    ensureFolder(currentPath);
    for (const part of relativeParts) {
      const nextPath = `${currentPath}/${part}`;
      ensureFolder(currentPath).childPaths.add(nextPath);
      ensureFolder(nextPath);
      currentPath = nextPath;
    }
    ensureFolder(parentPath).directFiles.push(document);

    let aggregatePath = parentPath;
    while (aggregatePath === root || aggregatePath.startsWith(`${root}/`)) {
      const folder = ensureFolder(aggregatePath);
      folder.descendantFileCount += 1;
      if (document.isQueued) folder.queuedCount += 1;
      if (updatedTime(document.updatedAt) > updatedTime(folder.updatedAt)) {
        folder.updatedAt = document.updatedAt;
      }
      if (aggregatePath === root) break;
      aggregatePath = path.posix.dirname(aggregatePath);
    }
  }

  const publicFolders = new Map();
  for (const [relativePath, folder] of folders) {
    publicFolders.set(relativePath, {
      id: folder.id,
      relativePath,
      name: folder.name,
      displayName: folder.displayName,
      parentPath: folder.parentPath,
      depth: folder.depth,
      directFileCount: folder.directFiles.length,
      descendantFileCount: folder.descendantFileCount,
      childFolderCount: folder.childPaths.size,
      queuedCount: folder.queuedCount,
      updatedAt: folder.updatedAt,
      childFolders: [...folder.childPaths]
        .map((childPath) => folders.get(childPath))
        .filter(Boolean)
        .map((child) => ({
          id: child.id,
          relativePath: child.relativePath,
          name: child.name,
          displayName: child.displayName,
          parentPath: child.parentPath,
          depth: child.depth,
          directFileCount: child.directFiles.length,
          descendantFileCount: child.descendantFileCount,
          childFolderCount: child.childPaths.size,
          queuedCount: child.queuedCount,
          updatedAt: child.updatedAt,
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN")),
      items: sortDocuments(folder.directFiles),
    });
  }

  return { documents, folders: publicFolders };
}

function queuePayload(folderIndex, readingState) {
  const byId = new Map(folderIndex.documents.map((item) => [item.id, item]));
  const byPath = new Map(folderIndex.documents.map((item) => [item.path, item]));
  return (readingState?.items ?? [])
    .map((queue) => {
      const document = byId.get(queue.documentId) ?? byPath.get(queue.relativePath) ?? null;
      return document
        ? { ...document, isQueued: true, queuedAt: queue.queuedAt, available: true }
        : {
            id: queue.documentId,
            path: queue.relativePath,
            relativePath: queue.relativePath,
            title: path.posix.basename(queue.relativePath, path.posix.extname(queue.relativePath)),
            previewKind: "unsupported",
            isQueued: true,
            queuedAt: queue.queuedAt,
            available: false,
          };
    })
    .sort((left, right) => updatedTime(right.queuedAt) - updatedTime(left.queuedAt));
}

export function materialsHomePayload(index, readingState = { items: [] }) {
  const rootPath = materialRoot(index);
  const folderIndex = buildMaterialFolderIndex(index, readingState);
  const root = folderIndex.folders.get(rootPath);
  const queue = queuePayload(folderIndex, readingState);
  return {
    generatedAt: index.generatedAt,
    root: {
      ...root,
      items: undefined,
    },
    folders: root?.childFolders ?? [],
    queue,
    queuePreview: queue.slice(0, 8),
    recent: sortDocuments(folderIndex.documents).slice(0, 12),
    items: sortDocuments(folderIndex.documents),
    classification: classificationSummary(folderIndex.documents),
    p2Admission: p2AdmissionSummary(folderIndex.documents),
    total: folderIndex.documents.length,
  };
}

export function materialFolderPayload(index, readingState, requestedPath) {
  const root = materialRoot(index);
  const relativePath = normalizedFolderPath(requestedPath, root);
  const folderIndex = buildMaterialFolderIndex(index, readingState);
  const folder = folderIndex.folders.get(relativePath);
  if (!folder) {
    throw new MaterialsError("MATERIAL_FOLDER_NOT_FOUND", "素材文件夹不存在或当前为空。");
  }
  const breadcrumbs = [];
  let cursor = relativePath;
  while (cursor === root || cursor.startsWith(`${root}/`)) {
    const item = folderIndex.folders.get(cursor) ?? createFolder(cursor, root);
    breadcrumbs.unshift({
      id: item.id,
      relativePath: cursor,
      displayName: item.displayName,
    });
    if (cursor === root) break;
    cursor = path.posix.dirname(cursor);
  }
  return {
    generatedAt: index.generatedAt,
    folder: {
      ...folder,
      items: undefined,
    },
    breadcrumbs,
    folders: folder.childFolders,
    items: folder.items,
  };
}

export function materialReadingQueuePayload(index, readingState = { items: [] }) {
  const folderIndex = buildMaterialFolderIndex(index, readingState);
  return {
    root: { relativePath: materialRoot(index) },
    updatedAt: readingState.updatedAt ?? null,
    total: readingState.items?.length ?? 0,
    items: queuePayload(folderIndex, readingState),
  };
}
