import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/hooks/use-language";
import { ThemeProvider } from "@/hooks/use-theme";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  unstable_HistoryRouter as BrowserRouter,
  Routes,
  Route,
  Navigate
} from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { PageWrapper } from "./components/ui/page-wrapper";
import { routers } from "./configs/routers";
import { ZH_PAIRED_ROUTES } from "./content/zh-routes.mjs";
import { createBrowserHistory } from "history";
import { authApi, tokenManager } from "./api";
import {
  buildLoginRedirect,
  reloginDialogOpenChangeAction,
  reloginDialogLockHandlers
} from "./lib/login-next";
// 控制台、部署页、图表页都不进首页主包。打开首页只下载营销页需要的脚本。
const ConsoleLayout = React.lazy(() => import("./layouts/ConsoleLayout"));
const Home = React.lazy(() => import("./pages/home.jsx"));
const SitesPage = React.lazy(() => import("./pages/console/SitesPage.jsx"));
const ProjectsPage = React.lazy(() => import("./pages/console/ProjectsPage.jsx"));
const ProjectMembersPage = React.lazy(() => import("./pages/console/ProjectMembersPage.jsx"));
const ProjectSettingsPage = React.lazy(() => import("./pages/console/ProjectSettingsPage"));
const ProjectOverviewPage = React.lazy(() => import("./pages/console/ProjectOverviewPage"));
const SettingsPage = React.lazy(() => import("./pages/console/SettingsPage"));
const TokensPage = React.lazy(() => import("./pages/console/TokensPage"));
const FunctionsPage = React.lazy(() => import("./pages/console/FunctionsPage"));
const ProjectFunctionsPage = React.lazy(() => import("./pages/console/ProjectFunctionsPage"));
const loadDatabasePage = () => import("./pages/console/ProjectDatabasePage");
const ProjectDatabaseLayout = React.lazy(() => loadDatabasePage().then((mod) => ({ default: mod.default })));
const ProjectDatabaseList = React.lazy(() => loadDatabasePage().then((mod) => ({ default: mod.ProjectDatabaseList })));
const ProjectDatabaseCreate = React.lazy(() => loadDatabasePage().then((mod) => ({ default: mod.ProjectDatabaseCreate })));
const ProjectDatabaseTable = React.lazy(() => loadDatabasePage().then((mod) => ({ default: mod.ProjectDatabaseTable })));
const UsagePage = React.lazy(() => import("./pages/console/UsagePage"));
const SiteSettingsPage = React.lazy(() => import("./pages/console/SiteSettingsPage.jsx"));
const AdminDashboard = React.lazy(() => import("./pages/AdminDashboard"));
const SiteAnalyticsPage = React.lazy(() => import("./pages/console/SiteAnalyticsPage"));
const lazyFallback = <div className="min-h-[60vh]" />;

