import React, { useState, useEffect } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  CheckCircle2,
  PartyPopper,
  Hammer,
  Rocket,
  Sparkles,
  Terminal,
  Ghost
} from "lucide-react";
import { MainLayout } from "@/layouts/MainLayout";

const LogPage: React.FC = () => {
  const [typedText, setTypedText] = useState("");
  const fullText = "Evolution";

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      setTypedText(fullText.slice(0, i + 1));
      i++;
      if (i === fullText.length) clearInterval(interval);
    }, 150);
    return () => clearInterval(interval);
  }, []);

  return (
    <MainLayout>
      <div className="selection:bg-zinc-800 selection:text-green-400 p-8 md:p-20">
        <div className="max-w-3xl mx-auto">
          <header className="mb-20 text-center relative">
            <h1 className="text-6xl md:text-8xl font-bold tracking-tighter mb-4">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-200 to-zinc-600">
                {typedText}
              </span>
              <span className="animate-pulse text-green-500">_</span>
            </h1>
            <p className="text-zinc-500 font-mono">
              changelog.md but make it{" "}
              <span className="text-green-400">fashion</span>
            </p>
          </header>

          <div className="relative border-l-2 border-zinc-800 ml-4 md:ml-0 space-y-24">
            <Section
              title="It Works on My Machine"
              subtitle="已上线"
              icon={<CheckCircle2 className="text-black" size={20} />}
              color="bg-green-500"
              lineColor="border-green-500"
              glow="shadow-[0_0_20px_rgba(34,197,94,0.3)]"
            >
              <TimelineItem
                version="v0.6.0"
                name="流量密码 (The Traffic Hack)"
                date="2025-12-26"
                dateNote="(假装我们在做增长)"
              >
                <Feature
                  tag="SEO"
                  title="搜索引擎优化"
                  desc="终于想起来做 SEO 了。Meta 标签、Sitemap、Open Graph 全套安排。虽然大概率还是搜不到，但至少我们给爬虫留了门。"
                  note="只要关键词够多，我就能上首页（做梦）。"
                />
              </TimelineItem>

              <TimelineItem
                version="v0.5.0"
                name="认清现实 (The Reality Check)"
                date="2025-12-26"
                dateNote="(版本号倒退是种艺术)"
              >
                <Feature
                  tag="Refactor"
                  title="Layout 大装修"
                  desc="前端重构了 layout 部分。之前的代码像意大利面，现在的像千层面——至少有层了。"
                  note="为了看起来更专业，我们把能居中的都居中了。"
                />
                <Feature
                  tag="Fix"
                  title="黄油手补丁"
                  desc="修复了不能拖拽上传的问题。现在你可以优雅地把文件甩进窗口，而不是像个原始人一样点击‘选择文件’。"
                />
                <Feature
                  tag="Security"
                  title="门卫大爷上岗"
                  desc="增加了鉴权与角色校验。现在不是谁都能进来了，虽然我们要防的人可能根本不存在。"
                  note="Role: 'God' 模式开发中。"
                />
                <Feature
                  tag="Fix"
                  title="导航栏精神分裂症"
                  desc="修复了“首页”和“控制台”导航栏长得像两个妈生的 Bug。"
                  note="原因：某位热心网友指出这看起来很“割裂”，为了不被设计师打死，我们决定改了。"
                />
                <Feature
                  tag="Optim"
                  title="上传宽容度"
                  desc="正在教服务器学会翻箱倒柜。以后不管你把 index.html 藏在哪个子文件夹里，我们都能把它揪出来。"
                />
              </TimelineItem>

              <TimelineItem
                version="v0.3.0"
                name="秩序重建 (Order Restored)"
                date="2025-12-25"
                dateNote="(圣诞节的礼物是代码整洁)"
              >
                <Feature
                  tag="Optim"
                  title="ID 系统大扫除"
                  desc="优化文件名处理、网站 ID 生成和删除逻辑。之前的 ID 像是乱码生成器，现在终于有了点人类逻辑。"
                  note="删除逻辑也修复了，现在“删除”真的意味着“消失”。"
                />
              </TimelineItem>

              <TimelineItem
                version="v0.2.0"
                name="独立日 (Independence Day)"
                date="2025-12-25"
                dateNote="(剪断脐带)"
              >
                <Feature
                  tag="Refactor"
                  title="告别 Weda"
                  desc="重构网站部署逻辑，移除 Weda 依赖并优化云。我们终于不再依赖外部输血，学会了独立呼吸。"
                  note="云端资源已优化，服务器松了一口气。"
                />
              </TimelineItem>

              <TimelineItem
                version="v0.1.0"
                name="创世纪 (Genesis)"
                date="2025-12-25"
                dateNote="(圣诞节还在写代码，你是魔鬼吗？)"
              >
                <Feature
                  tag="Feature"
                  title="拖拽部署"
                  desc="支持把 .zip 甩到脸上。因为我们知道你懒得输 scp 命令。"
                  note="Dev Note: 实际上只支持根目录 index.html，别试探我的底线。"
                />

                <Feature
                  tag="Style"
                  title="暗黑模式"
                  desc="默认全黑。为了保护你的视网膜，也为了省点电费。"
                />
              </TimelineItem>
            </Section>

            <Section
              title="Roadmap to Glory"
              subtitle="画的大饼"
              icon={<Sparkles className="text-black" size={20} />}
              color="bg-zinc-100"
              lineColor="border-dashed border-zinc-700"
              ghost
            >
              <TimelineItem
                version="Soon™"
                name="下周一定 (Next Week for Sure)"
                date="Coming..."
              >
                <Feature
                  tag="Refactor"
                  title="控制台整容手术"
                  desc="目前的控制台丑得像是我用脚写的 CSS。我们将进行一次彻底的整容，争取让它看起来不像是一个后端工程师的业余作品。"
                  note="设计师已经提刀在路上了。"
                />
                <Feature
                  tag="Copywriting"
                  title="尝试说人话"
                  desc="首页现在的文案充满了‘赋能’、‘抓手’这种黑话。我们要把它改成人类能看懂的语言，停止假装我们在改变世界。"
                />
                <Feature
                  tag="Open Source"
                  title="代码开源 (公开处刑)"
                  desc="我们要把这一坨代码传到 GitHub 上了。链接即将更新，届时欢迎大家来 Review (Roast) 我的代码。"
                  note="请轻喷，我也知道写得很烂。"
                />
              </TimelineItem>

              <TimelineItem version="v1.0" name="项目的诞生 (Projectization)">
                <Feature
                  tag="New"
                  title="项目归档"
                  desc="终于不再全是 deployment_final_v2_really_final.zip 了。我们要引入“项目”概念，让你乱糟糟的代码有个家。"
                />
                <Feature
                  tag="New"
                  title="单文件极简主义"
                  desc="支持直接上传单 html 页面。有时候你只是想写个 Hello World，不需要把它打包成一个 2KB 的 zip 还要假装它是个工程。"
                />
                <Feature
                  tag="New"
                  title="版本回退 (后悔药)"
                  desc="当你周五下午 5 点发布的更新把生产环境搞挂时，点这个按钮可以保住你的饭碗。"
                />
              </TimelineItem>

              <TimelineItem version="v3.0" name="氪金时代 (Premium Era)">
                <Feature
                  tag="New"
                  title="自定义域名"
                  desc="告别 project-gamma.demox.app 这种看起来像诈骗网站的域名。换上你自己的 .com，假装自己是大厂。"
                />
                <Feature
                  tag="New"
                  title="构建日志"
                  desc="如果部署失败了，我们会告诉你死在哪一行，而不是只回你一个高冷的 Error。"
                />
              </TimelineItem>
            </Section>
          </div>

          <footer className="mt-32 pb-10 text-center space-y-4">
            <p className="text-zinc-600 text-xs">
              本站由 Demox 强力驱动（禁止套娃部署本站）
            </p>
          </footer>
        </div>
      </div>
    </MainLayout>
  );
};

