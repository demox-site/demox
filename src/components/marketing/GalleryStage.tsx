// @ts-nocheck — markup mirrors the approved demo 1:1; behaviour lives in engine-s3.ts
import React, { useEffect, useRef } from "react";
import { initS3 } from "./engine-s3";
import "./demo-screens.css";
import { cardsForRow, type GalleryCard } from "./gallery-cards";
import { COFFEE_CSS, renderBody } from "./coffee-page.mjs";

/** Gallery mini-preview of coffee.demox.site — same shared page source */
const COFFEE_MINI = `<div class="cq"><div class="cf">${renderBody().replace(/ id="[^"]*"/g, "")}</div></div>`;
function ensureCoffeeCss() {
  if (document.getElementById("dx-coffee-css")) return;
  const st = document.createElement("style");
  st.id = "dx-coffee-css";
  st.textContent = COFFEE_CSS;
  document.head.appendChild(st);
}


const LOCK = <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><rect x={5} y={11} width={14} height={10} rx={2} /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
function renderPreview(c: GalleryCard) {
  if (c.preview === "coffee") return <div className="pi pv-cf2" dangerouslySetInnerHTML={{ __html: COFFEE_MINI }} />;
  if (c.preview === "www") return (<div className="pi pv-dx"><div className="nv"><b>demox</b><i className="ln" /><i className="ln" /><i className="ln" /><span className="lg">登录</span></div><h4>免费静态网站发布平台，<br />支持 CLI 和 MCP</h4><span className="bt">立即上传</span><div className="tm"><span className="g">➜</span> demox deploy<br /><span className="g">成功！已部署至：</span></div></div>);
  if (c.preview === "preview") return (<div className="pi pv-me"><h4>一键发布为公网网站</h4><div className="st"><div className="pn l"><i className="ln" /><i className="ln" /><i className="ln" /><i className="ln" /><i className="ln" /><i className="ln" /><i className="ln" /></div><div className="lk"><svg viewBox="0 0 16 16" aria-hidden="true"><rect width={16} height={16} rx={2} fill="#111" /><path d="M8 13.9L2.763 8.349A3.35 3.35 0 1 1 8 4.211A3.35 3.35 0 1 1 13.237 8.349Z" fill="#fff" /></svg></div><div className="pn r"><div className="bx" /><i className="ln" /><i className="ln s" /><i className="ln" /></div></div></div>);
  return <img className="pi s3-shot" src={c.image} alt="" width={560} height={270} loading="lazy" decoding="async" draggable={false} />;
}
function renderCard(c: GalleryCard) {
  return (
    <a key={c.id} className="s3-card is-real" href={c.href || c.url} target="_blank" rel="noopener">
      <div className="s3-bar"><span className="s3-dots"><i /><i /><i /></span><span className="s3-url">{LOCK}<span>{host(c.url)}</span></span></div>
      <div className="s3-pv" aria-hidden="true">{renderPreview(c)}</div>
      <div className="s3-cap"><div className="s3-cap-t"><b>{c.title}</b></div><div className="s3-cap-m" dangerouslySetInnerHTML={{ __html: c.caption }} /></div>
    </a>
  );
}

/** Screen 3 · 作品墙 drifting gallery + 示例 modal */
const Markup = React.memo(function Markup() {
  return (
    <div>
  <section className="s3" id="s3" aria-labelledby="s3-title">
    <div className="s3-head">
      <div className="badge"><i />都是用 Demox 发出来的页面</div>
      <h2 id="s3-title">我能用它做什么</h2>
      <p className="s3-sub">静态页面和 Node 接口都能发。上传你的页面，30 秒拿到一个能打开的链接。</p>
      <div className="s3-acts">
        <a className="s3-cta" href="https://www.demox.site/">立即上传
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
        <a className="s3-link" href="/how-demox-hosts-itself">阅读自托管说明
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9" /></svg></a>
      </div>
    </div>
    <p className="sr-only">作品墙：两排卡片缓慢横向滚动，可以左右拖动，点击卡片在新标签页打开对应网站。全部是用 Demox 发布的线上站点：{cardsForRow(1).concat(cardsForRow(2)).map((c) => c.title + "（" + host(c.url) + "）").join("、")}。</p>
    <div className="s3-stage" id="s3stage">
      <div className="s3-wall">
        <div className="s3-row"><div className="s3-track"><div className="s3-set">{cardsForRow(1).map(renderCard)}</div></div></div>
        <div className="s3-row rev"><div className="s3-track"><div className="s3-set">{cardsForRow(2).map(renderCard)}</div></div></div>
      </div>
    </div>
    <div className="s3-note"><span className="ix-hint s3-hint" aria-hidden="true"><svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7l-5 5 5 5" /><path d="M16 7l5 5-5 5" /><path d="M3 12h18" /></svg>拖动浏览，点击打开</span></div>
  </section>
  <div className="s3-modal" id="s3modal" hidden>
    <div className="s3-mbk" data-close />
    <div className="s3-dlg" role="dialog" aria-modal="true" aria-labelledby="s3mt" aria-describedby="s3md s3mn" tabIndex={-1}>
      <div className="s3-mbar"><span className="s3-dots" aria-hidden="true"><i /><i /><i /></span><span className="s3-url"><svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><rect x={5} y={11} width={14} height={10} rx={2} /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg><span id="s3mu" /></span>
        <button type="button" className="s3-x" data-close aria-label="关闭预览"><svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
      <div className="s3-mpv" aria-hidden="true" />
      <div className="s3-mcap"><div className="s3-cap-t"><b id="s3mt" /></div>
        <p className="s3-md" id="s3md" />
        <div className="s3-mft"><span className="s3-mnote" id="s3mn">示意画面，非用户作品</span><a className="s3-mcta" href="https://www.demox.site/">立即上传 <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></a></div></div>
    </div>
  </div>
</div>
  );
});

export const GalleryStage: React.FC<{ onUpload?: () => void }> = ({ onUpload }) => {
  const up = useRef(onUpload);
  up.current = onUpload;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ensureCoffeeCss();
    const root = ref.current;
    const stop = initS3(root);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.(".s3-cta, .s3-mcta");
      if (a && up.current) { e.preventDefault(); up.current(); }
    };
    root.addEventListener("click", onClick);
    return () => { root.removeEventListener("click", onClick); stop(); };
  }, []);
  return (
    <div ref={ref} className="dx-mk dx-s3">
      <Markup />
    </div>
  );
};

export default GalleryStage;
