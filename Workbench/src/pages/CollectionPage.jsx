import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { PageHeader } from "../components/PageHeader";
import { loadCollection } from "../lib/api";
import { collectionItemMatchesGroup } from "../lib/collection-filter";
import { formatCompactDate, statusLabel } from "../lib/format";

export function CollectionPage({
  kind,
  eyebrow,
  title,
  description,
  onOpenDocument,
}) {
  const [result, setResult] = useState({ data: null, source: "loading", error: null });
  const [selectedGroup, setSelectedGroup] = useState(null);
  const groupRefs = useRef({});

  useEffect(() => {
    let cancelled = false;
    loadCollection(kind).then((response) => {
      if (!cancelled) setResult(response);
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // GSAP count animation on mount
  useEffect(() => {
    if (result.source !== "loading" && result.data?.groups) {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      result.data.groups.forEach((group) => {
        const el = groupRefs.current[group.key];
        if (el && !prefersReducedMotion) {
          gsap.fromTo(
            el,
            { textContent: 0 },
            {
              textContent: group.count,
              duration: 1.2,
              ease: "power2.out",
              snap: { textContent: 1 },
              onUpdate: function () {
                el.textContent = Math.round(this.targets()[0].textContent);
              },
            }
          );
        }
      });
    }
  }, [result.data?.groups, result.source]);

  const isLoading = result.source === "loading";
  const hasError = result.error && !result.data;
  const groups = result.data?.groups ?? [];
  const allItems = result.data?.items ?? [];
  const total = result.data?.total ?? allItems.length;
  const selectedGroupMeta = groups.find((group) => group.key === selectedGroup) ?? null;
  const isKnowledge = kind === "wiki";

  // Filter logic
  const filteredItems = selectedGroup
    ? allItems.filter((item) =>
        collectionItemMatchesGroup(kind, item, selectedGroup))
    : allItems;

  // Sort by updatedAt descending
  const sortedItems = [...filteredItems].sort((a, b) => {
    const dateA = new Date(a.updatedAt || 0);
    const dateB = new Date(b.updatedAt || 0);
    return dateB - dateA;
  });

  // Limit to 80 items
  const displayItems = sortedItems.slice(0, 80);
  const remainingCount = sortedItems.length - displayItems.length;
  const atlasItems = allItems.slice(0, 5);
  const useKnowledgeDossiers = isKnowledge && displayItems.length > 0 && displayItems.length <= 4;

  const handleGroupClick = (key) => {
    setSelectedGroup(selectedGroup === key ? null : key);
  };

  const getSubtitle = (item) => {
    if (item.path) {
      const parts = item.path.split("/");
      if (parts.length > 1) {
        return parts[parts.length - 2] + "/";
      }
    }
    if (item.section) {
      const tagsPart = item.tags?.slice(0, 2).join(", ") || "";
      return tagsPart ? `${item.section} · ${tagsPart}` : item.section;
    }
    return item.tags?.slice(0, 2).join(", ") || "";
  };

  const updateAtlasPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty("--atlas-x", `${x.toFixed(1)}%`);
    event.currentTarget.style.setProperty("--atlas-y", `${y.toFixed(1)}%`);
  };

  return (
    <div className={`page page--collection${isKnowledge ? " page--knowledge-atlas" : ""}`}>
      {isKnowledge ? (
        <motion.section
          animate={{ opacity: 1, y: 0 }}
          className="knowledge-atlas-hero"
          initial={{ opacity: 0, y: 10 }}
          onPointerMove={updateAtlasPointer}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="knowledge-atlas-hero__copy">
            <div className="knowledge-atlas-hero__kicker mono">
              <span aria-hidden="true" />
              知识 / 知识库
            </div>
            <h1>知识库</h1>
            <p>{description}</p>
            <div className="knowledge-atlas-hero__facts">
              <div><strong>{isLoading ? "—" : total}</strong><span>知识对象</span></div>
              <div><strong>{groups.length}</strong><span>知识结构</span></div>
              <div><strong>{sortedItems[0]?.updatedAt ? formatCompactDate(sortedItems[0].updatedAt, false) : "—"}</strong><span>最近更新</span></div>
            </div>
          </div>

          <div className="memory-constellation" aria-label={`当前知识库包含 ${total} 个知识对象`} role="img">
            <div className="memory-constellation__glow" />
            <div className="memory-constellation__orbit memory-constellation__orbit--outer" />
            <div className="memory-constellation__orbit memory-constellation__orbit--inner" />
            <div className="memory-constellation__core">
              <strong>{total}</strong>
              <span>{total <= 1 ? "知识起点" : "知识对象"}</span>
            </div>
            {atlasItems.map((item, index) => (
              <span className={`memory-constellation__node memory-constellation__node--${index + 1}`} key={item.id}>
                <i aria-hidden="true" />
                <em>{item.title}</em>
              </span>
            ))}
            <span className="memory-constellation__caption">真实知识对象</span>
          </div>
        </motion.section>
      ) : (
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          aside={
            <div className="collection-count">
              {isLoading ? "…" : `${total} 项`}
            </div>
          }
        />
      )}

      <div className={`collection-workspace${groups.length === 0 ? " collection-workspace--single" : ""}`}>
        {groups.length > 0 ? (
          <aside className="collection-index" aria-label="知识类型索引">
            <div className="collection-index__head">
              <div>
                <span className="eyebrow">知识索引</span>
                <h2>知识结构</h2>
              </div>
              <span className="collection-index__meta mono">{groups.length} 组</span>
            </div>

            <div className="collection-index__pulse">
              <span className="mono">当前知识</span>
              <strong>{total}</strong>
              <small>{selectedGroupMeta?.label || "全部知识对象"}</small>
            </div>

            <div className="collection-groups">
              <button
                type="button"
                className={`group-card${selectedGroup === null ? " group-card--on" : ""}`}
                onClick={() => setSelectedGroup(null)}
              >
                <div className="group-card__count">{total}</div>
                <div className="group-card__body">
                  <div className="group-card__label">全部知识</div>
                  <div className="group-card__desc">完整知识层索引</div>
                </div>
              </button>
              {groups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  className={`group-card${selectedGroup === group.key ? " group-card--on" : ""}`}
                  onClick={() => handleGroupClick(group.key)}
                >
                  <div
                    ref={(el) => {
                      if (el) groupRefs.current[group.key] = el;
                    }}
                    className="group-card__count"
                  >
                    {group.count}
                  </div>
                  <div className="group-card__body">
                    <div className="group-card__label">{group.label}</div>
                    {group.description ? (
                      <div className="group-card__desc">{group.description}</div>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </aside>
        ) : null}

        <div className="collection-workspace__surface">
          {isLoading ? (
            <div className="collection-loading">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : null}

          {hasError ? (
            <div className="error-note">
              加载失败：{result.error?.message || "未知错误"}
            </div>
          ) : null}

          {!isLoading && !hasError ? (
            <>
              {displayItems.length > 0 ? (
                <section className="collection-list">
                  <div className="collection-list__head">
                    <div>
                      <span className="eyebrow">知识索引</span>
                      <strong>{selectedGroupMeta?.label || "全部知识"}</strong>
                    </div>
                    <span className="mono">{sortedItems.length} 项 · 最近更新优先</span>
                  </div>
                  {useKnowledgeDossiers ? (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      className="knowledge-dossiers"
                      initial={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.28 }}
                    >
                      {displayItems.map((item) => (
                        <button className="knowledge-dossier" key={item.id} onClick={() => onOpenDocument(item)} type="button">
                          <div className="knowledge-dossier__index mono">{statusLabel(item.status).toUpperCase()} / LOCAL MEMORY</div>
                          <div className="knowledge-dossier__type mono">{item.type || item.section || "KNOWLEDGE"}</div>
                          <h3>{item.title}</h3>
                          <p>{getSubtitle(item) || "已进入长期知识层，可继续补充关系、证据与应用场景。"}</p>
                          <div className="knowledge-dossier__meta">
                            <span>{statusLabel(item.status)}</span>
                            <span>{formatCompactDate(item.updatedAt, false)} 更新</span>
                          </div>
                          {(item.tags || []).length > 0 ? (
                            <div className="knowledge-dossier__tags">
                              {item.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                            </div>
                          ) : null}
                          <span className="knowledge-dossier__open">打开知识 <b aria-hidden="true">↗</b></span>
                        </button>
                      ))}
                    </motion.div>
                  ) : (
                    <motion.div
                      className="doc-table"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="doc-table__head" aria-hidden="true">
                        <span>文档</span>
                        <span>类型</span>
                        <span>状态</span>
                        <span>更新</span>
                      </div>
                      {displayItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="doc-row"
                          onClick={() => onOpenDocument(item)}
                        >
                          <div>
                            <div className="doc-row__title">{item.title}</div>
                            <div className="doc-row__sub">{getSubtitle(item)}</div>
                          </div>
                          <div className="doc-row__cell">
                            {item.type || item.section || "—"}
                          </div>
                          <div className="doc-row__cell">
                            {statusLabel(item.status)}
                          </div>
                          <div className="doc-row__date">
                            {formatCompactDate(item.updatedAt, false)}
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </section>
              ) : (
                <div className="collection-empty">这一层还没有内容</div>
              )}

              {remainingCount > 0 ? (
                <div className="collection-empty collection-empty--more">
                  还有 {remainingCount} 条，用 ⌘K 搜索定位
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
