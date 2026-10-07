// @ts-nocheck — markup mirrors the approved demo 1:1; behaviour lives in engine-s2.ts
import React, { useEffect, useRef } from "react";
import { initS2 } from "./engine-s2";
import "./demo-screens.css";

/** Screen 2 · 全球节点 dot globe */
const Markup = React.memo(function Markup() {
  return (
    <section className="s2" id="s2" aria-labelledby="s2-title">
  <div className="s2-in">
    <div className="s2-copy">
      <div className="badge"><i />全球分发</div>
      <h2 id="s2-title">从代码到全球</h2>
      <p className="s2-sub">自动分发至全球边缘节点，即刻访问。拿到带 HTTPS 和 CDN 的公开链接。</p>
      <ul className="s2-points">
        <li><span className="s2-ic"><svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 16l-4-4-4 4" /><path d="M12 12v9" /><path d="M20.4 18.4A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 4 16.3" /></svg></span>
          <div><b>上传至边缘网络</b><span>跳过服务器配置，<code>demox deploy</code>、网页上传或 MCP 直接发布到边缘。</span></div></li>
        <li><span className="s2-ic"><svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x={4} y={11} width={16} height={10} rx={2} /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg></span>
          <div><b>自动 HTTPS</b><span>发布后得到公网 HTTPS 地址。独立域名写一条 CNAME，证书由 Demox 签发。</span></div></li>
        <li><span className="s2-ic"><svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg></span>
          <div><b>更新同一个网站</b><span>重新部署后新产物替换当前版本，原分享链接继续可用；边缘缓存最长约 60 秒同步。</span></div></li>
      </ul>
      <div className="s2-tags"><span>全球 CDN</span><span>DDoS 防护</span><span>自动 HTTPS</span><span>独立域名</span></div>
    </div>
    <div className="s2-viz">
      <div className="ix-hint s2-hint" aria-hidden="true"><svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></svg>拖动旋转，点击发布</div>
      <div className="globe-wrap"><canvas id="globe" tabIndex={0} role="button" aria-label="全球节点示意图：拖动或用左右方向键旋转地球；点击地球上的位置或按回车，从那里发起一次部署" /></div>
      <p className="sr-only">示意动画：一次部署从源站沿弧线同步到分布在全球的边缘节点，访问请求由附近的节点响应。</p>
      <div className="s2-meta">
        <div className="s2-card busy" id="s2card" aria-hidden="true"><span className="dot" />
          <div className="s2-tx"><b id="s2st">上传至边缘网络...</b><em id="s2url">coffee.demox.site</em><div className="s2-bar"><i id="s2bar" /></div></div></div>
        <div className="s2-legend" aria-hidden="true"><span><i className="lg-node" />边缘节点</span><span><i className="lg-sync" />部署同步</span><span><i className="lg-req" />访问请求</span><span className="note">节点位置为示意</span></div>
      </div>
    </div>
  </div>
</section>
  );
});

export const GlobeStage: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return initS2(ref.current);
  }, []);
  return (
    <div ref={ref} className="dx-mk dx-s2">
      <Markup />
    </div>
  );
};

export default GlobeStage;
