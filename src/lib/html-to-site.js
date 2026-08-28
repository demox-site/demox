import JSZip from "jszip";

const HTML_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);

const extOf = (name = "") => {
  const cleaned = String(name).trim();
  const i = cleaned.toLowerCase().lastIndexOf(".");
  return i >= 0 ? cleaned.toLowerCase().slice(i) : "";
};

const stripExt = (name = "") => {
  const i = name.toLowerCase().lastIndexOf(".");
  return i >= 0 ? name.slice(0, i) : name;
};

const asciiSlug = (name = "") => {
  const base = stripExt(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "html";
};

export const SUPPORTED_HTML_EXTENSIONS = [".html", ".htm"];

export const isSupportedHtml = (file) => {
  if (!file) return false;
  if (SUPPORTED_HTML_EXTENSIONS.includes(extOf(file.name))) return true;
  const type = String(file.type || "").split(";")[0].trim().toLowerCase();
  return HTML_MIME_TYPES.has(type);
};

/**
 * buildHtmlSiteZipFile
 * 单个 .html/.htm 文件直接作为 index.html 打包成 .zip File，
 * 可直接交给 uploadZipFile。
 * @param {{ file:File }} o
 * @returns {Promise<{ zipFile:File, title:string }>}
 */
export async function buildHtmlSiteZipFile({ file }) {
  if (!file) throw new Error("缺少文件");

  const title = stripExt(file.name) || "html";
  const slug = asciiSlug(file.name);

  const zip = new JSZip();
  const html = await file.arrayBuffer();
  zip.file("index.html", html);

  const blob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([blob], `${slug}.zip`, { type: "application/zip" });
  return { zipFile, title };
}
