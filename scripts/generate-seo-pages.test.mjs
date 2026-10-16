import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, mkdir, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateSeoPages, PUBLIC_PAGES, ZH_PAGES, NOINDEX_ROUTES, CANONICAL_ALIAS_ROUTES, indexablePages } from "./generate-seo-pages.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("generates indexable static shells and noindex auth shells", async () => {
  const distDir = await mkdtemp(path.join(os.tmpdir(), "demox-seo-pages-"));
  try {
    await writeFile(path.join(distDir, "index.html"), await readFile(path.join(projectRoot, "index.html"), "utf8"));
    await generateSeoPages(distDir);

    const home = await readFile(path.join(distDir, "index.html"), "utf8");
    assert.match(home, /<link data-seo="canonical" data-rh="true" rel="canonical" href="https:\/\/www\.demox\.site\/" \/>/);
    assert.match(home, /<title data-seo="title">Free Static Website Hosting with CLI & MCP \| Demox<\/title>/);
    assert.match(home, /<h1>Deploy AI-generated websites in seconds<\/h1>/);
    assert.match(home, /<strong>Direct answer:<\/strong> Demox is a free static website hosting platform/);
    assert.match(home, /<h2>What is Demox\?<\/h2>/);
    assert.match(home, /<h2>Frequently asked questions<\/h2>/);
    assert.match(home, /免费静态网站发布平台/);
    assert.match(home, /href="\/when-to-use-demox">See if it fits<\/a>/);
    assert.match(home, /href="\/when-to-use-demox">When to use<\/a>/);
    assert.match(home, /href="\/privacy">Privacy<\/a>/);
    assert.match(home, /href="\/privacy">Privacy Policy<\/a>/);
    assert.match(home, /Skip to main content/);
    assert.match(home, /rel="icon" href="\/favicon.ico"/);
    assert.match(home, /rel="privacy-policy" href="https:\/\/www\.demox\.site\/privacy"/);
    assert.match(home, /handler\(request, env\)/);
    assert.match(home, /"@type":"Organization"/);
    assert.match(home, /"@type":"SoftwareApplication"/);
    assert.match(home, /"@type":"FAQPage"/);
    assert.match(home, /"@type":"HowTo"/);
    const englishWords = (home.match(/<main[^>]*data-crawlable-fallback[^>]*>[\s\S]*?<\/main>/)?.[0] || "")
      .replace(/<[^>]+>/g, " ")
      .match(/\b[A-Za-z]{2,}\b/g) || [];
    assert.ok(englishWords.length >= 300, `expected 300+ English words in crawlable homepage, got ${englishWords.length}`);
    assert.match(home, /<div id="root"><\/div>\s*<div data-crawlable-fallback-shell>\s*<main id="main" data-crawlable-fallback>/);
    assert.doesNotMatch(home, /<div id="root">\s*<main/);
    assert.doesNotMatch(home, /<noscript data-crawlable-fallback-shell>/);
    assert.match(home, /#root:not\(:empty\)\s*~\s*\[data-crawlable-fallback-shell\]/);

    const fallbackStyle = home.match(/<style data-seo="fallback-style">([\s\S]*?)<\/style>/)?.[1];
    const fallbackMarkup = home.match(/<main[^>]*data-crawlable-fallback[^>]*>([\s\S]*?)<\/main>/)?.[0];
    assert.ok(fallbackStyle, "crawlable fallback styles should be present");
    assert.ok(fallbackMarkup, "crawlable fallback markup should be present");
    assert.doesNotMatch(fallbackStyle, /\[data-crawlable-fallback\][^{]*{[^}]*background(?:-color)?\s*:\s*#09090b/i);
    assert.doesNotMatch(fallbackStyle, /\[data-crawlable-fallback\][^{]*{[^}]*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i);
    assert.doesNotMatch(fallbackMarkup, /\s(?:hidden|aria-hidden)(?:\s|=|>)/i);
    const schemas = [...home.matchAll(/<script data-seo="schema" type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((match) => match[1]);
    assert.ok(schemas.length >= 3, `expected multiple JSON-LD documents, got ${schemas.length}`);
    for (const schema of schemas) {
      assert.doesNotThrow(() => JSON.parse(schema), "homepage JSON-LD should be valid JSON");
    }
    assert.equal(JSON.parse(schemas[0])["@type"], "Organization");

    const docs = await readFile(path.join(distDir, "doc", "index.html"), "utf8");
    assert.match(docs, /href="https:\/\/www\.demox\.site\/doc"/);
    assert.match(docs, /content-scan/);

    const contentScan = await readFile(path.join(distDir, "content-scan", "index.html"), "utf8");
    assert.match(contentScan, /href="https:\/\/www\.demox\.site\/content-scan"/);
    assert.match(contentScan, /list_blocked_phrases|content-scan\/phrases/);
    assert.match(docs, /<main data-crawlable-fallback class="fallback-simple" lang="zh-CN">/);
    assert.match(docs, /<h1>用 CLI 或 MCP 发布静态网站和云函数<\/h1>/);
    assert.match(docs, /demox functions push/);
    assert.match(docs, /api\.demox\.site/);
    assert.doesNotMatch(docs, /noindex/);

    const guide = await readFile(path.join(distDir, "ai-static-site-deployment", "index.html"), "utf8");
    assert.match(guide, /<title data-seo="title">AI 生成网页如何快速发布成静态网站 \| Demox<\/title>/);
    assert.match(guide, /href="https:\/\/www\.demox\.site\/ai-static-site-deployment"/);
    assert.match(guide, /<strong>直接答案：<\/strong>先确认 AI 产物是单个 HTML 文件/);
    assert.match(guide, /哪些项目不适合直接静态发布？/);
    assert.match(guide, /"@type":"TechArticle"/);
    assert.match(guide, /"dateModified":"2026-09-14"/);
    assert.doesNotMatch(guide, /content="noindex/);

    const log = await readFile(path.join(distDir, "log", "index.html"), "utf8");
    assert.match(log, /<h1>Demox 更新日志<\/h1>/);
    assert.match(log, /2026-09-14/);
    assert.match(log, /when-to-use-demox/);

    const whenToUse = await readFile(path.join(distDir, "when-to-use-demox", "index.html"), "utf8");
    assert.match(whenToUse, /<h1>什么时候该用 Demox，什么时候不该用？<\/h1>/);
    assert.match(whenToUse, /handler\(request, env\)/);
    assert.match(whenToUse, /"@type":"TechArticle"/);

    const troubleshooting = await readFile(path.join(distDir, "deploy-troubleshooting", "index.html"), "utf8");
    assert.match(troubleshooting, /MISSING_ENTRYPOINT/);
    assert.match(troubleshooting, /CONTENT_BLOCKED/);
    assert.match(troubleshooting, /Access denied/);

    const selfHost = await readFile(path.join(distDir, "how-demox-hosts-itself", "index.html"), "utf8");
    assert.match(selfHost, /demox functions push/);
    assert.match(selfHost, /EPX2UU43/);

    const mcp = await readFile(path.join(distDir, "mcp-website-deployment", "index.html"), "utf8");
    assert.match(mcp, /<h1>Deploy a website from MCP<\/h1>/);
    assert.match(mcp, /@demox-site\/mcp-server/);
    assert.match(mcp, /"@type":"HowTo"/);

    const vite = await readFile(path.join(distDir, "deploy-vite-app", "index.html"), "utf8");
    assert.match(vite, /demox deploy \.\/dist/);

    const vercel = await readFile(path.join(distDir, "vercel-alternative-for-static-sites", "index.html"), "utf8");
    assert.match(vercel, /Keep Vercel or similar if you need that full platform/);
    assert.match(vercel, /先做静态导出，或 Vite\/React 生产构建/);
    assert.match(vercel, /常见问题/);
    assert.match(vercel, /Demox 能替代 Vercel 吗？/);
    assert.match(vercel, /Next\.js 呢？/);

    const callback = await readFile(path.join(distDir, NOINDEX_ROUTES[0], "index.html"), "utf8");
    assert.match(callback, /content="noindex, nofollow"/);
    assert.doesNotMatch(callback, /application\/ld\+json/);

    const notFound = await readFile(path.join(distDir, "404.html"), "utf8");
    assert.match(notFound, /content="noindex, nofollow"/);
    assert.match(notFound, /<h1>Page not found<\/h1>/);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("sitemap is generated at build time with hreflang pairs", async () => {
  const distDir = await mkdtemp(path.join(os.tmpdir(), "demox-seo-sitemap-"));
  const prev = process.env.SEO_BUILD_DATE;
  process.env.SEO_BUILD_DATE = "2031-02-03";
  try {
    await writeFile(path.join(distDir, "index.html"), await readFile(path.join(projectRoot, "index.html"), "utf8"));
    await generateSeoPages(distDir);
    const sitemap = await readFile(path.join(distDir, "sitemap.xml"), "utf8");
    assert.doesNotMatch(sitemap, /ai-builder\.aigc\.sx\.cn/);
    const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    assert.ok(lastmods.length > 0);
    assert.ok(lastmods.every((d) => d === "2031-02-03"), "lastmod must be the build date");
    const paths = [...sitemap.matchAll(/<loc>https:\/\/www\.demox\.site(\/[^<]*)<\/loc>/g)].map((match) => match[1]);
    for (const p of ["/", "/zh/", "/pricing", "/zh/pricing", "/free-static-site-hosting", "/zh/free-static-site-hosting", "/content-scan", "/when-to-use-demox"]) {
      assert.ok(paths.includes(p), `sitemap is missing ${p}`);
    }
    assert.equal(new Set(paths).size, paths.length, "no duplicate sitemap URLs");
    for (const pathname of paths) {
      const route = pathname.replace(/^\//, "").replace(/\/$/, "");
      assert.ok(Object.hasOwn(PUBLIC_PAGES, route) || Object.hasOwn(ZH_PAGES, route), `Sitemap route is not generated: ${pathname}`);
    }
    assert.match(sitemap, /<loc>https:\/\/www\.demox\.site\/zh\/<\/loc>\s*<xhtml:link rel="alternate" hreflang="en" href="https:\/\/www\.demox\.site\/" \/>/);
    assert.equal(paths.length, Object.keys(PUBLIC_PAGES).length - 1 + Object.keys(ZH_PAGES).length);
  } finally {
    if (prev === undefined) delete process.env.SEO_BUILD_DATE; else process.env.SEO_BUILD_DATE = prev;
    await rm(distDir, { recursive: true, force: true });
  }
});

test("/zh/ pages are prerendered Chinese with reciprocal hreflang", async () => {
  const distDir = await mkdtemp(path.join(os.tmpdir(), "demox-seo-zh-"));
  try {
    await writeFile(path.join(distDir, "index.html"), await readFile(path.join(projectRoot, "index.html"), "utf8"));
    await generateSeoPages(distDir);
    const zhHome = await readFile(path.join(distDir, "zh", "index.html"), "utf8");
    assert.match(zhHome, /<html lang="zh-CN">/);
    assert.match(zhHome, /<link data-seo="canonical" data-rh="true" rel="canonical" href="https:\/\/www\.demox\.site\/zh\/" \/>/);
    assert.match(zhHome, /<h1>免费静态网站发布平台，<br>支持 CLI 和 MCP<\/h1>/);
    assert.match(zhHome, /hreflang="zh-CN" href="https:\/\/www\.demox\.site\/zh\/"/);
    assert.match(zhHome, /hreflang="en" href="https:\/\/www\.demox\.site\/"/);
    assert.match(zhHome, /hreflang="x-default" href="https:\/\/www\.demox\.site\/"/);
    assert.match(zhHome, /"@type":"HowTo"/);
    const fallback = zhHome.match(/<main[^>]*data-crawlable-fallback[^>]*>[\s\S]*?<\/main>/)[0];
    const cjk = fallback.match(/[\u4e00-\u9fff]/g) || [];
    assert.ok(cjk.length >= 300, `expected 300+ Chinese characters on /zh/, got ${cjk.length}`);

    const enHome = await readFile(path.join(distDir, "index.html"), "utf8");
    assert.match(enHome, /<html lang="en">/);
    assert.match(enHome, /hreflang="zh-CN" href="https:\/\/www\.demox\.site\/zh\/"/);
    assert.match(enHome, /hreflang="en" href="https:\/\/www\.demox\.site\/"/);

    for (const key of ["pricing", "free-static-site-hosting", "vercel-alternative-for-static-sites"]) {
      const zh = await readFile(path.join(distDir, "zh", key, "index.html"), "utf8");
      const en = await readFile(path.join(distDir, key, "index.html"), "utf8");
      assert.match(zh, /<html lang="zh-CN">/);
      assert.match(zh, new RegExp(`rel="canonical" href="https://www\\.demox\\.site/zh/${key}"`));
      for (const html of [zh, en]) {
        assert.match(html, new RegExp(`hreflang="en" href="https://www\\.demox\\.site/${key}"`));
        assert.match(html, new RegExp(`hreflang="zh-CN" href="https://www\\.demox\\.site/zh/${key}"`));
        assert.match(html, new RegExp(`hreflang="x-default" href="https://www\\.demox\\.site/${key}"`));
      }
    }
    // 中文 only 页面没有英文对，不加 hreflang
    const doc = await readFile(path.join(distDir, "doc", "index.html"), "utf8");
    assert.doesNotMatch(doc, /hreflang=/);
    assert.doesNotMatch(zhHome, /noindex/);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("pricing states prices and limits; llms-full and .md exist", async () => {
  const distDir = await mkdtemp(path.join(os.tmpdir(), "demox-seo-pricing-"));
  try {
    await writeFile(path.join(distDir, "index.html"), await readFile(path.join(projectRoot, "index.html"), "utf8"));
    await generateSeoPages(distDir);
    const pricing = await readFile(path.join(distDir, "pricing", "index.html"), "utf8");
    assert.match(pricing, /\$0\/month/);
    assert.match(pricing, /128 MB/);
    assert.match(pricing, /"@type":"Offer"/);
    const zhPricing = await readFile(path.join(distDir, "zh", "pricing", "index.html"), "utf8");
    assert.match(zhPricing, /\$0\/月/);
    const md = await readFile(path.join(distDir, "pricing.md"), "utf8");
    assert.match(md, /\| Function memory \| 128 MB \| 512 MB \|/);
    assert.match(await readFile(path.join(distDir, "zh", "index.md"), "utf8"), /# 免费静态网站发布平台，支持 CLI 和 MCP/);
    assert.match(await readFile(path.join(distDir, "index.md"), "utf8"), /# Deploy AI-generated websites in seconds/);
    const full = await readFile(path.join(distDir, "llms-full.txt"), "utf8");
    assert.match(full, /URL: https:\/\/www\.demox\.site\/zh\/pricing/);
    assert.match(full, /URL: https:\/\/www\.demox\.site\/doc/);
    assert.doesNotMatch(full, /<\/?(main|div|section|p)\b/);
    const guide = await readFile(path.join(distDir, "ai-static-site-deployment", "index.html"), "utf8");
    assert.match(guide, /"@type":"HowTo"/);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("production robots.txt allows AI and CN crawlers and never disallows the whole site", async () => {
  const robots = await readFile(path.join(projectRoot, "public", "robots.txt"), "utf8");
  for (const bot of ["Google-Extended", "Bytespider", "Baiduspider", "GPTBot"]) assert.match(robots, new RegExp(`User-agent: ${bot}`));
  assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/m, "production robots.txt must not block the whole site");
  assert.doesNotMatch(await readFile(path.join(projectRoot, "index.html"), "utf8"), /noindex/);
});

test("preview build is noindex but only in its own copy", async () => {
  const { makePreviewSite, PREVIEW_ROBOTS } = await import("./make-preview-site.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "demox-seo-preview-"));
  try {
    const distDir = path.join(root, "dist");
    await mkdir(distDir);
    await writeFile(path.join(distDir, "index.html"), await readFile(path.join(projectRoot, "index.html"), "utf8"));
    await writeFile(path.join(distDir, "robots.txt"), await readFile(path.join(projectRoot, "public", "robots.txt"), "utf8"));
    await generateSeoPages(distDir);
    await makePreviewSite(distDir, path.join(root, "dist-preview"));
    assert.equal(await readFile(path.join(root, "dist-preview", "robots.txt"), "utf8"), PREVIEW_ROBOTS);
    assert.match(await readFile(path.join(root, "dist-preview", "zh", "index.html"), "utf8"), /content="noindex, nofollow"/);
    // 生产目录保持原样
    assert.doesNotMatch(await readFile(path.join(distDir, "robots.txt"), "utf8"), /^Disallow:\s*\/\s*$/m);
    assert.doesNotMatch(await readFile(path.join(distDir, "zh", "index.html"), "utf8"), /noindex/);
    await assert.rejects(() => makePreviewSite(path.join(root, "dist-preview"), distDir), /Refusing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const WWW = "https://www.demox.site";

function robotsGroups(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const agent = line.match(/^User-agent:\s*(.+)$/i);
    if (agent) {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(agent[1]);
      continue;
    }
    if (current) current.rules.push(line);
  }
  return groups;
}

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await htmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function canonicalHrefs(html) {
  return [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/gi)].map((match) => {
    const href = match[0].match(/\bhref="([^"]+)"/);
    return href ? href[1] : "";
  });
}

function routeFromHtml(distDir, file) {
  const rel = path.relative(distDir, file).split(path.sep).join("/");
  if (rel === "404.html") return null;
  if (rel === "index.html") return "";
  if (rel.endsWith("/index.html")) return rel.slice(0, -"/index.html".length);
  return null;
}

test("indexable pages, aliases, and markdown robots use www canonicals", async () => {
  const distDir = await mkdtemp(path.join(os.tmpdir(), "demox-seo-canonical-"));
  try {
    await writeFile(path.join(distDir, "index.html"), await readFile(path.join(projectRoot, "index.html"), "utf8"));
    await generateSeoPages(distDir);

    const aliasCanonical = new Map(CANONICAL_ALIAS_ROUTES.map((alias) => [alias.route, `${WWW}${alias.canonicalPath}`]));
    aliasCanonical.set("index", `${WWW}/`);
    const indexableCanonical = new Map(indexablePages().map(({ route, config }) => {
      const href = config.canonicalPath ? `${WWW}${config.canonicalPath}` : (route ? `${WWW}/${route}` : `${WWW}/`);
      return [route, href];
    }));

    const files = await htmlFiles(distDir);
    assert.ok(files.length > Object.keys(PUBLIC_PAGES).length);
    for (const file of files) {
      const html = await readFile(file, "utf8");
      const hrefs = canonicalHrefs(html);
      assert.equal(hrefs.length, 1, `${file} should have exactly one canonical`);
      const href = hrefs[0];
      assert.match(href, /^https:\/\/www\.demox\.site(\/.*)?$/, href);
      assert.doesNotMatch(href, /^http:\/\//);
      assert.doesNotMatch(href, /^https:\/\/demox\.site(?:\/|$)/);
      assert.equal(html.includes("https://demox.site"), false, `${file} must not use the apex host`);
      assert.equal(html.includes("http://www.demox.site"), false, `${file} must not use http`);
      assert.equal(html.includes("http://demox.site"), false, `${file} must not use http on the apex`);

      const route = routeFromHtml(distDir, file);
      if (route === null) {
        assert.match(html, /content="noindex, nofollow"/);
        continue;
      }
      const indexable = !/content="noindex/.test(html);
      if (indexableCanonical.has(route)) {
        assert.equal(indexable, true, route);
        assert.equal(href, indexableCanonical.get(route), route);
      } else if (aliasCanonical.has(route)) {
        assert.equal(indexable, true, route);
        assert.equal(href, aliasCanonical.get(route), route);
      } else if (NOINDEX_ROUTES.includes(route)) {
        assert.equal(indexable, false, route);
        assert.equal(href, `${WWW}/${route}`, route);
        assert.notEqual(href, `${WWW}/`);
      } else {
        assert.fail(`unexpected prerendered route ${route}`);
      }
    }

    const docs = await readFile(path.join(distDir, "docs", "index.html"), "utf8");
    assert.match(docs, /rel="canonical" href="https:\/\/www\.demox\.site\/doc"/);
    assert.match(docs, /<h1>用 CLI 或 MCP 发布静态网站和云函数<\/h1>/);
    assert.doesNotMatch(docs, /noindex/);
    const home = await readFile(path.join(distDir, "home", "index.html"), "utf8");
    assert.match(home, /rel="canonical" href="https:\/\/www\.demox\.site\/" /);
    assert.match(home, /<h1>Deploy AI-generated websites in seconds<\/h1>/);
    const indexAlias = await readFile(path.join(distDir, "index", "index.html"), "utf8");
    assert.match(indexAlias, /rel="canonical" href="https:\/\/www\.demox\.site\/" /);
    for (const route of ["admin", "mcp", "layout-demo"]) {
      const html = await readFile(path.join(distDir, route, "index.html"), "utf8");
      assert.match(html, /content="noindex, nofollow"/);
      assert.match(html, new RegExp(`rel="canonical" href="${WWW}/${route}"`));
      assert.doesNotMatch(html, /rel="canonical" href="https:\/\/www\.demox\.site\/" /);
    }

    await assert.rejects(readFile(path.join(distDir, "docs.md"), "utf8"));
    await assert.rejects(readFile(path.join(distDir, "home.md"), "utf8"));
    assert.match(await readFile(path.join(distDir, "doc.md"), "utf8"), /Source: https:\/\/www\.demox\.site\/doc/);
    assert.match(await readFile(path.join(distDir, "index.md"), "utf8"), /Source: https:\/\/www\.demox\.site\//);

    const sitemap = await readFile(path.join(distDir, "sitemap.xml"), "utf8");
    for (const loc of [`${WWW}/docs`, `${WWW}/home`, `${WWW}/admin`, `${WWW}/mcp`, `${WWW}/layout-demo`, `${WWW}/index`]) {
      assert.equal(sitemap.includes(`<loc>${loc}</loc>`), false, loc);
    }
    assert.match(sitemap, new RegExp(`<loc>${WWW}/doc</loc>`));
    assert.match(sitemap, new RegExp(`<loc>${WWW}/</loc>`));
    assert.doesNotMatch(sitemap, /\.md</);
    const sitemapUrls = [
      ...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g),
      ...sitemap.matchAll(/<xhtml:link\b[^>]*href="([^"]+)"/g),
    ].map((match) => match[1]);
    assert.ok(sitemapUrls.length > 0);
    for (const url of sitemapUrls) {
      assert.match(url, /^https:\/\/www\.demox\.site(\/.*)?$/, url);
      assert.doesNotMatch(url, /^https:\/\/demox\.site(?:\/|$)/);
      assert.doesNotMatch(url, /^http:\/\//);
    }

    const robots = await readFile(path.join(projectRoot, "public", "robots.txt"), "utf8");
    const groups = robotsGroups(robots);
    const star = groups.filter((group) => group.agents.includes("*"));
    const named = groups.filter((group) => !group.agents.includes("*"));
    assert.equal(star.length, 1);
    assert.equal(star[0].rules.filter((rule) => rule === "Disallow: /*.md$").length, 1);
    for (const group of named) {
      assert.equal(group.rules.some((rule) => rule.includes(".md")), false, group.agents.join(","));
      assert.ok(group.rules.includes("Allow: /"), group.agents.join(","));
    }
    for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
      assert.ok(named.some((group) => group.agents.includes(bot)), bot);
    }
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("prerendered header inlines the logo SVG with fixed size (no image request)", async () => {
  const distDir = await mkdtemp(path.join(os.tmpdir(), "demox-seo-logo-"));
  try {
    await writeFile(path.join(distDir, "index.html"), await readFile(path.join(projectRoot, "index.html"), "utf8"));
    await generateSeoPages(distDir);
    for (const rel of ["index.html", "zh/index.html", "zh/pricing/index.html"]) {
      const html = await readFile(path.join(distDir, rel), "utf8").catch(() => readFile(path.join(distDir, rel.replace("/index.html", ".html")), "utf8"));
      if (rel.endsWith("pricing/index.html")) {
        assert.match(html, /<div class="pricing-limits"><table>/);
        continue;
      }
      assert.match(html, /class="fallback-brand"[^>]*><svg class="fallback-logo" viewBox="0 0 1200 330" width="117" height="32"/, rel);
      assert.doesNotMatch(html, /class="fallback-brand"[^>]*>Demox<\/a>/, rel);
    }
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});
