import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { userManager } from "../api";
import { AuthDialog } from "../components/AuthDialog";
import {
  Package,
  UploadCloud,
  Rocket,
  CheckCircle2,
  ExternalLink,
  Code2,
  FileText,
  Sparkles
} from "lucide-react";

import { useLanguage } from "../hooks/use-language";
import { siteConfig } from "@/configs/env";
import { MainLayout } from "@/layouts/MainLayout";
import { track } from "@/lib/track";

const translations = {
  zh: {
    hero: {
      version: `v${siteConfig.version} 现已发布`,
      title_start: "上传构建产物，立刻获得一个能打开的链接",
      title_end: "",
      desc: "适合前端 Demo、AI 生成页面、客户评审、PDF/Markdown/DOCX 网页化。无需服务器、CDN、HTTPS 配置。",
      start_btn: "立即上传",
      examples_btn: "看 30 秒示例"
    },
    terminal: {
      title: "bash — 80x24",
      cmd: "demox deploy",
      init: "初始化部署引擎...",
      bundling: "打包资源...",
      bundling_done: "完成 (0.4s)",
      uploading: "上传至边缘网络...",
      uploading_done: "完成 (1.2s)",
      success: "成功！已部署至：",
      url: "https://project-gamma.demox.site"
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
          url: "https://project-gamma.demox.site",
          cmd: "cd my-app && npm run build && demox deploy ./dist"
        },
        {
          tag: "Markdown 转网页",
          title: "文档变可分享网页",
          desc: "上传 .md 文件，内置模板渲染为带目录的网页，适合文档/笔记/草稿。",
          url: "https://project-gamma.demox.site",
          cmd: "demox deploy README.md"
        },
        {
          tag: "AI 发布页面",
          title: "AI 生成页面一键发布",
          desc: "Claude/Cursor/v0 生成 HTML 后，CLI 或 MCP 直接发布，跳过服务器配置。",
          url: "https://project-gamma.demox.site",
          cmd: "demox deploy ./ai-generated.html"
        }
      ]
    },
    useCases: {
      title: "我能用它做什么",
      subtitle: "四种最常见的发布场景，全部 30 秒拿到链接。",
      try_btn: "立即试试",
      items: [
        {
          id: "frontend-demo",
          title: "前端 Demo",
          desc: "Vite / Next / CRA 构建产物打包 zip，秒级拿到可分享链接，适合作品集与团队预览。"
        },
        {
          id: "ai-page",
          title: "AI 生成页面",
          desc: "Claude / Cursor / v0 生成的 HTML，跳过服务器配置，CLI 或 MCP 直接发布到边缘。"
        },
        {
          id: "client-review",
          title: "客户评审",
          desc: "把设计稿或原型 zip 上传，发链接给客户在线看效果，对方无需本地环境。"
        },
        {
          id: "docs-to-web",
          title: "文档网页化",
          desc: "PDF / Markdown / DOCX 一键转为带目录的可分享网页，适合文档、笔记、草稿。"
        }
      ]
    },
    workflow: {
      title: "从代码到全球",
      subtitle: "极简的发布流程，集成了企业级的基础设施能力。",
      steps: [
        {
          title: "本地构建",
          desc: "使用您熟悉的工具构建项目，生成静态文件。",
          tags: ["任意框架", "零配置"]
        },
        {
          title: "上传部署",
          desc: "将构建产物打包为 zip，直接拖拽上传。",
          tags: ["秒级处理", "安全扫描"]
        },
        {
          title: "全球分发",
          desc: "自动分发至全球边缘节点，即刻访问。",
          tags: ["全球 CDN", "DDoS 防护", "自动 HTTPS", "独立域名"]
        }
      ]
    },
    cta: {
      title: "准备好发布了吗？",
      subtitle: "上传你的页面，30 秒拿到一个能打开的链接。",
      start_btn: "立即上传",
      contact_btn: "查看套餐"
    },
    footer: {
      copyright: "Demox © 2025",
      terms: "条款",
      privacy: "隐私",
      status: "状态",
      twitter: "Twitter"
    }
  },
  en: {
    hero: {
      version: `v${siteConfig.version} is now live`,
      title_start: "Upload your build,",
      title_end: "get a link that opens.",
      desc: "For frontend demos, AI-generated pages, client previews, and turning PDF/Markdown/DOCX into web pages. No server, CDN, or HTTPS config.",
      start_btn: "Upload now",
      examples_btn: "See 30s examples"
    },
    terminal: {
      title: "bash — 80x24",
      cmd: "demox deploy",
      init: "Initializing deployment engine...",
      bundling: "Bundling assets...",
      bundling_done: "Done (0.4s)",
      uploading: "Uploading to Edge Network...",
      uploading_done: "Done (1.2s)",
      success: "Success! Deployed to:",
      url: "https://project-gamma.demox.site"
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
          url: "https://project-gamma.demox.site",
          cmd: "cd my-app && npm run build && demox deploy ./dist"
        },
        {
          tag: "Markdown to web",
          title: "Docs as a shareable page",
          desc: "Upload a .md file; built-in templates render it as a page with a table of contents.",
          url: "https://project-gamma.demox.site",
          cmd: "demox deploy README.md"
        },
        {
          tag: "AI-published page",
          title: "Ship AI-generated pages instantly",
          desc: "After Claude/Cursor/v0 generates HTML, publish via CLI or MCP — no server setup.",
          url: "https://project-gamma.demox.site",
          cmd: "demox deploy ./ai-generated.html"
        }
      ]
    },
    useCases: {
      title: "What can I use it for?",
      subtitle: "Four common publishing scenarios — get a link in 30 seconds for each.",
      try_btn: "Try it now",
      items: [
        {
          id: "frontend-demo",
          title: "Frontend Demo",
          desc: "Zip Vite / Next / CRA build output and get a shareable link in seconds — perfect for portfolios and team previews."
        },
        {
          id: "ai-page",
          title: "AI-Generated Pages",
          desc: "Skip server setup for Claude / Cursor / v0 HTML — publish directly to the edge via CLI or MCP."
        },
        {
          id: "client-review",
          title: "Client Review",
          desc: "Upload your prototype zip and send the link to clients — they review online with no local env needed."
        },
        {
          id: "docs-to-web",
          title: "Docs to Web",
          desc: "Turn PDF / Markdown / DOCX into a shareable web page with a table of contents — great for docs, notes, drafts."
        }
      ]
    },
    workflow: {
      title: "From Code to Global",
      subtitle:
        "Streamlined deployment workflow with enterprise-grade infrastructure built-in.",
      steps: [
        {
          title: "Build Locally",
          desc: "Build your project with familiar tools to generate static files.",
          tags: ["Any Framework", "No Config"]
        },
        {
          title: "Upload & Deploy",
          desc: "Zip your artifacts and drag-and-drop to upload directly.",
          tags: ["Instant Processing", "Security Scan"]
        },
        {
          title: "Global Distribution",
          desc: "Automatically distributed to global edge nodes for instant access.",
          tags: ["Global CDN", "DDoS Protection", "Auto HTTPS", "Custom Domain"]
        }
      ]
    },
    cta: {
      title: "Ready to ship?",
      subtitle: "Upload your page and get a working link in 30 seconds.",
      start_btn: "Upload now",
      contact_btn: "View plans"
    },
    footer: {
      copyright: "Demox © 2025",
      terms: "Terms",
      privacy: "Privacy",
      status: "Status",
      twitter: "Twitter"
    }
  }
};

