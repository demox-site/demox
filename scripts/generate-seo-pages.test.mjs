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
    assert.match(home, /<title data-seo="title">Demox - AI 生成网页静态发布 \| Static Site Deployment<\/title>/);
    assert.match(home, /<h1>AI 生成网页怎样快速发布成静态网站？<\/h1>/);
    assert.match(home, /<strong>直接答案：<\/strong>把 AI 生成的单个 HTML 文件/);
    assert.match(home, /<h2>Demox 是什么？<\/h2>/);
    assert.match(home, /href="\/ai-static-site-deployment">查看完整指南<\/a>/);
    assert.match(home, /href="\/ai-static-site-deployment">Guide<\/a>/);
    assert.match(home, /"@type":"SoftwareApplication"/);
    assert.match(home, /<div id="root"><\/div>\s*<noscript data-crawlable-fallback-shell>\s*<main data-crawlable-fallback>/);
    assert.doesNotMatch(home, /<div id="root">\s*<main data-crawlable-fallback>/);

    const fallbackStyle = home.match(/<style data-seo="fallback-style">([\s\S]*?)<\/style>/)?.[1];
    const fallbackMarkup = home.match(/<main data-crawlable-fallback>([\s\S]*?)<\/main>/)?.[0];
    assert.ok(fallbackStyle, "crawlable fallback styles should be present");
    assert.ok(fallbackMarkup, "crawlable fallback markup should be present");
    assert.doesNotMatch(fallbackStyle, /\[data-crawlable-fallback\][^{]*{[^}]*background(?:-color)?\s*:\s*#09090b/i);
    assert.doesNotMatch(fallbackStyle, /\[data-crawlable-fallback\][^{]*{[^}]*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i);
    assert.doesNotMatch(fallbackMarkup, /\s(?:hidden|aria-hidden)(?:\s|=|>)/i);
    const schema = home.match(/<script data-seo="schema" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert.doesNotThrow(() => JSON.parse(schema), "homepage JSON-LD should be valid JSON");

    const docs = await readFile(path.join(distDir, "doc", "index.html"), "utf8");
    assert.match(docs, /href="https:\/\/www\.demox\.site\/doc"/);
    assert.match(docs, /<main data-crawlable-fallback class="fallback-simple" lang="zh-CN">/);
    assert.match(docs, /<h1>用 CLI 或 MCP 发布静态网站<\/h1>/);
    assert.doesNotMatch(docs, /noindex/);

    const guide = await readFile(path.join(distDir, "ai-static-site-deployment", "index.html"), "utf8");
    assert.match(guide, /<title data-seo="title">AI 生成网页如何快速发布成静态网站 \| Demox<\/title>/);
    assert.match(guide, /href="https:\/\/www\.demox\.site\/ai-static-site-deployment"/);
    assert.match(guide, /<strong>直接答案：<\/strong>先确认 AI 产物是单个 HTML 文件/);
    assert.match(guide, /哪些项目不适合直接静态发布？/);
    assert.match(guide, /"@type":"TechArticle"/);
    assert.match(guide, /"dateModified":"2026-08-24"/);
    assert.doesNotMatch(guide, /content="noindex/);

    const log = await readFile(path.join(distDir, "log", "index.html"), "utf8");
    assert.match(log, /<h1>Demox 更新日志<\/h1>/);
    assert.match(log, /2026-08-24/);
    assert.match(log, /AI 静态网站发布指南/);

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
  for (const pathname of paths) {
    const route = pathname.replace(/^\//, "").replace(/\/$/, "");
    assert.ok(Object.hasOwn(PUBLIC_PAGES, route), `Sitemap route is not generated: ${pathname}`);
  }
});
