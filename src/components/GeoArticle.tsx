import React, { type ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { ArrowRight, Clock3 } from "lucide-react";
import { MainLayout } from "@/layouts/MainLayout";

type Cta = {
  href: string;
  label: string;
  primary?: boolean;
};

export function GeoArticle({
  url,
  published,
  updated,
  language,
  eyebrow,
  title,
  answer,
  author,
  publishedLabel,
  updatedLabel,
  ctas,
  children,
}: {
  url: string;
  published: string;
  updated: string;
  language: "zh" | "en";
  eyebrow: string;
  title: string;
  answer: string;
  author: string;
  publishedLabel: string;
  updatedLabel: string;
  ctas: readonly Cta[];
  children: ReactNode;
}) {
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description: answer,
    datePublished: published,
    dateModified: updated,
    inLanguage: language === "zh" ? "zh-CN" : "en",
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: "Demox", url: "https://www.demox.site/" },
    publisher: { "@type": "Organization", name: "Demox", url: "https://www.demox.site/" },
  };

  return (
    <MainLayout>
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(articleSchema)}</script>
      </Helmet>
      <article className="relative min-w-0 w-full pb-8">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] overflow-hidden opacity-70"
          style={{
            background:
              "radial-gradient(circle at 12% 8%, var(--stitch-blue-soft), transparent 32rem), radial-gradient(circle at 88% 20%, var(--stitch-blue-soft), transparent 26rem)",
          }}
        />
        <header className="mx-auto max-w-5xl border-b border-[var(--stitch-line)] pb-14 pt-5 md:pb-20 md:pt-12">
          <div className="mb-7 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-[var(--stitch-muted)]">
            <span className="h-px w-8 bg-[var(--stitch-ink)]" />
            {eyebrow}
          </div>
          <h1 className="max-w-4xl min-w-0 break-words text-3xl font-black leading-[1.15] tracking-[-0.04em] text-[var(--stitch-ink)] [overflow-wrap:anywhere] sm:text-5xl md:text-6xl">
            {title}
          </h1>
          <p className="mt-8 max-w-3xl min-w-0 break-words text-base leading-8 text-[var(--stitch-muted)] [overflow-wrap:anywhere] md:text-xl">{answer}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-[var(--stitch-muted)]">
            <span className="inline-flex items-center gap-2">
              <Clock3 size={14} />
              {updatedLabel}
            </span>
            <span>{publishedLabel}</span>
            <span>{author}</span>
          </div>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            {ctas.map((cta) => (
              <a
                key={cta.href + cta.label}
                href={cta.href}
                className={
                  cta.primary
                    ? "inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--stitch-ink)] px-6 py-3 text-sm font-bold text-[var(--stitch-surface)] transition-transform hover:-translate-y-0.5"
                    : "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--stitch-line)] bg-[var(--stitch-surface)] px-6 py-3 text-sm font-bold text-[var(--stitch-ink)] transition-colors hover:bg-[var(--stitch-surface-strong)]"
                }
              >
                {cta.label}
                {!cta.primary && <ArrowRight size={17} />}
              </a>
            ))}
          </div>
        </header>
        {children}
      </article>
    </MainLayout>
  );
}

export function GeoSectionHeading({
  eyebrow,
  title,
  id,
}: {
  eyebrow: string;
  title: string;
  id: string;
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--stitch-muted)]">{eyebrow}</p>
      <h2 id={id} className="mt-3 max-w-3xl text-3xl font-black tracking-[-0.035em] md:text-4xl">
        {title}
      </h2>
    </div>
  );
}
