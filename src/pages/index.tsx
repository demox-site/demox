import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { userManager } from "../api";
import { AuthDialog } from "../components/AuthDialog";
import {
  ExternalLink,
  Code2,
  FileText,
  Sparkles,
  Package,
} from "lucide-react";

import { useLanguage } from "../hooks/use-language";
import { siteConfig } from "@/configs/env";
import { MainLayout } from "@/layouts/MainLayout";
import { track } from "@/lib/track";
import { INTENT_LANDINGS } from "@/content/intent-landings.mjs";
import {
  HeroEditorDemo,
  GlobeNodes,
  WorksGallery,
} from "@/components/marketing";
import "@/components/marketing/marketing.css";

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
    examples: {
      title: "30 秒看完三个真实示例",
      subtitle: "点开就能看到，都是用 Demox 发出来的页面。",
      view_btn: "打开示例",
      items: [
        {
          tag: "前端项目",
          title: "Vite + React 构建产物",
          desc: "npm run build 后打包 dist 为 zip，拖拽上传即得链接。",
          url: "https://example-vite.demox.site",
          cmd: "cd my-app && npm run build && demox deploy ./dist",
        },
        {
          tag: "Markdown 转网页",
          title: "文档变可分享网页",
          desc: "上传 .md 文件，内置模板渲染为带目录的网页，适合文档/笔记/草稿。",
          url: "https://example-md.demox.site",
          cmd: "demox deploy README.md",
        },
        {
          tag: "AI 发布页面",
          title: "AI 生成页面一键发布",
          desc: "Claude/Cursor/v0 生成 HTML 后，CLI 或 MCP 直接发布，跳过服务器配置。",
          url: "https://example-ai.demox.site",
          cmd: "demox deploy ./ai-generated.html",
        },
      ],
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
    examples: {
      title: "Three real examples in 30 seconds",
      subtitle: "Click to open — all deployed with Demox.",
      view_btn: "Open example",
      items: [
        {
          tag: "Frontend project",
          title: "Vite + React build output",
          desc: "Run npm run build, zip the dist folder, drag and drop to get a link.",
          url: "https://example-vite.demox.site",
          cmd: "cd my-app && npm run build && demox deploy ./dist",
        },
        {
          tag: "Markdown to web",
          title: "Docs as a shareable page",
          desc: "Upload a .md file; built-in templates render it as a page with a table of contents.",
          url: "https://example-md.demox.site",
          cmd: "demox deploy README.md",
        },
        {
          tag: "AI-published page",
          title: "Ship AI-generated pages instantly",
          desc: "After Claude/Cursor/v0 generates HTML, publish via CLI or MCP — no server setup.",
          url: "https://example-ai.demox.site",
          cmd: "demox deploy ./ai-generated.html",
        },
      ],
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
    document.getElementById("use-cases")?.scrollIntoView({ behavior: "smooth" });
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

        <HeroEditorDemo language={lang} />
      </section>

      {/* Screen 2 — global edge nodes */}
      <div className="border-t border-[var(--stitch-line)]">
        <GlobeNodes language={lang} />
      </div>

      {/* Screen 3 — gallery wall (真实 + 示例) */}
      <div className="border-t border-[var(--stitch-line)] -mx-4 sm:-mx-6 lg:-mx-8">
        <WorksGallery language={lang} onUpload={openUpload} />
      </div>

      {/* Intent guides (SEO) */}
      <section
        id="intent-guides"
        className="py-16 px-4 border-t border-[var(--stitch-line)]"
      >
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-3 text-white">
            {lang === "zh"
              ? "按具体发布任务查"
              : "Guides for a specific deploy job"}
          </h2>
          <p className="text-zinc-400 mb-8 max-w-3xl">
            {lang === "zh"
              ? "这些页面直接回答 CLI、MCP、Vite、React、单个 HTML 和常见平台对比，方便搜索引擎和 AI 引用。"
              : "These pages answer CLI, MCP, Vite, React, single HTML, and honest platform comparisons so search engines and AI tools can cite them."}
          </p>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {INTENT_LANDINGS.map((page) => (
              <li key={page.id}>
                <a
                  href={`/${page.id}`}
                  className="block rounded-xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-4 py-3 text-sm font-medium text-[var(--stitch-ink)] hover:border-[var(--stitch-muted)]"
                >
                  {lang === "zh" ? page.zh.h1 : page.h1}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Classic example cards (templates as 示例 links) */}
      <section
        id="template-examples"
        className="py-24 px-4 border-t border-[var(--stitch-line)]"
      >
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
              {t.examples.title}
            </h2>
            <p className="text-zinc-400">{t.examples.subtitle}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {t.examples.items.map((ex, i) => {
              const icon =
                i === 0 ? (
                  <Package className="w-5 h-5" />
                ) : i === 1 ? (
                  <FileText className="w-5 h-5" />
                ) : (
                  <Sparkles className="w-5 h-5" />
                );
              return (
                <div
                  key={i}
                  className="group relative min-w-0 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-6 hover:border-[var(--stitch-muted)] transition-colors flex flex-col"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-9 h-9 rounded-lg bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] flex items-center justify-center text-[var(--stitch-muted)] group-hover:text-white transition-colors">
                      {icon}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] text-[var(--stitch-muted)] font-mono">
                      {ex.tag}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-2 text-white">
                    {ex.title}
                  </h3>
                  <p className="text-sm text-zinc-400 leading-relaxed mb-4 flex-1">
                    {ex.desc}
                  </p>
                  <div className="rounded-lg bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] px-3 py-2 mb-4 flex items-center gap-2">
                    <Code2 className="w-3.5 h-3.5 text-[var(--stitch-muted)] shrink-0" />
                    <code className="text-xs text-[var(--stitch-muted)] font-mono truncate">
                      {ex.cmd}
                    </code>
                  </div>
                  <a
                    href={ex.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      track("example_click", { index: i, tag: ex.tag })
                    }
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] text-sm font-medium text-[var(--stitch-ink)] hover:border-[var(--stitch-blue)] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t.examples.view_btn}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </section>

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
