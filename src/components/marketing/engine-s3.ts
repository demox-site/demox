// @ts-nocheck
/* Ported verbatim from the approved demox-hero-demo (v6-interactive + v7.1 content).
   Scoped to `root`; returns a cleanup that stops all loops and window/document listeners. */
/* ===== Screen 3 · 作品墙 — build v5-s3-gallery + v6-interactive =====
   Two rows drift in opposite directions forever. v6: the drift is driven by rAF (one transform per row per frame)
   so each row can be dragged/swiped with momentum and then eases back into its drift. Track layout per row:
   [clone][original set][clones…]; x stays in [-2w,-w) while idle so there is always content on both sides.
   Clicking a 示例 card opens a larger preview (dialog); the three 真实 cards (coffee / www / preview) stay plain links. A drag never opens/navigates. */

import { marketingStrings } from './marketing-translations';

export function initS3(root: HTMLElement, lang: 'zh' | 'en' = 'zh'): () => void {
  const T = marketingStrings(lang).s3;
  var __dead=false, __L=[];
  function __on(t,e,f,o){ t.addEventListener(e,f,o); __L.push([t,e,f,o]); }
  var __raf=window.requestAnimationFrame.bind(window);
  var requestAnimationFrame=function(f){ return __raf(function(t){ if(!__dead) f(t); }); };
  function $id(i){ return root.querySelector('#'+i); }
  var __cleanup = function(){};
  (function(){

  var sec=$id('s3'); if(!sec) return;
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage=$id('s3stage');
  var SPEED=[34,28];                       // px per second, row A (←) / row B (→)
  var rows=[].slice.call(sec.querySelectorAll('.s3-row')).map(function(el,i){
    var base=(el.classList.contains('rev')?1:-1)*SPEED[i];
    return {el:el, tr:el.querySelector('.s3-track'), base:base, v:base, x:0, w:0, hover:false, focus:false, drag:null, init:false};
  });
  var modalOpen=false, lastDragEnd=-1e9;

  /* originals: 示例 cards become keyboard buttons; 真实 links stay links */
  rows.forEach(function(r){
    [].forEach.call(r.tr.querySelector('.s3-set').querySelectorAll('.s3-card'),function(c){
      if(c.tagName==='ARTICLE'){
        c.tabIndex=0; c.setAttribute('role','button'); c.setAttribute('aria-haspopup','dialog');
        c.setAttribute('aria-label',T.viewExample+c.querySelector('.s3-cap-t b').textContent+T.srItemOpen+T.modalNote+T.srItemClose);
      } else c.setAttribute('draggable','false');
    });
  });
  function cloneSet(set){
    var c=set.cloneNode(true); c.setAttribute('aria-hidden','true');       // not inert: clones must stay clickable
    [].forEach.call(c.querySelectorAll('.s3-card'),function(a){ a.setAttribute('tabindex','-1'); a.removeAttribute('role'); a.removeAttribute('aria-label'); a.removeAttribute('aria-haspopup'); });
    return c;
  }
  function wrap(r){ if(r.focus||!r.w) return; r.x = r.x - Math.floor(r.x/r.w)*r.w - 2*r.w; }    // → [-2w,-w)
  function apply(r){ r.tr.style.transform='translate3d('+r.x.toFixed(2)+'px,0,0)'; }

  var lastW=0;
  function layout(){
    var vw=stage.offsetWidth; if(!vw || vw===lastW) return; lastW=vw;
    var small=window.innerWidth<=760;
    rows.forEach(function(r,i){
      var tr=r.tr, set=tr.querySelector('.s3-set:not([aria-hidden])');
      [].forEach.call(tr.querySelectorAll('.s3-set[aria-hidden]'),function(x){ tr.removeChild(x); });
      if(reduce){ tr.style.transform=''; return; }              // static, complete, natively scrollable
      var w=set.offsetWidth;                                     // offsetWidth ignores the wall's 3D tilt
      tr.insertBefore(cloneSet(set),set);
      var need=Math.max(1,Math.ceil(vw*1.5/w));
      for(var n=0;n<need;n++) tr.appendChild(cloneSet(set));
      if(!r.init){                                               // same first frame as v5: both 真实 cards in view
        r.init=true; var f=small?(i?0.05:0.99):(i?0.62:0.72);
        r.x=(r.base<0?-f*w:-(1-f)*w)-w;
      } else if(r.w) r.x=r.x/r.w*w;
      r.w=w; wrap(r); apply(r);
    });
  }

  /* ---- drift / momentum loop (only while on screen) ---- */
  var running=false, visible=true, last=0;
  function tick(now){
    if(!visible){ running=false; return; }
    var dt=Math.min(.05,(now-(last||now))/1000); last=now;
    rows.forEach(function(r){
      if(r.drag && r.drag.on) return;
      var target=(r.hover||r.focus||modalOpen)?0:r.base, fling=Math.abs(r.v)>Math.abs(r.base)*1.6;
      r.v += (target-r.v)*(1-Math.exp(-dt/(fling?0.5:0.35)));
      r.x += r.v*dt; wrap(r); apply(r);
    });
    requestAnimationFrame(tick);
  }
  function start(){ if(running||reduce) return; running=true; last=0; requestAnimationFrame(tick); }

  /* ---- drag / swipe per row (pointer can start anywhere on the wall; nearest row by y) ---- */
  var D=null;
  function rowAt(e){
    var el=e.target.closest&&e.target.closest('.s3-row');
    for(var i=0;i<rows.length;i++) if(rows[i].el===el) return rows[i];
    var best=null, bd=1e9;
    rows.forEach(function(r){ var c=r.el.querySelector('.s3-card'); if(!c) return; var b=c.getBoundingClientRect(), d=Math.abs(e.clientY-(b.top+b.height/2)); if(d<bd){ bd=d; best=r; } });
    return best;
  }
  stage.addEventListener('pointerdown',function(e){
    if(reduce || D || (e.pointerType==='mouse' && e.button!==0)) return;
    var r=rowAt(e); if(!r) return;
    D={r:r,id:e.pointerId,x0:e.clientX,y0:e.clientY,sx:r.x,on:false,s:[[e.timeStamp,e.clientX]]};
  });
  stage.addEventListener('pointermove',function(e){
    if(!D || D.id!==e.pointerId) return;
    var r=D.r, dx=e.clientX-D.x0, dy=e.clientY-D.y0;
    if(!D.on){
      if(Math.abs(dx)<6){ if(Math.abs(dy)>10) D=null; return; }
      if(Math.abs(dy)>Math.abs(dx)){ D=null; return; }            // vertical intent → page scroll
      D.on=true; D.sx=r.x-dx; r.v=0; r.drag=D;                  // 1:1 from the pointerdown point
      try{ stage.setPointerCapture(e.pointerId); }catch(_){}
      stage.classList.add('s3-dragging');
    }
    r.x=D.sx+(e.clientX-D.x0); wrap(r); apply(r);
    D.s.push([e.timeStamp,e.clientX]); while(D.s.length>2 && e.timeStamp-D.s[0][0]>100) D.s.shift();
  });
  function endDrag(e){
    if(!D || D.id!==e.pointerId) return;
    var d=D, r=d.r; D=null; r.drag=null;
    if(!d.on) return;
    stage.classList.remove('s3-dragging'); lastDragEnd=performance.now();
    var a=d.s[0], b=d.s[d.s.length-1], dts=(b[0]-a[0])/1000;
    var v=(e.type==='pointerup' && dts>0.012 && e.timeStamp-b[0]<80)?(b[1]-a[1])/dts:0;
    r.v=Math.max(-2600,Math.min(2600,v));
  }
  stage.addEventListener('pointerup',endDrag);
  stage.addEventListener('pointercancel',endDrag);
  rows.forEach(function(r){
    var el=r.el;
    el.addEventListener('pointerenter',function(e){ if(e.pointerType==='mouse') r.hover=true; });
    el.addEventListener('pointerleave',function(e){ if(e.pointerType==='mouse') r.hover=false; });
    /* keyboard focus: pause the row and slide the focused card into view (the section is overflow:clip, so the browser can't scroll it) */
    el.addEventListener('focusin',function(e){
      var c=e.target.closest&&e.target.closest('.s3-card'); if(!c) return;
      var kb=true; try{ kb=c.matches(':focus-visible'); }catch(_){}
      if(!kb) return;                                            // mouse/touch focus: don't pause or slide
      r.focus=true; if(reduce) return;
      var sr=stage.getBoundingClientRect(), cr=c.getBoundingClientRect(), pad=Math.min(90,sr.width*.12), d=0;
      if(cr.left<sr.left+pad) d=sr.left+pad-cr.left; else if(cr.right>sr.right-pad) d=sr.right-pad-cr.right;
      if(d){ r.x+=d; apply(r); }
    });
    el.addEventListener('focusout',function(e){ if(!el.contains(e.relatedTarget)){ r.focus=false; wrap(r); apply(r); } });
  });
  sec.addEventListener('scroll',function(){ sec.scrollLeft=0; });   // fallback for browsers without overflow:clip

  /* ---- click vs drag; 示例 card → dialog ---- */
  stage.addEventListener('click',function(e){
    if(performance.now()-lastDragEnd<350){ e.preventDefault(); e.stopPropagation(); return; }
    var c=e.target.closest('.s3-card'); if(!c || !stage.contains(c)) return;
    if(c.tagName==='ARTICLE'){ e.preventDefault(); openModal(c); }
  },true);
  stage.addEventListener('dragstart',function(e){ e.preventDefault(); });
  stage.addEventListener('keydown',function(e){
    var c=e.target.closest&&e.target.closest('article.s3-card'); if(!c) return;
    if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openModal(c); }
  });

  var modal=$id('s3modal'), dlg=modal.querySelector('.s3-dlg'), mpv=modal.querySelector('.s3-mpv'),
      mt=$id('s3mt'), md=$id('s3md'), mu=$id('s3mu'), closeBtn=modal.querySelector('.s3-x');
  var lastFocus=null, closeT=0;
  function fit(){ mpv.style.setProperty('--s3-mk',(mpv.clientWidth/560).toFixed(4)); }
  function openModal(card){
    if(modalOpen) return;
    clearTimeout(closeT);
    mpv.innerHTML=''; mpv.appendChild(card.querySelector('.s3-pv>.pi').cloneNode(true));
    mt.textContent=card.querySelector('.s3-cap-t b').textContent;
    md.innerHTML=card.querySelector('.s3-cap-m').innerHTML;      // our own static markup
    mu.textContent=card.querySelector('.s3-url span').textContent;
    lastFocus=card.closest('[aria-hidden="true"]')?null:card;
    var sbw=window.innerWidth-root.clientWidth;
    document.body.style.overflow='hidden'; if(sbw>0) document.body.style.paddingRight=sbw+'px';
    modal.hidden=false; modalOpen=true; fit();
    if(reduce) modal.classList.add('is-open'); else requestAnimationFrame(function(){ requestAnimationFrame(function(){ if(modalOpen) modal.classList.add('is-open'); }); });
    try{ closeBtn.focus({preventScroll:true}); }catch(_){ closeBtn.focus(); }
  }
  function closeModal(){
    if(!modalOpen) return; modalOpen=false;
    modal.classList.remove('is-open');
    var done=function(){ modal.hidden=true; mpv.innerHTML=''; };
    if(reduce) done(); else closeT=setTimeout(done,240);
    document.body.style.overflow=''; document.body.style.paddingRight='';
    if(lastFocus){ try{ lastFocus.focus({preventScroll:true}); }catch(_){} }
    else if(document.activeElement && modal.contains(document.activeElement)) document.activeElement.blur();
  }
  modal.addEventListener('click',function(e){ if(e.target.closest('[data-close]')) closeModal(); });
  modal.addEventListener('keydown',function(e){
    if(e.key==='Escape'){ e.preventDefault(); closeModal(); return; }
    if(e.key!=='Tab') return;
    var f=[].slice.call(dlg.querySelectorAll('button,a[href]')), first=f[0], lastEl=f[f.length-1], a=document.activeElement;
    if(e.shiftKey && (a===first||a===dlg)){ e.preventDefault(); lastEl.focus(); }
    else if(!e.shiftKey && a===lastEl){ e.preventDefault(); first.focus(); }
  });
  __on(document,'keydown',function(e){ if(modalOpen && e.key==='Escape' && !modal.contains(e.target)) closeModal(); });
  __on(document,'focusin',function(e){ if(modalOpen && !modal.contains(e.target)){ try{ closeBtn.focus({preventScroll:true}); }catch(_){} } });

  layout();
  if('IntersectionObserver' in window){
    new IntersectionObserver(function(es){ visible=es[0].isIntersecting; if(visible) start(); },{rootMargin:'200px 0px'}).observe(sec);
  }
  start();
  var rz=0;
  __on(window,'resize',function(){ cancelAnimationFrame(rz); rz=requestAnimationFrame(function(){ layout(); if(modalOpen) fit(); }); });

  __cleanup=function(){  };
  })();
  return function(){ __dead=true; __L.forEach(function(x){ x[0].removeEventListener(x[1],x[2],x[3]); }); __cleanup(); };
}
