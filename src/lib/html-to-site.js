import JSZip from "jszip";

const extOf = (name = "") => {
  const i = name.toLowerCase().lastIndexOf(".");
  return i >= 0 ? name.toLowerCase().slice(i) : "";
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

export const isSupportedHtml = (file) =>
  !!file && SUPPORTED_HTML_EXTENSIONS.includes(extOf(file.name));

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
  zip.file("index.html", file);

  const blob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([blob], `${slug}.zip`, { type: "application/zip" });
  return { zipFile, title };
}