// Sub-components

const Section = ({
  title,
  subtitle,
  icon,
  children,
  color,
  lineColor,
  glow,
  isBlinking,
  ghost
}: any) => {
  const { scrollYProgress } = useScroll();

  return (
    <div
      className={`relative pl-8 md:pl-12 ${
        ghost
          ? "opacity-60 hover:opacity-100 transition-opacity duration-500"
          : ""
      }`}
    >
      {/* Icon Node */}
      <div
        className={`absolute -left-[13px] md:-left-[21px] top-0 flex items-center justify-center w-6 h-6 md:w-10 md:h-10 rounded-full ${color} ${glow} ${
          isBlinking ? "animate-pulse" : ""
        } z-10`}
      >
        {icon}
      </div>

      <div className="mb-8">
        <h2
          className={`text-2xl md:text-3xl font-bold flex items-center gap-3 ${
            ghost ? "text-zinc-400" : "text-zinc-100"
          }`}
        >
          {title}
          <span
            className={`text-sm px-2 py-1 rounded border ${
              ghost
                ? "border-zinc-700 text-zinc-500"
                : `border-zinc-700 bg-zinc-900 text-zinc-400`
            }`}
          >
            {subtitle}
          </span>
        </h2>
      </div>

      <div className="space-y-12">{children}</div>
    </div>
  );
};

const TimelineItem = ({ version, name, date, dateNote, children }: any) => {
  return (
    <div className="relative group">
      <div className="mb-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3 className="text-xl font-mono font-bold text-green-400">
            {version}
          </h3>
          <span className="text-lg font-bold text-zinc-200">{name}</span>
        </div>
        {date && (
          <div className="text-sm text-zinc-500 font-mono mt-1">
            {date} <span className="text-zinc-600 italic">{dateNote}</span>
          </div>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
};

const Feature = ({ tag, title, desc, note }: any) => {
  return (
    <motion.div
      whileHover={{ x: 10 }}
      className="p-4 rounded-lg bg-zinc-900/30 border border-zinc-800/50 hover:bg-zinc-900/80 hover:border-zinc-700 transition-all relative group"
    >
      <div className="flex items-start gap-3">
        <span className="text-xs font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono uppercase tracking-wider shrink-0 mt-0.5">
          {tag}
        </span>
        <div>
          <h4 className="font-bold text-zinc-300 mb-1">{title}</h4>
          <p className="text-zinc-400 text-sm leading-relaxed">{desc}</p>
        </div>
      </div>

      {/* Hover Note Tooltip */}
      {note && (
        <div className="absolute -top-12 left-10 md:left-auto md:right-0 bg-yellow-900/90 text-yellow-100 text-xs px-3 py-2 rounded border border-yellow-700/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-normal md:whitespace-nowrap max-w-[200px] md:max-w-none z-20">
          {/* Triangle */}
          <div className="absolute bottom-[-6px] left-4 md:left-auto md:right-4 w-3 h-3 bg-yellow-900/90 border-r border-b border-yellow-700/50 rotate-45 transform"></div>
          {note}
        </div>
      )}
    </motion.div>
  );
};

export default LogPage;