function Deferred({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={lazyFallback}>{children}</React.Suspense>;
}

const history = createBrowserHistory();
window._WEAPPS_HISTORY = history;
// Create a client
const queryClient = new QueryClient();

const App: React.FC = () => {
  const [tokenExpiredOpen, setTokenExpiredOpen] = React.useState(false);

  const handleGoLogin = () => {
    try {
      authApi.logout();
    } catch {}
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.assign(buildLoginRedirect(here));
  };

  React.useEffect(() => {
    // 检查token是否有效
    const checkAuth = async () => {
      const token = tokenManager.get();
      if (token) {
        try {
          await authApi.verifyToken();
        } catch {
          setTokenExpiredOpen(true);
        }
      }
    };
    checkAuth();

    (window as any).showTokenExpiredModal = () => setTokenExpiredOpen(true);
  }, []);

  return (
    <React.StrictMode>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <ThemeProvider>
              <LanguageProvider>
              <Toaster />
              <Sonner position="top-center" />
              <AlertDialog
                open={tokenExpiredOpen}
                onOpenChange={(open) => {
                  // Prefer hard-lock (Esc/outside preventDefault below).
                  // If a close still lands, same path as「去登录」— never stay on broken page.
                  if (reloginDialogOpenChangeAction(open) === "open") {
                    setTokenExpiredOpen(true);
                  } else {
                    handleGoLogin();
                  }
                }}
              >
                <AlertDialogContent
                  className="border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] text-[var(--stitch-ink)]"
                  {...reloginDialogLockHandlers()}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>请重新登录</AlertDialogTitle>
                    <AlertDialogDescription className="text-[var(--stitch-muted)]">
                      为了账号安全，请重新登录一次。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogAction
                      className="bg-[var(--stitch-ink)] font-semibold text-[var(--stitch-bg)] hover:bg-[var(--stitch-ink)] hover:opacity-90"
                      onClick={handleGoLogin}
                    >
                      去登录
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <BrowserRouter
                history={history}
                future={{
                  v7_startTransition: true,
                  v7_relativeSplatPath: true
                }}
              >
                <Routes>
                  <Route
                    path="/"
                    element={
                      <PageWrapper
                        id={routers.find((item) => item.isHome)?.id || routers[0].id}
                        Page={routers.find((item) => item.isHome)?.component || routers[0].component}
                      />
                    }
                  />

                  <Route path="/index" element={<Navigate to="/" replace />} />

                  {/* 中文版：/zh/ 下的成对页面，静态 HTML 由 scripts/generate-seo-pages.mjs 预渲染 */}
                  {ZH_PAIRED_ROUTES.map((key) => {
                    const item = key
                      ? routers.find((router) => router.id === key)
                      : routers.find((router) => router.isHome);
                    if (!item) return null;
                    return (
                      <Route
                        key={`zh-${key || "home"}`}
                        path={key ? `/zh/${key}` : "/zh"}
                        element={<Deferred><PageWrapper id={item.id} Page={item.component} /></Deferred>}
                      />
                    );
                  })}

                  {/* 控制台：共享侧栏布局的嵌套路由 */}
                  <Route path="/console" element={<Deferred><ConsoleLayout /></Deferred>}>
                    <Route index element={<Navigate to="/console/projects" replace />} />
                    <Route path="projects" element={<Deferred><ProjectsPage /></Deferred>} />
                    <Route
                      path="projects/:projectId/overview"
                      element={<Deferred><ProjectOverviewPage /></Deferred>}
                    />
                    <Route
                      path="projects/:projectId/deploy"
                      element={<Deferred><Home /></Deferred>}
                    />
                    <Route
                      path="projects/:projectId/sites"
                      element={<Deferred><SitesPage /></Deferred>}
                    />
                    <Route
                      path="projects/:projectId/functions"
                      element={<Deferred><ProjectFunctionsPage /></Deferred>}
                    />
                    <Route path="projects/:projectId/database" element={<Deferred><ProjectDatabaseLayout /></Deferred>}>
                      <Route index element={<Deferred><ProjectDatabaseList /></Deferred>} />
                      <Route path="new" element={<Deferred><ProjectDatabaseCreate /></Deferred>} />
                      <Route path="tables/:tableName" element={<Deferred><ProjectDatabaseTable /></Deferred>} />
                    </Route>
                    <Route
                      path="projects/:projectId/sites/:websiteId/analytics"
                      element={<Deferred><SiteAnalyticsPage /></Deferred>}
                    />
                    <Route
                      path="projects/:projectId/sites/:websiteId/functions"
                      element={<Deferred><FunctionsPage /></Deferred>}
                    />
                    <Route
                      path="projects/:projectId/sites/:websiteId"
                      element={<Deferred><SiteSettingsPage /></Deferred>}
                    />
                    <Route
                      path="projects/:projectId/members"
                      element={<Deferred><ProjectMembersPage /></Deferred>}
                    />
                    <Route
                      path="projects/:projectId/settings"
                      element={<Deferred><ProjectSettingsPage /></Deferred>}
                    />
                    <Route path="deploy" element={<Navigate to="/console/projects" replace />} />
                    <Route path="sites" element={<Navigate to="/console/projects" replace />} />
                    <Route path="usage" element={<Deferred><UsagePage /></Deferred>} />
                    <Route path="tokens" element={<Deferred><TokensPage /></Deferred>} />
                    <Route path="functions" element={<Navigate to="/console/projects" replace />} />
                    <Route path="settings" element={<Deferred><SettingsPage /></Deferred>} />
                    {/* 管理后台：真正的二级路由，section 决定展示哪个面板 */}
                    <Route
                      path="admin"
                      element={<Navigate to="dashboard" replace />}
                    />
                    <Route path="admin/:section" element={<Deferred><AdminDashboard /></Deferred>} />
                  </Route>

                  {/* 旧地址兼容重定向 */}
                  <Route
                    path="/home"
                    element={<Navigate to="/console/projects" replace />}
                  />
                  <Route
                    path="/admin"
                    element={<Navigate to="/console/admin/dashboard" replace />}
                  />
                  <Route
                    path="/mcp"
                    element={<Navigate to="/doc" replace />}
                  />
                  <Route
                    path="/docs"
                    element={<Navigate to="/doc" replace />}
                  />

                  {routers
                    .filter(
                      (item) => !item.isHome && item.id !== "home" && item.id !== "admin"
                    )
                    .map((item) => {
                      return (
                        <Route
                          key={item.id}
                          path={`/${item.id}`}
                          element={
                            <Deferred><PageWrapper id={item.id} Page={item.component} /></Deferred>
                          }
                        />
                      );
                    })}
                </Routes>
              </BrowserRouter>
            </LanguageProvider>
            </ThemeProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </React.StrictMode>
  );
};

export default App;
