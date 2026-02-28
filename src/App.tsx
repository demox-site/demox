import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider } from "@/hooks/use-language";
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
                  {routers.map((item) => {
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
          </TooltipProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </React.StrictMode>
  );
};

export default App;