const CloudHostLanding: React.FC = () => {
  const { language: lang } = useLanguage();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  const t = translations[lang];

  useEffect(() => {
    track("landing_view");
    const checkLoginState = () => {
      const currentUser = userManager.get();
      if (currentUser) {
        setUser(currentUser);
      }
    };
    checkLoginState();
  }, []);

  const handleLoginSuccess = () => {
    const currentUser = userManager.get();
    if (currentUser) {
      setUser(currentUser);
    }
    navigate("/console/projects");
  };

  const scrollToExamples = () => {
    document.getElementById("examples")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <MainLayout>
      <section className="pt-24 pb-20 md:pt-32 md:pb-32 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-line)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10" />

        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--stitch-line)] bg-[var(--stitch-surface)] mb-8">
            <span className="flex h-2 w-2 rounded-full bg-zinc-400 animate-pulse"></span>
            <span className="text-xs font-mono text-zinc-400">
              {t.hero.version}
            </span>
          </div>

          <h1
            className={`font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-zinc-100 to-zinc-500 ${
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

          <p className="text-lg md:text-xl text-zinc-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            {t.hero.desc}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={() => {
                track("deploy_click", { source: "hero" });
                user ? navigate("/console/projects") : setIsLoginOpen(true);
              }}
              className="w-full sm:w-auto px-8 py-3 bg-[var(--stitch-ink)] text-[var(--stitch-surface)] font-semibold rounded-xl hover:-translate-y-1 transition-transform duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]"
            >
              {t.hero.start_btn}
            </button>
            <button
              onClick={scrollToExamples}
              className="w-full sm:w-auto px-8 py-3 border border-[var(--stitch-line)] text-[var(--stitch-ink)] rounded-xl transition-colors font-medium flex items-center justify-center gap-2 hover:border-[var(--stitch-muted)]"
            >
              <ExternalLink size={16} />
              {t.hero.examples_btn}
            </button>
          </div>

          <div className="max-w-2xl mx-auto rounded-2xl overflow-hidden border border-[var(--stitch-line)] bg-[var(--stitch-surface)] shadow-2xl relative group">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[var(--stitch-muted)]/40"></div>
                <div className="w-3 h-3 rounded-full bg-[var(--stitch-muted)]/40"></div>
                <div className="w-3 h-3 rounded-full bg-[var(--stitch-muted)]/40"></div>
              </div>
              <div className="flex-1 text-center">
                <span className="text-xs text-zinc-500 font-mono">
                  {t.terminal.title}
                </span>
              </div>
            </div>
            <div className="p-6 text-left font-mono text-sm md:text-base space-y-2">
              <div className="flex items-center gap-2 text-zinc-400">
                <span className="text-green-500">➜</span>
                <span>~/project</span>
                <span className="text-zinc-600">$</span>
                <span className="text-zinc-100">{t.terminal.cmd}</span>
              </div>
              <div className="text-zinc-500">{t.terminal.init}</div>
              <div className="text-zinc-500">
                {t.terminal.bundling}{" "}
                <span className="text-zinc-300">
                  {t.terminal.bundling_done}
                </span>
              </div>
              <div className="text-zinc-500">
                {t.terminal.uploading}{" "}
                <span className="text-zinc-300">
                  {t.terminal.uploading_done}
                </span>
              </div>
              <div className="pt-2 flex items-center gap-2 text-green-400">
                <CheckCircle2 size={16} />
                <span>{t.terminal.success}</span>
              </div>
              <div className="text-blue-400 underline decoration-blue-400/30 underline-offset-4 cursor-pointer hover:text-blue-300">
                {t.terminal.url}
              </div>
            </div>

            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/20 to-transparent pointer-events-none" />
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-[var(--stitch-bg)] relative overflow-hidden">
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-20">
            <h2 className="text-3xl md:text-5xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-500">
              {t.workflow.title}
            </h2>
            <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
              {t.workflow.subtitle}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 relative">
            {[
              {
                icon: <Package className="text-blue-400" size={32} />,
                ...t.workflow.steps[0]
              },
              {
                icon: <UploadCloud className="text-purple-400" size={32} />,
                ...t.workflow.steps[1]
              },
              {
                icon: <Rocket className="text-pink-400" size={32} />,
                ...t.workflow.steps[2]
              }
            ].map((step, i) => (
              <div
                key={i}
                className="flex flex-col items-center text-center group"
              >
                {/* Glassmorphism Icon Circle */}
                <div className="w-24 h-24 rounded-full bg-[var(--stitch-blue-soft)] backdrop-blur-md border border-[var(--stitch-line)] flex items-center justify-center mb-8 relative z-10 transition-transform duration-500 group-hover:scale-110 group-hover:border-[var(--stitch-line)] shadow-[0_0_30px_-10px_rgba(255,255,255,0.1)]">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  {step.icon}
                  {/* Step Number Badge */}
                  <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] text-[var(--stitch-muted)] flex items-center justify-center font-mono text-sm font-bold">
                    {i + 1}
                  </div>
                </div>

                <h3 className="text-xl font-bold mb-3 text-white">
                  {step.title}
                </h3>
                <p className="text-zinc-400 leading-relaxed mb-6 h-12">
                  {step.desc}
                </p>

                {/* Tech Badges */}
                <div className="flex flex-wrap justify-center gap-2">
                  {step.tags.map((tag, tagIndex) => (
                    <span
                      key={tagIndex}
                      className="px-3 py-1 rounded-full text-xs font-medium bg-[var(--stitch-surface)] border border-[var(--stitch-line)] text-[var(--stitch-muted)] group-hover:border-[var(--stitch-muted)] transition-colors"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 用例区：我能用它做什么 */}
      <section id="use-cases" className="py-24 px-4 border-t border-[var(--stitch-line)]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
              {t.useCases.title}
            </h2>
            <p className="text-zinc-400">{t.useCases.subtitle}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {t.useCases.items.map((uc, i) => {
              const icon =
                i === 0 ? <Package className="w-5 h-5" />
                : i === 1 ? <Sparkles className="w-5 h-5" />
                : i === 2 ? <UploadCloud className="w-5 h-5" />
                : <FileText className="w-5 h-5" />;
              return (
                <div
                  key={uc.id}
                  className="group rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-6 hover:border-[var(--stitch-muted)] transition-colors flex flex-col"
                >
                  <div className="w-10 h-10 rounded-lg bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] flex items-center justify-center text-[var(--stitch-muted)] group-hover:text-white transition-colors mb-4">
                    {icon}
                  </div>
                  <h3 className="text-base font-bold mb-2 text-white">{uc.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed mb-5 flex-1">{uc.desc}</p>
                  <button
                    onClick={() => {
                      track("usecase_click", { case: uc.id });
                      user ? navigate("/console/projects") : setIsLoginOpen(true);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] text-xs font-medium text-[var(--stitch-ink)] hover:border-[var(--stitch-blue)] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t.useCases.try_btn}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 示例区：3 个真实可打开示例 */}
      <section id="examples" className="py-24 px-4 border-t border-[var(--stitch-line)]">
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
                i === 0 ? <Package className="w-5 h-5" />
                : i === 1 ? <FileText className="w-5 h-5" />
                : <Sparkles className="w-5 h-5" />;
              return (
                <div
                  key={i}
                  className="group relative rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-6 hover:border-[var(--stitch-muted)] transition-colors flex flex-col"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-9 h-9 rounded-lg bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] flex items-center justify-center text-[var(--stitch-muted)] group-hover:text-white transition-colors">
                      {icon}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] text-[var(--stitch-muted)] font-mono">
                      {ex.tag}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-2 text-white">{ex.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed mb-4 flex-1">{ex.desc}</p>
                  <div className="rounded-lg bg-[var(--stitch-surface-strong)] border border-[var(--stitch-line)] px-3 py-2 mb-4 flex items-center gap-2">
                    <Code2 className="w-3.5 h-3.5 text-[var(--stitch-muted)] shrink-0" />
                    <code className="text-xs text-[var(--stitch-muted)] font-mono truncate">{ex.cmd}</code>
                  </div>
                  <a
                    href={ex.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track("example_click", { index: i, tag: ex.tag })}
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
              onClick={() => (user ? navigate("/console/projects") : setIsLoginOpen(true))}
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
