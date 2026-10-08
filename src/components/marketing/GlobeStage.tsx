// @ts-nocheck — markup mirrors the approved demo 1:1; behaviour lives in engine-s2.ts
import React, { useEffect, useRef } from "react";
import { initS2 } from "./engine-s2";
import { marketingStrings, type MarketingLang, type MarketingStrings } from "./marketing-translations";
import "./demo-screens.css";

/** Screen 2 · 全球节点 dot globe */
const Markup = React.memo(function Markup({ t }: { t: MarketingStrings["s2"] }) {
  return (
    <section className="s2" id="s2" aria-labelledby="s2-title">
  <div className="s2-in">
    <div className="s2-copy">
      <div className="badge"><i />{t.badge}</div>
      <h2 id="s2-title">{t.title}</h2>
      <p className="s2-sub">{t.sub}</p>
      <ul className="s2-points">
        <li><span className="s2-ic"><svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 16l-4-4-4 4" /><path d="M12 12v9" /><path d="M20.4 18.4A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 4 16.3" /></svg></span>
          <div><b>{t.points[0].t}</b><span dangerouslySetInnerHTML={{ __html: t.points[0].d }} /></div></li>
        <li><span className="s2-ic"><svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x={4} y={11} width={16} height={10} rx={2} /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg></span>
          <div><b>{t.points[1].t}</b><span dangerouslySetInnerHTML={{ __html: t.points[1].d }} /></div></li>
        <li><span className="s2-ic"><svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg></span>
          <div><b>{t.points[2].t}</b><span dangerouslySetInnerHTML={{ __html: t.points[2].d }} /></div></li>
      </ul>
      <div className="s2-tags">{t.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    </div>
    <div className="s2-viz">
      <div className="ix-hint s2-hint" aria-hidden="true"><svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg>{t.hint}</div>
      <div className="globe-wrap"><canvas id="globe" tabIndex={0} role="button" aria-label={t.globeLabel} /></div>
      <p className="sr-only">{t.srAnim}</p>
      <div className="s2-meta">
        <div className="s2-card busy" id="s2card" aria-hidden="true"><span className="dot" />
          <div className="s2-tx"><b id="s2st">{t.cardUpload}</b><em id="s2url">coffee.demox.site</em><div className="s2-bar"><i id="s2bar" /></div></div></div>
        <div className="s2-legend" aria-hidden="true"><span><i className="lg-node" />{t.legendNode}</span><span><i className="lg-sync" />{t.legendSync}</span><span><i className="lg-req" />{t.legendReq}</span><span className="note">{t.legendNote}</span></div>
      </div>
    </div>
  </div>
</section>
  );
});

const GlobeStageInner: React.FC<{ lang: MarketingLang }> = ({ lang }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return initS2(ref.current, lang);
  }, [lang]);
  return (
    <div ref={ref} className="dx-mk dx-s2">
      <Markup t={marketingStrings(lang).s2} />
    </div>
  );
};

/** Remounts per language so the engine-driven status card restarts in the new language. */
export const GlobeStage: React.FC<{ lang?: MarketingLang }> = ({ lang = "zh" }) => (
  <GlobeStageInner key={lang} lang={lang} />
);

export default GlobeStage;
