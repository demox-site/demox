import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { userManager } from "../api";
import { AuthDialog } from "../components/AuthDialog";
import { ExternalLink } from "lucide-react";

import { useLanguage } from "../hooks/use-language";
import { siteConfig } from "@/configs/env";
import { MainLayout } from "@/layouts/MainLayout";
import { track } from "@/lib/track";
import { HeroStage, GlobeStage, GalleryStage } from "@/components/marketing";
import { TaskGuides } from "@/components/marketing/TaskGuides";

const translations = {
  zh: {
    hero: {
      version: `v${siteConfig.version} 现已发布`,
      title_start: "免费静态网站发布平台，支持 CLI 和 MCP",
      title_end: "",
      desc: "将 AI 生成的 HTML、ZIP、React/Vue/Vite 构建产物一键发布为公网网站，无需 Git，无需服务器配置。",
      start_btn: "立即上传",
      examples_btn: "看真实示例",
    },
    cta: {
      title: "准备好发布了吗？",
      subtitle: "上传你的页面，30 秒拿到一个能打开的链接。",
      start_btn: "立即上传",
      contact_btn: "查看套餐",
    },
  },
  en: {
    hero: {
      version: `v${siteConfig.version} is now live`,
      title_start: "Deploy AI-generated websites",
      title_end: "in seconds.",
      desc: "Demox is a free static website hosting platform for AI-generated websites. Deploy HTML, ZIP, React/Vue/Vite builds through drag-and-drop, CLI or MCP and get a public HTTPS URL.",
      start_btn: "Upload now",
      examples_btn: "See live examples",
    },
    cta: {
      title: "Ready to ship?",
      subtitle: "Upload your page and get a working link in 30 seconds.",
      start_btn: "Upload now",
      contact_btn: "View plans",
    },
  },
};

const CloudHostLanding: React.FC = () => {
  const { language: lang } = useLanguage();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  const t = translations[lang];

  useEffect(() => {
    track("landing_view");
    const currentUser = userManager.get();
    if (currentUser) setUser(currentUser);
  }, []);

  const handleLoginSuccess = () => {
    const currentUser = userManager.get();
    if (currentUser) setUser(currentUser);
    navigate("/console/projects");
  };

  const openUpload = () => {
    track("deploy_click", { source: "hero" });
    user ? navigate("/console/projects") : setIsLoginOpen(true);
  };

  const scrollToGallery = () => {
    document.getElementById("s3")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <MainLayout>
      {/* Hero copy + interactive editor/preview */}
      <section className="pt-8 pb-12 md:pt-12 md:pb-16 relative overflow-x-clip">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-line)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10" />

        <div className="max-w-4xl mx-auto text-center mb-12 md:mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] mb-8">
            <span className="flex h-2 w-2 rounded-full bg-zinc-400 animate-pulse" />
            <span className="text-xs font-mono text-zinc-400">
              {t.hero.version}
            </span>
          </div>

          <h1
            className={`font-bold tracking-tight mb-6 break-words bg-clip-text text-transparent bg-gradient-to-b from-zinc-100 to-zinc-500 ${
              lang === "zh"
                ? "text-3xl md:text-4xl lg:text-5xl"
                : "text-5xl md:text-7xl"
            }`}
          >
            {lang === "zh" ? (
              t.hero.title_start
            ) : (
              <>
                {t.hero.title_start}
                <br />
                <span className="text-white">{t.hero.title_end}</span>
              </>
            )}
          </h1>

          <p className="text-lg md:text-xl text-zinc-400 mb-10 max-w-2xl mx-auto leading-relaxed break-words [overflow-wrap:anywhere]">
            {t.hero.desc}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={openUpload}
              className="w-full sm:w-auto px-8 py-3 bg-[var(--stitch-ink)] text-[var(--stitch-surface)] font-semibold rounded-xl hover:-translate-y-1 transition-transform duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]"
            >
              {t.hero.start_btn}
            </button>
            <button
              onClick={scrollToGallery}
              className="w-full sm:w-auto px-8 py-3 border border-[var(--stitch-line)] text-[var(--stitch-ink)] rounded-xl transition-colors font-medium flex items-center justify-center gap-2 hover:border-[var(--stitch-muted)]"
            >
              <ExternalLink size={16} />
              {t.hero.examples_btn}
            </button>
          </div>
        </div>

        <HeroStage />
      </section>

      {/* Screen 2 — global edge nodes */}
      <GlobeStage />

      {/* Screen 3 — gallery wall (真实 + 示例) */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8">
        <GalleryStage onUpload={openUpload} />
      </div>

      {/* Intent guides (SEO) — grouped by publishing task */}
      <TaskGuides lang={lang} />

      <section className="py-24 px-4 border-t border-[var(--stitch-line)]">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-6">{t.cta.title}</h2>
          <p className="text-zinc-400 mb-8">{t.cta.subtitle}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() =>
                user ? navigate("/console/projects") : setIsLoginOpen(true)
              }
              className="w-full sm:w-auto px-8 py-3 bg-[var(--stitch-ink)] text-[var(--stitch-surface)] font-bold rounded-xl hover:opacity-90 transition-colors"
            >
              {t.cta.start_btn}
            </button>
            <button
              onClick={() => navigate("/pricing")}
              className="w-full sm:w-auto px-8 py-3 bg-[var(--stitch-surface)] text-[var(--stitch-ink)] font-medium rounded-xl border border-[var(--stitch-line)] hover:opacity-90 transition-colors"
            >
              {t.cta.contact_btn}
            </button>
          </div>
        </div>
      </section>

      <AuthDialog
        isOpen={isLoginOpen}
        onOpenChange={setIsLoginOpen}
        onLoginSuccess={handleLoginSuccess}
      />
    </MainLayout>
  );
};

export default CloudHostLanding;
