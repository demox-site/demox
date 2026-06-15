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
 * 解析文档为 { title, bodyHtml }。bodyHtml 已经过 DOMPurify 清洗。
 * docx 走 mammoth（动态 import，避免拖累首屏）；doc（旧二进制）不支持时抛错。
 * @param {File} file
 * @returns {Promise<{ title:string, bodyHtml:string }>}
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

  const bodyHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"]
  });

  const title = extractTitleFromHtml(bodyHtml) || stripExt(file.name);
  return { title, bodyHtml };
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
  const { title, bodyHtml } = await parseDocument(file);
  const tpl = getTemplate(templateId);
  const html = tpl.render({ title, bodyHtml });

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
