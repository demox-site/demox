/**
 * pdf-to-site.js
 * 把用户上传的 PDF 原样托管：生成一个内联预览的 index.html，
 * 连同原始 PDF 一起打包成可直接走现有部署流程的 .zip File。
 *
 * 与 doc-to-site 不同：PDF 是排版格式而非语义文档，这里不做解析、不套阅读模板，
 * 而是保留原始文件、用浏览器内置 PDF 预览呈现，保真度 100%。
 * 解析/渲染全部交给访客浏览器，后端无需改动：产物就是一个根目录含 index.html 的标准 zip。
 */
import JSZip from "jszip";

/** 支持的扩展名（用于 input accept 与校验） */
export const SUPPORTED_PDF_EXTENSIONS = [".pdf"];

/** 取小写扩展名（含点），无扩展名返回空串 */
const extOf = (name) => {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

/** 判断文件是否为受支持的 PDF */
export const isSupportedPdf = (file) =>
  !!file && SUPPORTED_PDF_EXTENSIONS.includes(extOf(file.name));

/** 去掉扩展名作为默认标题 */
const stripExt = (name) => {
  const i = String(name || "").lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : String(name || "");
};

/** HTML 转义，把标题安全放进 <title> 与可见标题 */
const escapeHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * 纯 ASCII 的资源文件名片段：仅保留字母数字与连字符，避免 href 编码问题。
 * 与 doc-to-site 的 safeSlug 不同，这里刻意丢弃中文，确保文件名与链接安全。
 */
const asciiSlug = (name) =>
  stripExt(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "document";

/**
 * 预览页：顶部一条极简工具栏（标题 + 新标签打开/下载），下方 iframe 内联 PDF。
 * iframe 走同源静态文件，桌面 Chrome/Firefox/Safari 会调用内置 PDF 阅读器；
 * 移动端若无法内联，工具栏的「在新标签打开」始终是可用的兜底入口。
 * @param {{ title:string, pdfName:string }} o
 */
const renderViewerHtml = ({ title, pdfName }) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    display: flex;
    flex-direction: column;
    background: #525659;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 1rem;
    background: #1f2023;
    color: #e4e4e7;
    border-bottom: 1px solid #000;
  }
  .bar .title {
    font-size: 0.95rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar .actions { margin-left: auto; display: flex; gap: 0.5rem; flex: 0 0 auto; }
  .bar a {
    font-size: 0.82rem;
    color: #e4e4e7;
    text-decoration: none;
    padding: 0.35rem 0.8rem;
    border: 1px solid #3f3f46;
    border-radius: 6px;
    transition: background 0.15s, border-color 0.15s;
  }
  .bar a:hover { background: #2a2b2e; border-color: #52525b; }
  .viewer { flex: 1 1 auto; border: 0; width: 100%; display: block; }
  .footer {
    flex: 0 0 auto;
    text-align: center;
    font-size: 0.72rem;
    color: #a1a1aa;
    padding: 0.5rem;
    background: #1f2023;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  .footer a { color: #a1a1aa; text-decoration: underline; text-underline-offset: 2px; }
</style>
</head>
<body>
<div class="bar">
  <span class="title">${escapeHtml(title)}</span>
  <span class="actions">
    <a href="${pdfName}" target="_blank" rel="noopener">在新标签打开</a>
    <a href="${pdfName}" download>下载</a>
  </span>
</div>
<iframe class="viewer" src="${pdfName}" title="${escapeHtml(title)}"></iframe>
<div class="footer">由 <a href="https://demox.site" target="_blank" rel="noopener">demox</a> 部署</div>
</body>
</html>`;

/**
 * buildPdfSiteZipFile
 * 生成预览页 index.html，连同原始 PDF 打包成 .zip File，可直接交给 uploadZipFile。
 * @param {{ file:File }} o
 * @returns {Promise<{ zipFile:File, title:string }>}
 */
export async function buildPdfSiteZipFile({ file }) {
  if (!file) throw new Error("缺少文件");

  const title = stripExt(file.name) || "document";
  const slug = asciiSlug(file.name);
  const pdfName = `${slug}.pdf`;
  const html = renderViewerHtml({ title, pdfName });

  const zip = new JSZip();
  zip.file("index.html", html);
  // PDF 本身已压缩，存储模式（STORE）避免重复压缩、加快打包
  zip.file(pdfName, file, { compression: "STORE" });

  const blob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([blob], `${slug}.zip`, { type: "application/zip" });
  return { zipFile, title };
}
