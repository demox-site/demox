import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INTENT_LANDINGS, intentPublicPages } from "../src/content/intent-landings.mjs";

const SITE_URL = "https://www.demox.site";
const INDEX_ROBOTS = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
const NOINDEX_ROBOTS = "noindex, nofollow";

const HOME_FAQ = [
  {
    question: "What is Demox?",
    answer: "Demox is a host for static websites and small Node functions. Upload HTML, a ZIP, or a dist folder. You get a public HTTPS URL on a CDN.",
  },
  {
    question: "How do I deploy a static site?",
    answer: "Put index.html at the root of the folder or ZIP. Log in, then upload in the web console or run demox deploy ./dist.",
  },
  {
    question: "Can I run Express, Python, or PHP?",
    answer: "Not as-is. Rewrite a Node backend as handler(request, env) and push it with demox functions push. Python, PHP, and Java need another host.",
  },
  {
    question: "Does Demox replace Vercel or Netlify?",
    answer: "No. Demox is for fast public links and small Node functions. It does not claim to replace a full CI/CD platform.",
  },
  {
    question: "Where is the privacy policy?",
    answer: "Read https://www.demox.site/privacy. Login uses essential cookies. Demox does not sell personal data. Contact phosa@qq.com.",
  },
];

const HOME_HOWTO_STEPS = [
  "Build or export the site so the root folder contains index.html.",
  "Sign in at www.demox.site or with the Demox CLI.",
  "Upload the folder in the console, or run demox deploy ./dist.",
  "Open the HTTPS URL in a private window and confirm the page loads.",
];

const crawlableFooter = `
  <footer class="fallback-footer">
    <p><a href="/privacy">Privacy Policy</a> · <a href="/privacy#cookies">Cookie policy</a> · <a href="/terms">Terms of Service</a> · <a href="/how-demox-hosts-itself">About</a> · <a href="mailto:phosa@qq.com">Contact phosa@qq.com</a> · <a href="https://github.com/demox-site/demox">GitHub</a></p>
    <p>Demox uses essential cookies for login. It does not use advertising cookies and does not sell personal data. Read the <a href="/privacy#cookies">cookie policy</a> for data handling and retention.</p>
  </footer>`;

