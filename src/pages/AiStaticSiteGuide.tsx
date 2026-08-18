import React from "react";
import { Helmet } from "react-helmet-async";
import {
  ArrowRight,
  Bot,
  Check,
  Clock3,
  Code2,
  FileCode2,
  FolderArchive,
  ServerOff,
  UploadCloud,
} from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { MainLayout } from "@/layouts/MainLayout";

const PAGE_URL = "https://www.demox.site/ai-static-site-deployment";
const PUBLISHED_AT = "2026-08-18";

const guideTexts = {
  zh: {
    eyebrow: "AI 网页发布指南",
    title: "AI 生成网页后，怎样快速发布成静态网站？",
    answer:
      "AI 生成网页后，先确认产物是单个 HTML 文件，或根目录含 index.html 的静态目录/ZIP；然后上传到 Demox，即可获得带 HTTPS 和 CDN 的公开链接。整个过程不需要配置服务器，适合演示、评审和分享。",
    published: "发布于 2026-08-18",
    updated: "更新于 2026-08-18",
    author: "Demox 团队",
    primaryCta: "现在上传",
    secondaryCta: "查看完整文档",
    pathsEyebrow: "选择最短路径",
    pathsTitle: "三种发布方式，取决于你手里有什么",
    pathsIntro:
      "不需要先学习一套部署系统。找到与你当前产物匹配的方式，检查入口文件，然后发布。",
    paths: [
      {
        number: "01",
        title: "只有一个 HTML 文件",
        description:
          "直接在网页端选择 .html 文件。Demox 会把它作为站点入口，适合 AI 生成的单页、原型和可视化报告。",
        action: "打开上传页面",
        href: "/console/projects",
      },
      {
        number: "02",
        title: "已有 dist、build 或 ZIP",
        description:
          "上传构建目录或 ZIP，确保根目录能找到 index.html。CSS、JavaScript、图片和字体应使用相对路径或正确的站点根路径。",
        action: "先看发布前检查",
        href: "#before-publish",
      },
      {
        number: "03",
        title: "正在和 AI 助手协作",
        description:
          "把 Demox 文档地址发给能读取网页和本地文件的 AI，要求它按文档部署；也可以使用 CLI、MCP 或 Agent Skill 完成发布。",
        action: "把文档发给 AI",
        href: "/doc",
      },
    ],
    workflowEyebrow: "从文件到链接",
    workflowTitle: "发布一个 AI 生成网页，需要哪几步？",
    workflow: [
      {
        title: "确认它是静态产物",
        description:
          "浏览器只需 HTML、CSS、JavaScript 和图片就能打开；页面本身不依赖 Node.js、Python、PHP 等服务器运行时。",
      },
      {
        title: "找到站点入口",
        description:
          "单文件直接使用 .html；目录或 ZIP 的根目录需要包含 index.html。React、Vue、Vite 项目应先执行自己的构建命令。",
      },
      {
        title: "上传并拿到链接",
        description:
          "在 Demox 网页端上传，或通过 CLI、MCP、Agent Skill 发布。成功后会得到一个可以直接分享的 HTTPS 地址。",
      },
      {
        title: "用无痕窗口复查",
        description:
          "检查首页、图片、字体和页面内跳转。无痕窗口能帮助发现只在本机缓存或登录状态下才正常的问题。",
      },
    ],
    checklistTitle: "发布前检查清单",
    checklist: [
      "入口文件名为 index.html，且位于上传目录或 ZIP 根目录",
      "资源路径没有指向本机磁盘，例如 /Users/... 或 C:\\...",
      "前端路由和资源 base path 已按静态托管方式构建",
      "密钥、Token、数据库密码等敏感信息没有写进前端文件",
    ],
    fitEyebrow: "先判断是否适合",
    fitTitle: "哪些项目适合 Demox，哪些不适合？",
    goodTitle: "适合直接发布",
    goodItems: [
      "AI 生成的 HTML 单页和交互原型",
      "React、Vue、Vite 等项目的构建产物",
      "产品演示、客户评审页和短期活动页",
      "只在浏览器运行，或调用已有远程 API 的前端",
    ],
    badTitle: "需要先改造或换平台",
    badItems: [
      "必须常驻运行 Node.js、Python、PHP 或 Java 服务",
      "直接连接数据库、执行服务端任务或保存本地文件",
      "依赖服务器端渲染且没有静态导出结果",
      "需要由 Demox 同时托管后端 API 的完整应用",
    ],
    agentTitle: "把文档链接直接发给 AI，真的能部署吗？",
    agentAnswer:
      "可以，但取决于 AI 助手是否能访问网页、读取你的本地文件，并拥有可执行工具。最简单的提示词是：‘阅读 https://www.demox.site/doc，把当前项目构建成静态产物并发布到 Demox；发布前不要上传密钥或后端配置。’ 如果助手只能聊天，它可以给出步骤，但不能代替你读取文件或执行上传。",
    faqEyebrow: "常见问题",
    faqTitle: "AI 静态网站发布 FAQ",
    faqs: [
      {
        question: "上传 HTML 后，为什么样式或图片丢了？",
        answer:
          "通常是 HTML 引用了本机绝对路径，或遗漏了同目录下的 CSS、图片和字体。把相关资源一起放进目录，使用相对路径，再将整个目录打成 ZIP 上传。",
      },
      {
        question: "React 或 Vue 源码可以直接上传吗？",
        answer:
          "通常不可以。先执行项目的生产构建命令，得到 dist 或 build 目录，再上传构建产物。源码目录中的依赖和开发服务器不会在静态托管环境中运行。",
      },
      {
        question: "发布后还能更新同一个网站吗？",
        answer:
          "可以。进入 Demox 控制台选择已有站点并重新部署，新产物会替换当前版本，原有分享链接可以继续使用。",
      },
      {
        question: "静态网站能调用接口吗？",
        answer:
          "可以调用公开的 HTTPS API，但接口必须允许浏览器跨域访问，并且不能把私密凭据放在前端代码里。需要保密的业务逻辑仍应放在独立后端。",
      },
    ],
    closingTitle: "网页已经做好了，就别让部署成为最后一道门槛。",
    closingBody: "准备好 HTML 或构建产物后，上传并拿到一个能直接打开的链接。",
    closingCta: "发布我的网页",
  },
  en: {
    eyebrow: "AI website publishing guide",
    title: "How do you publish an AI-generated page as a static website?",
    answer:
      "After generating a page with AI, make sure you have either one HTML file or a static directory or ZIP with index.html at its root. Upload it to Demox to receive a public HTTPS link delivered through CDN, without configuring a server.",
    published: "Published Aug 18, 2026",
    updated: "Updated Aug 18, 2026",
    author: "Demox team",
    primaryCta: "Upload now",
    secondaryCta: "Read the full docs",
    pathsEyebrow: "Choose the shortest path",
    pathsTitle: "Three publishing methods, based on what you have",
    pathsIntro:
      "You do not need to learn a deployment system first. Match the method to your current output, check the entry file, and publish.",
    paths: [
      {
        number: "01",
        title: "You have one HTML file",
        description:
          "Select the .html file in the web console. Demox uses it as the site entry, which works well for AI-generated pages, prototypes, and visual reports.",
        action: "Open the uploader",
        href: "/console/projects",
      },
      {
        number: "02",
        title: "You have dist, build, or ZIP",
        description:
          "Upload the built directory or ZIP and keep index.html at its root. CSS, JavaScript, images, and fonts must use relative paths or a correct site base path.",
        action: "Review the checklist",
        href: "#before-publish",
      },
      {
        number: "03",
        title: "You are working with an AI assistant",
        description:
          "Send the Demox docs to an assistant that can read web pages and local files, or publish through the CLI, MCP, or Demox Agent Skill.",
        action: "Send the docs to AI",
        href: "/doc",
      },
    ],
    workflowEyebrow: "From files to a link",
    workflowTitle: "What does it take to publish an AI-generated page?",
    workflow: [
      {
        title: "Confirm it is static output",
        description:
          "The browser can open it with HTML, CSS, JavaScript, and images alone. The page does not require a Node.js, Python, PHP, or other server runtime.",
      },
      {
        title: "Find the site entry",
        description:
          "Use the .html file directly, or keep index.html at the root of the directory or ZIP. Build React, Vue, and Vite projects before uploading.",
      },
      {
        title: "Upload and get a link",
        description:
          "Publish in the web console or through the CLI, MCP, or Agent Skill. A successful deployment returns a shareable HTTPS address.",
      },
      {
        title: "Verify in a private window",
        description:
          "Check the homepage, images, fonts, and navigation. A private window exposes issues hidden by local cache or an existing sign-in session.",
      },
    ],
    checklistTitle: "Pre-publish checklist",
    checklist: [
      "index.html is at the root of the uploaded directory or ZIP",
      "Asset paths do not point to a local disk such as /Users/... or C:\\...",
      "Frontend routes and the asset base path are built for static hosting",
      "Secrets, tokens, and database passwords are not included in frontend files",
    ],
    fitEyebrow: "Check the fit first",
    fitTitle: "Which projects fit Demox, and which do not?",
    goodTitle: "Ready for static publishing",
    goodItems: [
      "AI-generated HTML pages and interactive prototypes",
      "Built output from React, Vue, Vite, and similar tools",
      "Product demos, client review pages, and campaign pages",
      "Browser-only frontends or pages that call an existing remote API",
    ],
    badTitle: "Needs changes or another platform",
    badItems: [
      "Apps that must run Node.js, Python, PHP, or Java continuously",
      "Apps that connect directly to a database or run server-side jobs",
      "Server-rendered apps without a static export",
      "Full applications that require Demox to host their backend API too",
    ],
    agentTitle: "Can an AI really deploy from the documentation link?",
    agentAnswer:
      "Yes, if the assistant can access the web, read your local files, and use execution tools. A useful prompt is: ‘Read https://www.demox.site/doc, build this project as static output, and deploy it to Demox. Do not upload secrets or backend configuration.’ A chat-only assistant can explain the steps, but cannot read files or upload on your behalf.",
    faqEyebrow: "Common questions",
    faqTitle: "AI static website publishing FAQ",
    faqs: [
      {
        question: "Why are styles or images missing after I upload HTML?",
        answer:
          "The HTML usually points to local absolute paths or references files that were not uploaded. Put CSS, images, and fonts in the same project, use relative paths, and upload the complete directory as a ZIP.",
      },
      {
        question: "Can I upload React or Vue source code directly?",
        answer:
          "Usually not. Run the production build first, then upload the resulting dist or build directory. Dependencies and development servers from the source directory do not run on static hosting.",
      },
      {
        question: "Can I update the same website later?",
        answer:
          "Yes. Select the existing site in the Demox console and redeploy it. The new output replaces the current version while the shared link can stay the same.",
      },
      {
        question: "Can a static website call an API?",
        answer:
          "Yes, it can call a public HTTPS API if that API allows browser cross-origin requests. Never place private credentials in frontend code; sensitive logic still belongs in a separate backend.",
      },
    ],
    closingTitle: "Once the page is ready, deployment should not be the last obstacle.",
    closingBody: "Bring your HTML or built output, upload it, and get a link anyone can open.",
    closingCta: "Publish my page",
  },
} as const;

