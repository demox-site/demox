import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { userManager } from "../api";
import { AuthDialog } from "../components/AuthDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../components/ui/tooltip";
import {
  Terminal,
  Package,
  UploadCloud,
  Rocket,
  CheckCircle2,
  ChevronRight
} from "lucide-react";

import { useLanguage } from "../hooks/use-language";
import { siteConfig } from "@/configs/env";
import { MainLayout } from "@/layouts/MainLayout";
import { FeatureIcon } from "@/components/ui/feature-icon";

const translations = {
  zh: {
    hero: {
      version: `v${siteConfig.version} 现已发布`,
      title_start: "部署，从未如此简单",
      title_end: "",
      desc: "拖拽，上传，全球 CDN 分发。无需配置。专为追求速度的开发者设计。",
      start_btn: "试试这个空项目",
      install_cmd: "npm install -g demox",
      install_tooltip: "太麻烦了，我们不兴这个。"
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
      subtitle: "加入 10,000+ 开发者，共同构建未来的 Web。",
      start_btn: "立即白嫖",
      contact_btn: "查看昂贵的套餐"
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
      title_start: "Deploy Static Sites.",
      title_end: "Instantly.",
      desc: "Drag, drop, global CDN. No config required. Designed for developers who want speed without the hassle.",
      start_btn: "Try this empty project",
      install_cmd: "npm install -g demox",
      install_tooltip: "Too much trouble. We don't do this."
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
      subtitle: "Join 10,000+ developers building the future of the web.",
      start_btn: "Get Started for Free",
      contact_btn: "Contact Sales"
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
    navigate("/console/sites");
  };

  return (
    <MainLayout>
      <section className="pt-24 pb-20 md:pt-32 md:pb-32 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid-line)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[min(100%,42rem)] h-80 bg-brand/12 rounded-full blur-[100px] -z-10 pointer-events-none" />
        <div className="absolute top-32 right-[8%] w-64 h-64 bg-step-2/8 rounded-full blur-[80px] -z-10 pointer-events-none hidden md:block" />
        <div className="absolute top-48 left-[6%] w-48 h-48 bg-step-3/8 rounded-full blur-[70px] -z-10 pointer-events-none hidden md:block" />

        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-brand/25 bg-brand/5 mb-8">
            <span className="flex h-2 w-2 rounded-full bg-brand animate-pulse shadow-[0_0_8px_hsl(var(--brand)/0.7)]" />
            <span className="text-xs font-mono text-brand">
              {t.hero.version}
            </span>
          </div>

          <h1
            className={`font-bold tracking-tight mb-6 ${
              lang === "zh"
                ? "text-4xl md:text-5xl lg:text-6xl"
                : "text-5xl md:text-7xl"
            }`}
          >
            {lang === "zh" ? (
              <>
                <span className="text-foreground">部署，从未如此</span>
                <span className="text-brand">简单</span>
              </>
            ) : (
              <>
                <span className="bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
                  {t.hero.title_start}
                </span>
                <br />
                <span className="text-brand">{t.hero.title_end}</span>
              </>
            )}
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            {t.hero.desc}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={() => (user ? navigate("/console/sites") : setIsLoginOpen(true))}
              className="w-full sm:w-auto px-8 py-3 bg-brand text-brand-foreground font-semibold rounded-md shadow-[0_0_24px_hsl(var(--brand)/0.35)] hover:shadow-[0_0_36px_hsl(var(--brand)/0.5)] hover:-translate-y-0.5 transition-all duration-300"
            >
              {t.hero.start_btn}
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="w-full sm:w-auto px-8 py-3 border border-border text-muted-foreground rounded-md transition-colors font-mono text-sm flex items-center justify-center gap-2 group cursor-not-allowed line-through decoration-muted-foreground opacity-50">
                  <Terminal size={16} />
                  {t.hero.install_cmd}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t.hero.install_tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="max-w-2xl mx-auto rounded-lg overflow-hidden border border-brand/20 bg-card shadow-[0_0_40px_-10px_hsl(var(--brand)/0.25)] relative group">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/50">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
              </div>
              <div className="flex-1 text-center">
                <span className="text-xs text-muted-foreground font-mono">
                  {t.terminal.title}
                </span>
              </div>
            </div>
            <div className="p-6 text-left font-mono text-sm md:text-base space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ChevronRight className="w-4 h-4 text-success shrink-0" />
                <span>~/project</span>
                <span className="text-muted-foreground/70">$</span>
                <span className="text-foreground">{t.terminal.cmd}</span>
              </div>
              <div className="text-muted-foreground">{t.terminal.init}</div>
              <div className="text-muted-foreground">
                {t.terminal.bundling}{" "}
                <span className="text-foreground/80">
                  {t.terminal.bundling_done}
                </span>
              </div>
              <div className="text-muted-foreground">
                {t.terminal.uploading}{" "}
                <span className="text-foreground/80">
                  {t.terminal.uploading_done}
                </span>
              </div>
              <div className="pt-2 flex items-center gap-2 text-success">
                <CheckCircle2 size={16} />
                <span>{t.terminal.success}</span>
              </div>
              <div className="text-link underline decoration-link/30 underline-offset-4 cursor-pointer hover:opacity-80">
                {t.terminal.url}
              </div>
            </div>

            <div className="absolute inset-0 bg-gradient-to-t from-brand/5 to-transparent pointer-events-none" />
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-muted/30 relative overflow-hidden border-y border-border">
        <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-step-2/40 to-transparent -translate-y-1/2 hidden md:block pointer-events-none" />
        <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-step-3/30 to-transparent translate-y-px hidden md:block blur-sm pointer-events-none" />
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[min(100%,36rem)] h-48 bg-brand/8 rounded-full blur-[80px] pointer-events-none" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-20">
            <h2 className="text-3xl md:text-5xl font-bold mb-6">
              <span className="text-foreground">{lang === "zh" ? "从代码到" : "From Code to "}</span>
              <span className="text-brand">{lang === "zh" ? "全球" : "Global"}</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              {t.workflow.subtitle}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 relative">
            <div className="hidden md:block absolute top-12 left-[20%] right-[20%] h-px bg-gradient-to-r from-step-1/50 via-step-2/50 to-step-3/50 pointer-events-none" />

            {[
              {
                icon: Package,
                variant: "step-1" as const,
                ...t.workflow.steps[0]
              },
              {
                icon: UploadCloud,
                variant: "step-2" as const,
                ...t.workflow.steps[1]
              },
              {
                icon: Rocket,
                variant: "step-3" as const,
                ...t.workflow.steps[2]
              }
            ].map((step, i) => (
              <div
                key={i}
                className="flex flex-col items-center text-center group"
              >
                <div className="relative mb-8">
                  <FeatureIcon
                    icon={step.icon}
                    size="lg"
                    variant={step.variant}
                    className="group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-background border border-border text-muted-foreground flex items-center justify-center font-mono text-sm font-bold shadow-sm">
                    {i + 1}
                  </div>
                </div>

                <h3 className="text-xl font-bold mb-3 text-foreground">
                  {step.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed mb-6 h-12">
                  {step.desc}
                </p>

                <div className="flex flex-wrap justify-center gap-2">
                  {step.tags.map((tag, tagIndex) => (
                    <span
                      key={tagIndex}
                      className="px-3 py-1 rounded-full text-xs font-medium bg-muted/80 border border-border text-muted-foreground group-hover:border-foreground/20 transition-colors"
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

      <section className="py-24 px-4 border-t border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand/5 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-4xl font-bold mb-6">{t.cta.title}</h2>
          <p className="text-muted-foreground mb-8">{t.cta.subtitle}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => (user ? navigate("/console/sites") : setIsLoginOpen(true))}
              className="w-full sm:w-auto px-8 py-3 bg-brand text-brand-foreground font-bold rounded-md shadow-[0_0_24px_hsl(var(--brand)/0.35)] hover:shadow-[0_0_36px_hsl(var(--brand)/0.5)] hover:-translate-y-0.5 transition-all duration-300"
            >
              {t.cta.start_btn}
            </button>
            <button
              onClick={() => navigate("/pricing")}
              className="w-full sm:w-auto px-8 py-3 bg-muted text-foreground font-medium rounded-md border border-border hover:bg-muted/80 transition-colors"
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
