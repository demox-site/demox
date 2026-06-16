import React, { useEffect, useState } from "react";
import {
  Outlet,
  useNavigate,
  useLocation,
  Navigate
} from "react-router-dom";
import { authApi, websiteApi, userManager, isLoggedIn } from "@/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLanguage } from "@/hooks/use-language";
import logo from "@/assets/logo.svg";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Languages,
  User,
  LogOut,
  LayoutDashboard,
  Globe,
  Settings,
  KeyRound,
  Gauge,
  ShieldCheck,
  UploadCloud,
  FolderKanban,
  ArrowLeft
} from "lucide-react";

const navTexts = {
  zh: {
    groupConsole: "控制台",
    groupProject: "项目",
    groupAccount: "账户",
    groupGlobal: "全局",
    projects: "项目",
    deploy: "部署新项目",
    sites: "我的站点",
    usage: "用量套餐",
    tokens: "访问令牌",
    settings: "账号设置",
    admin: "管理后台",
    adminDashboard: "数据概览",
    adminRoles: "用户角色配置",
    adminRoleLimits: "角色列表",
    adminBuckets: "存储桶",
    currentProject: "当前项目",
    projectSelect: "切换项目",
    noProjects: "暂无项目",
    logout: "退出登录",
    backHome: "返回首页",
    backMainMenu: "返回主菜单"
  },
  en: {
    groupConsole: "Console",
    groupProject: "Project",
    groupAccount: "Account",
    groupGlobal: "Global",
    projects: "Projects",
    deploy: "Deploy New Project",
    sites: "My Sites",
    usage: "Usage & Plan",
    tokens: "Access Tokens",
    settings: "Settings",
    admin: "Admin",
    adminDashboard: "Dashboard",
    adminRoles: "User Roles",
    adminRoleLimits: "Roles",
    adminBuckets: "Storage Buckets",
    currentProject: "Current Project",
    projectSelect: "Switch project",
    noProjects: "No projects",
    logout: "Log out",
    backHome: "Home",
    backMainMenu: "Back to menu"
  }
} as const;

const maskEmail = (email: string) => {
  if (!email) return "";
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  const maskedName =
    name.length > 2 ? `${name.slice(0, 2)}...${name.slice(-1)}` : name;
  return `${maskedName}@${domain}`;
};

interface NavItem {
  key: string;
  path: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  adminOnly?: boolean;
}

interface ConsoleUser {
  userId?: string;
  email?: string;
  nickname?: string;
  githubId?: string | null;
  githubLogin?: string | null;
  avatarUrl?: string | null;
  roles?: string[];
}

interface ConsoleProject {
  id: string;
  name: string;
  slug?: string;
  role?: string | null;
  ownerUserId?: string | null;
  websitesCount?: number;
  archived?: boolean;
}

const normalizeProject = (project: any): ConsoleProject => ({
  id: String(project?.id || project?._id || ""),
  name: project?.name || "default",
  slug: project?.slug || "default",
  role: project?.role || project?.projectRole || null,
  ownerUserId: project?.ownerUserId || project?.userId || null,
  websitesCount: Number(project?.websitesCount || project?.websites_count || 0),
  archived: !!project?.archived
});

