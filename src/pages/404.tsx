import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Home,
  ArrowRight,
  Activity,
  Languages,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui";
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
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-line)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] -z-10" />

      <button
        onClick={toggleLang}
        className="absolute top-6 right-6 z-50 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/50 hover:bg-card"
      >
        <Languages size={14} />
        <span className="text-xs font-mono uppercase tracking-wider">{lang}</span>
      </button>

      <div className="max-w-3xl w-full px-4 relative z-10">
        <div className="rounded-lg overflow-hidden border border-border bg-card shadow-2xl relative group mb-12">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-destructive/80"></div>
              <div className="w-3 h-3 rounded-full bg-warning/80"></div>
              <div className="w-3 h-3 rounded-full bg-success/80"></div>
            </div>
            <div className="flex-1 text-center">
              <span className="text-xs text-muted-foreground font-mono">
                system_log — error_trace
              </span>
            </div>
          </div>

          <div className="p-6 font-mono text-sm md:text-base space-y-4 min-h-[300px]">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>$</span>
              <span className="text-foreground">initiate_connection_protocol</span>
            </div>

            <div className="text-muted-foreground">
              &gt; Resolving routing table...{" "}
              <span className="text-success">done</span>
            </div>
            <div className="text-muted-foreground">
              &gt; Locating deployment artifact...{" "}
              <span className="text-warning">searching</span>
            </div>
            <div className="text-muted-foreground">
              &gt; Verifying integrity hash...
            </div>

            <div className="pl-4 border-l-2 border-destructive/30 my-4">
              <div className="text-destructive font-bold mb-1 flex items-center gap-2">
                <AlertTriangle size={16} />
                CRITICAL_FAILURE
              </div>
              <div className="text-muted-foreground">
                Target deployment not found in the active registry.
                <br />
                The project may have been deleted, moved, or never existed.
              </div>
            </div>

            <div className="flex items-center gap-2 text-foreground mt-8">
              <ChevronRight className="w-4 h-4 text-destructive shrink-0" />
              <span className="animate-pulse">_</span>
              <span className="text-destructive font-bold">{typedText}</span>
            </div>
          </div>

          <div className="absolute inset-0 bg-gradient-to-t from-destructive/5 to-transparent pointer-events-none" />
        </div>

        <div className="text-center space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t.title}
            </h1>
            <p className="text-muted-foreground max-w-lg mx-auto">{t.desc}</p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={() => navigate("/")}
              className="w-full sm:w-auto gap-2"
            >
              <Home size={18} />
              {t.home_btn}
            </Button>

            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate("/console/sites")}
              className="w-full sm:w-auto gap-2 group"
            >
              <Activity size={18} />
              {t.status_btn}
              <ArrowRight
                size={16}
                className="group-hover:translate-x-1 transition-transform"
              />
            </Button>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
    </div>
  );
};

export default NotFoundPage;
