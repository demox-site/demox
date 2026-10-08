import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Layers, Sparkles, Wand2, Wrench, ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { MainLayout } from "@/layouts/MainLayout";
import { siteConfig } from "@/configs/env";
import { useLanguage, type Language } from "@/hooks/use-language";
import {
  CATEGORY_ORDER,
  LOG_FOOTER,
  LOG_SECTION_SUBTITLE,
  LOG_SECTION_TITLE,
  LOG_TAGLINE,
  LOG_TAGLINE_ACCENT,
  RELEASES,
  categoryOf,
  pickLang,
} from "@/content/changelog.mjs";
import "./log.css";

type Category = "feature" | "fix" | "ux" | "infra";
type Filter = "all" | Category;

/** A { zh, en } text pair from src/content/changelog.mjs. */
interface LangText {
  zh: string;
  en: string;
}

interface Feature {
  tag: string;
  title: LangText;
  desc: LangText;
  note?: LangText;
}

interface Release {
  version: string;
  name: LangText;
  date: string;
  dateNote: LangText;
  features: Feature[];
}

const COLLAPSE_AFTER = 3;

const ui = {
  zh: {
    eyebrow: "部署时间线",
    title: "Evolution",
    filterLabel: "按类型筛选",
    all: "全部",
    feature: "新功能",
    fix: "修复",
    ux: "体验",
    infra: "基建",
    releases: (n: number) => `${n} 个版本`,
    changes: (n: number) => `${n} 项变更`,
    more: (n: number) => `展开其余 ${n} 条`,
    less: "收起",
    empty: "这个类型下暂时没有记录。",
    termTitle: "~/demox — 终端",
    termAria: (v: string, d: string) => `最新版本 ${v}，发布于 ${d}`,
    head: "HEAD → 线上",
    tag: "标签",
    dateLabel: "日期",
    plus: (n: number) => `+${n} 项`,
    nodeAria: (v: string, d: string, n: number) => `${v}，${d}，${n} 项变更`,
    liveTitle: "当前线上版本",
  },
  en: {
    eyebrow: "Deploy timeline",
    title: "Evolution",
    filterLabel: "Filter by type",
    all: "All",
    feature: "Features",
    fix: "Fixes",
    ux: "Experience",
    infra: "Infra",
    releases: (n: number) => `${n} releases`,
    changes: (n: number) => `${n} changes`,
    more: (n: number) => `Show ${n} more`,
    less: "Show less",
    empty: "Nothing in this category yet.",
    termTitle: "~/demox — terminal",
    termAria: (v: string, d: string) => `Latest version ${v}, released ${d}`,
    head: "HEAD → live",
    tag: "tag",
    dateLabel: "Date",
    plus: (n: number) => `+${n} changes`,
    nodeAria: (v: string, d: string, n: number) => `${v}, ${d}, ${n} changes`,
    liveTitle: "Current live version",
  },
} as const;

const CATEGORY_ICON: Record<Category, LucideIcon> = {
  feature: Sparkles,
  fix: Wrench,
  ux: Wand2,
  infra: Layers,
};

const releases = RELEASES as Release[];
const displayVersion = (version: string) => (version === "current" ? `v${siteConfig.version}` : version);
const tr = (text: LangText | string | undefined, language: Language) => pickLang(text, language) as string;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/* ---------- Terminal header ---------- */

