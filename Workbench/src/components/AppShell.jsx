import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  IconBrandTiktok,
  IconBooks,
  IconBulb,
  IconCalendarClock,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconHome,
  IconInbox,
  IconLibrary,
  IconListCheck,
  IconMenu2,
  IconRadar2,
  IconSearch,
  IconSettings,
  IconSocial,
  IconStack2,
  IconTopologyStar3,
  IconX,
} from "@tabler/icons-react";

const localWorkbench = import.meta.env.VITE_WORKBENCH_HOSTED !== "true";

const homeNavigation = { to: "/", label: "指挥中心", icon: IconHome, end: true };

const primaryNavigationGroups = [
  {
    label: "工作",
    items: [
      { to: "/today", label: "今日", icon: IconHome },
      { to: "/focus", label: "专注", icon: IconClock },
      { to: "/review", label: "复盘", icon: IconListCheck },
      { to: "/tomorrow", label: "明日计划", icon: IconCalendarClock },
    ],
  },
  {
    label: "知识",
    items: [
      ...(localWorkbench ? [{ to: "/ingestion", label: "入库", icon: IconInbox }] : []),
      { to: "/materials", label: "资料中心", icon: IconStack2 },
      { to: "/wiki", label: "知识库", icon: IconLibrary },
      { to: "/graph", label: "知识图谱", icon: IconTopologyStar3 },
    ],
  },
  {
    label: "系统",
    items: [{ to: "/system", label: "系统与设置", icon: IconSettings }],
  },
];

const secondaryNavigationGroups = [
  {
    label: "其他",
    items: [
      { to: "/topics", label: "主题与灵感", icon: IconBulb },
      { to: "/books", label: "书架", icon: IconBooks },
      { to: "/daily-hot", label: "每日热点", icon: IconRadar2 },
      ...(localWorkbench
        ? [{ to: "/social-insights", label: "社媒洞察", icon: IconSocial }]
        : []),
      { to: "/douyin", label: "抖音数据", icon: IconBrandTiktok },
    ],
  },
];

const routeLabels = [
  ["/today", "今日"],
  ["/focus", "专注"],
  ["/review", "复盘"],
  ["/tomorrow", "明日计划"],
  ["/rules", "工作规则"],
  ["/ingestion", "入库"],
  ["/materials", "资料中心"],
  ["/wiki", "知识库"],
  ["/graph", "知识图谱"],
  ["/topics", "主题与灵感"],
  ["/books", "书架"],
  ["/daily-hot", "每日热点"],
  ["/content", "内容中心"],
  ["/social-insights", "社媒洞察"],
  ["/douyin", "抖音数据"],
  ["/system", "系统与设置"],
];

function routeLabel(pathname) {
  if (pathname === "/") return "指挥中心";
  return routeLabels.find(([prefix]) => pathname.startsWith(prefix))?.[1] || "指挥中心";
}

