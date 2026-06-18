import * as XLSX from "xlsx";
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
  return base || "spreadsheet";
};

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const SUPPORTED_SPREADSHEET_EXTENSIONS = [
  ".csv",
  ".xlsx",
  ".xls",
  ".ods"
];

export const isSupportedSpreadsheet = (file) =>
  !!file && SUPPORTED_SPREADSHEET_EXTENSIONS.includes(extOf(file.name));

/**
 * parseSpreadsheet
 * 用 SheetJS 解析 CSV/Excel 文件，返回每个 sheet 的 HTML 表格。
 * @param {File} file
 * @returns {Promise<{ sheets: Array<{ name:string, html:string }> }>}
 */
async function parseSpreadsheet(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws) return { name, html: "" };
    // sheet_to_html 保留合并单元格等信息，输出 <table>...</table>
    const raw = XLSX.utils.sheet_to_html(ws, { editable: false });
    // 去掉 id 属性避免多 sheet 重复 id
    const html = String(raw || "").replace(/\sid="[^"]*"/g, "");
    return { name, html };
  }).filter((s) => s.html && s.html.trim());
  return { sheets };
}

/**
 * renderHtml
 * 生成画册式表格网页：sticky 顶栏 + 多 sheet tab 切换 + 斑马纹表格。
 * 套用 demox stitch 设计语言。
 */
function renderHtml({ title, sheets, fileName }) {
  const multiSheet = sheets.length > 1;
  const downloadHref = encodeURIComponent(fileName);

  const tabsHtml = multiSheet
    ? `<nav class="sheet-tabs" role="tablist">${sheets
        .map(
          (s, i) =>
            `<button type="button" class="sheet-tab${
              i === 0 ? " active" : ""
            }" data-index="${i}" role="tab">${escapeHtml(s.name)}</button>`
        )
        .join("")}</nav>`
    : "";

  const panesHtml = sheets
    .map(
      (s, i) =>
        `<section class="sheet-pane${
          i === 0 ? " active" : ""
        }" data-index="${i}" role="tabpanel"><div class="sheet-table-wrap">${
          s.html
        }</div></section>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans+Text:wght@400;500;700&family=Google+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f7f5;--surface:#fff;--ink:#111;--muted:#6b7280;--line:#e5e7eb;--blue-soft:#dbeafe;--shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04)}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:'Google Sans Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
.topbar{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.92);backdrop-filter:saturate(180%) blur(12px);-webkit-backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--line)}
.topbar-inner{max-width:1200px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.topbar-title{font-family:'Google Sans',sans-serif;font-size:18px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.topbar-meta{display:flex;align-items:center;gap:12px;flex-shrink:0}
.topbar-count{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);padding:4px 10px;border:1px solid var(--line);border-radius:9999px}
.topbar-download{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:9999px;background:var(--ink);color:#fff;text-decoration:none;font-size:13px;font-weight:500;transition:opacity .2s}
.topbar-download:hover{opacity:.85}
.sheet-tabs{max-width:1200px;margin:0 auto;padding:16px 24px 0;display:flex;gap:8px;overflow-x:auto;scrollbar-width:thin}
.sheet-tab{padding:6px 16px;border-radius:9999px;border:1px solid var(--line);background:var(--surface);color:var(--muted);cursor:pointer;white-space:nowrap;font-size:13px;font-family:inherit;transition:all .15s}
.sheet-tab:hover{border-color:var(--ink);color:var(--ink)}
.sheet-tab.active{background:var(--ink);color:#fff;border-color:var(--ink)}
.sheet-pane{display:none}
.sheet-pane.active{display:block}
.sheet-table-wrap{max-width:1200px;margin:0 auto;padding:24px;overflow-x:auto}
.sheet-table-wrap table{border-collapse:collapse;width:100%;background:var(--surface);font-size:14px;box-shadow:var(--shadow);border-radius:8px;overflow:hidden}
.sheet-table-wrap table td{border:1px solid var(--line);padding:8px 12px;white-space:nowrap;color:var(--ink)}
.sheet-table-wrap table tr:first-child td{background:#f9fafb;font-weight:600;position:sticky;top:0;z-index:1}
.sheet-table-wrap table tr:nth-child(even) td{background:#fafafa}
.sheet-table-wrap table tr:hover td{background:var(--blue-soft)}
@media(max-width:640px){.topbar-inner{padding:12px 16px}.topbar-title{font-size:15px}.topbar-count{display:none}.sheet-tabs{padding:12px 16px 0}.sheet-table-wrap{padding:16px}.sheet-table-wrap table{font-size:13px}.sheet-table-wrap table td{padding:6px 8px}}
@media print{.topbar,.sheet-tabs{display:none}.sheet-pane{display:block!important}.sheet-table-wrap table tr:first-child td{position:static}}
</style>
</head>
<body>
<header class="topbar"><div class="topbar-inner"><div class="topbar-title">${escapeHtml(
    title
  )}</div><div class="topbar-meta">${
    multiSheet
      ? `<span class="topbar-count">${sheets.length} sheets</span>`
      : ""
  }<a class="topbar-download" href="${downloadHref}" download>↓ ${escapeHtml(
    fileName
  )}</a></div></div></header>
${tabsHtml}
<main>${panesHtml}</main>
<script>document.querySelectorAll('.sheet-tab').forEach(function(t){t.addEventListener('click',function(){var i=this.getAttribute('data-index');document.querySelectorAll('.sheet-tab').forEach(function(x){x.classList.remove('active')});document.querySelectorAll('.sheet-pane').forEach(function(x){x.classList.remove('active')});this.classList.add('active');var p=document.querySelector('.sheet-pane[data-index="'+i+'"]');if(p)p.classList.add('active')})});</script>
</body>
</html>`;
}

/**
 * buildSpreadsheetSiteZipFile
 * 解析 CSV/Excel 为多 sheet 表格网页，连同原始文件打包成 .zip File，
 * 可直接交给 uploadZipFile。
 * @param {{ file:File }} o
 * @returns {Promise<{ zipFile:File, title:string, sheetCount:number }>}
 */
export async function buildSpreadsheetSiteZipFile({ file }) {
  if (!file) throw new Error("缺少文件");

  const title = stripExt(file.name) || "spreadsheet";
  const slug = asciiSlug(file.name);
  const fileName = file.name;

  const { sheets } = await parseSpreadsheet(file);
  if (!sheets.length) throw new Error("表格为空");

  const html = renderHtml({ title, sheets, fileName });

  const zip = new JSZip();
  zip.file("index.html", html);
  // 保留原始文件作为可下载资源
  zip.file(fileName, file, { compression: "STORE" });

  const blob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([blob], `${slug}.zip`, { type: "application/zip" });
  return { zipFile, title, sheetCount: sheets.length };
}
