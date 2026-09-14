import React, { type ReactNode } from "react";
import { MainLayout } from "@/layouts/MainLayout";

export function LegalArticle({
  eyebrow,
  title,
  updated,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <MainLayout>
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{eyebrow}</p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-[var(--stitch-muted)]">{updated}</p>
          <p className="text-sm leading-relaxed text-[var(--stitch-muted)]">{intro}</p>
        </header>
        {children}
      </article>
    </MainLayout>
  );
}

export function LegalSection({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3" id={id}>
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function LegalP({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-[var(--stitch-muted)]">{children}</p>;
}

export function LegalList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--stitch-muted)]">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
