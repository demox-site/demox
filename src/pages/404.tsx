import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Terminal,
  AlertTriangle,
  Home,
  ArrowRight,
  Activity,
  Languages
} from "lucide-react";
import { useLanguage } from "../hooks/use-language";

const translations = {
  zh: {
    title: "页面未找到",
    desc: "我们找不到您要访问的页面。它可能已被移除或链接已失效。",
    home_btn: "返回首页",
    status_btn: "查看状态"
  },
  en: {
    title: "Page Not Found",
    desc: "We couldn't find the page you're looking for. It might have been removed or the link is broken.",
    home_btn: "Return Home",
    status_btn: "View Status"
  }
};

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
  const { language: lang, toggleLanguage: toggleLang } = useLanguage();
  const [typedText, setTypedText] = useState("");
  const fullText = "Error: 404_DEPLOYMENT_NOT_FOUND";

  const t = translations[lang];

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      setTypedText(fullText.slice(0, index + 1));
      index++;
      if (index > fullText.length) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Grid Effect */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-line)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] -z-10" />

      {/* Language Switcher */}
      <button
        onClick={toggleLang}
        className="absolute top-6 right-6 z-50 text-zinc-400 hover:text-zinc-100 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900"
      >
        <Languages size={14} />
        <span className="text-xs font-mono uppercase tracking-wider">
          {lang}
        </span>
      </button>

      {/* Main Content */}
      <div className="max-w-3xl w-full px-4 relative z-10">
        {/* Terminal Window */}
        <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl relative group mb-12">
          {/* Terminal Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
              <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
            </div>
            <div className="flex-1 text-center">
              <span className="text-xs text-zinc-500 font-mono">
                system_log — error_trace
              </span>
            </div>
          </div>

          {/* Terminal Body */}
          <div className="p-6 font-mono text-sm md:text-base space-y-4 min-h-[300px]">
            <div className="flex items-center gap-2 text-zinc-500">
              <span>$</span>
              <span className="text-zinc-300">
                initiate_connection_protocol
              </span>
            </div>

            <div className="text-zinc-500">
              &gt; Resolving routing table...{" "}
              <span className="text-green-500">done</span>
            </div>
            <div className="text-zinc-500">
              &gt; Locating deployment artifact...{" "}
              <span className="text-yellow-500">searching</span>
            </div>
            <div className="text-zinc-500">
              &gt; Verifying integrity hash...
            </div>

            <div className="pl-4 border-l-2 border-red-500/30 my-4">
              <div className="text-red-500 font-bold mb-1 flex items-center gap-2">
                <AlertTriangle size={16} />
                CRITICAL_FAILURE
              </div>
              <div className="text-zinc-400">
                Target deployment not found in the active registry.
                <br />
                The project may have been deleted, moved, or never existed.
              </div>
            </div>

            <div className="flex items-center gap-2 text-zinc-100 mt-8">
              <span className="text-red-500">➜</span>
              <span className="animate-pulse">_</span>
              <span className="text-red-400 font-bold">{typedText}</span>
            </div>
          </div>

          {/* Glow effect */}
          <div className="absolute inset-0 bg-gradient-to-t from-red-900/5 to-transparent pointer-events-none" />
        </div>

        {/* Action Area */}
        <div className="text-center space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t.title}
            </h1>
            <p className="text-zinc-400 max-w-lg mx-auto">{t.desc}</p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="w-full sm:w-auto px-8 py-3 bg-zinc-100 text-black font-semibold rounded-md hover:-translate-y-1 transition-transform duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] flex items-center justify-center gap-2"
            >
              <Home size={18} />
              {t.home_btn}
            </button>

            <button
              onClick={() => navigate("/console/projects")}
              className="w-full sm:w-auto px-8 py-3 border border-zinc-800 text-zinc-300 rounded-md hover:border-zinc-600 hover:text-zinc-100 transition-colors flex items-center justify-center gap-2 group"
            >
              <Activity size={18} />
              {t.status_btn}
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </button>
          </div>
        </div>
      </div>

      {/* Decorative Bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
    </div>
  );
};

export default NotFoundPage;
