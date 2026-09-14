import React from "react";
import { useLanguage } from "@/hooks/use-language";
import { GeoArticle, GeoSectionHeading } from "@/components/GeoArticle";

const PAGE_URL = "https://www.demox.site/how-demox-hosts-itself";
const PUBLISHED_AT = "2026-09-14";
const UPDATED_AT = "2026-09-14";

const copy = {
  zh: {
    eyebrow: "第一方案例",
    title: "Demox 怎样用自己部署自己？",
    answer:
      "Demox 主站是平台上的一个普通站点，不是腾讯云控制台里单独维护的特例页面。静态前端执行 npm run build 后，用 demox deploy ./dist 发布。鉴权、站点、MCP 和证书续期这些业务后端已经挂在同一站点上，用 demox functions push 按 slug 更新。函数环境变量按函数设置；首次上传创建 v1，production 和 develop 都指向 v1，之后再上传不会自动改别名。对外 API 入口是 https://api.demox.site。只有改发布能力本身时，才去动统一 SCF 路由器。本页记录的是仓库 AGENTS.md 中的现行发布方式。它证明同一套 CLI 可以同时发页面和 Node 函数，但不提供访问量、客户数或可用性数字。",
    published: "发布于 2026-09-14",
    updated: "更新于 2026-09-14",
    author: "Demox 团队",
    primaryCta: "查看 CLI 文档",
    secondaryCta: "适用场景",
    methodEyebrow: "方法",
    methodTitle: "发布时实际执行的命令",
    stepsTitle: "步骤",
    steps: [
      "在 demox/ 目录构建前端：npm run build。",
      "用仓库 CLI 发布静态产物：demox deploy ./dist --id EPX2UU43。",
      "按 slug 推送业务函数，例如 auth、website、mcp、cert-renew。",
      "密钥和数据库地址走该函数的 env，不写进前端文件。",
      "需要新版本对外服务时，显式把 production 或 develop 指向该版本。",
    ],
    limitsEyebrow: "范围",
    limitsTitle: "这个案例能证明什么，不能证明什么",
    limits: [
      "能证明：静态页面和 Node handler 可以挂在同一站点，并且 Demox 自己走这条路径。",
      "能证明：函数版本和别名是分开的，push 不会悄悄切换流量。",
      "不能证明：任意 Express、Python 或带私密数据库的应用可以零改动迁入。",
      "不能证明：性能、配额或客户规模。本页不给出这些数字。",
    ],
    closeTitle: "把主站当成一个用户站点来发。",
    closeBody: "页面走 demox deploy。业务函数走 demox functions push。不要为了改登录或站点页面去动腾讯云函数脚本。",
  },
  en: {
    eyebrow: "First-party case",
    title: "How does Demox host itself?",
    answer:
      "The Demox main site is an ordinary site on the platform, not a special page maintained only in the Tencent Cloud console. The static frontend runs npm run build, then demox deploy ./dist. Auth, website, MCP, and certificate-renewal backends already hang off the same site and update with demox functions push by slug. Function env is per function. The first upload creates v1 and points production and develop at v1; later uploads do not move aliases. The public API host is https://api.demox.site. The unified SCF router is touched only when the publishing capability itself changes. This page records the current path in the repository AGENTS.md. It shows that the same CLI can publish pages and Node functions. It does not provide traffic, customer, or uptime numbers.",
    published: "Published Sep 14, 2026",
    updated: "Updated Sep 14, 2026",
    author: "Demox team",
    primaryCta: "Read the CLI docs",
    secondaryCta: "When to use",
    methodEyebrow: "Method",
    methodTitle: "Commands used for a real release",
    stepsTitle: "Steps",
    steps: [
      "Build the frontend in demox/: npm run build.",
      "Publish the static output with the repo CLI: demox deploy ./dist --id EPX2UU43.",
      "Push business functions by slug, such as auth, website, mcp, and cert-renew.",
      "Put secrets and database addresses in that function's env, not in frontend files.",
      "To serve a new version, point production or develop at that version explicitly.",
    ],
    limitsEyebrow: "Scope",
    limitsTitle: "What this case does and does not prove",
    limits: [
      "It proves static pages and Node handlers can share one site, and that Demox uses this path.",
      "It proves function versions and aliases are separate; push does not silently switch traffic.",
      "It does not prove that any Express, Python, or private-database app can migrate with zero changes.",
      "It does not prove performance, quota, or customer scale. This page gives no such numbers.",
    ],
    closeTitle: "Treat the main site as a user site.",
    closeBody: "Pages use demox deploy. Business functions use demox functions push. Do not edit Tencent Cloud function scripts just to change sign-in or marketing pages.",
  },
} as const;

export const HowDemoxHostsItself: React.FC = () => {
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
        { href: "/doc", label: t.primaryCta, primary: true },
        { href: "/when-to-use-demox", label: t.secondaryCta },
      ]}
    >
      <section className="mx-auto max-w-5xl py-14 md:py-20" aria-labelledby="method">
        <GeoSectionHeading eyebrow={t.methodEyebrow} title={t.methodTitle} id="method" />
        <pre className="mt-8 overflow-x-auto rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface-strong)] p-5 text-xs leading-7 sm:text-sm">
          <code>{`npm run build
demox deploy ./dist --id EPX2UU43
demox functions push ./scf-deploy-packages/auth-api --id EPX2UU43 --slug auth
demox functions push ./scf-code/website-api --id EPX2UU43 --slug website
demox functions push ./scf-code/mcp-api --id EPX2UU43 --slug mcp
demox functions push ./scf-code/cert-renew --id EPX2UU43 --slug cert-renew`}</code>
        </pre>
        <h3 className="mt-10 text-xl font-bold">{t.stepsTitle}</h3>
        <ol className="mt-6 space-y-4">
          {t.steps.map((step, index) => (
            <li key={step} className="grid grid-cols-[2.5rem_1fr] gap-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--stitch-line)] font-mono text-xs font-bold">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="pt-2 leading-7 text-[var(--stitch-muted)]">{step}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="mx-auto max-w-5xl pb-14 md:pb-20" aria-labelledby="limits">
        <GeoSectionHeading eyebrow={t.limitsEyebrow} title={t.limitsTitle} id="limits" />
        <ul className="mt-8 space-y-4">
          {t.limits.map((item) => (
            <li key={item} className="rounded-2xl border border-[var(--stitch-line)] p-5 leading-7 text-[var(--stitch-muted)]">
              {item}
            </li>
          ))}
        </ul>
      </section>
      <section className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-[var(--stitch-ink)] px-7 py-12 text-[var(--stitch-surface)] md:px-12 md:py-16">
        <h2 className="max-w-3xl text-3xl font-black leading-tight tracking-[-0.035em] md:text-5xl">{t.closeTitle}</h2>
        <p className="mt-5 max-w-2xl leading-7 opacity-70">{t.closeBody}</p>
      </section>
    </GeoArticle>
  );
};

export default HowDemoxHostsItself;