const homeFallback = `
<main id="main" data-crawlable-fallback>
  <a class="fallback-skip" href="#main">Skip to main content</a>
  <header class="fallback-header">
    <a class="fallback-brand" href="/" aria-label="Demox homepage">Demox</a>
    <nav class="fallback-nav" aria-label="Main pages">
      <a href="/pricing">Pricing</a>
      <a href="/when-to-use-demox">When to use</a>
      <a href="/ai-static-site-deployment">Guide</a>
      <a href="/doc">Docs</a>
      <a href="/privacy">Privacy</a>
    </nav>
  </header>
  <section id="demox-overview" class="fallback-hero" lang="en">
    <div class="fallback-eyebrow"><span class="fallback-dot"></span>Static sites and Node functions</div>
    <h1>Deploy AI-generated websites in seconds</h1>
    <p class="fallback-summary"><strong>Direct answer:</strong> Demox is a free static website hosting platform for AI-generated websites. Deploy HTML, ZIP, React/Vue/Vite build output, PDF or Markdown through drag-and-drop, CLI or MCP and instantly get a public HTTPS URL. No Git and no server setup.</p>
    <div class="fallback-actions">
      <a class="fallback-action fallback-action-primary" href="/console/projects">Upload and publish</a>
      <a class="fallback-action" href="/when-to-use-demox">See if it fits</a>
    </div>
  </section>
  <section class="fallback-details" aria-label="About Demox" lang="en">
    <section>
      <h2>What is Demox?</h2>
      <p>Demox is a hosting platform for static websites and small Node functions. You upload files. You get a shareable HTTPS URL. You do not rent a server, issue a certificate, or configure a CDN by hand.</p>
      <p>Use it for frontend demos, AI-generated HTML, review links, and document pages. Use it for Node backends only after they export <code>handler(request, env)</code>. Demox does not replace a full CI/CD platform.</p>
    </section>
    <section>
      <h2>How do you deploy a static site?</h2>
      <ol>
        <li>Build or export the site so the root folder contains <code>index.html</code>.</li>
        <li>Sign in at <a href="https://www.demox.site/">www.demox.site</a> or with the Demox CLI.</li>
        <li>Upload the folder in the console, or run <code>demox deploy ./dist</code>.</li>
        <li>Open the HTTPS URL in a private window and confirm the page loads.</li>
      </ol>
      <p>The same flow works for a single HTML file, a ZIP, and PDF, Markdown, TXT, or DOCX files. CLI, MCP, and the web console all publish to the same site.</p>
    </section>
    <section>
      <h2>What can you host, and what should you skip?</h2>
      <p>Good fits include AI HTML, React or Vue dist folders, ZIP archives, and documents. Good fits also include Node handlers that you push with <code>demox functions push</code>.</p>
      <p>Skip Express apps that call <code>listen</code>. Skip Python, PHP, and Java services. Skip apps that must keep a private database socket open. Those need another host, or you must rewrite the backend first. See <a href="/when-to-use-demox">when to use Demox</a>.</p>
    </section>
    <section>
      <h2>How Demox hosts itself</h2>
      <p><time datetime="2026-09-14">Updated 14 September 2026</time>. The public site is a normal Demox site. Pages ship with <code>demox deploy</code>. Auth, website, MCP, and certificate jobs ship with <code>demox functions push</code>. That case study is on <a href="/how-demox-hosts-itself">how Demox hosts itself</a>.</p>
      <p>The CLI needs version 1.1.6 or later for functions, env, and alias. Four platform functions share the same site: auth, website, MCP, and cert-renew. Source is on <a href="https://github.com/demox-site/demox">GitHub</a> and in the <a href="https://nodejs.org/docs/latest/api/">Node.js API docs</a>.</p>
    </section>
    <section>
      <h2>Key terms</h2>
      <dl>
        <dt>Demox</dt>
        <dd>A host for static websites and small Node functions, with HTTPS and a CDN included.</dd>
        <dt>handler(request, env)</dt>
        <dd>The Node function export Demox runs. It is not an Express <code>listen</code> server.</dd>
        <dt>demox deploy</dt>
        <dd>The command that uploads HTML, a dist folder, or a ZIP and returns a public URL.</dd>
      </dl>
    </section>
    <section>
      <h2>Frequently asked questions</h2>
      ${HOME_FAQ.map((item) => `<h3>${item.question}</h3><p>${item.answer}</p>`).join("\n      ")}
    </section>
    <section lang="zh-CN">
      <h2>免费静态网站发布平台，支持 CLI 和 MCP</h2>
      <p>将 AI 生成的 HTML、ZIP、React/Vue/Vite 构建产物一键发布为公网网站，无需 Git，无需服务器配置。网页端拖拽，终端用 <code>demox deploy</code>，AI 助手走 MCP。Python、PHP、Java、Express listen 不是直接适配。</p>
    </section>
    <section>
      <h2>Guides for specific deploy jobs</h2>
      <ul>
        ${INTENT_LANDINGS.map((page) => `<li><a href="/${page.id}">${page.h1}</a></li>`).join("\n        ")}
      </ul>
    </section>
  </section>
  ${crawlableFooter}
</main>`;