export const ConsoleLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language: lang, toggleLanguage: toggleLang } = useLanguage();
  const [user, setUser] = useState<ConsoleUser | null>(() => userManager.get());
  const [projects, setProjects] = useState<ConsoleProject[]>([]);
  const t = navTexts[lang];

  useEffect(() => {
    setUser(userManager.get());
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) return;
    let alive = true;
    authApi
      .getCurrentUser()
      .then((res) => {
        if (!alive || !res?.success || !res.user) return;
        const local = userManager.get() || {};
        const nextUser = {
          ...local,
          userId: res.user.id || local.userId,
          email: res.user.email || local.email,
          nickname: res.user.nickname || "",
          githubId: res.user.githubId || null,
          githubLogin: res.user.githubLogin || null,
          avatarUrl: res.user.avatarUrl || null,
          roles: res.user.roles || local.roles || ["user"]
        };
        userManager.set(nextUser);
        setUser(nextUser);
      })
      .catch((error) => {
        console.warn("Load console user failed:", error);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) return;
    let alive = true;
    websiteApi
      .listProjects()
      .then((res) => {
        if (!alive || !res?.success) return;
        setProjects((res.projects || []).map(normalizeProject).filter((p) => p.id));
      })
      .catch((error) => {
        console.warn("Load console projects failed:", error);
      });
    return () => {
      alive = false;
    };
  }, [location.pathname]);

  if (!isLoggedIn()) {
    return <Navigate to="/index" replace />;
  }

  const isAdmin = (user?.roles || []).includes("admin");
  const displayName = user?.nickname?.trim() || "User";
  const avatarLabel = (user?.nickname?.trim()?.[0] || user?.email?.[0] || "").toUpperCase();

  const handleLogout = () => {
    authApi.logout();
    setUser(null);
    navigate("/index");
  };

  const projectMatch = location.pathname.match(
    /^\/console\/projects\/([^/]+)\/(deploy|sites)(?:\/|$)/
  );
  const currentProjectId = projectMatch?.[1] || "";
  const currentProjectSection = projectMatch?.[2] || "sites";
  const inProjectWorkspace = !!currentProjectId;

  const consoleNav: NavItem[] = [
    { key: "projects", path: "/console/projects", label: t.projects, icon: FolderKanban },
    { key: "usage", path: "/console/usage", label: t.usage, icon: Gauge },
    { key: "tokens", path: "/console/tokens", label: t.tokens, icon: KeyRound }
  ];

  const projectNav: NavItem[] = currentProjectId
    ? [
        {
          key: "deploy",
          path: `/console/projects/${currentProjectId}/deploy`,
          label: t.deploy,
          icon: UploadCloud
        },
        {
          key: "sites",
          path: `/console/projects/${currentProjectId}/sites`,
          label: t.sites,
          icon: Globe
        }
      ]
    : [];

  const accountNav: NavItem[] = [
    {
      key: "settings",
      path: "/console/settings",
      label: t.settings,
      icon: Settings
    }
  ];

  // 管理后台二级菜单(真实二级路由 /console/admin/:section)
  const adminSubNav = [
    { key: "dashboard", path: "/console/admin/dashboard", label: t.adminDashboard },
    { key: "roles", path: "/console/admin/roles", label: t.adminRoles },
    { key: "roleLimits", path: "/console/admin/roleLimits", label: t.adminRoleLimits },
    { key: "buckets", path: "/console/admin/buckets", label: t.adminBuckets }
  ];

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  const onAdminPage = location.pathname.startsWith("/console/admin");

  const handleSwitchProject = (projectId: string) => {
    if (!projectId || projectId === currentProjectId) return;
    navigate(`/console/projects/${projectId}/${currentProjectSection}`);
  };

  const renderItem = (item: NavItem) => {
    if (item.adminOnly && !isAdmin) return null;
    const Icon = item.icon;
    const active = item.key === "backMainMenu" ? false : isActive(item.path);
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton
          isActive={active}
          onClick={() => navigate(item.path)}
          tooltip={item.label}
        >
          <Icon size={16} />
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const renderAdminNav = () => {
    if (!isAdmin) return null;
    // 在管理后台页时总有一个二级项被选中，故一级仅作分组标题、不再抢高亮，
    // 避免一级与当前二级项同时高亮造成“选中停在一级”的错觉。
    const anySubActive = adminSubNav.some((s) => isActive(s.path));
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={onAdminPage && !anySubActive}
          onClick={() => navigate("/console/admin/dashboard")}
          tooltip={t.admin}
        >
          <ShieldCheck size={16} />
          <span>{t.admin}</span>
        </SidebarMenuButton>
        {onAdminPage && (
          <SidebarMenuSub>
            {adminSubNav.map((s) => (
              <SidebarMenuSubItem key={s.key}>
                <SidebarMenuSubButton
                  isActive={isActive(s.path)}
                  onClick={() => navigate(s.path)}
                  className="cursor-pointer"
                >
                  <span>{s.label}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <SidebarProvider className="stitch-console">
      <Sidebar collapsible="icon" className="border-0">
        <SidebarHeader className="p-3">
          <button
            type="button"
            onClick={() => navigate("/index")}
            className="group flex h-20 w-full items-center justify-center rounded-[1.6rem] border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-4 shadow-[0_18px_45px_rgba(0,0,0,0.10)] transition-all hover:border-[var(--stitch-ink)] hover:bg-[var(--stitch-surface-strong)] group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:rounded-2xl group-data-[collapsible=icon]:px-1"
            aria-label="Demox"
          >
            <img
              src={logo}
              alt="Demox"
              className="h-12 w-auto max-w-full object-contain transition-transform group-hover:scale-105 dark:invert group-data-[collapsible=icon]:h-5"
            />
          </button>
        </SidebarHeader>

        <SidebarContent>
          {inProjectWorkspace ? (
            <>
              <SidebarGroup>
                <SidebarGroupLabel>{t.groupProject}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>{projectNav.map(renderItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarGroup className="pt-5">
                <SidebarGroupContent>
                  <SidebarMenu>
                    {renderItem({
                      key: "backMainMenu",
                      path: "/console/projects",
                      label: t.backMainMenu,
                      icon: ArrowLeft
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          ) : (
            <>
              <SidebarGroup>
                <SidebarGroupLabel>{t.groupConsole}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>{consoleNav.map(renderItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarSeparator />

              <SidebarGroup>
                <SidebarGroupLabel>{t.groupAccount}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {accountNav.map(renderItem)}
                    {renderAdminNav()}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          )}
        </SidebarContent>

        <SidebarFooter>
          <div className="flex items-center gap-1">
            <SidebarTrigger className="h-8 w-8 shrink-0 text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)]" />
            <SidebarMenu className="min-w-0 flex-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => navigate("/index")}
                  tooltip={t.backHome}
                >
                  <LayoutDashboard size={16} />
                  <span>{t.backHome}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-transparent text-[var(--stitch-ink)]">
        <header className="stitch-topbar">
          {inProjectWorkspace ? (
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <span className="hidden text-xs font-bold uppercase tracking-[0.16em] text-[var(--stitch-muted)] sm:inline">
                Project
              </span>
              <select
                value={currentProjectId}
                onChange={(event) => handleSwitchProject(event.target.value)}
                disabled={projects.length === 0}
                title={t.projectSelect}
                className="stitch-select h-9 min-w-[150px] max-w-[52vw] sm:min-w-[220px]"
              >
                {projects.length === 0 && <option value="">{t.noProjects}</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="hidden text-sm font-semibold text-[var(--stitch-muted)] md:block">
              {t.projects}
            </div>
          )}
          <div className="flex-1" />

          <button
            type="button"
            onClick={toggleLang}
            className="flex items-center gap-1.5 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-3 py-1.5 text-[var(--stitch-muted)] transition-colors hover:text-[var(--stitch-ink)]"
          >
            <Languages size={16} />
            <span className="text-xs font-mono uppercase">{lang}</span>
          </button>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 rounded-full outline-none ring-offset-2 ring-offset-[var(--stitch-bg)] transition-all focus:ring-2 focus:ring-[var(--stitch-blue)]">
                <Avatar className="h-9 w-9 border border-[var(--stitch-line)] bg-[var(--stitch-surface)] transition-colors hover:border-[var(--stitch-blue)]">
                  <AvatarFallback className="bg-[var(--stitch-blue-soft)] text-[var(--stitch-blue)] text-xs font-mono">
                    {avatarLabel || <User size={16} />}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-64 border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] p-1.5 text-[var(--stitch-muted)] shadow-2xl backdrop-blur-xl"
              align="end"
              sideOffset={8}
            >
              <div className="mb-1 flex items-center gap-3 border-b border-[var(--stitch-line)] p-2 pb-3">
                <Avatar className="h-8 w-8 border border-[var(--stitch-line)]">
                  <AvatarFallback className="bg-[var(--stitch-blue-soft)] text-[var(--stitch-blue)] text-xs">
                    {avatarLabel || <User size={14} />}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate text-sm font-medium text-[var(--stitch-ink)]">
                    {displayName}
                  </span>
                  <span className="truncate font-mono text-xs text-[var(--stitch-muted)]">
                    {maskEmail(user?.email)}
                  </span>
                </div>
              </div>

              <DropdownMenuItem
                onClick={() => navigate("/console/settings")}
                className="my-0.5 cursor-pointer focus:bg-[var(--stitch-blue-soft)] focus:text-[var(--stitch-ink)]"
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>{t.settings}</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1 bg-[var(--stitch-line)]" />

              <DropdownMenuItem
                onClick={handleLogout}
                className="my-0.5 cursor-pointer text-[var(--stitch-muted)] focus:bg-[var(--stitch-blue-soft)] focus:text-[var(--stitch-ink)]"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>{t.logout}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 min-h-[calc(100vh-4rem)]">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default ConsoleLayout;
