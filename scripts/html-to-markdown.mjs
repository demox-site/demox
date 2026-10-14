/**
 * 把预渲染的 crawlable fallback HTML 转成 Markdown（给 /*.md 和 llms-full.txt 用）。
 * 只处理我们自己写的那几种标签：h1-h3、p、ol/ul/li、pre/code、a、strong、table、dl。
 */
function decode(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function absolute(href, siteUrl) {
  if (/^(https?:|mailto:)/.test(href)) return href;
  if (href.startsWith("/")) return `${siteUrl}${href}`;
  return href;
}

function inline(html, siteUrl) {
  return html
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, text) => `[${inline(text, siteUrl)}](${absolute(href, siteUrl)})`)
    .replace(/<strong>([\s\S]*?)<\/strong>/g, "**$1**")
    .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<br\s*\/?>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function htmlToMarkdown(html, siteUrl = "https://www.demox.site") {
  let out = html;
  const blocks = [];
  // pre/code blocks first so their content is untouched
  out = out.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, code) => {
    blocks.push("```\n" + decode(code.replace(/<[^>]+>/g, "")).trim() + "\n```");
    return `\n@@BLOCK${blocks.length - 1}@@\n`;
  });
  out = out.replace(/<table>([\s\S]*?)<\/table>/g, (_, table) => {
    const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
      [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => inline(cell[1], siteUrl)));
    if (!rows.length) return "";
    const lines = [`| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`)];
    blocks.push(lines.join("\n"));
    return `\n@@BLOCK${blocks.length - 1}@@\n`;
  });
  out = out.replace(/<ol>([\s\S]*?)<\/ol>/g, (_, list) => {
    let n = 0;
    return "\n" + [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li) => `${++n}. ${inline(li[1], siteUrl)}`).join("\n") + "\n";
  });
  out = out.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, list) =>
    "\n" + [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li) => `- ${inline(li[1], siteUrl)}`).join("\n") + "\n");
  out = out
    .replace(/<a class="fallback-skip"[\s\S]*?<\/a>/g, "")
    .replace(/<header class="fallback-header">[\s\S]*?<\/header>/g, "")
    .replace(/<h1>([\s\S]*?)<\/h1>/g, (_, t) => `\n# ${inline(t, siteUrl)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (_, t) => `\n## ${inline(t, siteUrl)}\n`)
    .replace(/<h3>([\s\S]*?)<\/h3>/g, (_, t) => `\n### ${inline(t, siteUrl)}\n`)
    .replace(/<dt>([\s\S]*?)<\/dt>/g, (_, t) => `\n**${inline(t, siteUrl)}**`)
    .replace(/<dd>([\s\S]*?)<\/dd>/g, (_, t) => `: ${inline(t, siteUrl)}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/g, (_, t) => `\n${inline(t, siteUrl)}\n`)
    .replace(/<div class="fallback-eyebrow">([\s\S]*?)<\/div>/g, (_, t) => `\n${inline(t, siteUrl)}\n`)
    .replace(/<div class="fallback-actions">([\s\S]*?)<\/div>/g, (_, t) => `\n${[...t.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => `[${inline(m[2], siteUrl)}](${absolute(m[1], siteUrl)})`).join(" · ")}\n`)
    .replace(/<[^>]+>/g, "");
  out = decode(out)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/@@BLOCK(\d+)@@/g, (_, i) => blocks[Number(i)])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out + "\n";
}
