import React from "react";
import { useLocation } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { GeoArticle, GeoSectionHeading } from "@/components/GeoArticle";
import { INTENT_LANDINGS, INTENT_PUBLISHED, INTENT_UPDATED } from "@/content/intent-landings.mjs";
import { useLanguage } from "@/hooks/use-language";

export const IntentLanding: React.FC = () => {
  const { pathname } = useLocation();
  const { language } = useLanguage();
  const id = pathname.replace(/\/+$/, "").replace(/^\//, "");
  const page = INTENT_LANDINGS.find((item) => item.id === id);
  const isZh = language === "zh";

  if (!page) {
    return (
      <GeoArticle
        url="https://www.demox.site/"
        published={INTENT_PUBLISHED}
        updated={INTENT_UPDATED}
        language={isZh ? "zh" : "en"}
        eyebrow="Demox"
        title={isZh ? "页面不存在" : "Page not found"}
        answer={isZh ? "这个地址不是 Demox 的公开说明页。" : "This URL is not a public Demox guide."}
        author="Demox"
        publishedLabel=""
        updatedLabel=""
        ctas={[{ href: "/", label: isZh ? "回到首页" : "Home", primary: true }]}
      >
        <p className="mx-auto max-w-5xl py-10 text-[var(--stitch-muted)]">
          <a href="/when-to-use-demox">{isZh ? "适用场景" : "When to use"}</a>
        </p>
      </GeoArticle>
    );
  }

  const h1 = isZh ? page.zh.h1 : page.h1;
  const answer = isZh ? page.zh.answer : page.answer;
  const steps = isZh ? page.zh.steps : page.steps;
  const faqs = isZh ? page.zh.faqs : page.faqs;
  const related = INTENT_LANDINGS.filter((item) => item.id !== page.id).slice(0, 8);

  return (
    <>
      <Seo title={isZh ? page.zh.title : page.title} description={isZh ? page.zh.description : page.description} />
      <GeoArticle
        url={`https://www.demox.site/${page.id}`}
        published={INTENT_PUBLISHED}
        updated={INTENT_UPDATED}
        language={isZh ? "zh" : "en"}
        eyebrow={isZh ? page.zh.eyebrow : page.eyebrow}
        title={h1}
        answer={answer}
        author="Demox"
        publishedLabel={isZh ? `发布于 ${INTENT_PUBLISHED}` : `Published ${INTENT_PUBLISHED}`}
        updatedLabel={isZh ? `更新于 ${INTENT_UPDATED}` : `Updated ${INTENT_UPDATED}`}
        ctas={[
          { href: "/console/projects", label: isZh ? "上传并发布" : "Upload and publish", primary: true },
          { href: "/doc", label: isZh ? "CLI / MCP 文档" : "CLI and MCP docs" },
        ]}
      >
        <section className="mx-auto max-w-5xl py-14 md:py-20" aria-labelledby="how-to">
          <GeoSectionHeading
            eyebrow={isZh ? "步骤" : "How to"}
            title={isZh ? "按这个顺序做" : "Do it in this order"}
            id="how-to"
          />
          <ol className="mt-8 space-y-4">
            {steps.map((step, index) => (
              <li key={`${index}-${step}`} className="grid grid-cols-[2.5rem_1fr] gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--stitch-line)] font-mono text-xs font-bold">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="pt-2 leading-7 text-[var(--stitch-muted)]">{step}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="mx-auto max-w-5xl pb-14 md:pb-20" aria-labelledby="faq">
          <GeoSectionHeading eyebrow="FAQ" title={isZh ? "常见问题" : "Questions"} id="faq" />
          <div className="mt-8 divide-y divide-[var(--stitch-line)] border-y border-[var(--stitch-line)]">
            {faqs.map((item) => (
              <article key={item.q} className="py-6">
                <h3 className="text-lg font-bold">{item.q}</h3>
                <p className="mt-3 max-w-3xl leading-7 text-[var(--stitch-muted)]">{item.a}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="mx-auto max-w-5xl pb-16" aria-labelledby="related">
          <GeoSectionHeading
            eyebrow={isZh ? "相关" : "Related"}
            title={isZh ? "这些意图页也指向 Demox" : "Other intent pages"}
            id="related"
          />
          <ul className="mt-8 grid gap-3 md:grid-cols-2">
            {related.map((item) => (
              <li key={item.id}>
                <a href={`/${item.id}`} className="block rounded-2xl border border-[var(--stitch-line)] p-5 text-sm font-bold leading-6">
                  {isZh ? item.zh.h1 : item.h1}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </GeoArticle>
    </>
  );
};

export default IntentLanding;