const TerminalHeader: React.FC<{ language: Language; reduced: boolean; totalChanges: number }> = ({
  language,
  reduced,
  totalChanges,
}) => {
  const t = ui[language];
  const latest = releases[0];
  const cmd = "demox log --latest";
  const [typed, setTyped] = useState(reduced ? cmd.length : 0);

  useEffect(() => {
    if (reduced) {
      setTyped(cmd.length);
      return;
    }
    setTyped(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= cmd.length) window.clearInterval(id);
    }, 45);
    return () => window.clearInterval(id);
  }, [reduced]);

  const done = typed >= cmd.length;

  return (
    <div className="dx-log-term" role="img" aria-label={t.termAria(displayVersion(latest.version), latest.date)}>
      <div className="bar" aria-hidden="true">
        <div className="dots"><i /><i /><i /></div>
        <span className="ttl">{t.termTitle}</span>
      </div>
      <div className="body" aria-hidden="true">
        <div className="row">
          <span className="p">$ </span>
          <span className="w">{cmd.slice(0, typed)}</span>
          {!done && <span className="caret" />}
        </div>
        {done && (
          <>
            <div className="row out">
              <span className="w">✓ {displayVersion(latest.version)}</span>
              <span className="d">  {latest.date}  ({t.head})</span>
            </div>
            <div className="row out" style={{ animationDelay: "90ms" }}>
              <span className="d">  </span>{tr(latest.name, language)}
            </div>
            <div className="row out" style={{ animationDelay: "180ms" }}>
              <span className="d">  {t.releases(releases.length)} · {t.changes(totalChanges)}</span>
            </div>
            <div className="row out" style={{ animationDelay: "260ms" }}>
              <span className="p">$ </span><span className="caret" />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* ---------- Release card ---------- */

const ReleaseCard: React.FC<{
  release: Release;
  items: Feature[];
  language: Language;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
  delay: number;
}> = ({ release, items, language, isLatest, expanded, onToggle, delay }) => {
  const t = ui[language];
  const ordered = useMemo(
    () =>
      (CATEGORY_ORDER as Category[]).flatMap((cat) => items.filter((f) => categoryOf(f.tag) === cat)),
    [items]
  );
  const collapsible = ordered.length > COLLAPSE_AFTER;
  const visible = collapsible && !expanded ? ordered.slice(0, COLLAPSE_AFTER) : ordered;
  const groups = (CATEGORY_ORDER as Category[])
    .map((cat) => ({ cat, list: visible.filter((f) => categoryOf(f.tag) === cat) }))
    .filter((g) => g.list.length > 0);

  return (
    <article className="dx-log-card" style={{ ["--d" as string]: `${delay}ms` }}>
      <header className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="dx-log-ver">{displayVersion(release.version)}</span>
          {isLatest && (
            <span className="dx-log-live" title={t.liveTitle}>
              <i aria-hidden="true" />LIVE
            </span>
          )}
          <h2 className="text-base md:text-lg font-semibold text-[var(--stitch-ink)] wrap-any">
            {tr(release.name, language)}
          </h2>
        </div>
        <div className="mt-1.5 text-xs mono text-[var(--stitch-muted)] wrap-any">
          <time dateTime={release.date}>{release.date}</time>{" "}
          <span className="italic opacity-80">{tr(release.dateNote, language)}</span>
        </div>
      </header>

      {groups.map(({ cat, list }) => {
        const Icon = CATEGORY_ICON[cat];
        return (
          <section key={cat} className="dx-log-group" aria-label={t[cat]}>
            <div className="dx-log-ghead">
              <Icon size={12} aria-hidden={true} />
              <span>{t[cat]}</span>
            </div>
            {list.map((f) => (
              <div key={f.title.zh} className="dx-log-item">
                <div className="dx-log-ihead">
                  <span className="dx-log-tag">{f.tag}</span>
                  <h3 className="font-semibold text-sm md:text-[15px] text-[var(--stitch-ink)] wrap-any min-w-0">
                    {tr(f.title, language)}
                  </h3>
                </div>
                <div className="dx-log-ibody">
                  <p className="mt-1 text-sm leading-relaxed text-[var(--stitch-muted)] wrap-any">
                    {tr(f.desc, language)}
                  </p>
                  {f.note && <p className="dx-log-note wrap-any">// {tr(f.note, language)}</p>}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {collapsible && (
        <button type="button" className="dx-log-more" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          {expanded ? t.less : t.more(ordered.length - COLLAPSE_AFTER)}
        </button>
      )}
    </article>
  );
};

/* ---------- Page ---------- */

const LogPage: React.FC = () => {
  const { language } = useLanguage();
  const t = ui[language];
  const reduced = usePrefersReducedMotion();
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const totalChanges = useMemo(() => releases.reduce((n, r) => n + r.features.length, 0), []);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: totalChanges, feature: 0, fix: 0, ux: 0, infra: 0 };
    releases.forEach((r) => r.features.forEach((f) => (c[categoryOf(f.tag) as Category] += 1)));
    return c;
  }, [totalChanges]);

  const rows = useMemo(
    () =>
      releases
        .map((release, index) => ({
          release,
          index,
          items: filter === "all" ? release.features : release.features.filter((f) => categoryOf(f.tag) === filter),
        }))
        .filter((r) => r.items.length > 0),
    [filter]
  );

  /* Rail lighting: everything in the first viewport is lit before first paint;
     below the fold the rail + nodes light up as you scroll (never un-light). */
  const tlRef = useRef<HTMLDivElement>(null);
  const [litPx, setLitPx] = useState<number | null>(null); // null = not measured yet → treat as fully lit
  const [railPx, setRailPx] = useState(0);
  const [litRows, setLitRows] = useState<Set<number>>(() => new Set(releases.map((_, i) => i)));
  const maxLit = useRef(0);

  const measure = useCallback(() => {
    const tl = tlRef.current;
    if (!tl) return;
    const rect = tl.getBoundingClientRect();
    const railTop = 14;
    const railHeight = Math.max(0, rect.height - railTop - 24);
    const vh = window.innerHeight || document.documentElement.clientHeight;
    // Bottom edge of the viewport in rail coords, plus one node height so a node that is even
    // partly visible on load is already lit (the first screen is never dimmed).
    const reach = reduced ? Infinity : vh - rect.top - railTop + 28;
    maxLit.current = Math.max(maxLit.current, reach);
    const lit = Math.min(railHeight, maxLit.current);
    setRailPx(railHeight);
    setLitPx(lit);
    const nextLit = new Set<number>();
    tl.querySelectorAll<HTMLElement>("[data-row]").forEach((el) => {
      const nodeY = el.offsetTop + 20 - railTop; // node top edge
      if (nodeY <= lit + 1) nextLit.add(Number(el.dataset.row));
    });
    setLitRows((prev) => {
      if (prev.size === nextLit.size && [...nextLit].every((i) => prev.has(i))) return prev;
      return nextLit;
    });
  }, [reduced]);

  useLayoutEffect(() => {
    measure();
  }, [measure, rows, expanded, language]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [measure]);

  const toggle = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const filters: Filter[] = ["all", ...(CATEGORY_ORDER as Category[])];
  const fillPx = litPx === null ? railPx : litPx;
  const allLit = litPx !== null && railPx > 0 && litPx >= railPx - 1;

  return (
    <MainLayout>
      <div className="dx-log">
        <div className="dx-log-grid" aria-hidden="true" />

        <header className="relative z-[1] grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-end mb-8 md:mb-10">
          <div className="min-w-0">
            <p className="mono text-xs tracking-wider uppercase text-[var(--stitch-muted)] mb-3 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--stitch-ink)]" aria-hidden="true" />
              {t.eyebrow}
            </p>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-[var(--stitch-ink)]">
              {t.title}
              <span className="text-[var(--stitch-muted)]">_</span>
            </h1>
            <p className="mono text-sm text-[var(--stitch-muted)] mt-3">
              {LOG_TAGLINE}{" "}
              <span className="text-[var(--stitch-ink)] underline decoration-[var(--stitch-line)] underline-offset-4">
                {LOG_TAGLINE_ACCENT}
              </span>
            </p>
          </div>
          <TerminalHeader language={language} reduced={reduced} totalChanges={totalChanges} />
        </header>

        <div
          role="group"
          aria-label={t.filterLabel}
          className="relative z-[1] flex flex-wrap gap-2 mb-6 md:mb-8"
        >
          {filters.map((f) => {
            const Icon = f === "all" ? null : CATEGORY_ICON[f];
            return (
              <button
                key={f}
                type="button"
                className="dx-log-chip"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {Icon && <Icon size={13} aria-hidden={true} />}
                {t[f]}
                <span className="n">{counts[f]}</span>
              </button>
            );
          })}
        </div>

        <div className="dx-log-tl relative z-[1] pt-9" ref={tlRef} data-all-lit={allLit || litPx === null}>
          <div className="dx-log-rail" aria-hidden="true" />
          <div className="dx-log-fill" aria-hidden="true" style={{ height: fillPx }}>
            {!reduced && (
              <div className="dx-log-flow" style={{ ["--flow-h" as string]: `${fillPx}px` }}>
                <i />
              </div>
            )}
          </div>
          <span className="dx-log-head-node" aria-hidden="true" />
          <div className="absolute left-[34px] md:left-[56px] top-[2px] flex items-center gap-2 text-xs mono text-[var(--stitch-muted)]">
            <span className="text-[var(--stitch-ink)] font-semibold">{tr(LOG_SECTION_TITLE, language)}</span>
            <span className="px-1.5 py-0.5 rounded border border-[var(--stitch-line)]">{tr(LOG_SECTION_SUBTITLE, language)}</span>
          </div>

          {rows.length === 0 && <p className="pl-12 text-sm text-[var(--stitch-muted)]">{t.empty}</p>}

          {rows.map(({ release, index, items }, i) => {
            const isLatest = index === 0;
            const lit = litPx === null || litRows.has(index);
            return (
              <div
                key={`${release.version}-${release.date}-${release.name.zh}`}
                className="dx-log-row"
                data-row={index}
                data-lit={lit}
                data-latest={isLatest}
              >
                <div className="dx-log-nodecol">
                  <span
                    className="dx-log-node"
                    tabIndex={0}
                    aria-label={t.nodeAria(displayVersion(release.version), release.date, release.features.length)}
                  >
                    <span className="dx-log-tip" role="tooltip">
                      {isLatest ? (
                        <><span className="y">({t.head}, </span><b>{t.tag}: {displayVersion(release.version)}</b><span className="y">)</span></>
                      ) : (
                        <><span className="y">({t.tag}: </span><b>{displayVersion(release.version)}</b><span className="y">)</span></>
                      )}
                      <br />
                      <span className="y">{t.dateLabel}:</span> {release.date} · {t.plus(release.features.length)}
                    </span>
                  </span>
                </div>
                <ReleaseCard
                  release={release}
                  items={items}
                  language={language}
                  isLatest={isLatest}
                  expanded={expanded.has(index)}
                  onToggle={() => toggle(index)}
                  delay={reduced ? 0 : Math.min(i, 6) * 50}
                />
              </div>
            );
          })}
          <span className="dx-log-end" aria-hidden="true" />
          <div className="h-12" aria-hidden="true" />
        </div>

        <footer className="mt-16 pb-6 text-center">
          <p className="text-[var(--stitch-muted)] text-xs">{tr(LOG_FOOTER, language)}</p>
        </footer>
      </div>
    </MainLayout>
  );
};

export default LogPage;
