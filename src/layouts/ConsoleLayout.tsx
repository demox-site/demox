import React, { useEffect, useState } from "react";
import {
  Outlet,
  useNavigate,
  useLocation,
  Navigate
} from "react-router-dom";
import { authApi, userManager, isLoggedIn } from "@/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLanguage } from "@/hooks/use-language";
import logo from "@/assets/logo.png";
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
  ShieldCheck
} from "lucide-react";

const navTexts = {
  zh: {
    groupConsole: "控制台",
    groupAccount: "账户",
    sites: "我的站点",
    usage: "用量套餐",
    tokens: "访问令牌",
    settings: "账号设置",
    admin: "管理后台",
    adminDashboard: "数据概览",
    adminRoles: "用户角色配置",
    adminRoleLimits: "角色列表",
    adminBuckets: "存储桶",
    logout: "退出登录",
    backHome: "返回首页"
  },
  en: {
    groupConsole: "Console",
    groupAccount: "Account",
    sites: "My Sites",
    usage: "Usage & Plan",
    tokens: "Access Tokens",
    settings: "Settings",
    admin: "Admin",
    adminDashboard: "Dashboard",
    adminRoles: "User Roles",
    adminRoleLimits: "Roles",
    adminBuckets: "Storage Buckets",
    logout: "Log out",
    backHome: "Home"
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
  roles?: string[];
}

export const ConsoleLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language: lang, toggleLanguage: toggleLang } = useLanguage();
  const [user, setUser] = useState<ConsoleUser | null>(() => userManager.get());
  const t = navTexts[lang];

  useEffect(() => {
    setUser(userManager.get());
  }, []);

  if (!isLoggedIn()) {
    return <Navigate to="/index" replace />;
  }

  const isAdmin = (user?.roles || []).includes("admin");

  const handleLogout = () => {
    authApi.logout();
    setUser(null);
    navigate("/index");
  };

  const consoleNav: NavItem[] = [
    { key: "sites", path: "/console/sites", label: t.sites, icon: Globe },
    { key: "usage", path: "/console/usage", label: t.usage, icon: Gauge },
    { key: "tokens", path: "/console/tokens", label: t.tokens, icon: KeyRound }
  ];

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

  const renderItem = (item: NavItem) => {
    if (item.adminOnly && !isAdmin) return null;
    const Icon = item.icon;
    return (
      <SidebarMenuItem key={item.key}>
        <SidebarMenuButton
          isActive={isActive(item.path)}
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
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-border">
        <SidebarHeader>
          <button
            type="button"
            onClick={() => navigate("/index")}
            className="flex items-center gap-2 px-2 py-1.5 group"
          >
            <img
              src={logo}
              alt="Demox"
              className="h-7 w-auto object-contain invert dark:invert-0 group-hover:scale-105 transition-transform"
            />
          </button>
        </SidebarHeader>

        <SidebarContent>
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
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
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
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-background text-foreground">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-border bg-background/80 backdrop-blur-md px-4">
          <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
          <div className="w-px h-4 bg-border mx-1" />
          <div className="flex-1" />

          <button
            type="button"
            onClick={toggleLang}
            className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted/80"
          >
            <Languages size={16} />
            <span className="text-xs font-mono uppercase">{lang}</span>
          </button>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 outline-none rounded-full ring-offset-2 ring-offset-background focus:ring-2 focus:ring-ring transition-all">
                <Avatar className="h-9 w-9 border border-border hover:border-foreground/20 transition-colors">
                  <AvatarFallback className="bg-muted text-muted-foreground text-xs font-mono">
                    {user?.email?.[0]?.toUpperCase() || <User size={16} />}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-64 p-1.5"
              align="end"
              sideOffset={8}
            >
              <div className="flex items-center gap-3 p-2 mb-1 border-b border-border pb-3">
                <Avatar className="h-8 w-8 border border-border">
                  <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                    <User size={14} />
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium text-foreground truncate">
                    {isAdmin ? "Admin" : "User"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate font-mono">
                    {maskEmail(user?.email)}
                  </span>
                </div>
              </div>

              <DropdownMenuItem
                onClick={() => navigate("/console/settings")}
                className="cursor-pointer my-0.5"
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>{t.settings}</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1" />

              <DropdownMenuItem
                onClick={handleLogout}
                className="cursor-pointer text-destructive focus:text-destructive my-0.5"
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
