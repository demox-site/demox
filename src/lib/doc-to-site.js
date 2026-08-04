/**
 * doc-to-site.js
 * 把用户上传的文字文档（.md / .markdown / .txt / .docx / .doc）解析为安全 HTML，
 * 套用所选模板生成完整 index.html，再打包成可直接走现有部署流程的 .zip File。
 *
 * 解析全部在浏览器端完成，后端无需改动：产物就是一个根目录含 index.html 的标准 zip。
 */
import { marked } from "marked";
import DOMPurify from "dompurify";
import JSZip from "jszip";
import { getTemplate } from "./doc-templates";

/** 支持的扩展名（用于 input accept 与校验） */
export const SUPPORTED_DOC_EXTENSIONS = [".md", ".markdown", ".txt", ".doc", ".docx"];

/** 取小写扩展名（含点），无扩展名返回空串 */
const extOf = (name) => {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

/** 判断文件是否为受支持的文字文档 */
export const isSupportedDoc = (file) =>
  !!file && SUPPORTED_DOC_EXTENSIONS.includes(extOf(file.name));

/** 去掉扩展名作为默认标题 */
const stripExt = (name) => {
  const i = String(name || "").lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : String(name || "");
};

/** 纯文本转 HTML：转义后按段落（空行）分块，保留换行 */
const textToHtml = (text) => {
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return String(text)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${esc(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
};

/** 从已解析的 HTML 里提取首个标题文本作为站点标题 */
const extractTitleFromHtml = (html) => {
  if (typeof document === "undefined") return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const h = tmp.querySelector("h1, h2, h3");
  return h ? h.textContent.trim() : "";
};

/** HTML 文本转义（目录链接文案） */
const escapeHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 去掉 HTML 标签，取纯文本 */
const stripTags = (html) => String(html || "").replace(/<[^>]+>/g, "").trim();

/** 标题文本 → 稳定 slug（支持中文） */
const slugifyHeading = (text) => {
  const slug = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
};

/**
 * 给正文标题补 id，并生成目录 HTML。
 * 首个 h1 通常与页面大标题重复，目录中跳过；至少 2 个条目才展示目录。
 * @param {string} html
 * @returns {{ bodyHtml: string, tocHtml: string }}
 */
export function enrichBodyWithToc(html) {
  const used = new Set();
  const items = [];

  const uniqueSlug = (text) => {
    const base = slugifyHeading(text);
    let slug = base;
    let i = 2;
    while (used.has(slug)) slug = `${base}-${i++}`;
    used.add(slug);
    return slug;
  };

  const bodyHtml = String(html || "").replace(
    /<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi,
    (match, levelStr, attrs = "", inner) => {
      const text = stripTags(inner);
      if (!text) return match;

      const existing = /\sid\s*=\s*["']([^"']+)["']/i.exec(attrs || "");
      let id;
      if (existing) {
        id = existing[1];
        used.add(id);
      } else {
        id = uniqueSlug(text);
      }

      items.push({ level: Number(levelStr), text, id });
      if (existing) return match;
      return `<h${levelStr}${attrs} id="${id}">${inner}</h${levelStr}>`;
    }
  );

  let tocItems = items;
  if (tocItems.length && tocItems[0].level === 1) tocItems = tocItems.slice(1);
  if (tocItems.length < 2) return { bodyHtml, tocHtml: "" };

  const minLevel = Math.min(...tocItems.map((item) => item.level));
  const tocHtml = `<ul class="doc-toc-list">
${tocItems
  .map(
    (item) =>
      `<li class="doc-toc-item level-${item.level - minLevel}"><a href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a></li>`
  )
  .join("\n")}
</ul>`;

  return { bodyHtml, tocHtml };
}

/** 读文件为 ArrayBuffer */
const readArrayBuffer = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });

/** 读文件为文本 */
const readText = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsText(file);
  });

/**
 * parseDocument
 * 解析文档为 { title, bodyHtml, tocHtml }。bodyHtml 已经过 DOMPurify 清洗，并补好标题锚点。
 * docx 走 mammoth（动态 import，避免拖累首屏）；doc（旧二进制）不支持时抛错。
 * @param {File} file
 * @returns {Promise<{ title:string, bodyHtml:string, tocHtml:string }>}
 */
export async function parseDocument(file) {
  if (!file) throw new Error("缺少文件");
  const ext = extOf(file.name);
  let rawHtml = "";

  if (ext === ".md" || ext === ".markdown") {
    const text = await readText(file);
    rawHtml = marked.parse(text, { breaks: true, gfm: true });
  } else if (ext === ".txt") {
    const text = await readText(file);
    rawHtml = textToHtml(text);
  } else if (ext === ".docx") {
    const mammoth = await import("mammoth/mammoth.browser.js");
    const arrayBuffer = await readArrayBuffer(file);
    const result = await mammoth.convertToHtml({ arrayBuffer });
    rawHtml = result.value || "";
  } else if (ext === ".doc") {
    // 旧版二进制 .doc 无法在浏览器端可靠解析
    throw new Error("UNSUPPORTED_DOC");
  } else {
    throw new Error("UNSUPPORTED_FORMAT");
  }

  const cleaned = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "id"]
  });

  const title = extractTitleFromHtml(cleaned) || stripExt(file.name);
  const { bodyHtml, tocHtml } = enrichBodyWithToc(cleaned);
  return { title, bodyHtml, tocHtml };
}

/** 安全的子域名/文件名片段：仅保留字母数字与连字符 */
const safeSlug = (name) =>
  stripExt(name)
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "doc";

/**
 * buildSiteZipFile
 * 用所选模板渲染 index.html 并打包成 .zip File，可直接交给 uploadZipFile。
 * @param {{ file:File, templateId:string }} o
 * @returns {Promise<{ zipFile:File, title:string }>}
 */
export async function buildSiteZipFile({ file, templateId }) {
  const { title, bodyHtml, tocHtml } = await parseDocument(file);
  const tpl = getTemplate(templateId);
  const html = tpl.render({ title, bodyHtml, tocHtml });

  const zip = new JSZip();
  zip.file("index.html", html);
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });

  const zipName = `${safeSlug(file.name)}.zip`;
  const zipFile = new File([blob], zipName, { type: "application/zip" });
  return { zipFile, title };
}
