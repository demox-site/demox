/**
 * doc-templates.js
 * 文档转站点的预制模板。每个模板提供 render({ title, bodyHtml }) -> 完整 index.html。
 * bodyHtml 已由 doc-to-site.js 解析并经 DOMPurify 清洗，这里只负责套壳与排版样式。
 *
 * 模板：
 *  - insight  见解：克制留白的浅色阅读版
 *  - warm     温暖：暖米色衬线、亲和
 *  - dark     暗：深色护眼，贴合 demox 控制台风格
 */

/** HTML 转义，用于把标题安全地放进 <title> 与可见标题 */
const escapeHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * 通用骨架：注入语言、标题、样式与正文。
 * @param {{ title:string, bodyHtml:string, css:string, bodyClass:string, headingTitle:string }} o
 */
const shell = ({ title, bodyHtml, css, bodyClass, headingTitle }) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body class="${bodyClass}">
<main class="doc">
${headingTitle ? `<h1 class="doc-title">${escapeHtml(title)}</h1>` : ""}
<article class="doc-body">
${bodyHtml}
</article>
<footer class="doc-footer">由 <a href="https://demox.site" target="_blank" rel="noopener">demox</a> 部署</footer>
</main>
</body>
</html>`;

/**
 * 共享的结构性排版，使用 CSS 变量便于各模板覆写配色。
 * 各模板只需定义一组变量 + 少量个性化样式。
 */
const baseCss = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: var(--font-body);
  font-size: 17px;
  line-height: 1.75;
  color: var(--fg);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.doc {
  max-width: var(--measure, 720px);
  margin: 0 auto;
  padding: clamp(2.5rem, 6vw, 5rem) clamp(1.25rem, 5vw, 2rem) 4rem;
}
.doc-title {
  font-family: var(--font-heading);
  font-size: clamp(1.9rem, 5vw, 2.8rem);
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 2rem;
  color: var(--heading);
}
.doc-body { word-wrap: break-word; }
.doc-body h1, .doc-body h2, .doc-body h3,
.doc-body h4, .doc-body h5, .doc-body h6 {
  font-family: var(--font-heading);
  line-height: 1.3;
  font-weight: 700;
  color: var(--heading);
  margin: 2.2em 0 0.8em;
  letter-spacing: -0.01em;
}
.doc-body h1 { font-size: 1.8em; }
.doc-body h2 {
  font-size: 1.45em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}
.doc-body h3 { font-size: 1.2em; }
.doc-body h4 { font-size: 1.05em; }
.doc-body p { margin: 0 0 1.2em; }
.doc-body a { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
.doc-body a:hover { color: var(--link-hover); }
.doc-body strong { color: var(--heading); font-weight: 700; }
.doc-body ul, .doc-body ol { margin: 0 0 1.2em; padding-left: 1.5em; }
.doc-body li { margin: 0.35em 0; }
.doc-body li::marker { color: var(--muted); }
.doc-body blockquote {
  margin: 1.5em 0;
  padding: 0.4em 1.2em;
  border-left: 4px solid var(--accent);
  color: var(--muted);
  background: var(--quote-bg);
  border-radius: 0 6px 6px 0;
}
.doc-body blockquote p:last-child { margin-bottom: 0; }
.doc-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 1.5em 0; display: block; }
.doc-body hr { border: none; border-top: 1px solid var(--border); margin: 2.5em 0; }
.doc-body code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
.doc-body pre {
  background: var(--pre-bg);
  color: var(--pre-fg);
  padding: 1.1em 1.3em;
  border-radius: 10px;
  overflow-x: auto;
  margin: 1.5em 0;
  border: 1px solid var(--border);
  line-height: 1.6;
}
.doc-body pre code { background: none; color: inherit; padding: 0; font-size: 0.9em; }
.doc-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5em 0;
  font-size: 0.95em;
}
.doc-body th, .doc-body td {
  border: 1px solid var(--border);
  padding: 0.6em 0.9em;
  text-align: left;
}
.doc-body th { background: var(--code-bg); font-weight: 700; color: var(--heading); }
.doc-footer {
  margin-top: 4rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  font-size: 0.85rem;
  color: var(--muted);
  font-family: var(--font-mono);
}
.doc-footer a { color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
.doc-footer a:hover { color: var(--fg); }
`;

