// @ts-nocheck — markup mirrors the approved demo 1:1; behaviour lives in engine-s1.ts
import React, { useEffect, useRef } from "react";
import { initS1 } from "./engine-s1";
import "./demo-screens.css";

/** Screen 1 · AI 编辑器 → 实时预览 → 部署 (beam canvas, node, terminal) */
const Markup = React.memo(function Markup() {
  return (
    <div className="s1-wrap"><div>
  <p className="sr-only">示意动画：左侧代码编辑器从空白开始编写 index.html，右侧浏览器同步显示页面，执行 demox deploy 后获得 https://coffee.demox.site 公网地址。点击编辑器（或下面的“点击编辑器，自己写一段”按钮）可以暂停演示，自己写 HTML，右侧实时预览。</p>
  <section className="stage" id="stage" aria-label="代码编辑器与实时预览">
    <canvas className="beam-cv" id="beamCv" aria-hidden="true" />
    <div className="tilt l" id="tiltL">
      <div className="panel editor" id="editor">
        <div className="ed-bar"><div className="dots" aria-hidden="true"><i /><i /><i /></div>
          <div className="tab"><b />index.html</div>
          <button type="button" className="s1-hint" id="s1Hint" aria-controls="s1Ta"><svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg><span className="s1-hf">点击编辑器，自己写一段</span><span className="s1-hs">点击自己写一段</span></button>
          <span className="s1-chip" role="status"><i aria-hidden="true" />编辑中</span>
          <button type="button" className="s1-resume" id="s1Resume"><svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg><span id="s1ResumeT">继续演示</span></button>
          <span className="ed-tag" aria-hidden="true">AI 生成</span></div>
        <div className="code" id="code"><div className="lines" id="lines" aria-hidden="true" />
          <div className="s1-live" id="s1Live"><div className="s1-cur" id="s1Cur" /><div className="s1-gut" aria-hidden="true"><pre id="s1Gut" /></div><div className="s1-hlw" aria-hidden="true"><pre className="s1-pre" id="s1Pre" /></div><textarea className="s1-ta" id="s1Ta" spellCheck="false" autoCapitalize="off" autoComplete="off" autoCorrect="off" wrap="off" aria-label="代码编辑器：写 HTML，右侧实时预览" aria-describedby="s1Help" defaultValue={""} /></div>
          <p className="sr-only" id="s1Help">Tab 键插入两个空格，Shift+Tab 减少缩进，Esc 键离开编辑框。停止输入约 0.3 秒后右侧预览更新。</p></div>
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
          <span className="state" id="stateTag">预览</span></div>
        <div className="page" id="page" aria-hidden="true">
          <div className="refresh" id="refresh" />
          <div className="blk" data-b="nav"><div><div className="box s-nav"><b>Coffee<span className="dt">.</span></b><em data-t>菜单</em><em>门店</em><em className="pl">预订</em></div></div></div>
          <div className="s-hero">
            <div className="s-copy">
              <div className="blk" data-b="ey"><div><div className="box s-ey" data-t /></div></div>
              <div className="blk" data-b="h1"><div><div className="box s-h1" data-t /></div></div>
              <div className="blk" data-b="p"><div><div className="box s-p" data-t /></div></div>
              <div className="blk" data-b="btn"><div><div className="box s-btn" data-t /></div></div>
            </div>
            <div className="blk" data-b="cover"><div><div className="box s-cover" aria-hidden="true"><i className="dr" /><i className="ds" /><i className="cup" /><i className="hd" /><i className="sm" /><i className="sm b" /></div></div></div>
          </div>
          <div className="s-cards">
            <div className="blk s-card" data-b="c1"><div><div className="box"><span data-t /></div></div></div>
            <div className="blk s-card" data-b="c2"><div><div className="box"><span data-t /></div></div></div>
            <div className="blk s-card" data-b="c3"><div><div className="box"><span data-t /></div></div></div>
          </div>
          <div className="blk" data-b="foot"><div><div className="box s-foot" data-t /></div></div>
        </div>
        <div className="s1-out" id="s1Out"><div className="s1-bar" id="s1Bar" /></div>
      </div>
    </div>
    <div className="node" id="node" aria-hidden="true"><div className="mark"><span className="ring" /><svg className="mk" viewBox="0 0 16 16" aria-hidden="true"><rect width={16} height={16} rx={2} fill="#111" /><path className="heart" d="M8 13.9L2.763 8.349A3.35 3.35 0 1 1 8 4.211A3.35 3.35 0 1 1 13.237 8.349Z" fill="#fff" /></svg></div><div className="node-label" id="nodeLabel">实时预览</div></div>
  </section>
</div></div>
  );
});

export const HeroStage: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return initS1(ref.current);
  }, []);
  return (
    <div ref={ref} className="dx-mk dx-s1" data-state="editing">
      <Markup />
    </div>
  );
};

export default HeroStage;
