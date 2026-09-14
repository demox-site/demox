import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateSeoPages, PUBLIC_PAGES, NOINDEX_ROUTES } from "./generate-seo-pages.mjs";

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

test("sitemap contains only generated public routes on the canonical host", async () => {
  const sitemap = await readFile(path.join(projectRoot, "public", "sitemap.xml"), "utf8");
  assert.doesNotMatch(sitemap, /ai-builder\.aigc\.sx\.cn/);

  const paths = [...sitemap.matchAll(/<loc>https:\/\/www\.demox\.site(\/[^<]*)<\/loc>/g)].map((match) => match[1]);
  assert.ok(paths.length > 0);
  assert.ok(paths.includes("/ai-static-site-deployment"));
  assert.ok(paths.includes("/when-to-use-demox"));
  assert.ok(paths.includes("/deploy-troubleshooting"));
  assert.ok(paths.includes("/how-demox-hosts-itself"));
  assert.ok(paths.includes("/free-static-site-hosting"));
  assert.ok(paths.includes("/mcp-website-deployment"));
  assert.ok(paths.includes("/vercel-alternative-for-static-sites"));
  assert.ok(paths.includes("/content-scan"));
  for (const pathname of paths) {
    const route = pathname.replace(/^\//, "").replace(/\/$/, "");
    assert.ok(Object.hasOwn(PUBLIC_PAGES, route), `Sitemap route is not generated: ${pathname}`);
  }
});