export const PUBLIC_PAGES = {
  "": {
    title: "Free Static Website Hosting with CLI & MCP | Demox",
    description: "Demox is a free static website hosting platform for AI-generated websites. Deploy HTML, ZIP, React/Vue/Vite builds through drag-and-drop, CLI or MCP and get a public HTTPS URL.",
    fallback: homeFallback,
    faq: HOME_FAQ,
    howTo: {
      name: "Publish a static site with Demox",
      description: "Upload HTML or a build folder and get an HTTPS CDN URL.",
      steps: HOME_HOWTO_STEPS,
    },
  },
  index: {
    title: "Free Static Website Hosting with CLI & MCP | Demox",
    description: "Demox is a free static website hosting platform for AI-generated websites. Deploy HTML, ZIP, React/Vue/Vite builds through drag-and-drop, CLI or MCP and get a public HTTPS URL.",
    canonicalPath: "/",
    fallback: homeFallback,
    faq: HOME_FAQ,
    howTo: {
      name: "Publish a static site with Demox",
      description: "Upload HTML or a build folder and get an HTTPS CDN URL.",
      steps: HOME_HOWTO_STEPS,
    },
  },
  pricing: {
    title: "Demox Pricing - Static Site Deployment Plans",
    description: "See Demox plans for deploying static websites, frontend demos, AI-generated pages, and shareable documents with CDN and HTTPS included.",
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Demox pricing</h1><p>The current Demox pricing page lists Basic, Pro, and Enterprise plans. Each plan includes static site deployment, and the Basic plan includes CDN delivery. Open the interactive pricing page for the current plan details.</p><p><a href="/">Deploy with Demox</a> or read the <a href="/doc">CLI and MCP documentation</a>.</p></main>`,
  },
  doc: {
    title: "Demox Docs - Deploy with CLI or MCP",
    description: "Deploy static pages with demox deploy and Node backends with demox functions push. Covers CLI, MCP, per-function env, aliases, and invoke URLs.",
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><h1>用 CLI 或 MCP 发布静态网站和云函数</h1><p><strong>直接答案：</strong>页面走 <code>demox deploy</code>。Node 后端改成 <code>handler(request, env)</code> 后走 <code>demox functions push</code>。环境变量按函数设置。首次上传创建 v1，production 和 develop 都指向 v1；再上传不会改别名。</p><h2>CLI quick start</h2><pre><code>npm install -g @demox-site/cli@latest\ndemox login\ndemox deploy ./dist --name my-site\ndemox functions push ./api/hello --id WEBSITE_ID --slug hello\ndemox env set --id WEBSITE_ID --slug hello API_KEY=secret\ndemox functions alias set --id WEBSITE_ID --slug hello production --version 2</code></pre><p>函数调用地址：<code>https://api.demox.site/{站点ID}/{别名}/api/{标识}</code>。页面里 <code>fetch('/api/标识')</code> 走 production。functions / env / alias 需要 CLI 1.1.6 及以上。</p><h2>MCP quick start</h2><p>运行 <code>npx -y @demox-site/mcp-server@latest</code> 作为 MCP server。第一次部署会打开浏览器完成 OAuth 授权。也可以把本页链接交给能访问网页、读取本地文件并执行工具的 AI 助手。</p><p>支持目录、ZIP、HTML、PDF、Markdown、TXT、DOCX。Node 后端不要 Express listen。不要把 Token 和数据库密码放进前端文件。<a href="https://github.com/demox-site/skill">查看 Demox Agent Skill</a>。完整屏蔽词见 <a href="/content-scan">内容审核屏蔽词</a>。</p></main>`,
  },
  "content-scan": {
    title: "Demox 屏蔽词表 - 内容审核公开接口",
    description: "查看 Demox 部署前本地规则使用的全部屏蔽词，以及无需登录的公开查询接口。",
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><h1>Demox 内容审核屏蔽词</h1><p><strong>直接答案：</strong>部署前会用短语匹配扫描上传包。完整词表在本页，也可通过公开接口查询。</p><h2>公开接口</h2><p>无需登录。AI 助手应先读取 <a href="https://github.com/demox-site/skill">Demox Agent Skill</a>，再调用：</p><pre><code>curl -s https://api.demox.site/website/content-scan/phrases</code></pre><p>也可 POST <code>{"action":"list_blocked_phrases"}</code>。静态副本：<a href="/content-scan.json">/content-scan.json</a>。</p><p>图片审核走腾讯云 IMS，不在屏蔽词表里。发布被拦时，失败信息会写明命中的具体词。</p></main>`,
  },
  "ai-static-site-deployment": {
    title: "AI 生成网页如何快速发布成静态网站 | Demox",
    description: "从单个 HTML、ZIP 或前端构建产物出发，用网页、CLI、MCP 或 AI 助手发布静态网站并获得 HTTPS 链接。",
    article: {
      datePublished: "2026-08-18",
      dateModified: "2026-09-14",
      inLanguage: "zh-CN",
    },
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><article><p>AI 静态网站发布指南 · 更新于 2026-09-14 · Demox 团队</p><h1>AI 生成网页后，怎样快速发布成静态网站？</h1><p><strong>直接答案：</strong>先确认 AI 产物是单个 HTML 文件，或根目录含 <code>index.html</code> 的静态目录/ZIP；再上传到 Demox，即可获得带 HTTPS 和 CDN 的公开链接。网页端适合手动上传，CLI 适合终端和 CI，MCP 适合能执行工具的 AI 助手。需要接口时，把 Node 后端改成 <code>handler(request, env)</code> 后走 <code>demox functions push</code>。</p><h2>三种发布方式，取决于你手里有什么</h2><h3>1. 只有一个 HTML 文件</h3><p>直接在 Demox 网页端选择 HTML 文件。它适合 AI 生成的单页、交互原型和可视化报告。若页面引用 CSS、图片或字体，请把资源放在同一个目录并使用相对路径。</p><h3>2. 已有 dist、build 或 ZIP</h3><p>先执行 React、Vue、Vite 等项目的生产构建，再上传构建目录或 ZIP。入口文件应位于上传目录或 ZIP 根目录，资源 base path 也要按静态托管方式配置。</p><h3>3. 正在和 AI 助手协作</h3><p>把 <a href="https://www.demox.site/doc">Demox 文档</a>发给能访问网页、读取本地文件并执行工具的 AI，要求它先检查静态产物，再通过 CLI、MCP 或 Agent Skill 发布。只会聊天的 AI 可以说明步骤，却不能代替你读取文件或执行上传。</p><h2>发布一个 AI 生成网页，需要哪几步？</h2><ol><li><strong>确认它是静态产物：</strong>浏览器只需 HTML、CSS、JavaScript 和图片就能打开，不依赖服务器运行时。</li><li><strong>找到站点入口：</strong>单文件直接使用 HTML；目录或 ZIP 的根目录需要包含 <code>index.html</code>。</li><li><strong>上传并拿到链接：</strong>在网页端上传，或通过 CLI、MCP、Agent Skill 发布。</li><li><strong>用无痕窗口复查：</strong>检查首页、资源加载和页面跳转，排除本机缓存造成的假象。</li></ol><h2>发布前检查清单</h2><ul><li><code>index.html</code> 位于上传目录或 ZIP 根目录。</li><li>资源路径没有指向本机磁盘。</li><li>前端路由和资源 base path 已按静态托管方式构建。</li><li>密钥、Token、数据库密码等敏感信息没有写进前端文件。</li></ul><h2>哪些项目适合 Demox？</h2><p>AI 生成的 HTML 单页、React/Vue/Vite 构建产物、产品演示、客户评审页，以及已改成 <code>handler(request, env)</code> 的 Node 接口，都适合发布。完整对照见 <a href="/when-to-use-demox">什么时候该用 Demox</a>。</p><h2>哪些项目不适合直接静态发布？</h2><p>Python、PHP、Java，Express <code>listen</code>，必须直连私密数据库或常驻进程，以及没有静态导出的服务端渲染应用，需要先改造或选择能运行该后端的平台。失败原文见 <a href="/deploy-troubleshooting">发布排错</a>。</p><h2>把文档链接直接发给 AI，真的能部署吗？</h2><p>可以，但前提是 AI 助手能访问网页、读取本地文件并执行工具。只具备聊天能力的 AI 可以说明步骤，却不能代替你读取文件或执行上传。可使用提示词：“阅读 https://www.demox.site/doc，把当前项目构建成静态产物并发布到 Demox；发布前不要上传密钥或后端配置。”</p><h2>常见问题</h2><h3>上传 HTML 后，为什么样式或图片丢了？</h3><p>通常是 HTML 引用了本机绝对路径，或遗漏了同目录下的 CSS、图片和字体。把相关资源一起放进目录，使用相对路径，再将整个目录打成 ZIP 上传。</p><h3>React 或 Vue 源码可以直接上传吗？</h3><p>通常不可以。先执行项目的生产构建命令，得到 dist 或 build 目录，再上传构建产物。</p><h3>静态网站能调用接口吗？</h3><p>可以调用允许浏览器跨域访问的公开 HTTPS API，也可以把 Node handler 发到同一站点后用 <code>fetch('/api/标识')</code>。不要把私密凭据放在前端代码中。</p><p><a href="/console/projects">上传并发布网页</a> · <a href="/doc">查看 Demox 完整文档</a></p></article></main>`,
  },
  terms: {
    title: "Demox Terms of Service",
    description: "Read the Demox terms of service, acceptable-use requirements, account responsibilities, and service limitations.",
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Demox Terms of Service</h1><p>These terms explain acceptable use of Demox, user responsibility for uploaded content and account security, service availability, intellectual property, and prohibited activities. Open this page in a browser to read the complete terms.</p><p><a href="/">Return to Demox</a>.</p></main>`,
  },
  privacy: {
    title: "Demox Privacy Policy",
    description: "Read how Demox handles account data, uploaded website files, access logs, cookies, security, and data retention.",
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Demox Privacy Policy</h1><p>Last updated 21 July 2026.</p><p>Demox collects account email, login logs, and the files you upload so we can host your site. We use that data to run accounts, deploy sites, review content for the public blocklist, and keep the service secure.</p><h2 id="cookies">Cookie policy</h2><p>Login uses essential cookies. Demox does not use advertising cookies, does not run a non-essential tracker, and does not sell personal data. There is no advertising cookie to accept or reject.</p><p>You can ask us to delete an account by emailing <a href="mailto:phosa@qq.com">phosa@qq.com</a>.</p><p>Open this page in a browser for the full Chinese text covering account data, uploads, access logs, security, and retention.</p><p><a href="/">Return to Demox</a> · <a href="/terms">Terms of Service</a></p></main>`,
  },
  log: {
    title: "Demox Changelog - Product and Infrastructure Updates",
    description: "Follow Demox updates across static deployment, CLI and MCP workflows, site security, analytics, domains, and platform infrastructure.",
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><article><h1>Demox 更新日志</h1><p><time datetime="2026-09-14">内容摘要更新于 2026-09-14</time>。这里记录 Demox 静态网站发布、Node 云函数、AI 工作流、站点访问和平台基础设施的真实变更。</p><h2>近期更新主题</h2><ul><li><strong>静态发布：</strong>支持 HTML、ZIP 和前端构建产物，并通过 CLI、MCP 或网页端发布。</li><li><strong>Node 云函数：</strong>入口是 handler(request, env)。首次 push 创建 v1，production 和 develop 指向 v1；之后 push 不改别名。</li><li><strong>AI 工作流：</strong>MCP server 和 Agent Skill 可以让具备工具权限的 AI 助手协助部署。</li><li><strong>站点管理：</strong>支持公开/私有站点、官方子域名、重新部署和访问分析。</li></ul><p><a href="/when-to-use-demox">判断是否适合 Demox</a>，<a href="/deploy-troubleshooting">对照发布错误</a>，或<a href="/doc">查看 CLI 和 MCP 文档</a>。</p></article></main>`,
  },
  "when-to-use-demox": {
    title: "什么时候该用 Demox，什么时候不该用 | Demox",
    description: "对照静态页面、Node handler、Express listen 和独立后端，判断项目是否适合 Demox。",
    article: {
      datePublished: "2026-09-14",
      dateModified: "2026-09-14",
      inLanguage: "zh-CN",
    },
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><article><p>适用场景 · 更新于 2026-09-14 · Demox 团队</p><h1>什么时候该用 Demox，什么时候不该用？</h1><p><strong>直接答案：</strong>Demox 适合两类产物。一类是静态网站：单个 HTML、根目录含 index.html 的 dist/build/ZIP，以及 PDF、Markdown、TXT、DOCX。另一类是 Node 接口：改成 handler(request, env) 后用 demox functions push 挂到同一站点。Python、PHP、Java、Express listen，以及必须直连私密数据库或常驻进程的服务，不适合直接上传。Demox 不声称替代完整 CI/CD 平台。</p><h2>按你手里的产物判断</h2><table><thead><tr><th>你手里有什么</th><th>适合 Demox？</th><th>怎么发</th></tr></thead><tbody><tr><td>AI 生成的单个 HTML</td><td>适合</td><td>网页上传或 demox deploy</td></tr><tr><td>React / Vue / Vite dist</td><td>适合</td><td>demox deploy ./dist</td></tr><tr><td>PDF、Markdown、DOCX</td><td>适合</td><td>网页上传或 demox deploy</td></tr><tr><td>Node handler(request, env)</td><td>适合</td><td>demox functions push</td></tr><tr><td>Express listen</td><td>不适合直接上传</td><td>先改成 handler</td></tr><tr><td>Python / PHP / Java</td><td>目前不适合</td><td>独立后端</td></tr></tbody></table><h2>Demox 自己也是这样发布的</h2><p>主站是平台上的一个普通站点。页面走 demox deploy，业务后端走 demox functions push。详见 <a href="/how-demox-hosts-itself">Demox 怎样用自己部署自己</a>。发布失败对照 <a href="/deploy-troubleshooting">排错页</a>。</p></article></main>`,
  },
  "deploy-troubleshooting": {
    title: "Demox 发布失败排错 | 对照错误原文",
    description: "对照 MISSING_ENTRYPOINT、CONTENT_BLOCKED、INVALID_STATIC_SITE 和 Access denied 等原文处理 Demox 发布失败。",
    article: {
      datePublished: "2026-09-14",
      dateModified: "2026-09-14",
      inLanguage: "zh-CN",
    },
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><article><p>部署排错 · 更新于 2026-09-14 · Demox 团队</p><h1>Demox 发布失败时，该看哪一条错误？</h1><p><strong>直接答案：</strong>先读失败信息里的 code 和原文。缺根目录 index.html 是 MISSING_ENTRYPOINT。包无法当静态站点打开是 INVALID_STATIC_SITE。命中屏蔽词是 CONTENT_BLOCKED，文案会写出具体词。私有站点未授权是 Access denied。functions push 成功但页面仍旧，是因为 push 不改别名。</p><h2>缺少根目录 index.html</h2><p>code：<code>MISSING_ENTRYPOINT</code>。原文：Artifact 缺少根目录 index.html。把 index.html 放到上传目录或 ZIP 根目录；React/Vue 先构建。</p><h2>内容审核拦截</h2><p>code：<code>CONTENT_BLOCKED</code>。原文：发布失败：{文件} 未通过安全审核，文件名或文件内容含有违规词「{词}」。请修改后重试。改掉写出的那个词。词表：<a href="/content-scan">/content-scan</a> 或 GET https://api.demox.site/website/content-scan/phrases。</p><h2>私有站点 Access denied</h2><p>未登录会跳登录；登录后仍无权限则返回 Access denied。把访问者加成项目成员，或改回公开。</p><h2>push 之后仍是旧逻辑</h2><p>push 只创建版本。执行 demox functions alias set --id 站点ID --slug 标识 production --version N。CLI 需要 1.1.6 及以上。</p></article></main>`,
  },
  "how-demox-hosts-itself": {
    title: "Demox 怎样用自己部署自己 | 第一方案例",
    description: "主站用 demox deploy 发页面，用 demox functions push 发 Node 后端。这是仓库记录的现行发布方式。",
    article: {
      datePublished: "2026-09-14",
      dateModified: "2026-09-14",
      inLanguage: "zh-CN",
    },
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><article><p>第一方案例 · 更新于 2026-09-14 · Demox 团队</p><h1>Demox 怎样用自己部署自己？</h1><p><strong>直接答案：</strong>主站是平台上的一个普通站点。前端 npm run build 后执行 demox deploy ./dist。鉴权、站点、MCP 和证书续期用 demox functions push 按 slug 更新。函数环境变量按函数设置；首次上传创建 v1，production 和 develop 指向 v1，之后再上传不改别名。本页不提供访问量或可用性数字。</p><h2>发布时实际执行的命令</h2><pre><code>npm run build
demox deploy ./dist --id EPX2UU43
demox functions push ./scf-deploy-packages/auth-api --id EPX2UU43 --slug auth
demox functions push ./scf-code/website-api --id EPX2UU43 --slug website
demox functions push ./scf-code/mcp-api --id EPX2UU43 --slug mcp
demox functions push ./scf-code/cert-renew --id EPX2UU43 --slug cert-renew</code></pre><h2>这个案例能证明什么</h2><p>能证明静态页面和 Node handler 可以挂在同一站点，且 Demox 自己走这条路径。不能证明任意 Express 或 Python 应用可以零改动迁入。完整边界见 <a href="/when-to-use-demox">适用场景</a>。</p></article></main>`,
  },
  ...intentPublicPages(),
};

export const NOINDEX_ROUTES = [
  "github-callback",
  "github-link",
  "feishu-callback",
  "feishu-link",
  "mcp-login",
  "mcp-authorize",
  "site-auth",
];

function escapeAttribute(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replaceRequired(html, pattern, replacement, label) {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  if (matches?.length !== 1) {
    throw new Error(`Expected exactly one ${label} marker, found ${matches?.length || 0}`);
  }
  return html.replace(pattern, replacement);
}

function pageUrl(route, canonicalPath) {
  if (canonicalPath) return `${SITE_URL}${canonicalPath}`;
  return route ? `${SITE_URL}/${route}` : `${SITE_URL}/`;
}

function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Demox",
    url: `${SITE_URL}/`,
    email: "phosa@qq.com",
    logo: `${SITE_URL}/demox-logo.png`,
    sameAs: [
      "https://github.com/demox-site/demox",
      "https://github.com/demox-site/skill",
      "https://x.com/a_phos",
    ],
    contactPoint: {
      "@type": "ContactPoint",
      email: "phosa@qq.com",
      contactType: "customer support",
      availableLanguage: ["en", "zh-CN"],
    },
  };
}

function schemaDocuments({ title, description, url, article, faq, howTo }) {
  const graph = [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Demox",
      url: `${SITE_URL}/`,
      publisher: { "@id": `${SITE_URL}/#organization` },
      inLanguage: ["en", "zh-CN"],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "Demox",
      url: `${SITE_URL}/`,
      applicationCategory: "DeveloperApplication",
      description: "A hosting platform for static websites and Node.js functions. Frontend builds, AI-generated pages, and documents become HTTPS sites. Node backends export handler(request, env) and run as cloud functions through web, CLI, MCP, and API workflows.",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      name: title,
      url,
      description,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#software` },
      author: { "@id": `${SITE_URL}/#organization` },
      inLanguage: ["en", "zh-CN"],
    },
  ];

  if (article) {
    graph.push({
      "@type": "TechArticle",
      "@id": `${url}#article`,
      headline: title,
      description,
      url,
      mainEntityOfPage: { "@id": `${url}#webpage` },
      datePublished: article.datePublished,
      dateModified: article.dateModified,
      inLanguage: article.inLanguage,
      author: { "@id": `${SITE_URL}/#organization` },
      publisher: { "@id": `${SITE_URL}/#organization` },
      about: { "@id": `${SITE_URL}/#software` },
    });
  }

  const documents = [
    organizationSchema(),
    ...graph.map((node) => ({ "@context": "https://schema.org", ...node })),
  ];

  if (faq?.length) {
    documents.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    });
  }

  if (howTo) {
    documents.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      "@id": `${url}#howto`,
      name: howTo.name,
      description: howTo.description,
      step: howTo.steps.map((text, index) => ({
        "@type": "HowToStep",
        position: index + 1,
        text,
      })),
    });
  }

  return documents;
}

