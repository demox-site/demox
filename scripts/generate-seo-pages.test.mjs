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
    assert.match(home, /<h1>Deploy a static site and get a link people can open<\/h1>/);
    assert.match(home, /"@type":"SoftwareApplication"/);

    const docs = await readFile(path.join(distDir, "doc", "index.html"), "utf8");
    assert.match(docs, /href="https:\/\/www\.demox\.site\/doc"/);
    assert.match(docs, /<h1>Deploy with the Demox CLI or MCP<\/h1>/);
    assert.doesNotMatch(docs, /noindex/);

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
  for (const pathname of paths) {
    const route = pathname.replace(/^\//, "").replace(/\/$/, "");
    assert.ok(Object.hasOwn(PUBLIC_PAGES, route), `Sitemap route is not generated: ${pathname}`);
  }
});
