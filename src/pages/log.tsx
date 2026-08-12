import React, { useState, useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { MainLayout } from "@/layouts/MainLayout";
import { siteConfig } from "@/configs/env";
import { useLanguage, type Language } from "@/hooks/use-language";

const logTranslations = {
  "已上线": "Live",
  "偷窥自己 (Know Thy Traffic)": "Know Thy Traffic",
  "(终于知道链接有没有人点了)": "(finally, you can tell whether anyone clicked your link)",
  "独立站点分析页": "Per-site analytics",
  "每个站点现在都有单独的分析页面，展示实时访问趋势、来源页面、访问路径、国家/省级地区分布和可视化地图。统计走边缘异步上报，不拖慢临时链接打开。":
    "Every site now has its own analytics page with live traffic trends, referrers, paths, country and regional breakdowns, and a visual map. Metrics are reported asynchronously at the edge, so shared links stay fast.",
  "不是监控你，是监控你的作品有没有被看。":
    "We're not watching you. We're checking whether anyone is watching your work.",
  "加密真实访问日志": "Encrypted access logs",
  "完整访问日志会加密写入私有对象存储，授权成员可以在分析页随时回看时间、IP、地区、路径、来源和设备信息。聚合数据每 5 分钟批量落 MySQL，原始日志不压数据库。":
    "Complete access logs are encrypted in private object storage. Authorized members can review timestamps, IPs, regions, paths, referrers, and device details from the analytics page. Aggregates are written to MySQL every five minutes, while raw logs stay out of the database.",
  "能查，但不裸奔。": "Searchable, but never exposed.",
  "增长数据后台化": "Growth metrics moved backstage",
  "Powered by Demox 点击仍会统计，但只作为后台增长指标，不再出现在普通用户的站点卡片或公开展示里。":
    "Clicks on Powered by Demox are still counted as internal growth metrics, but no longer appear on site cards or in public-facing views.",
  "数据库：谢谢你终于放过我。": "The database says: thanks for finally leaving me alone.",
  "边缘门禁 (Edge Gate)": "Edge Gate",
  "(门口有保安了)": "(there is finally a guard at the door)",
  "私有站点": "Private sites",
  "站点现在可以切换公开/私有。私有站点会在边缘层先拦截访问，未登录跳转 Demox 登录，登录后仍无权限则直接返回 Access denied。":
    "Sites can now be public or private. Private-site access is intercepted at the edge: signed-out visitors go to Demox sign-in, while signed-in users without permission receive Access denied.",
  "不是所有 URL 都该裸奔。": "Not every URL should run around in public.",
  "登录后跳回原站点": "Return to the original site after sign-in",
  "私有站点的登录流程会记住原访问地址，邮箱验证码和 GitHub 登录完成后都会自动跳回。":
    "The private-site sign-in flow remembers the original URL and returns you there after email-code or GitHub authentication.",
  "门卫终于知道你是来找哪一户的。": "The doorman finally knows which door you came for.",
  "海纳百川 (The Great Migration)": "The Great Migration",
  "(吃自己的狗粮，真香)": "(dogfooding tastes surprisingly good)",
  "多云存储桶注册制": "Registered multi-cloud buckets",
  "存储桶改为注册制，抽象出统一的存储层，密钥加密入库。多云时代的第一块砖，先把地基打牢。":
    "Storage buckets now use a registration model behind a unified storage layer, with credentials encrypted at rest. The first brick of our multi-cloud foundation is in place.",
  "目前还是单云，但架子已经搭好，吹牛不犯法。":
    "Still one cloud for now, but the scaffolding is ready. Aspirations are free.",
  "主站自托管": "The main site hosts itself",
  "本站不再走 GitHub Actions 传 COS，而是把自己当成一个普通用户站点，用 demox 部署 demox。":
    "The main site no longer ships to COS directly from GitHub Actions. It now behaves like any other user site: Demox deploys Demox.",
  "套娃部署成功，删桶根那次白屏的眼泪我们自己擦干了。":
    "Recursive deployment unlocked. We wiped away our own tears from that time the bucket root disappeared.",
  "一键自动发布": "One-push automated releases",
  "push 到 master 自动构建打包并发布到边缘网络，纯 curl 最小依赖。顺手把路由从 # 哈希切到了真·浏览器路由。":
    "A push to master now builds, packages, and publishes to the edge automatically with minimal curl-based dependencies. Routes also moved from hash URLs to real browser paths.",
  "地址栏里那个碍眼的 # 终于没了。": "That annoying # has finally left the address bar.",
  "DNS 与证书急救": "DNS and certificate rescue",
  "修复了首页打开慢十秒和 HTTPS 证书过期的连环坑，根因是 DNS 绕路。已把解析迁回，证书重新签发。":
    "Fixed the ten-second homepage delay and expired HTTPS certificate. DNS was taking the scenic route, so we moved resolution back and reissued the certificate.",
  "证书续期失败这种事，总在你睡着时发生。": "Certificate renewals only fail while you are asleep.",
  "认证觉醒 (The Awakening)": "The Awakening",
  "(终于有人管门了)": "(someone is finally minding the door)",
  "GitHub 一键登录": "One-click GitHub sign-in",
  "接入 GitHub OAuth，点一下就能登录或绑定账号。无主账号还能选择新建还是关联已有，不再偷偷帮你合并。":
    "GitHub OAuth now supports one-click sign-in and account linking. For unclaimed identities, you choose whether to create a new account or link an existing one; no more silent merges.",
  "毕竟你的 star 数就是你的尊严。": "Your star count is your dignity, after all.",
  "控制台大改造": "Console overhaul",
  "登录后的控制台从顶栏导航重构为独立的侧边栏 + 嵌套路由，营销页和控制台彻底分家。":
    "The signed-in console moved from top navigation to a dedicated sidebar with nested routes, finally separating the product console from the marketing site.",
  "终于不再像两个妈生的了。": "They finally look like they belong to the same family.",
  "自定义子域名": "Custom subdomains",
  "每个站点除了默认域名，还能挑一个好记的官方域名前缀，例如 {label}.demox.site 或 {label}.vibeme.cn。":
    "Each site can choose a memorable official subdomain in addition to its default domain, such as {label}.demox.site or {label}.vibeme.cn.",
  "抢一个好听的名字，手慢无。": "Claim a good name before someone else does.",
  "MCP 部署": "MCP deployments",
  "提供 MCP server，让 AI 助手直接帮你部署站点。你动嘴，它动手。":
    "An MCP server lets AI assistants deploy sites for you. You say it; they ship it.",
  "未来你可能连拖拽都懒得拖了。": "Soon even drag-and-drop may feel like too much work.",
  "主题三态切换": "Three-way theme switching",
  "新增 跟随系统 / 浅色 / 深色 三态主题，浅色模式由深色镜像反转而来，颜色体系全部走 CSS 变量。":
    "Added system, light, and dark theme modes. Light mode mirrors the dark palette, with the entire color system driven by CSS variables.",
  "白天党终于不用被亮瞎了。": "Daylight users can finally keep their retinas.",
  "井井有条 (Orderliness)": "Orderliness",
  "(强迫症狂喜)": "(a neat freak's dream)",
  "资源标签管理": "Resource tags",
  "增加了资源标签管理。终于不用在一堆乱七八糟的资源里大海捞针了，现在你可以优雅地给它们打上标签。":
    "Added resource tag management. No more searching through a pile of mystery resources; label them like a civilized person.",
  "整理使人快乐，虽然通常只能维持一天。": "Tidying sparks joy, even if it only lasts a day.",
  "名正言顺 (The Identity)": "The Identity",
  "(有了名字就有了灵魂)": "(a name gives it a soul)",
  "我们产品名定下来了 Demox，还有 Logo。这些真的很重要。":
    "We settled on the name Demox and got a logo. These things really do matter.",
  "感觉身价倍增。": "Our valuation feels higher already.",
  "流量密码 (The Traffic Hack)": "The Traffic Hack",
  "(假装我们在做增长)": "(pretending we know growth)",
  "搜索引擎优化": "Search engine optimization",
  "终于想起来做 SEO 了。Meta 标签、Sitemap、Open Graph 全套安排。虽然大概率还是搜不到，但至少我们给爬虫留了门。":
    "We finally remembered SEO: meta tags, sitemap, Open Graph, the whole set. Search engines may still ignore us, but at least the crawlers have a door.",
  "只要关键词够多，我就能上首页（做梦）。": "Enough keywords will put us on page one. In our dreams.",
  "认清现实 (The Reality Check)": "The Reality Check",
  "(版本号倒退是种艺术)": "(version regression is an art form)",
  "Layout 大装修": "Layout renovation",
  "前端重构了 layout 部分。之前的代码像意大利面，现在的像千层面——至少有层了。":
    "Refactored the frontend layout. It used to be spaghetti; now it is lasagna. At least it has layers.",
  "为了看起来更专业，我们把能居中的都居中了。": "To look more professional, we centered everything that could be centered.",
  "黄油手补丁": "Butterfingers patch",
  "修复了不能拖拽上传的问题。现在你可以优雅地把文件甩进窗口，而不是像个原始人一样点击‘选择文件’。":
    "Fixed broken drag-and-drop uploads. You can now toss files into the window instead of clicking Choose file like a caveman.",
  "门卫大爷上岗": "The bouncer clocks in",
  "增加了鉴权与角色校验。现在不是谁都能进来了，虽然我们要防的人可能根本不存在。":
    "Added authentication and role checks. Not everyone can walk in anymore, even if the people we are guarding against may not exist.",
  "Role: 'God' 模式开发中。": "Role: 'God' mode is under construction.",
  "导航栏精神分裂症": "Navigation identity crisis",
  "修复了“首页”和“控制台”导航栏长得像两个妈生的 Bug。":
    "Fixed the bug where the Home and Console navigation bars looked like they came from different products.",
  "原因：某位热心网友指出这看起来很“割裂”，为了不被设计师打死，我们决定改了。":
    "A helpful stranger called the design disconnected, so we fixed it before a designer could come after us.",
  "上传宽容度": "More forgiving uploads",
  "正在教服务器学会翻箱倒柜。以后不管你把 index.html 藏在哪个子文件夹里，我们都能把它揪出来。":
    "We are teaching the server to rummage through folders. Soon, wherever you hide index.html, we will find it.",
  "秩序重建 (Order Restored)": "Order Restored",
  "(圣诞节的礼物是代码整洁)": "(the Christmas gift is clean code)",
  "ID 系统大扫除": "ID system cleanup",
  "优化文件名处理、网站 ID 生成和删除逻辑。之前的 ID 像是乱码生成器，现在终于有了点人类逻辑。":
    "Improved filename handling, site ID generation, and deletion logic. IDs used to look like random noise; now they almost make human sense.",
  "删除逻辑也修复了，现在“删除”真的意味着“消失”。": "Deletion is fixed too. Delete now actually means disappear.",
  "独立日 (Independence Day)": "Independence Day",
  "(剪断脐带)": "(cutting the cord)",
  "告别 Weda": "Farewell, Weda",
  "重构网站部署逻辑，移除 Weda 依赖并优化云。我们终于不再依赖外部输血，学会了独立呼吸。":
    "Reworked site deployment, removed the Weda dependency, and optimized cloud resources. We finally learned to breathe on our own.",
  "云端资源已优化，服务器松了一口气。": "Cloud resources are optimized. The server can breathe again.",
  "创世纪 (Genesis)": "Genesis",
  "(圣诞节还在写代码，你是魔鬼吗？)": "(coding on Christmas, you monster)",
  "拖拽部署": "Drag-and-drop deployment",
  "支持把 .zip 甩到脸上。因为我们知道你懒得输 scp 命令。":
    "Throw a .zip at us and we will deploy it, because we know you cannot be bothered to type an scp command.",
  "Dev Note: 实际上只支持根目录 index.html，别试探我的底线。":
    "Dev note: only a root-level index.html is supported. Do not test our patience.",
  "暗黑模式": "Dark mode",
  "默认全黑。为了保护你的视网膜，也为了省点电费。":
    "Black by default, to protect your retinas and shave a little off the power bill.",
  "本站由 Demox 强力驱动（禁止套娃部署本站）":
    "Powered by Demox (please do not recursively deploy this site)",
} as const;

type LogText = keyof typeof logTranslations;

interface SectionProps {
  title: string;
  subtitle: LogText;
  icon: ReactNode;
  children: ReactNode;
  color: string;
  lineColor?: string;
  glow: string;
  isBlinking?: boolean;
  ghost?: boolean;
}

interface TimelineItemProps {
  version: string;
  name: LogText;
  date?: string;
  dateNote?: LogText;
  children: ReactNode;
}

interface FeatureProps {
  tag: string;
  title: LogText;
  desc: LogText;
  note?: LogText;
}

const translateLogText = (text: string | undefined, language: Language) => {
  if (!text || language === "zh" || !(text in logTranslations)) return text;
  return logTranslations[text as LogText];
};

const LogPage: React.FC = () => {
  const { language } = useLanguage();
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

          <div className="relative border-l-2 border-[var(--stitch-line)] ml-4 md:ml-0 space-y-24">
            <Section
              title="It Works on My Machine"
              subtitle="已上线"
              icon={<CheckCircle2 className="text-black" size={20} />}
              color="bg-green-500"
              lineColor="border-green-500"
              glow="shadow-[0_0_20px_rgba(34,197,94,0.3)]"
            >
              <TimelineItem
                version={`v${siteConfig.version}`}
                name="偷窥自己 (Know Thy Traffic)"
                date="2026-06-22"
                dateNote="(终于知道链接有没有人点了)"
              >
                <Feature
                  tag="Analytics"
                  title="独立站点分析页"
                  desc="每个站点现在都有单独的分析页面，展示实时访问趋势、来源页面、访问路径、国家/省级地区分布和可视化地图。统计走边缘异步上报，不拖慢临时链接打开。"
                  note="不是监控你，是监控你的作品有没有被看。"
                />
                <Feature
                  tag="Privacy"
                  title="加密真实访问日志"
                  desc="完整访问日志会加密写入私有对象存储，授权成员可以在分析页随时回看时间、IP、地区、路径、来源和设备信息。聚合数据每 5 分钟批量落 MySQL，原始日志不压数据库。"
                  note="能查，但不裸奔。"
                />
                <Feature
                  tag="Infra"
                  title="增长数据后台化"
                  desc="Powered by Demox 点击仍会统计，但只作为后台增长指标，不再出现在普通用户的站点卡片或公开展示里。"
                  note="数据库：谢谢你终于放过我。"
                />
              </TimelineItem>

              <TimelineItem
                version={`v${siteConfig.version}`}
                name="边缘门禁 (Edge Gate)"
                date="2026-06-15"
                dateNote="(门口有保安了)"
              >
                <Feature
                  tag="Security"
                  title="私有站点"
                  desc="站点现在可以切换公开/私有。私有站点会在边缘层先拦截访问，未登录跳转 Demox 登录，登录后仍无权限则直接返回 Access denied。"
                  note="不是所有 URL 都该裸奔。"
                />
                <Feature
                  tag="UX"
                  title="登录后跳回原站点"
                  desc="私有站点的登录流程会记住原访问地址，邮箱验证码和 GitHub 登录完成后都会自动跳回。"
                  note="门卫终于知道你是来找哪一户的。"
                />
              </TimelineItem>

              <TimelineItem
                version="v0.9.0"
                name="海纳百川 (The Great Migration)"
                date="2026-06-13"
                dateNote="(吃自己的狗粮，真香)"
              >
                <Feature
                  tag="Feature"
                  title="多云存储桶注册制"
                  desc="存储桶改为注册制，抽象出统一的存储层，密钥加密入库。多云时代的第一块砖，先把地基打牢。"
                  note="目前还是单云，但架子已经搭好，吹牛不犯法。"
                />
                <Feature
                  tag="Infra"
                  title="主站自托管"
                  desc="本站不再走 GitHub Actions 传 COS，而是把自己当成一个普通用户站点，用 demox 部署 demox。"
                  note="套娃部署成功，删桶根那次白屏的眼泪我们自己擦干了。"
                />
                <Feature
                  tag="CI"
                  title="一键自动发布"
                  desc="push 到 master 自动构建打包并发布到边缘网络，纯 curl 最小依赖。顺手把路由从 # 哈希切到了真·浏览器路由。"
                  note="地址栏里那个碍眼的 # 终于没了。"
                />
                <Feature
                  tag="Fix"
                  title="DNS 与证书急救"
                  desc="修复了首页打开慢十秒和 HTTPS 证书过期的连环坑，根因是 DNS 绕路。已把解析迁回，证书重新签发。"
                  note="证书续期失败这种事，总在你睡着时发生。"
                />
              </TimelineItem>

              <TimelineItem
                version="v0.8.0"
                name="认证觉醒 (The Awakening)"
                date="2026-06-12"
                dateNote="(终于有人管门了)"
              >
                <Feature
                  tag="Feature"
                  title="GitHub 一键登录"
                  desc="接入 GitHub OAuth，点一下就能登录或绑定账号。无主账号还能选择新建还是关联已有，不再偷偷帮你合并。"
                  note="毕竟你的 star 数就是你的尊严。"
                />
                <Feature
                  tag="Refactor"
                  title="控制台大改造"
                  desc="登录后的控制台从顶栏导航重构为独立的侧边栏 + 嵌套路由，营销页和控制台彻底分家。"
                  note="终于不再像两个妈生的了。"
                />
                <Feature
                  tag="Feature"
                  title="自定义子域名"
                  desc="每个站点除了默认域名，还能挑一个好记的官方域名前缀，例如 {label}.demox.site 或 {label}.vibeme.cn。"
                  note="抢一个好听的名字，手慢无。"
                />
                <Feature
                  tag="Feature"
                  title="MCP 部署"
                  desc="提供 MCP server，让 AI 助手直接帮你部署站点。你动嘴，它动手。"
                  note="未来你可能连拖拽都懒得拖了。"
                />
                <Feature
                  tag="Style"
                  title="主题三态切换"
                  desc="新增 跟随系统 / 浅色 / 深色 三态主题，浅色模式由深色镜像反转而来，颜色体系全部走 CSS 变量。"
                  note="白天党终于不用被亮瞎了。"
                />
              </TimelineItem>

              <TimelineItem
                version="v0.7.7"
                name="井井有条 (Orderliness)"
                date="2025-12-29"
                dateNote="(强迫症狂喜)"
              >
                <Feature
                  tag="Feature"
                  title="资源标签管理"
                  desc="增加了资源标签管理。终于不用在一堆乱七八糟的资源里大海捞针了，现在你可以优雅地给它们打上标签。"
                  note="整理使人快乐，虽然通常只能维持一天。"
                />
              </TimelineItem>

              <TimelineItem
                version="v0.7.0"
                name="名正言顺 (The Identity)"
                date="2025-12-26"
                dateNote="(有了名字就有了灵魂)"
              >
                <Feature
                  tag="Brand"
                  title="Demox & Logo"
                  desc="我们产品名定下来了 Demox，还有 Logo。这些真的很重要。"
                  note="感觉身价倍增。"
                />
              </TimelineItem>

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
          </div>

          <footer className="mt-32 pb-10 text-center space-y-4">
            <p className="text-[var(--stitch-muted)] text-xs">
              {translateLogText("本站由 Demox 强力驱动（禁止套娃部署本站）", language)}
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
}: SectionProps) => {
  const { language } = useLanguage();

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
            ghost ? "text-[var(--stitch-muted)]" : "text-zinc-100"
          }`}
        >
          {translateLogText(title, language)}
          <span
            className={`text-sm px-2 py-1 rounded border ${
              ghost
                ? "border-[var(--stitch-line)] text-[var(--stitch-muted)]"
                : `border-[var(--stitch-line)] bg-zinc-900 text-[var(--stitch-muted)]`
            }`}
          >
            {translateLogText(subtitle, language)}
          </span>
        </h2>
      </div>

      <div className="space-y-12">{children}</div>
    </div>
  );
};

const TimelineItem = ({ version, name, date, dateNote, children }: TimelineItemProps) => {
  const { language } = useLanguage();

  return (
    <div className="relative group">
      <div className="mb-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3 className="text-xl font-mono font-bold text-green-400">
            {version}
          </h3>
          <span className="text-lg font-bold text-zinc-200">
            {translateLogText(name, language)}
          </span>
        </div>
        {date && (
          <div className="text-sm text-zinc-500 font-mono mt-1">
            {date}{" "}
            <span className="text-zinc-600 italic">
              {translateLogText(dateNote, language)}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
};

const Feature = ({ tag, title, desc, note }: FeatureProps) => {
  const { language } = useLanguage();

  return (
    <motion.div
      whileHover={{ x: 10 }}
      className="p-4 rounded-xl bg-[var(--stitch-surface)] border border-[var(--stitch-line)] hover:bg-[var(--stitch-surface-strong)] hover:border-[var(--stitch-muted)]/30 transition-all relative group"
    >
      <div className="flex items-start gap-3">
        <span className="text-xs font-bold px-2 py-0.5 rounded bg-[var(--stitch-blue-soft)] text-[var(--stitch-ink)] font-mono uppercase tracking-wider shrink-0 mt-0.5">
          {tag}
        </span>
        <div>
          <h4 className="font-bold text-[var(--stitch-ink)] mb-1">
            {translateLogText(title, language)}
          </h4>
          <p className="text-[var(--stitch-muted)] text-sm leading-relaxed">
            {translateLogText(desc, language)}
          </p>
        </div>
      </div>

      {/* Hover Note Tooltip */}
      {note && (
        <div className="absolute -top-12 left-10 md:left-auto md:right-0 bg-yellow-900/90 text-yellow-100 text-xs px-3 py-2 rounded border border-yellow-700/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-normal md:whitespace-nowrap max-w-[200px] md:max-w-none z-20">
          {/* Triangle */}
          <div className="absolute bottom-[-6px] left-4 md:left-auto md:right-4 w-3 h-3 bg-yellow-900/90 border-r border-b border-yellow-700/50 rotate-45 transform"></div>
          {translateLogText(note, language)}
        </div>
      )}
    </motion.div>
  );
};

export default LogPage;
