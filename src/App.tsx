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
  AlertDialogCancel,
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
import { ConsoleLayout } from "./layouts/ConsoleLayout";
import Home from "./pages/home.jsx";
import AdminDashboard from "./pages/AdminDashboard";
import ProjectsPage from "./pages/console/ProjectsPage.jsx";
import SettingsPage from "./pages/console/SettingsPage";
import TokensPage from "./pages/console/TokensPage";
import UsagePage from "./pages/console/UsagePage";

const history = createBrowserHistory();
window._WEAPPS_HISTORY = history;
// Create a client
const queryClient = new QueryClient();

const App: React.FC = () => {
  const [tokenExpiredOpen, setTokenExpiredOpen] = React.useState(false);

  const handleConfirmRefresh = async () => {
    try {
      authApi.logout();
    } catch {}
    try {
      window.location.reload();
    } catch {
      setTokenExpiredOpen(false);
    }
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
              <AlertDialog open={tokenExpiredOpen} onOpenChange={setTokenExpiredOpen}>
                <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                  <AlertDialogHeader>
                    <AlertDialogTitle>凭证过期</AlertDialogTitle>
                    <AlertDialogDescription className="text-zinc-400">
                      凭证已过期，是否刷新页面以重新获取登录状态？
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800">
                      取消
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-zinc-100 text-zinc-900 hover:bg-white"
                      onClick={handleConfirmRefresh}
                    >
                      确认
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
                      <Navigate
                        to={`/${
                          routers.find((item) => item.isHome)?.id ||
                          routers[0].id
                        }`}
                        replace
                      />
                    }
                  />

                  {/* 控制台：共享侧栏布局的嵌套路由 */}
                  <Route path="/console" element={<ConsoleLayout />}>
                    <Route index element={<Navigate to="/console/projects" replace />} />
                    <Route path="projects" element={<ProjectsPage />} />
                    <Route
                      path="projects/:projectId/deploy"
                      element={<Home mode="deploy" />}
                    />
                    <Route
                      path="projects/:projectId/sites"
                      element={<Home mode="sites" />}
                    />
                    <Route path="deploy" element={<Navigate to="/console/projects" replace />} />
                    <Route path="sites" element={<Navigate to="/console/projects" replace />} />
                    <Route path="usage" element={<UsagePage />} />
                    <Route path="tokens" element={<TokensPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    {/* 管理后台：真正的二级路由，section 决定展示哪个面板 */}
                    <Route
                      path="admin"
                      element={<Navigate to="dashboard" replace />}
                    />
                    <Route path="admin/:section" element={<AdminDashboard />} />
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
                      (item) => item.id !== "home" && item.id !== "admin"
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
