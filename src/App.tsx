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
} from "@/components/ui";
import {
  unstable_HistoryRouter as BrowserRouter,
  Routes,
  Route,
  Navigate
} from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { PageWrapper } from "./components/ui/page-wrapper";
import { routers } from "./configs/routers";
import { createBrowserHistory } from "history";
import { authApi, tokenManager } from "./api";
import {
  buildLoginRedirect,
  reloginDialogOpenChangeAction,
  reloginDialogLockHandlers
} from "./lib/login-next";
import { ConsoleLayout } from "./layouts/ConsoleLayout";
import Home from "./pages/home.jsx";
import SitesPage from "./pages/console/SitesPage.jsx";
import ProjectsPage from "./pages/console/ProjectsPage.jsx";
import ProjectMembersPage from "./pages/console/ProjectMembersPage.jsx";
import ProjectSettingsPage from "./pages/console/ProjectSettingsPage";
import SettingsPage from "./pages/console/SettingsPage";
import TokensPage from "./pages/console/TokensPage";
import FunctionsPage from "./pages/console/FunctionsPage";
import UsagePage from "./pages/console/UsagePage";
import SiteSettingsPage from "./pages/console/SiteSettingsPage.jsx";

// 管理后台和站点分析页带图表库（recharts），按需加载，不进 www 主包。
const AdminDashboard = React.lazy(() => import("./pages/AdminDashboard"));
const SiteAnalyticsPage = React.lazy(() => import("./pages/console/SiteAnalyticsPage"));
const lazyFallback = <div className="min-h-[60vh]" />;

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

                  {/* 控制台：共享侧栏布局的嵌套路由 */}
                  <Route path="/console" element={<ConsoleLayout />}>
                    <Route index element={<Navigate to="/console/projects" replace />} />
                    <Route path="projects" element={<ProjectsPage />} />
                    <Route
                      path="projects/:projectId/deploy"
                      element={<Home />}
                    />
                    <Route
                      path="projects/:projectId/sites"
                      element={<SitesPage />}
                    />
                    <Route
                      path="projects/:projectId/sites/:websiteId/analytics"
                      element={<React.Suspense fallback={lazyFallback}><SiteAnalyticsPage /></React.Suspense>}
                    />
                    <Route
                      path="projects/:projectId/sites/:websiteId/functions"
                      element={<FunctionsPage />}
                    />
                    <Route
                      path="projects/:projectId/sites/:websiteId"
                      element={<SiteSettingsPage />}
                    />
                    <Route
                      path="projects/:projectId/members"
                      element={<ProjectMembersPage />}
                    />
                    <Route
                      path="projects/:projectId/settings"
                      element={<ProjectSettingsPage />}
                    />
                    <Route path="deploy" element={<Navigate to="/console/projects" replace />} />
                    <Route path="sites" element={<Navigate to="/console/projects" replace />} />
                    <Route path="usage" element={<UsagePage />} />
                    <Route path="tokens" element={<TokensPage />} />
                    <Route path="functions" element={<Navigate to="/console/projects" replace />} />
                    <Route path="settings" element={<SettingsPage />} />
                    {/* 管理后台：真正的二级路由，section 决定展示哪个面板 */}
                    <Route
                      path="admin"
                      element={<Navigate to="dashboard" replace />}
                    />
                    <Route path="admin/:section" element={<React.Suspense fallback={lazyFallback}><AdminDashboard /></React.Suspense>} />
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
                            <PageWrapper id={item.id} Page={item.component} />
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