function jsonLdScripts(documents) {
  return documents
    .map((document) => `<script data-seo="schema" type="application/ld+json">${JSON.stringify(document)}</script>`)
    .join("\n    ");
}

export function renderSeoPage(baseHtml, route, config) {
  const title = config.title;
  const description = config.description;
  const url = pageUrl(route, config.canonicalPath);
  const shouldIndex = config.index !== false;
  const attrTitle = escapeAttribute(title);
  const attrDescription = escapeAttribute(description);

  let html = baseHtml;
  html = replaceRequired(html, /<title data-seo="title">[\s\S]*?<\/title>/, `<title data-seo="title">${title}</title>`, "title");
  html = replaceRequired(html, /<meta\s+data-seo="description"[^>]*>/, `<meta data-seo="description" data-rh="true" name="description" content="${attrDescription}" />`, "description");
  html = replaceRequired(html, /<meta\s+data-seo="robots"[^>]*>/, `<meta data-seo="robots" data-rh="true" name="robots" content="${shouldIndex ? INDEX_ROBOTS : NOINDEX_ROBOTS}" />`, "robots");
  html = replaceRequired(html, /<link\s+data-seo="canonical"[^>]*>/, `<link data-seo="canonical" data-rh="true" rel="canonical" href="${url}" />`, "canonical");
  html = replaceRequired(html, /<meta\s+data-seo="og-title"[^>]*>/, `<meta data-seo="og-title" data-rh="true" property="og:title" content="${attrTitle}" />`, "Open Graph title");
  html = replaceRequired(html, /<meta\s+data-seo="og-description"[^>]*>/, `<meta data-seo="og-description" data-rh="true" property="og:description" content="${attrDescription}" />`, "Open Graph description");
  html = replaceRequired(html, /<meta\s+data-seo="og-url"[^>]*>/, `<meta data-seo="og-url" data-rh="true" property="og:url" content="${url}" />`, "Open Graph URL");
  html = replaceRequired(html, /<meta\s+data-seo="twitter-title"[^>]*>/, `<meta data-seo="twitter-title" data-rh="true" name="twitter:title" content="${attrTitle}" />`, "Twitter title");
  html = replaceRequired(html, /<meta\s+data-seo="twitter-description"[^>]*>/, `<meta data-seo="twitter-description" data-rh="true" name="twitter:description" content="${attrDescription}" />`, "Twitter description");
  html = replaceRequired(html, /<main[^>]*data-crawlable-fallback[^>]*>[\s\S]*?<\/main>/, config.fallback, "crawlable fallback");

  const schema = shouldIndex
    ? jsonLdScripts(schemaDocuments({
      title,
      description,
      url,
      article: config.article,
      faq: config.faq,
      howTo: config.howTo,
    }))
    : "";
  html = replaceRequired(html, /<script data-seo="schema" type="application\/ld\+json">[\s\S]*?<\/script>/, schema, "schema");
  return html;
}

