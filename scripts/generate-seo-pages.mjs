import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE_URL = "https://www.demox.site";
const INDEX_ROBOTS = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
const NOINDEX_ROBOTS = "noindex, nofollow";

const homeFallback = `
<main data-crawlable-fallback>
  <header class="fallback-header">
    <a class="fallback-brand" href="/" aria-label="Demox homepage">Demox</a>
    <nav class="fallback-nav" aria-label="Main pages">
      <a href="/pricing">Pricing</a>
      <a href="/ai-static-site-deployment">Guide</a>
      <a href="/log">Changelog</a>
      <a href="/doc">Docs</a>
    </nav>
  </header>
  <section class="fallback-hero" lang="zh-CN">
    <div class="fallback-eyebrow"><span class="fallback-dot"></span>AI 静态网站发布</div>
    <h1>AI 生成网页怎样快速发布成静态网站？</h1>
    <p class="fallback-summary"><strong>直接答案：</strong>把 AI 生成的单个 HTML 文件，或根目录包含 <code>index.html</code> 的 dist、build 目录或 ZIP 上传到 Demox，就能获得带 HTTPS 和 CDN 的公开链接。支持网页、CLI、MCP 和 API，无需自行配置服务器。</p>
    <div class="fallback-actions">
      <a class="fallback-action fallback-action-primary" href="/console/projects">上传并发布</a>
      <a class="fallback-action" href="/ai-static-site-deployment">查看完整指南</a>
    </div>
  </section>
  <section class="fallback-details" aria-label="About Demox">
    <section lang="zh-CN">
      <h2>Demox 是什么？</h2>
      <p>Demox 是一个静态网站部署平台，让前端开发者和 AI 工作流把 HTML、静态构建目录、ZIP 或文档直接变成可分享链接。它适合前端 Demo、交互原型、客户评审和文档页面；需要运行 Node.js、Python、PHP、Java 或连接私密数据库的项目，仍需独立后端。</p>
    </section>
    <section lang="en">
      <h2>What is Demox?</h2>
      <p>Demox turns an HTML file, static build directory, ZIP archive, or document into a shareable HTTPS site through the web console, CLI, MCP, or API.</p>
    </section>
  </section>
</main>`;