/** 见解：克制的浅色阅读版，黑白灰 + 一点点蓝 */
const insightCss = `
:root {
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-heading: var(--font-body);
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --measure: 700px;
  --bg: #ffffff;
  --fg: #27272a;
  --heading: #18181b;
  --muted: #71717a;
  --border: #e4e4e7;
  --accent: #2563eb;
  --link: #2563eb;
  --link-hover: #1d4ed8;
  --quote-bg: #f8fafc;
  --code-bg: #f4f4f5;
  --code-fg: #be185d;
  --pre-bg: #fafafa;
  --pre-fg: #27272a;
}
${baseCss}
`;

/** 温暖：暖米底色 + 衬线标题，亲和阅读感 */
const warmCss = `
:root {
  --font-body: "Georgia", "Songti SC", "STSong", "PingFang SC", serif;
  --font-heading: "Georgia", "Songti SC", "STSong", serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --measure: 700px;
  --bg: #fbf7f0;
  --fg: #463f35;
  --heading: #3a2f24;
  --muted: #8a7b68;
  --border: #e8ddcb;
  --accent: #d97706;
  --link: #b45309;
  --link-hover: #92400e;
  --quote-bg: #f5ecdd;
  --code-bg: #f1e7d6;
  --code-fg: #b45309;
  --pre-bg: #f5ecdd;
  --pre-fg: #463f35;
}
${baseCss}
body { font-size: 18px; }
.doc-body blockquote { font-style: italic; }
`;

/** 暗：深色护眼，贴合 demox 控制台 zinc 风格 */
const darkCss = `
:root {
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-heading: var(--font-body);
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --measure: 720px;
  --bg: #0a0a0b;
  --fg: #d4d4d8;
  --heading: #fafafa;
  --muted: #71717a;
  --border: #27272a;
  --accent: #a3e635;
  --link: #a3e635;
  --link-hover: #bef264;
  --quote-bg: #18181b;
  --code-bg: #18181b;
  --code-fg: #f0abfc;
  --pre-bg: #131316;
  --pre-fg: #e4e4e7;
}
${baseCss}
body {
  background-image: radial-gradient(circle at 20% 0%, rgba(163, 230, 53, 0.04), transparent 40%);
  background-attachment: fixed;
}
`;

/**
 * 模板注册表。id 用于持久化选择；previewColors 供 UI 画缩略色块；render 产出完整 HTML。
 */
export const docTemplates = [
  {
    id: "insight",
    name: { zh: "见解", en: "Insight" },
    desc: { zh: "克制留白的浅色阅读版", en: "Clean light reading layout" },
    previewColors: { bg: "#ffffff", fg: "#18181b", accent: "#2563eb" },
    render: ({ title, bodyHtml }) =>
      shell({ title, bodyHtml, css: insightCss, bodyClass: "t-insight", headingTitle: true })
  },
  {
    id: "warm",
    name: { zh: "温暖", en: "Warm" },
    desc: { zh: "暖米底色衬线、亲和", en: "Warm serif, cozy tone" },
    previewColors: { bg: "#fbf7f0", fg: "#3a2f24", accent: "#d97706" },
    render: ({ title, bodyHtml }) =>
      shell({ title, bodyHtml, css: warmCss, bodyClass: "t-warm", headingTitle: true })
  },
  {
    id: "dark",
    name: { zh: "暗", en: "Dark" },
    desc: { zh: "深色护眼，贴合控制台", en: "Dark, easy on the eyes" },
    previewColors: { bg: "#0a0a0b", fg: "#fafafa", accent: "#a3e635" },
    render: ({ title, bodyHtml }) =>
      shell({ title, bodyHtml, css: darkCss, bodyClass: "t-dark", headingTitle: true })
  }
];

/** 默认模板 id */
export const defaultTemplateId = "insight";

/** 按 id 取模板，找不到回退到默认 */
export const getTemplate = (id) =>
  docTemplates.find((tpl) => tpl.id === id) ||
  docTemplates.find((tpl) => tpl.id === defaultTemplateId);