export function AppShell({ children, onOpenSearch, sync }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const location = useLocation();
  const currentView = routeLabel(location.pathname);
  const immersiveHome = location.pathname === "/";

  useEffect(() => {
    const activeGroup = secondaryNavigationGroups.find((group) =>
      group.items.some((item) => location.pathname.startsWith(item.to)),
    );
    if (!activeGroup) return;
    setExpandedGroups((current) => {
      if (current.has(activeGroup.label)) return current;
      const next = new Set(current);
      next.add(activeGroup.label);
      return next;
    });
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const expandForMobile = () => {
      if (media.matches) setSidebarCollapsed(false);
    };
    expandForMobile();
    media.addEventListener?.("change", expandForMobile);
    return () => media.removeEventListener?.("change", expandForMobile);
  }, []);

  return (
    <div className={`app-shell${sidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}${immersiveHome ? " app-shell--command" : ""}`}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="mobile-header">
        <button
          aria-label="打开导航"
          className="icon-button"
          onClick={() => setMobileOpen(true)}
          type="button"
        >
          <IconMenu2 aria-hidden="true" />
        </button>
        <span className="mobile-header__brand">
          <span aria-hidden="true" className="mobile-header__mark">W</span>
          <span>个人 AI</span>
        </span>
        <button
          aria-label="搜索"
          className="icon-button"
          onClick={onOpenSearch}
          type="button"
        >
          <IconSearch aria-hidden="true" />
        </button>
      </header>

      {mobileOpen ? (
        <button
          aria-label="关闭导航"
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      ) : null}

      <aside className={`sidebar${mobileOpen ? " sidebar--open" : ""}`}>
        <div className="sidebar__top">
          <div className="sidebar__brand-row">
            <NavLink className="sidebar__brand" onClick={() => setMobileOpen(false)} title={sidebarCollapsed ? "指挥中心" : undefined} to="/">
              <span aria-hidden="true" className="sidebar__brand-mark">W</span>
              <span className="sidebar__brand-copy"><strong>个人 AI</strong><small>知识工作台</small></span>
            </NavLink>
            <button
              aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              className="icon-button sidebar__collapse"
              onClick={() => setSidebarCollapsed((value) => !value)}
              title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              type="button"
            >
              {sidebarCollapsed ? <IconChevronRight aria-hidden="true" /> : <IconChevronLeft aria-hidden="true" />}
            </button>
            <button
              aria-label="关闭导航"
              className="icon-button sidebar__close"
              onClick={() => setMobileOpen(false)}
              type="button"
            >
              <IconX aria-hidden="true" />
            </button>
          </div>

          <button className="sidebar-search" onClick={onOpenSearch} title={sidebarCollapsed ? "搜索" : undefined} type="button">
            <IconSearch aria-hidden="true" stroke={1.7} />
            <span>搜索</span>
            <kbd>⌘ K</kbd>
          </button>

          <nav aria-label="主要导航" className="sidebar__nav">
            <div className="sidebar__nav-group sidebar__nav-group--core">
              <NavLink
                className={({ isActive }) =>
                  `sidebar__nav-item${isActive ? " sidebar__nav-item--active" : ""}`
                }
                end
                onClick={() => setMobileOpen(false)}
                title={sidebarCollapsed ? homeNavigation.label : undefined}
                to={homeNavigation.to}
              >
                <homeNavigation.icon aria-hidden="true" className="sidebar__nav-icon" stroke={1.7} />
                <span>{homeNavigation.label}</span>
              </NavLink>
            </div>

            {primaryNavigationGroups.map((group) => (
              <div className="sidebar__nav-group sidebar__nav-group--core" key={group.label}>
                <span className="sidebar__nav-label">{group.label}</span>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      className={({ isActive }) =>
                        `sidebar__nav-item${isActive ? " sidebar__nav-item--active" : ""}`
                      }
                      key={item.to}
                      onClick={() => setMobileOpen(false)}
                      title={sidebarCollapsed ? item.label : undefined}
                      to={item.to}
                    >
                      <Icon aria-hidden="true" className="sidebar__nav-icon" stroke={1.7} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            ))}

            <div className="sidebar__secondary">
              {secondaryNavigationGroups.map((group) => {
                const expanded = expandedGroups.has(group.label);
                const groupId = `sidebar-group-${group.label}`;
                return (
                  <div className="sidebar__nav-group sidebar__nav-group--secondary" key={group.label}>
                    <button
                      aria-controls={groupId}
                      aria-expanded={expanded}
                      className="sidebar__nav-toggle"
                      onClick={() => {
                        setExpandedGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.label)) next.delete(group.label);
                          else next.add(group.label);
                          return next;
                        });
                      }}
                      type="button"
                    >
                      <span>{group.label}</span>
                      <IconChevronDown aria-hidden="true" className={expanded ? "is-open" : ""} />
                    </button>
                    <div className="sidebar__nav-items" hidden={!expanded} id={groupId}>
                      {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      className={({ isActive }) =>
                        `sidebar__nav-item${isActive ? " sidebar__nav-item--active" : ""}`
                      }
                      end={item.end}
                      key={item.to}
                      onClick={() => setMobileOpen(false)}
                      to={item.to}
                    >
                      <Icon aria-hidden="true" className="sidebar__nav-icon" stroke={1.7} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>
        </div>

        <div className="sidebar__bottom">
          <div className={`sidebar__sync sidebar__sync--${sync?.status || "connecting"}`}>
            <span aria-hidden="true" />
            <span>{sync?.status === "watching" ? "文件已实时同步" : sync?.status === "rebuilding" || sync?.status === "pending" ? "正在同步文件" : "正在连接文件同步"}</span>
          </div>
        </div>
      </aside>

      <div className={`workspace-frame${immersiveHome ? " workspace-frame--command" : ""}`}>
        <header className={`workspace-bar${immersiveHome ? " workspace-bar--command" : ""}`}>
          <div className="workspace-bar__context">
            <strong>个人 AI 工作台</strong>
            <span>/</span>
            <span>{currentView}</span>
          </div>
          <button className="workspace-bar__search" onClick={onOpenSearch} type="button">
            <IconSearch aria-hidden="true" stroke={1.7} />
            <span>搜索、打开或执行命令</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className={`workspace-bar__sync workspace-bar__sync--${sync?.status || "connecting"}`}>
            <span aria-hidden="true" />
            <span>{sync?.status === "watching" ? "本地同步" : sync?.status === "rebuilding" || sync?.status === "pending" ? "同步中" : "连接中"}</span>
          </div>
        </header>
        <main className={`app-main${immersiveHome ? " app-main--command" : ""}`} id="main-content">{children}</main>
      </div>
    </div>
  );
}