export const PUBLIC_PAGES = {
  "": {
    title: "Demox - AI 生成网页静态发布 | Static Site Deployment",
    description: "Demox 将 AI 生成的 HTML、ZIP 和前端构建产物发布为带 HTTPS 和 CDN 的静态网站，支持网页、CLI、MCP 与 API。",
    fallback: homeFallback,
  },
  index: {
    title: "Demox - AI 生成网页静态发布 | Static Site Deployment",
    description: "Demox 将 AI 生成的 HTML、ZIP 和前端构建产物发布为带 HTTPS 和 CDN 的静态网站，支持网页、CLI、MCP 与 API。",
    canonicalPath: "/",
    fallback: homeFallback,
  },
  pricing: {
    title: "Demox Pricing - Static Site Deployment Plans",
    description: "See Demox plans for deploying static websites, frontend demos, AI-generated pages, and shareable documents with CDN and HTTPS included.",
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Demox pricing</h1><p>The current Demox pricing page lists Basic, Pro, and Enterprise plans. Each plan includes static site deployment, and the Basic plan includes CDN delivery. Open the interactive pricing page for the current plan details.</p><p><a href="/">Deploy with Demox</a> or read the <a href="/doc">CLI and MCP documentation</a>.</p></main>`,
  },
  doc: {
    title: "Demox Docs - Deploy with CLI or MCP",
    description: "Deploy static sites with the Demox CLI or from MCP-compatible AI assistants such as Claude Code and Cursor. Includes authentication, file support, and examples.",
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><h1>用 CLI 或 MCP 发布静态网站</h1><p><strong>直接答案：</strong>AI 生成网页后，先得到单个 HTML 或包含 <code>index.html</code> 的 dist、build、ZIP，再用 Demox CLI、MCP 或网页端上传，成功后获得公开 HTTPS 链接。</p><h2>CLI quick start</h2><pre><code>npm install -g @demox-site/cli@latest\ndemox login\ndemox deploy ./dist</code></pre><h2>MCP quick start</h2><p>运行 <code>npx -y @demox-site/mcp-server@latest</code> 作为 MCP server。第一次部署会打开浏览器完成 OAuth 授权。也可以把本页链接交给能访问网页、读取本地文件并执行工具的 AI 助手。</p><p>支持目录、ZIP、HTML、PDF、Markdown、TXT、DOCX 和表格。静态发布不能代替 Node.js、Python、PHP 或 Java 后端；不要把 Token 和数据库密码放进前端文件。<a href="https://github.com/demox-site/skill">查看 Demox Agent Skill</a>。</p></main>`,
  },
  "ai-static-site-deployment": {
    title: "AI 生成网页如何快速发布成静态网站 | Demox",
    description: "从单个 HTML、ZIP 或前端构建产物出发，用网页、CLI、MCP 或 AI 助手发布静态网站并获得 HTTPS 链接。",
    article: {
      datePublished: "2026-08-18",
      dateModified: "2026-08-24",
      inLanguage: "zh-CN",
    },
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><article><p>AI 静态网站发布指南 · 更新于 2026-08-24 · Demox 团队</p><h1>AI 生成网页后，怎样快速发布成静态网站？</h1><p><strong>直接答案：</strong>先确认 AI 产物是单个 HTML 文件，或根目录含 <code>index.html</code> 的静态目录/ZIP；再上传到 Demox，即可获得带 HTTPS 和 CDN 的公开链接。网页端适合手动上传，CLI 适合终端和 CI，MCP 适合能执行工具的 AI 助手。这个流程不需要配置服务器，适合演示、评审和分享。</p><h2>三种发布方式，取决于你手里有什么</h2><h3>1. 只有一个 HTML 文件</h3><p>直接在 Demox 网页端选择 HTML 文件。它适合 AI 生成的单页、交互原型和可视化报告。若页面引用 CSS、图片或字体，请把资源放在同一个目录并使用相对路径。</p><h3>2. 已有 dist、build 或 ZIP</h3><p>先执行 React、Vue、Vite 等项目的生产构建，再上传构建目录或 ZIP。入口文件应位于上传目录或 ZIP 根目录，资源 base path 也要按静态托管方式配置。</p><h3>3. 正在和 AI 助手协作</h3><p>把 <a href="https://www.demox.site/doc">Demox 文档</a>发给能访问网页、读取本地文件并执行工具的 AI，要求它先检查静态产物，再通过 CLI、MCP 或 Agent Skill 发布。只会聊天的 AI 可以说明步骤，却不能代替你读取文件或执行上传。</p><h2>发布一个 AI 生成网页，需要哪几步？</h2><ol><li><strong>确认它是静态产物：</strong>浏览器只需 HTML、CSS、JavaScript 和图片就能打开，不依赖服务器运行时。</li><li><strong>找到站点入口：</strong>单文件直接使用 HTML；目录或 ZIP 的根目录需要包含 <code>index.html</code>。</li><li><strong>上传并拿到链接：</strong>在网页端上传，或通过 CLI、MCP、Agent Skill 发布。</li><li><strong>用无痕窗口复查：</strong>检查首页、资源加载和页面跳转，排除本机缓存造成的假象。</li></ol><h2>发布前检查清单</h2><ul><li><code>index.html</code> 位于上传目录或 ZIP 根目录。</li><li>资源路径没有指向本机磁盘。</li><li>前端路由和资源 base path 已按静态托管方式构建。</li><li>密钥、Token、数据库密码等敏感信息没有写进前端文件。</li></ul><h2>哪些项目适合 Demox？</h2><p>AI 生成的 HTML 单页、React/Vue/Vite 构建产物、产品演示、客户评审页，以及只在浏览器运行或调用已有远程 API 的前端，都适合静态发布。</p><h2>哪些项目不适合直接静态发布？</h2><p>必须运行 Node.js、Python、PHP 或 Java 服务，直接连接数据库，执行服务端任务，或依赖服务器端渲染且没有静态导出结果的应用，需要先改造或选择能运行后端的平台。静态网站可以调用允许跨域访问的公开 HTTPS API，但不能把私密凭据放在浏览器代码中。</p><h2>把文档链接直接发给 AI，真的能部署吗？</h2><p>可以，但前提是 AI 助手能访问网页、读取本地文件并执行工具。只具备聊天能力的 AI 可以说明步骤，却不能代替你读取文件或执行上传。可使用提示词：“阅读 https://www.demox.site/doc，把当前项目构建成静态产物并发布到 Demox；发布前不要上传密钥或后端配置。”</p><h2>常见问题</h2><h3>上传 HTML 后，为什么样式或图片丢了？</h3><p>通常是 HTML 引用了本机绝对路径，或遗漏了同目录下的 CSS、图片和字体。把相关资源一起放进目录，使用相对路径，再将整个目录打成 ZIP 上传。</p><h3>React 或 Vue 源码可以直接上传吗？</h3><p>通常不可以。先执行项目的生产构建命令，得到 dist 或 build 目录，再上传构建产物。</p><h3>静态网站能调用接口吗？</h3><p>可以调用允许浏览器跨域访问的公开 HTTPS API，但不能把私密凭据放在前端代码中。需要保密的业务逻辑仍应放在独立后端。</p><p><a href="/console/projects">上传并发布网页</a> · <a href="/doc">查看 Demox 完整文档</a></p></article></main>`,
  },
  terms: {
    title: "Demox Terms of Service",
    description: "Read the Demox terms of service, acceptable-use requirements, account responsibilities, and service limitations.",
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Demox Terms of Service</h1><p>These terms explain acceptable use of Demox, user responsibility for uploaded content and account security, service availability, intellectual property, and prohibited activities. Open this page in a browser to read the complete terms.</p><p><a href="/">Return to Demox</a>.</p></main>`,
  },
  privacy: {
    title: "Demox Privacy Policy",
    description: "Read how Demox handles account data, uploaded website files, access logs, cookies, security, and data retention.",
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Demox Privacy Policy</h1><p>This policy explains how Demox handles account information, uploaded website files, access logs, cookies, security controls, and data retention. Open this page in a browser to read the complete privacy policy.</p><p><a href="/">Return to Demox</a>.</p></main>`,
  },
  log: {
    title: "Demox Changelog - Product and Infrastructure Updates",
    description: "Follow Demox updates across static deployment, CLI and MCP workflows, site security, analytics, domains, and platform infrastructure.",
    fallback: `<main data-crawlable-fallback class="fallback-simple" lang="zh-CN"><article><h1>Demox 更新日志</h1><p><time datetime="2026-08-24">内容摘要更新于 2026-08-24</time>。这里记录 Demox 静态网站发布、AI 工作流、站点访问和平台基础设施的真实变更。</p><h2>近期更新主题</h2><ul><li><strong>静态发布：</strong>支持 HTML、ZIP 和前端构建产物，并通过 CLI、MCP 或网页端发布。</li><li><strong>AI 工作流：</strong>MCP server 和 Agent Skill 可以让具备工具权限的 AI 助手协助部署。</li><li><strong>站点管理：</strong>支持公开/私有站点、官方子域名、重新部署和访问分析。</li><li><strong>平台基础设施：</strong>持续改进边缘发布、认证、路由、缓存和资源管理。</li></ul><p><a href="/ai-static-site-deployment">阅读 AI 静态网站发布指南</a>，或<a href="/doc">查看 CLI 和 MCP 文档</a>。</p></article></main>`,
  },
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

function schemaForPage({ title, description, url, article }) {
  const graph = [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Demox",
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/demox-logo.png`,
      sameAs: ["https://github.com/demox-site/demox"],
    },
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
      description: "A static website deployment platform for frontend builds, AI-generated pages, and documents, available through web, CLI, MCP, and API workflows.",
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

  return { "@context": "https://schema.org", "@graph": graph };
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
  html = replaceRequired(html, /<main data-crawlable-fallback>[\s\S]*?<\/main>/, config.fallback, "crawlable fallback");

  const schema = shouldIndex
    ? `<script data-seo="schema" type="application/ld+json">${JSON.stringify(schemaForPage({ title, description, url, article: config.article }))}</script>`
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
