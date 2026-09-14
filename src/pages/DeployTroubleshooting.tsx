import React from "react";
import { useLanguage } from "@/hooks/use-language";
import { GeoArticle, GeoSectionHeading } from "@/components/GeoArticle";

const PAGE_URL = "https://www.demox.site/deploy-troubleshooting";
const PUBLISHED_AT = "2026-09-14";
const UPDATED_AT = "2026-09-14";

const copy = {
  zh: {
    eyebrow: "部署排错",
    title: "Demox 发布失败时，该看哪一条错误？",
    answer:
      "先读失败信息里的 code 和原文，不要猜。静态包缺根目录 index.html 时，会看到 MISSING_ENTRYPOINT 或「Artifact 缺少根目录 index.html」。包无法当静态站点打开时，code 是 INVALID_STATIC_SITE，默认文案是「上传包不是可直接访问的静态站点」。命中本地屏蔽词时，code 是 CONTENT_BLOCKED，文案是「发布失败：{文件} 未通过安全审核，文件名或文件内容含有违规词「{词}」。请修改后重试」。完整词表在 /content-scan，也可 GET https://api.demox.site/website/content-scan/phrases。私有站点未授权会看到 Access denied。Node 函数 push 成功但页面仍走旧逻辑，是因为 push 不改别名，站点域名始终使用 production。functions、env、alias 需要 CLI 1.1.6 及以上。",
    published: "发布于 2026-09-14",
    updated: "更新于 2026-09-14",
    author: "Demox 团队",
    primaryCta: "查看屏蔽词",
    secondaryCta: "打开文档",
    listEyebrow: "对照错误原文",
    listTitle: "常见失败和已验证处理",
    issues: [
      {
        q: "缺少根目录 index.html",
        code: "MISSING_ENTRYPOINT",
        message: "Artifact 缺少根目录 index.html",
        fix: "单文件 HTML 可直接上传。目录或 ZIP 必须把 index.html 放在根目录，不要放在子文件夹。React 或 Vue 源码目录通常不能直接上传，先执行生产构建。",
      },
      {
        q: "上传包不是静态站点",
        code: "INVALID_STATIC_SITE",
        message: "上传包不是可直接访问的静态站点",
        fix: "浏览器应只靠 HTML、CSS、JavaScript 和图片打开首页。不要上传带 node_modules 的源码树，也不要把开发服务器当作站点入口。",
      },
      {
        q: "内容审核拦截",
        code: "CONTENT_BLOCKED",
        message: "发布失败：{文件} 未通过安全审核，文件名或文件内容含有违规词「{词}」。请修改后重试",
        fix: "改掉失败信息里写出的那一个词，再重新发布。不要猜测词表。公开接口：GET https://api.demox.site/website/content-scan/phrases。图片审核走腾讯云 IMS，不在屏蔽词表里。",
      },
      {
        q: "私有站点打不开",
        code: "Access denied",
        message: "Access denied",
        fix: "私有站点在边缘拦截。未登录会跳到 Demox 登录；登录后仍无权限则返回 Access denied。把访问者加成项目成员，或把站点改回公开。",
      },
      {
        q: "样式或图片丢失",
        code: "",
        message: "页面能打开，但 CSS、字体或图片 404",
        fix: "检查 HTML 是否引用了 /Users/... 或 C:\\... 这类本机路径。把资源放进同一目录，使用相对路径，再整包上传。",
      },
      {
        q: "push 之后接口还是旧逻辑",
        code: "",
        message: "functions push 成功，站点域名仍返回上一版",
        fix: "push 只创建新版本，不会移动别名。站点域名走 production。执行 demox functions alias set --id 站点ID --slug 标识 production --version N。",
      },
      {
        q: "Express 原样上传",
        code: "",
        message: "入口不是 handler(request, env)",
        fix: "不要 app.listen。每个接口一个函数，入口文件 index.js / index.cjs / index.mjs，导出 module.exports = async function handler(request, env)。密钥用 demox env set --slug 注入。",
      },
      {
        q: "CLI 没有 functions 命令",
        code: "",
        message: "demox functions 不可用",
        fix: "安装 @demox-site/cli@latest，确认版本是 1.1.6 或更高。旧版只有页面部署命令。",
      },
    ],
    closeTitle: "先对错误原文，再改文件。",
    closeBody: "屏蔽词看 /content-scan。函数别名看文档。静态入口永远是根目录 index.html。",
  },
  en: {
    eyebrow: "Troubleshooting",
    title: "Which Demox deploy error should you act on?",
    answer:
      "Read the code and the exact message. Do not guess. A package missing root index.html returns MISSING_ENTRYPOINT or “Artifact 缺少根目录 index.html”. A package that cannot open as a static site returns INVALID_STATIC_SITE, defaulting to “上传包不是可直接访问的静态站点”. A local blocklist hit returns CONTENT_BLOCKED: “发布失败：{file} 未通过安全审核，文件名或文件内容含有违规词「{phrase}」。请修改后重试”. The full list is at /content-scan, or GET https://api.demox.site/website/content-scan/phrases. Unauthorized private sites show Access denied. A successful functions push that still serves old code did not move aliases; the site hostname always uses production. functions, env, and alias need CLI 1.1.6 or newer.",
    published: "Published Sep 14, 2026",
    updated: "Updated Sep 14, 2026",
    author: "Demox team",
    primaryCta: "Open the blocklist",
    secondaryCta: "Open the docs",
    listEyebrow: "Match the exact text",
    listTitle: "Common failures and verified remedies",
    issues: [
      {
        q: "Missing root index.html",
        code: "MISSING_ENTRYPOINT",
        message: "Artifact 缺少根目录 index.html",
        fix: "A single HTML file can upload directly. A directory or ZIP must keep index.html at the root, not in a nested folder. React or Vue source usually cannot upload until you run the production build.",
      },
      {
        q: "Not a static site",
        code: "INVALID_STATIC_SITE",
        message: "上传包不是可直接访问的静态站点",
        fix: "The browser should open the homepage with HTML, CSS, JavaScript, and images only. Do not upload a source tree with node_modules, and do not use a dev server as the site entry.",
      },
      {
        q: "Content scan blocked the upload",
        code: "CONTENT_BLOCKED",
        message: "发布失败：{file} 未通过安全审核，文件名或文件内容含有违规词「{phrase}」。请修改后重试",
        fix: "Change the exact phrase named in the error, then retry. Do not guess the list. Public API: GET https://api.demox.site/website/content-scan/phrases. Image review uses Tencent IMS and is not in the phrase list.",
      },
      {
        q: "Private site will not open",
        code: "Access denied",
        message: "Access denied",
        fix: "Private sites are blocked at the edge. Signed-out visitors go to Demox sign-in. Signed-in users without permission receive Access denied. Add the visitor as a project member, or switch the site back to public.",
      },
      {
        q: "Styles or images missing",
        code: "",
        message: "The page opens, but CSS, fonts, or images 404",
        fix: "Check whether HTML points at local paths such as /Users/... or C:\\.... Keep assets in the same directory, use relative paths, and upload the whole package.",
      },
      {
        q: "The API is still on the old version after push",
        code: "",
        message: "functions push succeeded, but the site hostname still returns the previous version",
        fix: "push only creates a version. It does not move aliases. The site hostname uses production. Run demox functions alias set --id SITE_ID --slug SLUG production --version N.",
      },
      {
        q: "Uploading Express as-is",
        code: "",
        message: "The entry is not handler(request, env)",
        fix: "Do not call app.listen. One function per endpoint. Entry file index.js / index.cjs / index.mjs exporting module.exports = async function handler(request, env). Inject secrets with demox env set --slug.",
      },
      {
        q: "CLI has no functions command",
        code: "",
        message: "demox functions is unavailable",
        fix: "Install @demox-site/cli@latest and confirm 1.1.6 or newer. Older CLIs only deploy pages.",
      },
    ],
    closeTitle: "Match the exact error, then edit the file.",
    closeBody: "Phrases live at /content-scan. Aliases are in the docs. The static entry is always root index.html.",
  },
} as const;

