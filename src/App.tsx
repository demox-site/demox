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
import { createHashHistory } from "history";
import { authApi, tokenManager } from "./api";
import { ConsoleLayout } from "./layouts/ConsoleLayout";
import Home from "./pages/home.jsx";
import AdminDashboard from "./pages/AdminDashboard";
import SettingsPage from "./pages/console/SettingsPage";
import TokensPage from "./pages/console/TokensPage";
import UsagePage from "./pages/console/UsagePage";

const history = createHashHistory();
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
                    <Route index element={<Navigate to="sites" replace />} />
                    <Route path="sites" element={<Home />} />
                    <Route path="usage" element={<UsagePage />} />
                    <Route path="tokens" element={<TokensPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="admin" element={<AdminDashboard />} />
                  </Route>

                  {/* 旧地址兼容重定向 */}
                  <Route
                    path="/home"
                    element={<Navigate to="/console/sites" replace />}
                  />
                  <Route
                    path="/admin"
                    element={<Navigate to="/console/admin" replace />}
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
