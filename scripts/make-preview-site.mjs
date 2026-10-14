/**
 * 预览站专用：把生产构建 dist/ 复制成 dist-preview/，再加上「禁止索引」。
 * - robots.txt 换成 User-agent: * / Disallow: /
 * - 每个 HTML 的 robots meta 改成 noindex, nofollow
 * 只改副本，永远不写 dist/，所以这条规则进不了生产构建（deploy 用的是 dist/）。
 * 用法：node scripts/make-preview-site.mjs [srcDir=dist] [outDir=dist-preview]
 */
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PREVIEW_ROBOTS = "User-agent: *\nDisallow: /\n";
const NOINDEX_META = '<meta data-seo="robots" data-rh="true" name="robots" content="noindex, nofollow" />';

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

export async function makePreviewSite(srcDir, outDir) {
  const src = path.resolve(srcDir);
  const out = path.resolve(outDir);
  if (out === src || path.basename(out) === "dist") {
    throw new Error(`Refusing to write the preview noindex build into ${out}; use a separate directory such as dist-preview/`);
  }
  await rm(out, { recursive: true, force: true });
  await cp(src, out, { recursive: true });
  await writeFile(path.join(out, "robots.txt"), PREVIEW_ROBOTS);
  let count = 0;
  for await (const file of htmlFiles(out)) {
    const html = await readFile(file, "utf8");
    let next = html.replace(/<meta\s+data-seo="robots"[^>]*>/, NOINDEX_META);
    if (next === html && !/name="robots"/.test(html)) next = html.replace("</head>", `  ${NOINDEX_META}\n  </head>`);
    await writeFile(file, next);
    count += 1;
  }
  return count;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const src = process.argv[2] || path.join(root, "dist");
  const out = process.argv[3] || path.join(root, "dist-preview");
  const count = await makePreviewSite(src, out);
  console.log(`preview build: ${out} (${count} HTML files set to noindex, robots Disallow: /)`);
}