const pathIcons = [FileCode2, FolderArchive, Bot];

export const AiStaticSiteGuide: React.FC = () => {
  const { language } = useLanguage();
  const t = guideTexts[language];

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: t.title,
    description: t.answer,
    datePublished: PUBLISHED_AT,
    dateModified: PUBLISHED_AT,
    inLanguage: language === "zh" ? "zh-CN" : "en",
    mainEntityOfPage: PAGE_URL,
    author: { "@type": "Organization", name: "Demox", url: "https://www.demox.site/" },
    publisher: { "@type": "Organization", name: "Demox", url: "https://www.demox.site/" },
  };

  return (
    <MainLayout>
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(articleSchema)}</script>
      </Helmet>

      <article className="relative overflow-hidden pb-8">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] opacity-70"
          style={{
            background:
              "radial-gradient(circle at 12% 8%, var(--stitch-blue-soft), transparent 32rem), radial-gradient(circle at 88% 20%, var(--stitch-blue-soft), transparent 26rem)",
          }}
        />

        <header className="mx-auto max-w-5xl border-b border-[var(--stitch-line)] pb-14 pt-5 md:pb-20 md:pt-12">
          <div className="mb-7 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-[var(--stitch-muted)]">
            <span className="h-px w-8 bg-[var(--stitch-ink)]" />
            {t.eyebrow}
          </div>
          <h1 className="max-w-4xl text-4xl font-black leading-[1.08] tracking-[-0.045em] text-[var(--stitch-ink)] sm:text-5xl md:text-7xl">
            {t.title}
          </h1>
          <p className="mt-8 max-w-3xl text-lg leading-8 text-[var(--stitch-muted)] md:text-xl">
            {t.answer}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-[var(--stitch-muted)]">
            <span className="inline-flex items-center gap-2"><Clock3 size={14} />{t.updated}</span>
            <span>{t.published}</span>
            <span>{t.author}</span>
          </div>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <a
              href="/console/projects"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--stitch-ink)] px-6 py-3 text-sm font-bold text-[var(--stitch-surface)] transition-transform hover:-translate-y-0.5"
            >
              <UploadCloud size={17} />
              {t.primaryCta}
            </a>
            <a
              href="/doc"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-6 py-3 text-sm font-bold text-[var(--stitch-ink)] transition-colors hover:bg-[var(--stitch-surface-strong)]"
            >
              {t.secondaryCta}
              <ArrowRight size={17} />
            </a>
          </div>
        </header>

        <section className="mx-auto max-w-5xl py-14 md:py-20" aria-labelledby="publish-paths">
          <SectionHeading eyebrow={t.pathsEyebrow} title={t.pathsTitle} id="publish-paths" />
          <p className="mt-4 max-w-2xl leading-7 text-[var(--stitch-muted)]">{t.pathsIntro}</p>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {t.paths.map((item, index) => {
              const Icon = pathIcons[index];
              return (
                <section
                  key={item.number}
                  className="group flex min-h-[22rem] flex-col rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-6 transition-transform duration-300 hover:-translate-y-1 md:p-7"
                >
                  <div className="flex items-start justify-between">
                    <span className="font-mono text-4xl font-black tracking-[-0.08em] text-[var(--stitch-muted)]/45">{item.number}</span>
                    <span className="rounded-xl border border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] p-3">
                      <Icon size={22} />
                    </span>
                  </div>
                  <h3 className="mt-9 text-xl font-bold tracking-tight">{item.title}</h3>
                  <p className="mt-4 flex-1 text-sm leading-7 text-[var(--stitch-muted)]">{item.description}</p>
                  <a href={item.href} className="mt-7 inline-flex items-center gap-2 text-sm font-bold">
                    {item.action}<ArrowRight size={15} />
                  </a>
                </section>
              );
            })}
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-10 border-y border-[var(--stitch-line)] py-14 md:grid-cols-[1.15fr_0.85fr] md:py-20" aria-labelledby="workflow">
          <div>
            <SectionHeading eyebrow={t.workflowEyebrow} title={t.workflowTitle} id="workflow" />
            <ol className="mt-10 space-y-8">
              {t.workflow.map((item, index) => (
                <li key={item.title} className="grid grid-cols-[2.5rem_1fr] gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--stitch-line)] font-mono text-xs font-bold">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="font-bold text-[var(--stitch-ink)]">{item.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-[var(--stitch-muted)]">{item.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <aside id="before-publish" className="self-start rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] p-6 md:sticky md:top-24 md:p-8">
            <Code2 size={24} />
            <h2 className="mt-5 text-xl font-bold">{t.checklistTitle}</h2>
            <ul className="mt-6 space-y-4">
              {t.checklist.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-[var(--stitch-muted)]">
                  <Check size={17} className="mt-1 shrink-0 text-[var(--stitch-ink)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <section className="mx-auto max-w-5xl py-14 md:py-20" aria-labelledby="project-fit">
          <SectionHeading eyebrow={t.fitEyebrow} title={t.fitTitle} id="project-fit" />
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <FitCard icon={Check} title={t.goodTitle} items={t.goodItems} />
            <FitCard icon={ServerOff} title={t.badTitle} items={t.badItems} muted />
          </div>
        </section>

        <section className="mx-auto max-w-5xl rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] p-7 md:p-10" aria-labelledby="ai-agent-answer">
          <div className="grid gap-7 md:grid-cols-[auto_1fr]">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--stitch-ink)] text-[var(--stitch-surface)]">
              <Bot size={23} />
            </span>
            <div>
              <h2 id="ai-agent-answer" className="text-2xl font-black tracking-tight md:text-3xl">{t.agentTitle}</h2>
              <p className="mt-5 leading-8 text-[var(--stitch-muted)]">{t.agentAnswer}</p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl py-14 md:py-20" aria-labelledby="faq">
          <SectionHeading eyebrow={t.faqEyebrow} title={t.faqTitle} id="faq" />
          <div className="mt-9 divide-y divide-[var(--stitch-line)] border-y border-[var(--stitch-line)]">
            {t.faqs.map((item, index) => (
              <details key={item.question} className="group py-6" open={index === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-bold [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span className="font-mono text-xl text-[var(--stitch-muted)] group-open:rotate-45">+</span>
                </summary>
                <p className="max-w-3xl pb-1 pt-4 leading-7 text-[var(--stitch-muted)]">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-[var(--stitch-ink)] px-7 py-12 text-[var(--stitch-surface)] md:px-12 md:py-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] opacity-60">Demox / publish</p>
          <h2 className="mt-5 max-w-3xl text-3xl font-black leading-tight tracking-[-0.035em] md:text-5xl">{t.closingTitle}</h2>
          <p className="mt-5 max-w-2xl leading-7 opacity-70">{t.closingBody}</p>
          <a href="/console/projects" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[var(--stitch-surface)] px-6 py-3 text-sm font-bold text-[var(--stitch-ink)]">
            {t.closingCta}<ArrowRight size={17} />
          </a>
        </section>
      </article>
    </MainLayout>
  );
};

function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--stitch-muted)]">{eyebrow}</p>
      <h2 id={id} className="mt-3 max-w-3xl text-3xl font-black tracking-[-0.035em] md:text-4xl">{title}</h2>
    </div>
  );
}

function FitCard({
  icon: Icon,
  title,
  items,
  muted = false,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  items: readonly string[];
  muted?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-[var(--stitch-line)] p-6 md:p-8 ${muted ? "bg-transparent" : "bg-[var(--stitch-surface)]"}`}>
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-[var(--stitch-blue-soft)] p-2"><Icon size={19} /></span>
        <h3 className="text-xl font-bold">{title}</h3>
      </div>
      <ul className="mt-6 space-y-4">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-[var(--stitch-muted)]">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--stitch-ink)]" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default AiStaticSiteGuide;
