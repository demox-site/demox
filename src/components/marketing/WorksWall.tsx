import React, { useEffect, useRef, useState } from "react";
import { marketingStrings, type MarketingLang, type MarketingStrings } from "./marketing-translations";

/** 固定文件名。市场替换 public/works/<id>.webp 即可，构建不会改名。比例 1200×750。 */
const WORK_IDS = [
  "guangzhouta",
  "gebii",
  "botcamp",
  "yuanshan-design",
  "coffee",
  "beixian-lighting",
  "letters-from-the-hill",
] as const satisfies readonly (keyof MarketingStrings["works"]["names"])[];

const SHOT_W = 1200;
const SHOT_H = 750;

function useWhenVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, visible };
}

function WorkCard({
  id,
  name,
  newTabLabel,
}: {
  id: (typeof WORK_IDS)[number];
  name: string;
  newTabLabel: string;
}) {
  const { ref, visible } = useWhenVisible<HTMLDivElement>();
  const host = `${id}.demox.site`;
  return (
    <a
      href={`https://${host}/`}
      target="_blank"
      rel="noopener"
      className="block min-w-0 overflow-hidden rounded-[12px] border border-[#e5e5e3] bg-[#ffffff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111] hover:border-[#c8c8c6]"
    >
      <div ref={ref} className="relative aspect-[16/10] bg-[#ffffff]" data-works-shot={id}>
        {visible ? (
          <img
            src={`/works/${id}.webp`}
            alt=""
            width={SHOT_W}
            height={SHOT_H}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="px-4 py-3">
        <div className="text-[15px] font-semibold leading-snug text-[#111111]">{name}</div>
        <div className="mt-1 break-all text-[13px] leading-snug text-[#6b6b6b]">{host}</div>
        <span className="sr-only">{newTabLabel}</span>
      </div>
    </a>
  );
}

/** 首页首屏以下的作品墙。只放这 7 个站，不展示品类或数字。 */
export function WorksWall({ lang }: { lang: MarketingLang }) {
  const t = marketingStrings(lang).works;
  return (
    <section id="works" aria-labelledby="works-title" className="scroll-mt-20 border-t border-[var(--stitch-line)] py-16 md:py-24">
      <h2 id="works-title" className="mb-8 text-2xl font-bold tracking-tight text-[var(--stitch-ink)] md:text-3xl">
        {t.title}
      </h2>
      <p className="sr-only">{t.srIntro}</p>
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-3 lg:gap-5">
        {WORK_IDS.map((id) => (
          <li key={id} className="min-w-0">
            <WorkCard id={id} name={t.names[id]} newTabLabel={t.srNewTab} />
          </li>
        ))}
      </ul>
    </section>
  );
}
