// @ts-nocheck — markup mirrors the approved demo 1:1; behaviour lives in engine-s3.ts
import React, { useEffect, useRef } from "react";
import { initS3 } from "./engine-s3";
import "./demo-screens.css";
import { cardsForRow, cardTitle, cardCaption, type GalleryCard } from "./gallery-cards";
import { marketingStrings, type MarketingLang, type MarketingStrings } from "./marketing-translations";
import { COFFEE_CSS, renderBody, coffeeBody } from "./coffee-page.mjs";

/** Gallery mini-preview of coffee.demox.site — same shared page source */
const coffeeMini = (lang: MarketingLang) =>
  `<div class="cq" lang="${lang === "en" ? "en" : "zh-CN"}"><div class="cf">${renderBody(coffeeBody(lang)).replace(/ id="[^"]*"/g, "")}</div></div>`;
function ensureCoffeeCss() {
  if (document.getElementById("dx-coffee-css")) return;
  const st = document.createElement("style");
  st.id = "dx-coffee-css";
  st.textContent = COFFEE_CSS;
  document.head.appendChild(st);
}


const LOCK = <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><rect x={5} y={11} width={14} height={10} rx={2} /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
type S3 = MarketingStrings["s3"];
function renderPreview(c: GalleryCard, t: S3, lang: MarketingLang) {
  if (c.preview === "coffee") return <div className="pi pv-cf2" dangerouslySetInnerHTML={{ __html: coffeeMini(lang) }} />;
  if (c.preview === "www") return (<div className="pi pv-dx"><div className="nv"><b>demox</b><i className="ln" /><i className="ln" /><i className="ln" /><span className="lg">{t.miniWww.login}</span></div><h4>{t.miniWww.titleA}<br />{t.miniWww.titleB}</h4><span className="bt">{t.miniWww.btn}</span><div className="tm"><span className="g">➜</span> demox deploy<br /><span className="g">{t.miniWww.success}</span></div></div>);
  if (c.preview === "preview") return (<div className="pi pv-me"><h4>{t.miniPreview}</h4><div className="st"><div className="pn l"><i className="ln" /><i className="ln" /><i className="ln" /><i className="ln" /><i className="ln" /><i className="ln" /><i className="ln" /></div><div className="lk"><svg viewBox="0 0 16 16" aria-hidden="true"><rect width={16} height={16} rx={2} fill="#111" /><path d="M8 13.9L2.763 8.349A3.35 3.35 0 1 1 8 4.211A3.35 3.35 0 1 1 13.237 8.349Z" fill="#fff" /></svg></div><div className="pn r"><div className="bx" /><i className="ln" /><i className="ln s" /><i className="ln" /></div></div></div>);
  return <img className="pi s3-shot" src={c.image} alt="" width={560} height={270} loading="lazy" decoding="async" draggable={false} />;
}
function renderCard(c: GalleryCard, t: S3, lang: MarketingLang) {
  return (
    <a key={c.id} className="s3-card is-real" href={c.href || c.url} target="_blank" rel="noopener">
      <div className="s3-bar"><span className="s3-dots"><i /><i /><i /></span><span className="s3-url">{LOCK}<span>{host(c.url)}</span></span></div>
      <div className="s3-pv" aria-hidden="true">{renderPreview(c, t, lang)}</div>
      <div className="s3-cap"><div className="s3-cap-t"><b>{cardTitle(c, lang)}</b></div><div className="s3-cap-m" dangerouslySetInnerHTML={{ __html: cardCaption(c, lang) }} /></div>
    </a>
  );
}

/** Screen 3 · 作品墙 drifting gallery + 示例 modal */
const Markup = React.memo(function Markup({ t, lang }: { t: S3; lang: MarketingLang }) {
  const card = (c: GalleryCard) => renderCard(c, t, lang);
  return (
    <div>
  <section className="s3" id="s3" aria-labelledby="s3-title">
    <div className="s3-head">
      <div className="badge"><i />{t.badge}</div>
      <h2 id="s3-title">{t.title}</h2>
      <p className="s3-sub">{t.sub}</p>
      <div className="s3-acts">
        <a className="s3-cta" href="https://www.demox.site/">{t.cta}
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
        <a className="s3-link" href="/how-demox-hosts-itself">{t.selfHost}
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9" /></svg></a>
      </div>
    </div>
    <p className="sr-only">{t.srWallLead}{cardsForRow(1).concat(cardsForRow(2)).map((c) => cardTitle(c, lang) + t.srItemOpen + host(c.url) + t.srItemClose).join(t.srSep)}{t.srWallEnd}</p>
    <div className="s3-stage" id="s3stage">
      <div className="s3-wall">
        <div className="s3-row"><div className="s3-track"><div className="s3-set">{cardsForRow(1).map(card)}</div></div></div>
        <div className="s3-row rev"><div className="s3-track"><div className="s3-set">{cardsForRow(2).map(card)}</div></div></div>
      </div>
    </div>
    <div className="s3-note"><span className="ix-hint s3-hint" aria-hidden="true"><svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7l-5 5 5 5" /><path d="M16 7l5 5-5 5" /><path d="M3 12h18" /></svg>{t.dragHint}</span></div>
  </section>
  <div className="s3-modal" id="s3modal" hidden>
    <div className="s3-mbk" data-close />
    <div className="s3-dlg" role="dialog" aria-modal="true" aria-labelledby="s3mt" aria-describedby="s3md s3mn" tabIndex={-1}>
      <div className="s3-mbar"><span className="s3-dots" aria-hidden="true"><i /><i /><i /></span><span className="s3-url"><svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><rect x={5} y={11} width={14} height={10} rx={2} /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg><span id="s3mu" /></span>
        <button type="button" className="s3-x" data-close aria-label={t.closePreview}><svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
      <div className="s3-mpv" aria-hidden="true" />
      <div className="s3-mcap"><div className="s3-cap-t"><b id="s3mt" /></div>
        <p className="s3-md" id="s3md" />
        <div className="s3-mft"><span className="s3-mnote" id="s3mn">{t.modalNote}</span><a className="s3-mcta" href="https://www.demox.site/">{t.cta} <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a></div></div>
    </div>
  </div>
</div>
  );
});

const GalleryStageInner: React.FC<{ onUpload?: () => void; lang: MarketingLang }> = ({ onUpload, lang }) => {
  const up = useRef(onUpload);
  up.current = onUpload;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ensureCoffeeCss();
    const root = ref.current;
    const stop = initS3(root, lang);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.(".s3-cta, .s3-mcta");
      if (a && up.current) { e.preventDefault(); up.current(); }
    };
    root.addEventListener("click", onClick);
    return () => { root.removeEventListener("click", onClick); stop(); };
  }, [lang]);
  return (
    <div ref={ref} className="dx-mk dx-s3">
      <Markup t={marketingStrings(lang).s3} lang={lang} />
    </div>
  );
};

/** Remounts per language (the drifting rows clone the card sets once at init). */
export const GalleryStage: React.FC<{ onUpload?: () => void; lang?: MarketingLang }> = ({ onUpload, lang = "zh" }) => (
  <GalleryStageInner key={lang} onUpload={onUpload} lang={lang} />
);

export default GalleryStage;