export const DeployTroubleshooting: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language === "en" ? "en" : "zh"];

  return (
    <GeoArticle
      url={PAGE_URL}
      published={PUBLISHED_AT}
      updated={UPDATED_AT}
      language={language === "en" ? "en" : "zh"}
      eyebrow={t.eyebrow}
      title={t.title}
      answer={t.answer}
      author={t.author}
      publishedLabel={t.published}
      updatedLabel={t.updated}
      ctas={[
        { href: "/content-scan", label: t.primaryCta, primary: true },
        { href: "/doc", label: t.secondaryCta },
      ]}
    >
      <section className="mx-auto max-w-5xl py-14 md:py-20" aria-labelledby="errors">
        <GeoSectionHeading eyebrow={t.listEyebrow} title={t.listTitle} id="errors" />
        <div className="mt-10 divide-y divide-[var(--stitch-line)] border-y border-[var(--stitch-line)]">
          {t.issues.map((item, index) => (
            <article key={item.q} className="py-7" id={item.code ? item.code.toLowerCase() : undefined}>
              <h3 className="text-xl font-bold tracking-tight">
                <span className="mr-3 font-mono text-sm text-[var(--stitch-muted)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item.q}
              </h3>
              {item.code ? (
                <p className="mt-3 font-mono text-xs text-[var(--stitch-muted)]">code: {item.code}</p>
              ) : null}
              <blockquote className="mt-4 break-words rounded-xl border border-[var(--stitch-line)] bg-[var(--stitch-blue-soft)] px-4 py-3 text-sm leading-7">
                {item.message}
              </blockquote>
              <p className="mt-4 max-w-3xl break-words leading-7 text-[var(--stitch-muted)]">{item.fix}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-[var(--stitch-ink)] px-7 py-12 text-[var(--stitch-surface)] md:px-12 md:py-16">
        <h2 className="max-w-3xl text-3xl font-black leading-tight tracking-[-0.035em] md:text-5xl">{t.closeTitle}</h2>
        <p className="mt-5 max-w-2xl leading-7 opacity-70">{t.closeBody}</p>
      </section>
    </GeoArticle>
  );
};

export default DeployTroubleshooting;
