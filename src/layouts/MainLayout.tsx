import React from "react";
import { useNavigate } from "react-router-dom";

interface MainLayoutProps {
  children: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white flex flex-col">
      <nav className="border-b border-zinc-800 bg-black/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              type="button"
              onClick={() => navigate("/index")}
              className="flex items-center gap-2"
            >
              <div className="w-5 h-5 bg-zinc-100 rounded-sm flex items-center justify-center">
                <span className="text-black text-xs font-bold">C</span>
              </div>
              <span className="text-lg font-bold tracking-tight">
                CloudHost<span className="animate-pulse">_</span>
              </span>
            </button>

            <div className="flex items-center gap-6 text-sm text-zinc-400">
              <button
                type="button"
                onClick={() => navigate("/layout-demo")}
                className="hover:text-zinc-100 transition-colors"
              >
                Layout Demo
              </button>
              <button
                type="button"
                onClick={() => navigate("/home")}
                className="hover:text-zinc-100 transition-colors"
              >
                控制台
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 md:py-16">
          {children}
        </div>
      </main>

      <footer className="border-t border-zinc-900 bg-zinc-950 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-zinc-800 rounded-sm flex items-center justify-center">
                <span className="text-zinc-500 text-[10px] font-bold">C</span>
              </div>
              <span className="text-zinc-500 text-sm">
                CloudHost © {new Date().getFullYear()}
              </span>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8 text-sm text-zinc-500">
              <a
                href="mailto:phosa@qq.com"
                className="hover:text-zinc-300 transition-colors flex items-center gap-2"
              >
                <span>联系邮箱：phosa@qq.com</span>
              </a>
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-zinc-300 transition-colors flex items-center gap-2"
              >
                <span>陕ICP备2024025600号-1</span>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