export async function generateSeoPages(distDir) {
  const indexPath = path.join(distDir, "index.html");
  const baseHtml = await readFile(indexPath, "utf8");
  const renderedHome = renderSeoPage(baseHtml, "", PUBLIC_PAGES[""]);
  await writeFile(indexPath, renderedHome);

  for (const [route, config] of Object.entries(PUBLIC_PAGES)) {
    if (!route) continue;
    const routeDir = path.join(distDir, route);
    await mkdir(routeDir, { recursive: true });
    await writeFile(path.join(routeDir, "index.html"), renderSeoPage(baseHtml, route, config));
  }

  for (const route of NOINDEX_ROUTES) {
    const routeDir = path.join(distDir, route);
    const config = {
      title: "Continue securely | Demox",
      description: "Complete the Demox sign-in or authorization flow in a JavaScript-enabled browser.",
      index: false,
      fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Continue securely in your browser</h1><p>This Demox sign-in or authorization route requires JavaScript and is intentionally excluded from search indexing.</p><p><a href="/">Return to Demox</a>.</p></main>`,
    };
    await mkdir(routeDir, { recursive: true });
    await writeFile(path.join(routeDir, "index.html"), renderSeoPage(baseHtml, route, config));
  }

  const notFound = renderSeoPage(baseHtml, "", {
    title: "Page not found | Demox",
    description: "The requested Demox page could not be found.",
    index: false,
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Page not found</h1><p>The requested Demox page could not be found. <a href="/">Return to the homepage</a>.</p></main>`,
  });
  await writeFile(path.join(distDir, "404.html"), notFound);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await generateSeoPages(path.join(projectRoot, "dist"));
}
