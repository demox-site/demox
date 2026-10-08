// @ts-nocheck — markup mirrors the approved demo 1:1; behaviour lives in engine-s1.ts
import React, { useEffect, useRef } from "react";
import { initS1 } from "./engine-s1";
import { marketingStrings, type MarketingLang, type MarketingStrings } from "./marketing-translations";
import "./demo-screens.css";

/** Screen 1 · AI 编辑器 → 实时预览 → 部署 (beam canvas, node, terminal) */
const Markup = React.memo(function Markup({ t }: { t: MarketingStrings["s1"] }) {
  return (
    <div className="s1-wrap"><div>
  <p className="sr-only">{t.srIntro}</p>
  <section className="stage" id="stage" aria-label={t.stageLabel}>
    <canvas className="beam-cv" id="beamCv" aria-hidden="true" />
    <div className="tilt l" id="tiltL">
      <div className="panel editor" id="editor">
        <div className="ed-bar"><div className="dots" aria-hidden="true"><i /><i /><i /></div>
          <div className="tab"><b />index.html</div>
          <button type="button" className="s1-hint" id="s1Hint" aria-controls="s1Ta"><svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg><span className="s1-hf">{t.hintFull}</span><span className="s1-hs">{t.hintShort}</span></button>
          <span className="s1-chip" role="status"><i aria-hidden="true" />{t.chipEditing}</span>
          <button type="button" className="s1-resume" id="s1Resume"><svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg><span id="s1ResumeT">{t.resume}</span></button>
          <span className="ed-tag" aria-hidden="true">{t.tagAi}</span></div>
        <div className="code" id="code"><div className="lines" id="lines" aria-hidden="true" />
          <div className="s1-live" id="s1Live"><div className="s1-cur" id="s1Cur" /><div className="s1-gut" aria-hidden="true"><pre id="s1Gut" /></div><div className="s1-hlw" aria-hidden="true"><pre className="s1-pre" id="s1Pre" /></div><textarea className="s1-ta" id="s1Ta" spellCheck="false" autoCapitalize="off" autoComplete="off" autoCorrect="off" wrap="off" aria-label={t.editorLabel} aria-describedby="s1Help" defaultValue={""} /></div>
          <p className="sr-only" id="s1Help">{t.editorHelp}</p></div>
        <div className="term" id="term" aria-hidden="true" />
      </div>
    </div>
    <div className="link" id="link" aria-hidden="true" />
    <div className="tilt r" id="tiltR">
      <div className="panel browser" id="browser">
        <div className="chrome" aria-hidden="true"><div className="dots"><i /><i /><i /></div>
          <div className="url"><span className="ud" />
            <svg className="lock" width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x={5} y={11} width={14} height={10} rx={2} /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            <span className="ut" id="url">localhost:5173</span></div>
          <span className="state" id="stateTag">{t.statePreview}</span></div>
        <div className="page" id="page" aria-hidden="true">
          <div className="refresh" id="refresh" />
          <div className="cf-host" id="cfHost" />
        </div>
        <div className="s1-out" id="s1Out"><div className="s1-bar" id="s1Bar" /></div>
      </div>
    </div>
    <div className="node" id="node" aria-hidden="true"><div className="mark"><span className="ring" /><svg className="mk" viewBox="0 0 16 16" aria-hidden="true"><rect width={16} height={16} rx={2} fill="#111" /><path className="heart" d="M8 13.9L2.763 8.349A3.35 3.35 0 1 1 8 4.211A3.35 3.35 0 1 1 13.237 8.349Z" fill="#fff" /></svg></div><div className="node-label" id="nodeLabel">{t.nodePreview}</div></div>
  </section>
</div></div>
  );
});

/** One engine instance per language: switching language remounts the stage so the typed code,
 *  terminal and labels restart in the new language (no reload needed). */
const HeroStageInner: React.FC<{ lang: MarketingLang }> = ({ lang }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return initS1(ref.current, lang);
  }, [lang]);
  return (
    <div ref={ref} className="dx-mk dx-s1" data-state="editing">
      <Markup t={marketingStrings(lang).s1} />
    </div>
  );
};

export const HeroStage: React.FC<{ lang?: MarketingLang }> = ({ lang = "zh" }) => (
  <HeroStageInner key={lang} lang={lang} />
);

export default HeroStage;
