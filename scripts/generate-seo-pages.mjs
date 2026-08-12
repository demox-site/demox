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
      <a href="/log">Changelog</a>
      <a href="/doc">Docs</a>
    </nav>
  </header>
  <section class="fallback-hero">
    <div class="fallback-eyebrow"><span class="fallback-dot"></span>Static publishing, simplified</div>
    <h1>Upload your build.<br /><span>Get a link that opens.</span></h1>
    <p class="fallback-summary">For frontend demos, AI-generated pages, client previews, and turning documents into web pages. No server, CDN, or HTTPS configuration.</p>
    <div class="fallback-actions">
      <a class="fallback-action fallback-action-primary" href="/console/projects">Upload now</a>
      <a class="fallback-action" href="/doc">Read the docs</a>
    </div>
  </section>
  <section class="fallback-details" aria-label="About Demox">
    <h2>Static site deployment for frontend and AI workflows</h2>
    <p>Demox is a static website deployment platform for frontend developers and AI-assisted workflows. Upload a built directory, ZIP archive, standalone HTML page, PDF, Markdown, TXT, DOCX, or spreadsheet, and Demox turns it into a public link without requiring you to configure a server, CDN, HTTPS certificate, or cache policy. You can deploy from the web console, the Demox CLI, an MCP-compatible AI assistant, or the API. It is designed for frontend demos, AI-generated pages, client reviews, internal previews, and shareable documents when the practical goal is simple: give someone a link they can open. Public sites run behind CDN and HTTPS, while private sites can require sign-in. Projects, official subdomains, redeployment, and traffic analytics are managed from the same console. Demox focuses on fast static delivery rather than replacing a full CI/CD platform.</p>
    <section lang="zh-CN">
      <h2>Demox 是什么？</h2>
      <p>Demox 是一个静态网站部署平台：上传前端构建产物、AI 生成页面或文档，即刻获得一个能打开的链接，无需自行配置服务器、CDN、HTTPS 和缓存策略。你可以通过网页控制台、CLI、MCP 或 API 完成部署。</p>
    </section>
  </section>
</main>`;

export const PUBLIC_PAGES = {
  "": {
    title: "Demox - Static Site Deployment for Frontend and AI Workflows",
    description: "Deploy frontend builds, AI-generated pages, and documents as public static sites. Demox provides web, CLI, MCP, and API workflows with CDN and HTTPS included.",
    fallback: homeFallback,
  },
  index: {
    title: "Demox - Static Site Deployment for Frontend and AI Workflows",
    description: "Deploy frontend builds, AI-generated pages, and documents as public static sites. Demox provides web, CLI, MCP, and API workflows with CDN and HTTPS included.",
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
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Deploy with the Demox CLI or MCP</h1><p>Demox offers two automation paths backed by the same account and deployment capabilities. Use the CLI from a terminal or CI workflow, or use the MCP server from an AI assistant that supports MCP. Both paths upload static build artifacts and documents through the Demox deployment API.</p><h2>CLI quick start</h2><pre><code>npm install -g @demox-site/cli@latest\ndemox login\ndemox deploy ./dist</code></pre><h2>MCP quick start</h2><p>Run <code>npx -y @demox-site/mcp-server@latest</code> as an MCP server. The first deployment opens browser-based OAuth authorization.</p><p>Supported inputs include directories, ZIP, HTML, PDF, Markdown, TXT, DOCX, and spreadsheets. <a href="https://github.com/demox-site/skill">View the Demox agent skill</a>.</p></main>`,
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
    fallback: `<main data-crawlable-fallback class="fallback-simple"><h1>Demox changelog</h1><p>The Demox changelog records product and infrastructure updates across static deployment, CLI and MCP workflows, private-site access, analytics, official subdomains, authentication, and platform operations.</p><p><a href="/doc">Read the deployment documentation</a> or <a href="/">open Demox</a>.</p></main>`,
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

function schemaForPage({ title, description, url }) {
  return {
    "@context": "https://schema.org",
    "@graph": [
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
    ],
  };
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
    ? `<script data-seo="schema" type="application/ld+json">${JSON.stringify(schemaForPage({ title, description, url }))}</script>`
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
