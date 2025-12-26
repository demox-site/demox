import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../cloudbase";
import { AuthDialog } from "../components/AuthDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../components/ui/tooltip";
import {
  Terminal,
  Zap,
  Globe,
  Lock,
  Cpu,
  Command,
  CheckCircle2
} from "lucide-react";

import { useLanguage } from "../hooks/use-language";
import { siteConfig } from "@/configs/env";
import { MainLayout } from "@/layouts/MainLayout";

const translations = {
  zh: {
    navbar: {
      pricing: "价格",
      log: "日志",
      login: "登录",
      console: "控制台",
      logout: "退出"
    },
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
      url: "https://project-gamma.demox.app"
    },
    features: [
      {
        title: "极速体验",
        desc: "全球边缘网络确保您的网站在毫秒级加载，无论用户身在何处。"
      },
      {
        title: "自定义域名",
        desc: "秒级绑定您的域名，自动配置和更新 SSL 证书。"
      },
      {
        title: "企业级安全",
        desc: "开箱即用的 DDoS 防护、托管 WAF 和 SOC2 合规性。"
      }
    ],
    how_it_works: {
      title: "从本地到全球",
      subtitle: "简单三步，部署您的应用。",
      steps: [
        {
          title: "连接",
          desc: "关联您的 GitHub 仓库或使用我们的 CLI 进行初始化。"
        },
        {
          title: "构建",
          desc: "我们自动检测您的框架并构建您的网站。"
        },
        {
          title: "部署",
          desc: "即时不可变部署，生成唯一访问 URL。"
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
    navbar: {
      pricing: "Pricing",
      log: "Log",
      login: "Login",
      console: "Console",
      logout: "Logout"
    },
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
      url: "https://project-gamma.demox.app"
    },
    features: [
      {
        title: "Lightning Fast",
        desc: "Global edge network ensures your site loads in milliseconds, no matter where your users are."
      },
      {
        title: "Custom Domains",
        desc: "Map your own domain in seconds with automatic SSL provisioning and renewal."
      },
      {
        title: "Enterprise Security",
        desc: "DDoS protection, managed WAF, and SOC2 compliance out of the box."
      }
    ],
    how_it_works: {
      title: "From Local to Global",
      subtitle: "Three simple steps to deploy your application.",
      steps: [
        {
          title: "Connect",
          desc: "Link your GitHub repository or use our CLI to initialize."
        },
        {
          title: "Build",
          desc: "We automatically detect your framework and build your site."
        },
        {
          title: "Deploy",
          desc: "Instant immutable deployments with a unique URL."
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
    const checkLoginState = async () => {
      const loginState = await auth.getLoginState();
      if (loginState) {
        setUser(loginState.user);
      }
    };
    checkLoginState();
  }, []);

  const handleLoginSuccess = async () => {
    const loginState = await auth.getLoginState();
    if (loginState) {
      setUser(loginState.user);
    }
    navigate("/home");
  };

  return (
    <MainLayout>
      <section className="pt-24 pb-20 md:pt-32 md:pb-32 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] -z-10" />

        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-900/50 mb-8">
            <span className="flex h-2 w-2 rounded-full bg-zinc-400 animate-pulse"></span>
            <span className="text-xs font-mono text-zinc-400">
              {t.hero.version}
            </span>
          </div>

          <h1
            className={`font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-zinc-100 to-zinc-500 ${
              lang === "zh"
                ? "text-4xl md:text-5xl lg:text-6xl"
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
              onClick={() => (user ? navigate("/home") : setIsLoginOpen(true))}
              className="w-full sm:w-auto px-8 py-3 bg-zinc-100 text-black font-semibold rounded-md hover:-translate-y-1 transition-transform duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]"
            >
              {t.hero.start_btn}
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="w-full sm:w-auto px-8 py-3 border border-zinc-800 text-zinc-500 rounded-md transition-colors font-mono text-sm flex items-center justify-center gap-2 group cursor-not-allowed line-through decoration-zinc-500 opacity-50">
                  <Terminal size={16} />
                  {t.hero.install_cmd}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t.hero.install_tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="max-w-2xl mx-auto rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl relative group">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
                <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
                <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
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

      <section className="py-24 px-4 border-t border-zinc-900 bg-zinc-950/30">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: <Zap className="text-zinc-100" size={24} />,
                title: t.features[0].title,
                desc: t.features[0].desc
              },
              {
                icon: <Globe className="text-zinc-100" size={24} />,
                title: t.features[1].title,
                desc: t.features[1].desc
              },
              {
                icon: <Lock className="text-zinc-100" size={24} />,
                title: t.features[2].title,
                desc: t.features[2].desc
              }
            ].map((feature, i) => (
              <div
                key={i}
                className="p-6 rounded-lg border border-zinc-900 bg-zinc-950/50 hover:border-zinc-700 transition-colors group"
              >
                <div className="w-12 h-12 rounded-lg bg-zinc-900 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold mb-2 text-zinc-100">
                  {feature.title}
                </h3>
                <p className="text-zinc-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-black relative">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              {t.how_it_works.title}
            </h2>
            <p className="text-zinc-400">{t.how_it_works.subtitle}</p>
          </div>

          <div className="relative">
            <div className="hidden md:block absolute top-12 left-0 w-full h-[2px] bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 z-0"></div>

            <div className="grid md:grid-cols-3 gap-12 relative z-10">
              {[
                {
                  step: "01",
                  title: t.how_it_works.steps[0].title,
                  icon: <Command size={32} />,
                  desc: t.how_it_works.steps[0].desc
                },
                {
                  step: "02",
                  title: t.how_it_works.steps[1].title,
                  icon: <Cpu size={32} />,
                  desc: t.how_it_works.steps[1].desc
                },
                {
                  step: "03",
                  title: t.how_it_works.steps[2].title,
                  icon: <Globe size={32} />,
                  desc: t.how_it_works.steps[2].desc
                }
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center text-center">
                  <div className="w-24 h-24 rounded-full bg-black border border-zinc-800 flex items-center justify-center mb-6 relative group">
                    <div className="absolute inset-0 rounded-full bg-zinc-900/50 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative text-zinc-100">{item.icon}</div>
                    <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-zinc-100 text-black flex items-center justify-center font-bold text-sm">
                      {item.step}
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 border-t border-zinc-900">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-6">{t.cta.title}</h2>
          <p className="text-zinc-400 mb-8">{t.cta.subtitle}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => (user ? navigate("/home") : setIsLoginOpen(true))}
              className="w-full sm:w-auto px-8 py-3 bg-white text-black font-bold rounded-md hover:bg-zinc-200 transition-colors"
            >
              {t.cta.start_btn}
            </button>
            <button
              onClick={() => navigate("/pricing")}
              className="w-full sm:w-auto px-8 py-3 bg-zinc-900 text-white font-medium rounded-md border border-zinc-800 hover:bg-zinc-800 transition-colors"
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
