// @ts-nocheck
/* Ported verbatim from the approved demox-hero-demo (v6-interactive + v7.1 content).
   Scoped to `root`; returns a cleanup that stops all loops and window/document listeners. */
/* ===================== Screen 2 · 全球节点 — canvas dot-matrix globe ===================== */

export function initS2(root: HTMLElement): () => void {
  var __dead=false, __L=[];
  function __on(t,e,f,o){ t.addEventListener(e,f,o); __L.push([t,e,f,o]); }
  var __raf=window.requestAnimationFrame.bind(window);
  var requestAnimationFrame=function(f){ return __raf(function(t){ if(!__dead) f(t); }); };
  function $id(i){ return root.querySelector('#'+i); }
  var __cleanup = function(){};
  (function(){

  'use strict';
  var cv=$id('globe'); if(!cv) return;
  var ctx=cv.getContext('2d'), wrap=cv.parentNode;
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var D2R=Math.PI/180;

  /* land mask: Natural Earth 1:110m land (via world-atlas, public domain), rasterised to a 360×180 1° bitmap */
  var LAND='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADg/wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA/v8/AOL//z8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+///j/////79/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPD//3/+//////8PAAAAAD0AAFgAAAAAAH8AAAAAAAAAAAAAAAAAAAAAAAAAAPD//wP+//////8BAACA/z8AAAAAAAAAAP4AAAAAAAAAAAAAAAAAAAAAAAAA+Mzv//j///////8AAAAAfwQAAAAAAAAAAAAfAAAAAAAAAAAAAAAAAAAAAOAAAADwP8D///////8BAAAAPAQAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAHzBgPP5H8D//////38AAAAAAAAAAAAA8AAAAID/HwAAAAAAAAAAAAAAAAAAAID/g7P/DwAA/v////8AAAAAAAAAAADADwAA4P//PwAA4B8AAAAAAAAAAAAAAAQIACD+BwAA+P////8AAAAAAAAAAAB4AAAA/P//BwAAAAAAAAAAAAAAAAAAAP8AhPM5ewAA8P///38AAAAAAAAAAAAcAADg/////4cHAAYAAAAAAAAAAAAAgP9/x3f8xwAA4P///x8AAAAAAAAAAAAPAB7g//////8fAD8AAAAAAQAAAAAAgOf/B3f8/wsA4P///z8AAAAAAAAAAAAPgM////////8f3/8HAAAAAAD4fwAAEMD/H/D4/38A4P///xcAAAAAAPgDAAAAgN//////////////DwAAAAD+///h/4//f+7Bh/8BwP7//w8AAAAAwP8fAAAAjt///////////////89/A8D///////+bB+TPA/4AAP///wEAAAAA8P//BwD7f57/////////////////H4D////////////vh/kPwP//BwAAAAAA/P//H/P//5///////////////////4H8////////////Afw/wP//ASAQAAAA/v//X////+///////////////////PH///////////9fAP4YgP8fAPA/AAAA/+N/8P//////////////////////QID7///////////Pw/0HAP8HAOA/AADA//F//v////////////////////9/AAD8///////////DAPAHAP4HAAACAADw//z///////////////////////9/AID///////////8AQ8ABAPwBAAAAAAD8P/7///////////////////////9/AMD//////////z8AwA8AAPgBAAAAAAD+H/7/////////////////////Of8BAKD///z//////z8AwD8AAMABAAAAAAD+P/z///////////////////9/wH8AAAD8NwD//////x8AwH8MAAAAAAAAAAD+P/D///////////////////958AAAAADAAwD8/////38AwP8eAAAAAAAAgACcH/D//////////////////wEAOAAAAADADADA/////38AgP8/AAAAAAAAwAMAH/T//////////////////wAAfgAAAAAwAACA//////8PgP8/AAAAAAAAwANwD/7/////////////////PwAAfwAAAAAGAAAA//////9/wP//AAAAAAAAgAOwA/7/////////////////HwCAPwAAAAAAAAAA/v//////4///BwAAAAAAOAcg8P//////////////////HwAAHwAAAAAAAACA/P//////4///DwAAAAAAPA/8/////////////////////wUADwAAAAAAAAAA+P//////5///DwAAAAAAmD///////////////////////wcAAwAAAAAAAAAA8P//////7///DwAAAAAAgB///////////////////////wUAAwAAAAAAAAAA8P//////////DAAAAAAAgOH//////////////////////w0AAAAAAAAAAAAAYP////////8hHAAAAAAAAPj//////////////////////wwAAAAAAAAAAAAAgP7//////38HfgAAAAAAgP///////////////////////wQAAAAAAAAAAAAAAP////////8HdgAAAAAAAP7/////////////////////fwQAAAAAAAAAAAAAAP////////+PAAAAAAAAAPz//////P//////////////PwQAAAAAAAAAAAAAAP////////9/AAAAAAAAAPj////j/v//////////////HwAAAAAAAAAAAAAAAP////////8NAAAAAAAAAPj/+P8B/P//////////////DwQAAAAAAAAAAAAAAP///////z8EAAAAAAAA+P/H8f8A8P//////////////Bx4AAAAAAAAAAAAAAP///////x8AAAAAAAAA+H+gw/8A4P////////////9/AA8AAAAAAAAAAAAAAP///////x8AAAAAAAAA+D8Aj//w4P////////////8/AAEAAAAAAAAAAAAAAP///////wMAAAAAAAAA+B8wvM///////////////98fAAMAAAAAAAAAAAAAAP///////wMAAAAAAAAA+A8wEMf//////////////2cOAAMAAAAAAAAAAAAAAP7//////wEAAAAAAAAA+A8AEM7//////////////wMOgAEAAAAAAAAAAAAAAP7//////wAAAAAAAAAA+AcABob//////////////zccwAEAAAAAAAAAAAAAAPz//////wAAAAAAAAAAQOB/AAT2/////////////x888AEAAAAAAAAAAAAAAPj//////wAAAAAAAAAAQP1/AAAA/////////////w8c/gEAAAAAAAAAAAAAAPD/////fwAAAAAAAAAA4P9/AAAA/////////////w+APwAAAAAAAAAAAAAAAMD/////HwAAAAAAAAAA8P9/AACA/////////////x/AAwAAAAAAAAAAAAAAAID/////DwAAAAAAAAAA+P//BweA/////////////x/AAAAAAAAAAAAAAAAAAID/////BwAAAAAAAAAA/P//D3/E/////////////z9AAAAAAAAAAAAAAAAAAAD5////BwAAAAAAAAAA/P///////////////////z8AAAAAAAAAAAAAAAAAAAD6/z8GBgAAAAAAAAAA/P///////8///////////z8AAAAAAAAAAAAAAAAAAAD0/w8ABgAAAAAAAAAA/v///////4///////////z8AAAAAAAAAAAAAAAAAAADu/wcADgAAAAAAAACA//////8//x///////////x8AAAAAAAAAAAAAAAAAAADI/wcADAAAAAAAAADA//////8//z/k/////////w8AAAAAAAAAAAAAAAAAAACQ/wcACAAAAAAAAADg//////9//v/I/////////wcAAAAAAAAAAAAAAAAAAAAw/wMAAAAAAAAAAADg//////9//v8cgP///////ycAAAAAAAAAAAAAAAAAAAAA/gMAAAAAAAAAAADw/////////P9/AP///////zEAAAAAAAAAAAAAAAAAAAAA/AMAPQAAAAAAAAD4////////+P//AP7/////fxAAAAAAAAAAAAAAAAAAAAAA+AcYcAAAAAAAAAD4////////+f9/APz/B///DgAAAAAAAAAAAAAAAAAAAAAA/AcewAEAAAAAAAD4////////8f8/AOD/B/9/AAAAAAAAAAAAAAAAAQAAAAAA+A8eADgAAAAAAADw////////4f8/AOD/Af4/BgAAAAAAAAAAAAAAAAAAAAAA8N8PQHgCAAAAAADw////////4/8fAOD/APw/AgAAAAAAAAAAAAAAAAAAAAAAgP8PAAAAAAAAAADw////////x/8HAOB/APx/ADAAAAAAAAAAAAAAAAAAAAAAAP4PAAAAAAAAAAD4////////h/8BAOA/APz/ADAAAAAAAAAAAAAAAAAAAAAAAID/AAAAAAAAAAD4////////j/8AAMAPAMD/ATAAAAAAAAAAAAAAAAAAAAAAAAD/AQAAAAAAAAD4////////nx8AAMAPAMD/ASAAAAAAAAAAAAAAAAAAAAAAAAD8AQAAAAAAAAD4////////vwcAAIAPAMD/AcAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAD4////////fwAAAIAPAMD8AQAAAAAAAAAAAAAAAAAAAAAAAADAAHgAAAAAAADw////////f3AAAIAPAID4AUACAAAAAAAAAAAAAAAAAAAAAADAAf5TAAAAAADg/////////38AAAAPAEDwAIAAAAAAAAAAAAAAAAAAAAAAAAAAE+9/AAAAAADA/////////38AAAAHAEAgAAQAAAAAAAAAAAAAAAAAAAAAAAAA7v//AAAAAACA/////////z8AAAASAMAAAIADAAAAAAAAAAAAAAAAAAAAAAAAyP//AQAAAACA/////////z8AAAAwAIABAEAHAAAAAAAAAAAAAAAAAAAAAAAAwP//AwAAAAAA/v///////x8AAAAwAAADAAMDAAAAAAAAAAAAAAAAAAAAAAAAgP//fwAAAAAA/A/+/////x8AAAAAAAAHgAcAAAAAAAAAAAAAAAAAAAAAAAAAgP///wAAAAAAGAD8/////w8AAAAAADAGwAMAAAAAAAAAAAAAAAAAAAAAAAAAgP///wEAAAAAAADg/////wcAAAAAAGAG4AMAAAAAAAAAAAAAAAAAAAAAAAAA4P///wEAAAAAAADA/////wMAAAAAAMAM+AMAAAAAAAAAAAAAAAAAAAAAAAAA4P///wMAAAAAAADg/////wEAAAAAAIAL/gMIAAAAAAAAAAAAAAAAAAAAAAAA8P///wMAAAAAAADg/////wAAAAAAAIAH/vMYAAAAAAAAAAAAAAAAAAAAAAAA+P///wcAAAAAAADg////fwAAAAAAAAAP/gMAAQAAAAAAAAAAAAAAAAAAAAAA+P///38AAAAAAADg////PwAAAAAAAAAe/DmAAwAAAAAAAAAAAAAAAAAAAAAA+P////8BAAAAAADA////HwAAAAAAAAA+/DkA8wEAAAAAAAAAAAAAAAAAAAAA8P////8fAAAAAACA////DwAAAAAAAAA8wCgQ/g8AAAAAAAAAAAAAAAAAAAAA+P////9/AAAAAACA////BwAAAAAAAAA4AEAA+B8AAAAAAAAAAAAAAAAAAAAA+P//////AQAAAAAA////BwAAAAAAAAAwAAAAwD8OAAAAAAAAAAAAAAAAAAAA+P//////AQAAAAAA////BwAAAAAAAADAAQAAwP+AAAAAAAAAAAAAAAAAAAAA8P//////AQAAAAAA/v//BwAAAAAAAACAHwAAwH8AAAAAAAAAAAAAAAAAAAAA4P//////AQAAAAAA/v//BwAAAAAAAAAAUHYAQMcAAAAAAAAAAAAAAAAAAAAA4P//////AQAAAAAA/v//DwAAAAAAAAAAAAgBAIADAAAAAAAAAAAAAAAAAAAAwP//////AAAAAAAA/v//DwAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAwP////9/AAAAAAAA/P//HwAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAgP////8/AAAAAAAA/v//HyAAAAAAAAAAAACAHwQAAAAAAAAAAAAAAAAAAAAAAP////8fAAAAAAAA/v//HzAAAAAAAAAAAADADwwAAAAAAAAAAAAAAAAAAAAAAP////8fAAAAAAAA////HzAAAAAAAAAAAADuDxwAAAAAAAAAAAAAAAAAAAAAAP7///8fAAAAAAAA////DzwAAAAAAAAAAAD/Hx4AAAAAAAAAAAAAAAAAAAAAAPj///8fAAAAAAAA////Dz8AAAAAAAAAAAD/Pz4AAAAAAAAAAAAAAAAAAAAAAOD///8fAAAAAAAA////Az8AAAAAAAAAAMD//z8AAAAAAAAAAAAAAAAAAAAAAMD///8PAAAAAAAA////AR8AAAAAAAAAAMD//z8AAAAAAAAAAAAAAAAAAAAAAMD///8PAAAAAAAA/v9/AB8AAAAAAAAAAOD///8AAAAAAAAAAAAAAAAAAAAAAMD///8PAAAAAAAA/v9/AB8AAAAAAAAAAPz///8BAAEAAAAAAAAAAAAAAAAAAMD///8HAAAAAAAA/P9/gA8AAAAAAAAAgP////8BAAIAAAAAAAAAAAAAAAAAAMD///8DAAAAAAAA/P//gA8AAAAAAAAAwP////8HAAAAAAAAAAAAAAAAAAAAAMD//38AAAAAAAAA/P//AA8AAAAAAAAAwP////8HAAAAAAAAAAAAAAAAAAAAAOD//x8AAAAAAAAA/P9/AAcAAAAAAAAA4P////8PAAAAAAAAAAAAAAAAAAAAAOD//w8AAAAAAAAA+P8fAAAAAAAAAAAAwP////8fAAAAAAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA+P8fAAAAAAAAAAAAwP////8fAAAAAAAAAAAAAAAAAAAAAOD//w8AAAAAAAAA+P8fAAAAAAAAAAAAwP////8fAAAAAAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA8P8PAAAAAAAAAAAAwP////8/AAAAAAAAAAAAAAAAAAAAAOD//wMAAAAAAAAA4P8HAAAAAAAAAAAAgP////8fAAAAAAAAAAAAAAAAAAAAAPD//wMAAAAAAAAA4P8HAAAAAAAAAAAAgP////8fAAAAAAAAAAAAAAAAAAAAAPD//wEAAAAAAAAAwP8DAAAAAAAAAAAAAP////8fAAAAAAAAAAAAAAAAAAAAAPD//wAAAAAAAAAAwP8BAAAAAAAAAAAAAP8D/P8PAAAAAAAAAAAAAAAAAAAAAPD/fwAAAAAAAAAAwH8AAAAAAAAAAAAAgP8A+P8PAAAAAAAAAAAAAAAAAAAAAPD/PwAAAAAAAAAAgAEAAAAAAAAAAAAAgAcA6P8HAAAAAAAAAAAAAAAAAAAAAPj/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP8HAAACAAAAAAAAAAAAAAAAAPj/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8DAAAEAAAAAAAAAAAAAAAAAPz/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8DAAAIAAAAAAAAAAAAAAAAAPj/AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGwAAAA4AAAAAAAAAAAAAAAAAPg/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAPw/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAPwHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAALAAAAAAAAAAAAAAAAAPwPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAIADAAAAAAAAAAAAAAAAAPgHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAMABAAAAAAAAAAAAAAAAAPwHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAP4BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAP4BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAP4DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH6AAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAeAAAAAAAAAAAAAAAAAIAfAAAAAAAeeMDkDwAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAPD/EADg/////////z8AAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAwP///wH4//////////8HAAAAAAAAAAAAAAAAAAAAAHAfAAAAAAAAAAAAAADw+////wP/////////////BwAAAAAAAAAAAAAAAAAAAHA/AAAAAAAAAAA+//v//////+D/////////////PwAAAAAAAAAAAAAAAAAAAP5+AAAAAAAA9v////////////D//////////////38AAAAAAAAAAAAAwAcAABB/AAAAAACA/////////////////////////////38AAAAAAAAAAAQA4P//OPh/AAAAAADw/////////////////////////////z8AAAAAAAD4//8XgP////8/AAAAAADw/////////////////////////////wMAAAAAAPz///////////8HAAAAAAD+/////////////////////////////wAAAAAAAP///////////z8AAAAAAP///////////////////////////////wAAAADA/////////////wMAAAAA8P///////////////////////////////wAAAACG////////////PwAAAPwA/////////////////////////////////wcAAAAMgP//////////fwAAAP4Bxv//////////////////////////////HwAAAAAAAP7//////////wfYwD8A4P//////////////////////////////DwAAAAAA/v////////////8HAAD8////////////////////////////////HwAAAAAA+P//////////////8f///////////////////////////////////wAAAAAA+P///////////////////////////////////////////////////x8A2A8AwP////////////////////////////////////////////////////8ZAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  var bin=atob(LAND), bits=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) bits[i]=bin.charCodeAt(i);
  function isLand(lat,lon){
    var r=Math.min(179,Math.max(0,Math.floor(90-lat))), c=((Math.floor(lon+180)%360)+360)%360, k=r*360+c;
    return (bits[k>>3]>>(k&7))&1;
  }
  function vec(lat,lon){ lat*=D2R; lon*=D2R; return [Math.cos(lat)*Math.sin(lon), Math.sin(lat), Math.cos(lat)*Math.cos(lon)]; }

  /* illustrative node positions only — not a real PoP list (the site does not publish one) */
  var NODES=[[37.5,-122],[40.5,-74.5],[19.5,-99],[-23.5,-46.5],[51.5,0],[50,8.5],[59.5,18],[-26,28],[25,55.5],[19,73],
             [1.5,104],[35.5,139.5],[37.5,127],[31,121.5],[-33.5,151]].map(function(p){return {v:vec(p[0],p[1]),sync:0,ping:-9,blink:-9};});
  var ORIGIN={v:vec(22.3,114.2)};

  /* deploy arcs: great circle, lifted with distance */
  function slerpArc(a,b,n,lift){
    var dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2], om=Math.acos(Math.max(-1,Math.min(1,dot))), so=Math.sin(om)||1, out=new Float32Array((n+1)*3);
    var h=lift(om);
    if(om<1e-4){ for(var q=0;q<=n;q++){ out[q*3]=a[0]; out[q*3+1]=a[1]; out[q*3+2]=a[2]; } return {p:out,n:n,om:0}; }
    for(var k=0;k<=n;k++){
      var t=k/n, s1=Math.sin((1-t)*om)/so, s2=Math.sin(t*om)/so, r=1+h*Math.sin(Math.PI*t);
      out[k*3]=(a[0]*s1+b[0]*s2)*r; out[k*3+1]=(a[1]*s1+b[1]*s2)*r; out[k*3+2]=(a[2]*s1+b[2]*s2)*r;
    }
    return {p:out,n:n,om:om};
  }
  function angle(a,b){ return Math.acos(Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2]))); }
  NODES.forEach(function(nd){
    nd.arc=slerpArc(ORIGIN.v,nd.v,56,function(om){return Math.min(.13,.03+.14*om/Math.PI);});
    var a=nd.arc.om; nd.delay=.12+a*.55; nd.dur=.75+a*.55;
  });

  /* ---- sizing / point cloud ---- */
  var W=0,RS=1,dpr=Math.min(2,window.devicePixelRatio||1),R=0,cx=0,cy=0,PTS=null,NP=0,LANDIDX=null,dotPx=1.5;
  function build(){
    var w=Math.round(wrap.clientWidth); if(!w) return false;
    if(w===W && PTS) return false;
    W=w; cv.width=Math.round(W*dpr); cv.height=Math.round(W*dpr);
    R=W*0.40; cx=W/2; cy=W*0.47; RS=R*DP/Math.sqrt(DP*DP-1);
    var s=R>200?6.1:(R>150?5.4:4.9); dotPx=R>200?1.55:1.35;
    var N=Math.round(4*Math.PI*R*R/(s*s)), g=Math.PI*(3-Math.sqrt(5)), tmp=[];
    for(var k=0;k<N;k++){
      var y=1-2*(k+.5)/N, rr=Math.sqrt(1-y*y), ph=k*g, x=Math.cos(ph)*rr, z=Math.sin(ph)*rr;
      var lat=Math.asin(y)/D2R, lon=Math.atan2(x,z)/D2R;
      if(lat<-58) continue;
      if(isLand(lat,lon)) tmp.push(x,y,z);
    }
    PTS=new Float32Array(tmp); NP=tmp.length/3;
    return true;
  }

  /* ---- sprites (same light language as the screen-1 beam) ---- */
  function sprite(stops,size){
    var c=document.createElement('canvas'); c.width=c.height=size; var g=c.getContext('2d');
    var r=g.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
    stops.forEach(function(s){r.addColorStop(s[0],s[1]);}); g.fillStyle=r; g.fillRect(0,0,size,size); return c;
  }
  var GLOW=sprite([[0,'rgba(74,222,128,.9)'],[.18,'rgba(34,197,94,.5)'],[.45,'rgba(34,197,94,.14)'],[1,'rgba(34,197,94,0)']],96);
  var CORE=sprite([[0,'rgba(255,255,255,1)'],[.4,'rgba(240,253,244,1)'],[.65,'rgba(134,239,172,.9)'],[1,'rgba(34,197,94,0)']],48);
  var HEART=new Path2D('M8 13.9L2.763 8.349A3.35 3.35 0 1 1 8 4.211A3.35 3.35 0 1 1 13.237 8.349Z');

  /* ---- view transform ---- */
  var rot=0, TILT=0.36, tilt=TILT, ct=Math.cos(TILT), st=Math.sin(TILT), cr=1, sr=0, DP=3.4;
  var L=[-0.45,0.55,0.70]; (function(){var m=Math.hypot(L[0],L[1],L[2]);L=[L[0]/m,L[1]/m,L[2]/m];})();
  var o={x:0,y:0,z:0,f:1,sx:0,sy:0};
  function tf(x,y,z){
    var x1=x*cr-z*sr, z1=x*sr+z*cr, y2=y*ct-z1*st, z2=y*st+z1*ct, f=DP/(DP-z2);
    o.x=x1;o.y=y2;o.z=z2;o.f=f;o.sx=cx+x1*R*f;o.sy=cy-y2*R*f; return o;
  }
  function hidden(){ return o.z<0.0; }   // only the near side: arcs dip out of view at the horizon instead of peeking from behind

  /* ---- simulation ---- */
  var CYCLE=9.5, T0=0.8;                // deploy wave every 9.5 s; arcs launch at 0.8 s
  var simT=3.1;                         // start mid-wave so the first paint is already "running"
  var cyc=simT%CYCLE;                   // v6: wave phase has its own clock so a click can restart the wave
  var reqs=[];
  function spawnReq(age){
    if(!NP) return;
    for(var tries=0;tries<14;tries++){
      var k=(Math.random()*NP|0)*3, v=[PTS[k],PTS[k+1],PTS[k+2]];
      tf(v[0],v[1],v[2]); if(o.z<.25) continue;
      var best=null,ba=9; NODES.forEach(function(nd){var a=angle(v,nd.v); if(a<ba){ba=a;best=nd;}});
      if(ba<0.03) continue;
      var arc=slerpArc(v,best.v,24,function(om){return .02+.12*om/Math.PI;});
      reqs.push({arc:arc,node:best,t0:simT-(age||0),dur:.55+ba*1.1,done:false});
      return;
    }
  }
  var card=$id('s2card'), stEl=$id('s2st'), bar=$id('s2bar'), lastState='';
  function setCard(state,prog){
    if(state!==lastState){
      lastState=state;
      card.className='s2-card '+(state==='live'?'live':'busy');
      stEl.textContent = state==='upload'?'上传至边缘网络...':(state==='spread'?'自动分发至全球边缘节点':'即刻访问 · 已部署');
      $id('s2url').textContent = state==='live'?'https://coffee.demox.site':'coffee.demox.site';
    }
    bar.style.width=(prog*100).toFixed(1)+'%';
  }

  function drawTrail(arc,head,trail,color,width,glow){
    // head/trail in [0,1] arc parameter
    var n=arc.n, p=arc.p, a0=Math.max(0,head-trail), segs=10, prevOK=false, px=0, py=0;
    for(var s=0;s<=segs;s++){
      var t=a0+(head-a0)*s/segs, fi=t*n, i0=Math.min(n-1,Math.floor(fi)), fr=fi-i0;
      var x=p[i0*3]+(p[i0*3+3]-p[i0*3])*fr, y=p[i0*3+1]+(p[i0*3+4]-p[i0*3+1])*fr, z=p[i0*3+2]+(p[i0*3+5]-p[i0*3+2])*fr;
      tf(x,y,z); var ok=!hidden(), sx=o.sx, sy=o.sy, zf=Math.max(0,Math.min(1,o.z/0.3,(0.99-Math.hypot(o.sx-cx,o.sy-cy)/RS)/0.08));
      if(s>0 && ok && prevOK){
        var al=s/segs*zf;
        if(glow){ ctx.strokeStyle='rgba(34,197,94,'+(0.14*al)+')'; ctx.lineWidth=width*4*al+1; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(sx,sy); ctx.stroke(); }
        ctx.strokeStyle=color.replace('A',((glow?0.9:0.5)*al*al).toFixed(3)); ctx.lineWidth=width*al+.4; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(sx,sy); ctx.stroke();
      }
      prevOK=ok; px=sx; py=sy;
    }
    return prevOK ? {x:px,y:py,a:Math.max(0,Math.min(1,o.z/0.3,(0.99-Math.hypot(o.sx-cx,o.sy-cy)/RS)/0.08))} : null;
  }
  function strokeArc(arc,t1,alpha,width){   // per-segment alpha fades arcs out toward the horizon
    var n=arc.n,p=arc.p,end=Math.round(t1*n),px=0,py=0,pz=-1; ctx.lineWidth=width;
    for(var k=0;k<=end;k++){
      tf(p[k*3],p[k*3+1],p[k*3+2]); var z=o.z;
      var dk=Math.max(0,Math.min(1,(0.99-Math.hypot(o.sx-cx,o.sy-cy)/RS)/0.08)), zz=Math.min(z/0.3,dk);
      if(k>0 && zz>0 && pz>0){ var a=alpha*Math.min(1,Math.min(zz,pz)); if(a>0.01){ ctx.strokeStyle='rgba(34,197,94,'+a.toFixed(3)+')'; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(o.sx,o.sy); ctx.stroke(); } }
      px=o.sx; py=o.sy; pz=zz;
    }
  }

  var B=[[],[],[],[],[],[]], BA=[.13,.2,.28,.37,.47,.58];
  function draw(){
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,W);
    cr=Math.cos(rot); sr=Math.sin(rot); ct=Math.cos(tilt); st=Math.sin(tilt);
    var k,x,y,z;
    // back hemisphere dots (seen faintly through the glass)
    ctx.fillStyle='rgba(17,17,17,.16)'; ctx.beginPath();
    for(k=0;k<NP;k++){ x=PTS[k*3];y=PTS[k*3+1];z=PTS[k*3+2]; tf(x,y,z); if(o.z<0){ var d=dotPx*.8; ctx.rect(o.sx-d/2,o.sy-d/2,d,d);} }
    ctx.fill();
    // glass sphere
    var g=ctx.createRadialGradient(cx-R*.38,cy-R*.42,R*.05,cx,cy,R*1.04);
    g.addColorStop(0,'rgba(255,255,255,.93)'); g.addColorStop(.55,'rgba(250,250,248,.86)'); g.addColorStop(1,'rgba(232,232,229,.86)');
    ctx.beginPath(); ctx.arc(cx,cy,R*DP/Math.sqrt(DP*DP-1)*0.985,0,6.2832); ctx.fillStyle=g; ctx.fill();
    ctx.lineWidth=1; ctx.strokeStyle='rgba(17,17,17,.12)'; ctx.stroke();
    // front dots, bucketed by lighting
    for(k=0;k<6;k++) B[k].length=0;
    for(k=0;k<NP;k++){
      x=PTS[k*3];y=PTS[k*3+1];z=PTS[k*3+2]; tf(x,y,z); if(o.z<0.02) continue;
      var lam=o.x*L[0]+o.y*L[1]+o.z*L[2], a=.1+.5*Math.pow(o.z,.7)*(.8+.2*lam), b=Math.min(5,Math.max(0,Math.round((a-.13)/.09)));
      B[b].push(o.sx,o.sy,o.f);
    }
    for(k=0;k<6;k++){
      var arr=B[k]; if(!arr.length) continue; ctx.fillStyle='rgba(17,17,17,'+BA[k]+')'; ctx.beginPath();
      for(var j=0;j<arr.length;j+=3){ var dd=dotPx*arr[j+2]; ctx.rect(arr[j]-dd/2,arr[j+1]-dd/2,dd,dd); }
      ctx.fill();
    }
    // specular rim
    ctx.beginPath(); ctx.arc(cx,cy,R*1.0,Math.PI*1.05,Math.PI*1.45); ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=2; ctx.stroke();

    var ph=cyc, ctT=ph-T0, arrived=0;
    ctx.lineCap='round';
    // deploy arcs
    NODES.forEach(function(nd){
      var lt=ctT-nd.delay, p=lt/nd.dur;
      if(p>=1){ arrived++; if(nd.sync<1 && p<1.05){} }
      if(lt<0 || p>1.6) return;
      var head=Math.min(1,1-Math.pow(1-Math.min(p,1),1.4));
      var fade=p<=1?1:Math.max(0,1-(p-1)/.6);
      strokeArc(nd.arc,head,0.42*fade,1.3);
      if(p<=1){
        var hp=drawTrail(nd.arc,head,.32,'rgba(34,197,94,A)',2.8,true);
        if(hp){ ctx.globalAlpha=.95*hp.a; ctx.drawImage(GLOW,hp.x-20,hp.y-20,40,40); ctx.globalAlpha=hp.a; ctx.drawImage(CORE,hp.x-6,hp.y-6,12,12); ctx.globalAlpha=1; }
      }
    });
    // requests (ink) — served by the closest node
    ctx.lineCap='round';
    for(var q=reqs.length-1;q>=0;q--){
      var r=reqs[q], rp=(simT-r.t0)/r.dur;
      if(rp>1.5){ reqs.splice(q,1); continue; }
      if(rp<0) continue;
      var a0=r.arc.p; tf(a0[0],a0[1],a0[2]);
      if(!hidden() && o.z>0){ var al=Math.max(0,1-rp/1.5); ctx.beginPath(); ctx.arc(o.sx,o.sy,1.8+rp*3,0,6.2832); ctx.strokeStyle='rgba(17,17,17,'+(0.45*al).toFixed(3)+')'; ctx.lineWidth=1; ctx.stroke(); }
      if(rp<=1){ var hh=Math.min(1,rp); var hq=drawTrail(r.arc,hh,.45,'rgba(17,17,17,A)',1.3,false); if(hq){ ctx.globalAlpha=hq.a; ctx.beginPath(); ctx.arc(hq.x,hq.y,1.7,0,6.2832); ctx.fillStyle='#111'; ctx.fill(); ctx.globalAlpha=1; } }
      else if(!r.done){ r.done=true; r.node.blink=simT; }
    }
    // nodes
    NODES.forEach(function(nd){
      var lt=ctT-nd.delay, p=lt/nd.dur;
      var synced = p>=1 && ph < CYCLE-0.9;
      if(p>=1 && nd.ping < simT-CYCLE*0.5) nd.ping=simT-(lt-nd.dur);
      tf(nd.v[0],nd.v[1],nd.v[2]); if(o.z<0.04) return;
      var sx=o.sx, sy=o.sy, edge=Math.min(1,o.z*4);
      var pa=simT-nd.ping;
      if(pa>=0 && pa<1.1){ var e=1-Math.pow(1-pa/1.1,3); ctx.beginPath(); ctx.arc(sx,sy,3+16*e,0,6.2832); ctx.strokeStyle='rgba(34,197,94,'+(0.7*(1-pa/1.1)*edge).toFixed(3)+')'; ctx.lineWidth=1.6*(1-pa/1.1)+.4; ctx.stroke(); }
      var ba=simT-nd.blink;
      if(ba>=0 && ba<.6){ ctx.beginPath(); ctx.arc(sx,sy,3+8*(ba/.6),0,6.2832); ctx.strokeStyle='rgba(17,17,17,'+(0.4*(1-ba/.6)*edge).toFixed(3)+')'; ctx.lineWidth=1; ctx.stroke(); }
      if(synced){ ctx.globalAlpha=.45*edge; ctx.drawImage(GLOW,sx-11,sy-11,22,22); ctx.globalAlpha=1; }
      ctx.beginPath(); ctx.arc(sx,sy,3.3,0,6.2832);
      ctx.fillStyle=synced?'#22c55e':'#ffffff'; ctx.globalAlpha=edge; ctx.fill();
      ctx.strokeStyle=synced?'rgba(21,128,61,.9)':'rgba(17,17,17,.6)'; ctx.lineWidth=1.3; ctx.stroke(); ctx.globalAlpha=1;
    });
    // origin: the Demox heart
    tf(ORIGIN.v[0],ORIGIN.v[1],ORIGIN.v[2]);
    if(o.z>0.04){
      var s=14, ox=o.sx-s/2, oy=o.sy-s/2, up=ph<T0+0.4;
      if(up){ var u=(ph%0.8)/0.8; ctx.beginPath(); ctx.arc(o.sx,o.sy,9+12*u,0,6.2832); ctx.strokeStyle='rgba(34,197,94,'+(0.55*(1-u)).toFixed(3)+')'; ctx.lineWidth=1.4; ctx.stroke(); }
      ctx.save(); ctx.globalAlpha=Math.min(1,o.z*4);
      ctx.shadowColor='rgba(0,0,0,.18)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2;
      ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(ox,oy,s,s,s*2/16); else ctx.rect(ox,oy,s,s); ctx.fillStyle='#111'; ctx.fill();
      ctx.shadowColor='transparent'; ctx.translate(ox,oy); ctx.scale(s/16,s/16); ctx.fillStyle=up?'#86efac':'#fff'; ctx.fill(HEART); ctx.restore();
    }
    // status card
    var prog=arrived/NODES.length;
    setCard(ph<T0?'upload':(prog<1?'spread':'live'), ph<T0?0:prog);
  }

  /* ---- loop: runs only while on screen; simulation clock keeps its state, so it never restarts from empty ---- */
  var running=false, last=0, visible=true, nextReq=0;
  function frame(now){
    if(!visible){ running=false; return; }
    var dt=Math.min(.05,(now-(last||now))/1000); last=now;
    simT+=dt; cyc+=dt; if(cyc>=CYCLE) cyc-=CYCLE;
    motion(dt,now);                          // auto spin ~84 s per revolution (west→east), or drag inertia
    if(simT>=nextReq){ spawnReq(0); nextReq=simT+.28+Math.random()*.42; }
    draw();
    requestAnimationFrame(frame);
  }
  function start(){ if(running||reduce) return; running=true; last=0; requestAnimationFrame(frame); }

  rot=(114.2+28)*D2R;                        // origin sits front-left on first paint, drifts right (eastward spin)
  build();
  for(var s0=0;s0<5;s0++) spawnReq(Math.random()*.6);
  if(reduce){ simT=7.6; cyc=7.6; }
  draw();                                     // complete first frame synchronously
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(es){ visible=es[0].isIntersecting; if(visible) start(); },{rootMargin:'160px 0px'}).observe(wrap);
  }
  start();

  /* =====================================================================
     v6-interactive · drag to rotate (inertia → eases back to auto-spin),
     click/tap the globe to launch a deploy wave from that point,
     click a node → wave from that node + visitor-request comets to it.
     Touch: canvas is touch-action:pan-y, so vertical swipes still scroll the page.
     ===================================================================== */
  var AUTO=-0.075, spin=AUTO, drag=null, lastInput=-1e9;
  function motion(dt,now){
    if(drag && drag.on) return;
    var hold=(now-lastInput)<1600;
    spin += ((hold?0:AUTO)-spin)*(1-Math.exp(-dt/(hold?0.55:1.3)));
    rot += spin*dt;
    if(!hold) tilt += (TILT-tilt)*(1-Math.exp(-dt/0.9));
  }
  function view(){ cr=Math.cos(rot); sr=Math.sin(rot); ct=Math.cos(tilt); st=Math.sin(tilt); }
  function local(e){ var r=cv.getBoundingClientRect(); return {x:(e.clientX-r.left)*W/(r.width||W), y:(e.clientY-r.top)*W/(r.height||W)}; }
  function hitNode(p,rad){
    view(); var best=null, bd=rad;
    tf(ORIGIN.v[0],ORIGIN.v[1],ORIGIN.v[2]);
    if(o.z>0.04){ var d0=Math.hypot(o.sx-p.x,o.sy-p.y); if(d0<bd){ bd=d0; best=ORIGIN; } }
    NODES.forEach(function(nd){ tf(nd.v[0],nd.v[1],nd.v[2]); if(o.z<0.04) return; var d=Math.hypot(o.sx-p.x,o.sy-p.y); if(d<bd){ bd=d; best=nd; } });
    return best;
  }
  function pickSphere(p){          // inverse of tf(): screen point → nearest point on the unit sphere (or null)
    view();
    var u=(p.x-cx)/R, v=-(p.y-cy)/R, a=u/DP, b=v/DP, k=a*a+b*b+1, disc=DP*DP-k*(DP*DP-1);
    if(disc<0) return null;
    var w=(DP-Math.sqrt(disc))/k, z2=DP-w, x1=a*w, y2=b*w;
    var y=y2*ct+z2*st, z1=-y2*st+z2*ct, x=x1*cr+z1*sr, z=-x1*sr+z1*cr, m=Math.hypot(x,y,z)||1;
    return [x/m,y/m,z/m];
  }
  function setOrigin(v){
    ORIGIN.v=v;
    NODES.forEach(function(nd){
      nd.arc=slerpArc(v,nd.v,56,function(om){return Math.min(.13,.03+.14*om/Math.PI);});
      var a=nd.arc.om; nd.delay=.12+a*.55; nd.dur=.75+a*.55; nd.ping=-9;
    });
  }
  function spawnReqTo(nd,delay){
    if(!NP||reduce) return;
    view();
    for(var tries=0;tries<60;tries++){
      var k=(Math.random()*NP|0)*3, v=[PTS[k],PTS[k+1],PTS[k+2]], a=angle(v,nd.v);
      if(a<0.12||a>0.75) continue;
      tf(v[0],v[1],v[2]); if(o.z<.15) continue;
      var arc=slerpArc(v,nd.v,24,function(om){return .02+.12*om/Math.PI;});
      reqs.push({arc:arc,node:nd,t0:simT+(delay||0),dur:.55+a*1.1,done:false});
      return;
    }
  }
  function launch(v,nd){
    setOrigin(v);
    cyc = reduce ? 7.6 : T0-0.35;               // status card restarts: 上传至边缘网络... → 自动分发 → 已部署
    if(nd && nd!==ORIGIN){ nd.blink=simT; for(var i=0;i<3;i++) spawnReqTo(nd,i*.22); }
    if(!running) draw();
  }
  function onTap(p,touch){
    var nd=hitNode(p,touch?22:13);
    if(nd===ORIGIN){ launch(ORIGIN.v,null); return; }
    if(nd){ launch(nd.v,nd); return; }
    var v=pickSphere(p); if(v) launch(v,null);
  }
  cv.addEventListener('pointerdown',function(e){
    if(e.pointerType==='mouse' && e.button!==0) return;
    drag={id:e.pointerId,x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,t0:e.timeStamp,t:e.timeStamp,on:false,v:0,touch:e.pointerType!=='mouse'};
    if(!drag.touch){ try{ cv.setPointerCapture(e.pointerId); }catch(_){} }
  });
  cv.addEventListener('pointermove',function(e){
    if(!drag || drag.id!==e.pointerId){
      if(e.pointerType==='mouse' && !drag) wrap.classList.toggle('s2-onnode',!!hitNode(local(e),13));
      return;
    }
    if(!drag.on){
      var tx=e.clientX-drag.x0, ty=e.clientY-drag.y0;
      if(Math.hypot(tx,ty)<6) return;
      if(drag.touch && Math.abs(ty)>Math.abs(tx)){ drag=null; return; }   // vertical swipe: leave it to page scroll
      drag.on=true; wrap.classList.add('s2-dragging'); wrap.classList.remove('s2-onnode');
      if(drag.touch){ try{ cv.setPointerCapture(e.pointerId); }catch(_){} }
    }
    var dx=e.clientX-drag.x, dy=e.clientY-drag.y, dts=Math.max(.001,(e.timeStamp-drag.t)/1000);
    var dr=-dx/(R*1.05);
    rot+=dr;
    if(!drag.touch) tilt=Math.max(-0.1,Math.min(0.8,tilt+dy/(R*1.6)));
    drag.v=drag.v*0.5+(dr/dts)*0.5;
    drag.x=e.clientX; drag.y=e.clientY; drag.t=e.timeStamp;
    lastInput=performance.now();
    if(!running) draw();
  });
  function endDrag(e){
    if(!drag || drag.id!==e.pointerId) return;
    var d=drag; drag=null; wrap.classList.remove('s2-dragging');
    if(d.on){ spin=(e.timeStamp-d.t>90)?0:Math.max(-5,Math.min(5,d.v)); lastInput=performance.now(); }
    else if(e.type==='pointerup' && e.timeStamp-d.t0<700) onTap(local(e),d.touch);
  }
  cv.addEventListener('pointerup',endDrag);
  cv.addEventListener('pointercancel',endDrag);
  cv.addEventListener('pointerleave',function(e){ if(e.pointerType==='mouse' && !drag) wrap.classList.remove('s2-onnode'); });
  cv.addEventListener('keydown',function(e){
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
      e.preventDefault(); var dir=e.key==='ArrowLeft'?1:-1;
      spin=dir*1.4; lastInput=performance.now();
      if(!running){ rot+=dir*.25; draw(); }
    } else if(e.key==='Enter'||e.key===' '){
      e.preventDefault(); var v=pickSphere({x:cx,y:cy}); if(v) launch(v,null);
    }
  });
  var rz=0;
  __on(window,'resize',function(){ cancelAnimationFrame(rz); rz=requestAnimationFrame(function(){ if(build()) draw(); }); });
  if('ResizeObserver' in window) new ResizeObserver(function(){ if(build()) draw(); }).observe(wrap);

  __cleanup=function(){  };
  })();
  return function(){ __dead=true; __L.forEach(function(x){ x[0].removeEventListener(x[1],x[2],x[3]); }); __cleanup(); };
}
