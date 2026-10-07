// @ts-nocheck
/* Ported verbatim from the approved demox-hero-demo (v6-interactive + v7.1 content).
   Scoped to `root`; returns a cleanup that stops all loops and window/document listeners. */

export function initS1(root: HTMLElement): () => void {
  var __dead=false, __L=[];
  function __on(t,e,f,o){ t.addEventListener(e,f,o); __L.push([t,e,f,o]); }
  var __raf=window.requestAnimationFrame.bind(window);
  var requestAnimationFrame=function(f){ return __raf(function(t){ if(!__dead) f(t); }); };
  function $id(i){ return root.querySelector('#'+i); }
  var __cleanup = function(){};
  (function(){

  'use strict';
  var html = root;
  html.classList.add('init');

  /* ---------- the "AI-generated" source, typed from zero every loop ---------- */
  // [code, blockId, revealAt(optional: reveal once this many chars are typed)]
  var LINES = [
    ['<!doctype html>'],
    ['<nav><b>Coffee.</b> <a>菜单</a> <a>门店</a> <a>预订</a></nav>', 'nav', 5],
    ['<section class="hero">'],
    ['  <span class="eyebrow">手冲咖啡馆 · 每日现烘</span>', 'ey'],
    ['  <h1>好咖啡，慢慢来</h1>', 'h1'],
    ['  <p>每天清晨现烘，一杯一杯手冲。</p>', 'p'],
    ['  <button>预订座位</button>', 'btn'],
    ['  <div class="pour" aria-hidden="true"></div>', 'cover'],
    ['</section>'],
    ['<ul class="cards">'],
    ['  <li>云南日晒</li>', 'c1'],
    ['  <li>埃塞俄比亚水洗</li>', 'c2'],
    ['  <li>哥伦比亚蜜处理</li>', 'c3'],
    ['</ul>'],
    ['<footer>© 2026 Coffee.</footer>', 'foot']
  ];
  var URL_LIVE = 'https://coffee.demox.site';

  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function tokenize(line){
    var t=[],i=0,n=line.length;
    function push(s,c){ if(s) t.push([s,c]); }
    while(i<n){
      if(line[i]==='<' && line[i+1]==='!'){var j=line.indexOf('>',i);var e=j<0?n:j+1;push(line.slice(i,e),'cm');i=e;continue;}
      if(line[i]==='<'){
        var a=i+1; if(line[a]==='/') a++;
        push(line.slice(i,a),'pn');
        var k=a; while(k<n && /[a-zA-Z0-9]/.test(line[k])) k++;
        push(line.slice(a,k),'tg'); i=k;
        while(i<n && line[i]!=='>'){
          var ch=line[i];
          if(ch===' '){push(' ','tx');i++;continue;}
          if(ch==='"'){var q=line.indexOf('"',i+1);q=q<0?n:q+1;push(line.slice(i,q),'st');i=q;continue;}
          if(ch==='='||ch==='/'){push(ch,'pn');i++;continue;}
          var k2=i; while(k2<n && /[a-zA-Z-]/.test(line[k2])) k2++; if(k2===i) k2=i+1;
          push(line.slice(i,k2),'at'); i=k2;
        }
        if(line[i]==='>'){push('>','pn');i++;}
        continue;
      }
      var j2=line.indexOf('<',i); if(j2<0) j2=n;
      push(line.slice(i,j2),'tx'); i=j2;
    }
    return t;
  }
  var TOK = LINES.map(function(l){return tokenize(l[0]);});
  var INNER = LINES.map(function(l){
    var s=l[0], b=l[1]; if(!b || l[2]!=null) return null;
    var o=s.indexOf('>'), c=s.lastIndexOf('</');
    if(o<0||c<0||c<o) return null;
    return [o+1,c];
  });

  var linesEl=$id('lines'), codeEl=$id('code'),
      termEl=$id('term'), urlEl=$id('url'),
      stateTag=$id('stateTag'), nodeLabel=$id('nodeLabel'),
      refreshEl=$id('refresh'), nodeEl=$id('node');
  var blocks={}; [].forEach.call(root.querySelectorAll('.blk'),function(el){blocks[el.getAttribute('data-b')]=el;});
  var lineEls=[];
  LINES.forEach(function(l,i){
    var d=document.createElement('div'); d.className='ln'; if(l[1]) d.setAttribute('data-b',l[1]);
    d.innerHTML='<span class="no">'+(i+1)+'</span><span class="src"></span>';
    linesEl.appendChild(d); lineEls.push(d);
  });
  var typed = LINES.map(function(){return 0;});
  var cur = -1, lastBlock=null, linesOff=0;

  function renderLine(i, caret){
    var n=typed[i], out='', used=0;
    for(var k=0;k<TOK[i].length && used<n;k++){
      var tk=TOK[i][k], take=Math.min(tk[0].length, n-used);
      out+='<span class="'+tk[1]+'">'+esc(tk[0].slice(0,take))+'</span>'; used+=take;
    }
    if(caret) out+='<i class="caret"></i>';
    lineEls[i].lastChild.innerHTML=out;
    lineEls[i].style.display = (n>0||caret) ? '' : 'none';
  }
  function setCur(i){
    if(cur>=0 && lineEls[cur]){lineEls[cur].classList.remove('cur'); renderLine(cur,false);}
    cur=i;
    if(i>=0){lineEls[i].classList.add('cur'); renderLine(i,true);}
    scrollCode();
    if(typeof Beam!=='undefined') Beam.aim(i>=0?lineEls[i]:termEl, i>=0?(lastBlock||blocks.nav):root.querySelector('.chrome'));
  }
  function scrollCode(){
    var lh=lineEls[0].offsetHeight||20, vis=codeEl.clientHeight-24, last=cur;
    if(last<0){for(var i=typed.length-1;i>=0;i--){if(typed[i]>0){last=i;break;}}}
    var off=Math.max(0,Math.ceil(((last+1.5)*lh-vis)/lh)*lh);
    linesEl.style.transform='translateY('+(-off)+'px)'; linesOff=off;
  }
  function syncBlock(i){
    var b=LINES[i][1]; if(!b) return;
    var el=blocks[b], s=LINES[i][0], n=typed[i], inn=INNER[i], show;
    if(LINES[i][2]!=null) show = n>=LINES[i][2];
    else if(inn){ show = n>inn[0];
      var te=el.querySelector('[data-t]'); if(te) te.textContent = n>inn[0] ? s.slice(inn[0],Math.min(n,inn[1])) : '';
    } else show = n>=s.length;
    if(show && !el.classList.contains('on')){ el.classList.add('on'); onReveal(el); }
    if(show){ lastBlock=el; if(cur===i) Beam.aim(lineEls[i], el); }
    if(!show && el.classList.contains('on')) el.classList.remove('on');
  }
  function onReveal(el){
    if(html.classList.contains('init')) return;
    pageRefresh();
    Beam.fire({size:3.4, trail:150, dur:560, onArrive:function(){ land(el); Beam.burst(1); }});
  }
  function land(el){ el.classList.add('land'); setTimeout(function(){el.classList.remove('land');},140); }
  function pageRefresh(){ refreshEl.classList.remove('go'); void refreshEl.offsetWidth; refreshEl.classList.add('go'); }
  function setCharge(v){ nodeEl.style.setProperty('--charge', v.toFixed(3)); }

  /* ---------- terminal + state ---------- */
  var PROMPT='<span class="ok">➜</span> <span class="dim">~/coffee $</span> ';
  function term(rows){ termEl.innerHTML=rows.map(function(r){return '<div class="row">'+r+'</div>';}).join(''); }
  function termStatic(){ term([PROMPT+'<span class="w">demox deploy ./dist</span>','<span class="dim">上传至边缘网络...</span> 完成 (1.2s)','<span class="ok">✓ 成功！已部署至：</span><span class="w">coffee.demox.site</span>']); }
  function termIdle(){ term([PROMPT+'<span class="w">npm run dev</span>','<span class="dim">VITE ready ·</span> localhost:5173 <span class="dim">· 热更新已开启</span>']); }
  function setState(s){
    root.setAttribute('data-state',s); Beam.state(s);
    if(s==='editing'){urlEl.textContent='localhost:5173';stateTag.textContent='预览';nodeLabel.textContent='实时预览';}
    if(s==='deploying'){urlEl.textContent='正在部署…';stateTag.textContent='部署中';nodeLabel.textContent='demox deploy';}
    if(s==='live'){urlEl.textContent=URL_LIVE;stateTag.textContent='已上线';nodeLabel.textContent='已部署';}
  }

  /* =====================================================================
     Beam: canvas connector — luminous track, comets with fading trails,
     landing ripples + sparks, node charge hits, deploy surge.
     One accent only: #22c55e and its tints (#bbf7d0 #86efac #4ade80 #16a34a).
     ===================================================================== */
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var Beam = (function(){
    var stage=$id('stage'), cv=$id('beamCv'), ctx=cv.getContext('2d'),
        edEl=$id('editor'), brEl=$id('browser'), linkEl=$id('link');
    var dpr=Math.min(2,window.devicePixelRatio||1);
    var N=120, PX=new Float32Array(N+1), PY=new Float32Array(N+1), CUM=new Float32Array(N+1), LEN=1, MID=0.5;
    var ox=0, oy=0, cw=0, ch=0, vertical=false, endDir={x:1,y:0}, FX=1;
    var R={}, sy=null, ey=null, aimS=null, aimE=null;      // live endpoints (y) follow the code line / landing element
    var comets=[], ripples=[], sparks=[];
    var surge=0, surgeTarget=0, st='editing', nextAmb=0, flowOff=0, last=0, running=false;

    function sprite(stops,size){
      var c=document.createElement('canvas'); c.width=c.height=size; var g=c.getContext('2d');
      var r=g.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
      stops.forEach(function(s){r.addColorStop(s[0],s[1]);}); g.fillStyle=r; g.fillRect(0,0,size,size); return c;
    }
    var GLOW=sprite([[0,'rgba(74,222,128,.95)'],[.16,'rgba(34,197,94,.6)'],[.42,'rgba(34,197,94,.18)'],[1,'rgba(34,197,94,0)']],128);
    var CORE=sprite([[0,'rgba(255,255,255,1)'],[.35,'rgba(240,253,244,1)'],[.62,'rgba(134,239,172,.95)'],[1,'rgba(34,197,94,0)']],64);

    function rel(r){ return {l:r.left-R.s.left, t:r.top-R.s.top, r:r.right-R.s.left, b:r.bottom-R.s.top, w:r.width, h:r.height}; }
    function measure(){
      R.s=stage.getBoundingClientRect();
      R.e=rel(edEl.getBoundingClientRect()); R.b=rel(brEl.getBoundingClientRect()); R.k=rel(linkEl.getBoundingClientRect());
      vertical = window.matchMedia('(max-width:900px)').matches;
      var PADX=70, PADY=90, x0,x1,y0,y1; FX=vertical?0.5:1;
      if(!vertical){ x0=R.e.r-PADX; x1=R.b.l+PADX; y0=Math.min(R.e.t,R.b.t)-PADY*.4; y1=Math.max(R.e.b,R.b.b)+PADY*.4; }
      else { x0=R.k.l; x1=R.k.r; y0=R.e.b-4; y1=R.b.t+4; }  /* mobile: canvas == the gap, so glow can never bleed over either window */
      var w=Math.ceil(x1-x0), h=Math.ceil(y1-y0);
      if(Math.abs(w-cw)>1||Math.abs(h-ch)>1){ cw=w; ch=h; cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr); cv.style.width=w+'px'; cv.style.height=h+'px'; }
      ox=x0; oy=y0; cv.style.transform='translate('+ox.toFixed(1)+'px,'+oy.toFixed(1)+'px)';
      var mx=(R.k.l+R.k.r)/2, my=vertical?(R.e.b+R.b.t)/2:(R.e.t+R.e.b)/2;
      R.mx=mx; R.my=my;
      nodeEl.style.left=mx+'px'; nodeEl.style.top=my+'px';
    }
    function yOf(el, box, fallback){
      if(!el) return fallback;
      var r=rel(el.getBoundingClientRect()); if(r.h===0) return fallback;
      return Math.max(box.t+24, Math.min(box.b-18, r.t+r.h/2));
    }
    function cubic(a,b,c,d,t){var u=1-t;return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d;}
    function build(dt){
      var x1,y1,x2,y2,mx=R.mx-ox,my=R.my-oy;
      if(!vertical){
        var ts=yOf(aimS,R.e,R.e.t+R.e.h*.6), te=yOf(aimE,R.b,R.b.t+R.b.h*.4);
        var k=dt>0?1-Math.exp(-dt/110):1; sy = sy==null?ts:sy+(ts-sy)*k; ey = ey==null?te:ey+(te-ey)*k;
        x1=R.e.r-ox-1; y1=sy-oy; x2=R.b.l-ox+1; y2=ey-oy;
        var d1=(mx-x1)*.6, d2=(x2-mx)*.6, h=N/2, L=0;
        for(var i=0;i<=N;i++){
          var t,px,py;
          if(i<=h){t=i/h; px=cubic(x1,x1+d1,mx-d1,mx,t); py=cubic(y1,y1,my,my,t);}
          else {t=(i-h)/h; px=cubic(mx,mx+d2,x2-d2,x2,t); py=cubic(my,my,y2,y2,t);}
          PX[i]=px; PY[i]=py; if(i>0) L+=Math.hypot(px-PX[i-1],py-PY[i-1]); CUM[i]=L;
        }
        LEN=L||1; MID=CUM[h]/LEN;
      } else {
        x1=R.e.l+R.e.w/2-ox; y1=R.e.b-oy-1; x2=R.b.l+R.b.w/2-ox; y2=R.b.t-oy+1; var L2=0;
        for(var j=0;j<=N;j++){ var tt=j/N; PX[j]=x1+(x2-x1)*tt; PY[j]=y1+(y2-y1)*tt; if(j>0) L2+=Math.hypot(PX[j]-PX[j-1],PY[j]-PY[j-1]); CUM[j]=L2; }
        LEN=L2||1; MID=.5;
      }
      var ex=PX[N]-PX[N-4], eyy=PY[N]-PY[N-4], el=Math.hypot(ex,eyy)||1; endDir={x:ex/el,y:eyy/el};
    }
    function at(s){
      if(s<=0) return {x:PX[0],y:PY[0]}; if(s>=LEN) return {x:PX[N],y:PY[N]};
      var lo=0,hi=N; while(hi-lo>1){var mid=(lo+hi)>>1; if(CUM[mid]<s) lo=mid; else hi=mid;}
      var f=(s-CUM[lo])/((CUM[hi]-CUM[lo])||1); return {x:PX[lo]+(PX[hi]-PX[lo])*f, y:PY[lo]+(PY[hi]-PY[lo])*f};
    }
    function strokeRange(a,b){
      a=Math.max(0,a); b=Math.min(LEN,b); if(b<=a) return false;
      var p=at(a); ctx.beginPath(); ctx.moveTo(p.x,p.y);
      for(var i=1;i<N;i++){ if(CUM[i]>a && CUM[i]<b) ctx.lineTo(PX[i],PY[i]); }
      p=at(b); ctx.lineTo(p.x,p.y); return true;
    }
    function fullPath(){ ctx.beginPath(); ctx.moveTo(PX[0],PY[0]); for(var i=1;i<=N;i++) ctx.lineTo(PX[i],PY[i]); }
    function fire(o){
      if(reduce) return;
      var k=Math.min(1,LEN/260);
      comets.push({t0:performance.now(), dur:o.dur||800, size:o.size||2, trail:(o.trail||80)*(.5+.5*k), onArrive:o.onArrive, passed:false, arrived:false});
    }
    function burst(str, big){
      if(reduce) return;
      var e={x:PX[N],y:PY[N]}, now=performance.now();
      ripples.push({x:e.x,y:e.y,t0:now,dur:big?1100:700,r:(big?78:36)*FX,s:str});
      if(big) ripples.push({x:e.x,y:e.y,t0:now+140,dur:1200,r:50*FX,s:str*.7});
      var n=big?22:9;
      for(var i=0;i<n;i++){
        var ang=Math.atan2(endDir.y,endDir.x)+(Math.random()-.5)*(big?3.6:2.2), sp=((big?.14:.09)+Math.random()*(big?.22:.12))*FX;
        sparks.push({x:e.x,y:e.y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,t0:now,dur:380+Math.random()*(big?560:300),r:1+Math.random()*(big?2:1.4)});
      }
    }
    function nodeHit(strong){
      var m=at(LEN*MID); ripples.push({x:m.x,y:m.y,t0:performance.now(),dur:560,r:(strong?40:30)*FX,s:strong?.8:.5});
      nodeEl.classList.add('hit'); clearTimeout(nodeHit._t); nodeHit._t=setTimeout(function(){nodeEl.classList.remove('hit');},170);
    }
    function setStateB(s){
      st=s; surgeTarget = s==='deploying'?1:0;
      if(s==='live' && running){ surge=Math.max(surge,1); burst(1.25,true); var m=at(LEN*MID); ripples.push({x:m.x,y:m.y,t0:performance.now(),dur:900,r:60*FX,s:.85}); }
    }
    function easeHead(p){ return 1-Math.pow(1-p,1.45); }

    function draw(now){
      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,cw,ch);
      ctx.lineCap='round'; ctx.lineJoin='round';
      var S=surge;
      fullPath();
      ctx.strokeStyle='rgba(34,197,94,'+(0.08+0.14*S)+')'; ctx.lineWidth=(9+16*S)*(vertical?.7:1); ctx.stroke();
      ctx.strokeStyle='rgba(34,197,94,'+(0.16+0.30*S)+')'; ctx.lineWidth=3+4*S; ctx.stroke();
      ctx.strokeStyle='rgba(255,255,255,'+(0.55+0.3*S)+')'; ctx.lineWidth=1; ctx.stroke();
      ctx.setLineDash([14,20]); ctx.lineDashOffset=-flowOff; ctx.strokeStyle='rgba(22,163,74,'+(0.55+0.4*S)+')'; ctx.lineWidth=1.8+1.6*S; ctx.stroke();
      ctx.setLineDash([]);
      for(var i=comets.length-1;i>=0;i--){
        var c=comets[i], p=(now-c.t0)/c.dur;
        if(p<0) continue;
        var head=Math.min(1,easeHead(Math.min(p,1)))*LEN;
        var tl=c.trail*(p<=1?Math.min(1,p*3):Math.max(0,1-(p-1)/.28));
        if(!c.passed && head>=LEN*MID){ c.passed=true; nodeHit(c.size>3); }
        if(!c.arrived && p>=1){ c.arrived=true; if(c.onArrive) c.onArrive(); }
        if(p>1.28){ comets.splice(i,1); continue; }
        var K=14, sz=c.size*(1+.4*S);
        for(var k=0;k<K;k++){
          var a=head-tl*(1-k/K), b=head-tl*(1-(k+1)/K), al=(k+1)/K;
          if(!strokeRange(a,b+0.5)) continue;
          ctx.strokeStyle='rgba(34,197,94,'+(0.16*al)+')'; ctx.lineWidth=sz*5*al+1; ctx.stroke();
          ctx.strokeStyle=(k>K-3?'rgba(187,247,208,':'rgba(34,197,94,')+(0.95*al*al)+')'; ctx.lineWidth=sz*1.15*al+.5; ctx.stroke();
        }
        if(p<=1.02){
          var hp=at(head), g=sz*11*(vertical?.6:1), cr=sz*3.4;
          ctx.globalAlpha=.95; ctx.drawImage(GLOW,hp.x-g,hp.y-g,g*2,g*2);
          ctx.globalAlpha=1; ctx.drawImage(CORE,hp.x-cr,hp.y-cr,cr*2,cr*2);
        }
      }
      for(var r=ripples.length-1;r>=0;r--){
        var Rp=ripples[r], q=(now-Rp.t0)/Rp.dur; if(q<0) continue; if(q>=1){ripples.splice(r,1);continue;}
        var e=1-Math.pow(1-q,3), rad=4+Rp.r*e;
        ctx.beginPath(); ctx.arc(Rp.x,Rp.y,rad,0,6.2832);
        ctx.strokeStyle='rgba(34,197,94,'+(0.75*(1-q)*Rp.s)+')'; ctx.lineWidth=2.4*(1-q)+.4; ctx.stroke();
        ctx.globalAlpha=Math.max(0,.6*(1-q)*Rp.s); var gg=rad*1.15; ctx.drawImage(GLOW,Rp.x-gg,Rp.y-gg,gg*2,gg*2); ctx.globalAlpha=1;
      }
      for(var s2=sparks.length-1;s2>=0;s2--){
        var P=sparks[s2], u=(now-P.t0)/P.dur; if(u>=1){sparks.splice(s2,1);continue;}
        var tt=now-P.t0, x=P.x+P.vx*tt, y=P.y+P.vy*tt;
        ctx.beginPath(); ctx.arc(x,y,P.r*(1-u*.6),0,6.2832); ctx.fillStyle='rgba(34,197,94,'+(0.9*(1-u))+')'; ctx.fill();
      }
      [[PX[0],PY[0]],[PX[N],PY[N]]].forEach(function(pt,idx){
        var gs=vertical?10:18; ctx.globalAlpha=0.45+0.45*S; ctx.drawImage(GLOW,pt[0]-gs,pt[1]-gs,gs*2,gs*2); ctx.globalAlpha=1;
        ctx.beginPath(); ctx.arc(pt[0],pt[1],3.8,0,6.2832); ctx.fillStyle='#fff'; ctx.fill();
        ctx.strokeStyle='rgba(22,163,74,.9)'; ctx.lineWidth=1.4; ctx.stroke();
      });
    }
    function frame(now){
      var dt=Math.min(50, now-(last||now)); last=now;
      measure(); build(dt);
      surge += (surgeTarget-surge)*(1-Math.exp(-dt/(surgeTarget>surge?160:700)));
      flowOff += dt*(0.06+0.34*surge);
      if(now>=nextAmb){
        if(st==='deploying'){ fire({size:2.6+Math.random()*2, trail:130+Math.random()*80, dur:420+Math.random()*180}); nextAmb=now+50+Math.random()*40; }
        else { fire({size:1.9+Math.random()*.9, trail:80+Math.random()*50, dur:820+Math.random()*300}); nextAmb=now+(st==='live'?650:340)+Math.random()*320; }
      }
      draw(now);
      requestAnimationFrame(frame);
    }
    function refresh(){ measure(); build(0); draw(performance.now()); }
    return {
      geom:refresh, fire:fire, burst:burst, state:setStateB,
      aim:function(s,e){ aimS=s; aimE=e; },
      settle:function(){},
      start:function(){ if(reduce||running) return; running=true; requestAnimationFrame(frame); },
      setStatic:function(v){ surge=v; surgeTarget=v; },
      kick:function(v){ if(!reduce) surge=Math.max(surge,v||.9); }
    };
  })();

  /* ---------- timeline (from zero, every loop) ---------- */
  /* v6: every await goes through sleep(); bumping `gen` aborts the running loop at its next tick (used by edit mode) */
  var gen=0, ABORT={abort:true};
  function sleep(ms){ var g=gen; return new Promise(function(r){setTimeout(r,ms);}).then(function(){ if(g!==gen) throw ABORT; }); }
  function charDelay(c,fast){ if(c===' ') return 8; if(/[\u4e00-\u9fff，。·]/.test(c)) return 36+Math.random()*26; return fast?(7+Math.random()*6):(11+Math.random()*13); }
  async function typeAll(){
    for(var i=0;i<LINES.length;i++){
      var s=LINES[i][0]; setCur(i);
      while(typed[i]<s.length){
        await sleep(charDelay(s[typed[i]], !LINES[i][1]));
        typed[i]++; renderLine(i,true); syncBlock(i);
      }
      setCharge((i+1)/LINES.length);
      await sleep(LINES[i][1]?130:40);
    }
  }
  async function deploy(){
    setCur(-1);
    var cmd='demox deploy ./dist';
    for(var k=1;k<=cmd.length;k++){ term([PROMPT+'<span class="w">'+cmd.slice(0,k)+'</span><i class="caret"></i>']); await sleep(18+Math.random()*22); }
    await sleep(160);
    setState('deploying');
    var head=PROMPT+'<span class="w">'+cmd+'</span>';
    term([head,'<span class="dim">打包资源...</span>']);
    await sleep(520);
    term([head,'<span class="dim">打包资源...</span> 完成 (0.4s)','<span class="dim">上传至边缘网络...</span>']);
    await sleep(820);
    term([head,'<span class="dim">上传至边缘网络...</span> 完成 (1.2s)','<span class="ok">✓ 成功！已部署至：</span><span class="w">'+URL_LIVE.replace('https://','')+'</span>']);
    setState('live'); pageRefresh();
  }
  async function clearAll(){
    setState('editing'); setCharge(0); lastBlock=null;
    for(var i=LINES.length-1;i>=0;i--){
      typed[i]=0; lineEls[i].classList.remove('cur'); renderLine(i,false); syncBlock(i);
      scrollCode(); await sleep(22);
    }
    cur=-1; termIdle(); setCur(0);
  }
  async function loop(){
    try{
      while(true){
        await typeAll();
        await sleep(280);
        await deploy();
        await sleep(2800);
        await clearAll();
        await sleep(60);
      }
    }catch(e){ if(e!==ABORT) throw e; }
  }

  /* ---------- first frame: frames visible, editor empty with caret, typing starts at t=0 ---------- */
  for(var i=0;i<LINES.length;i++){
    typed[i] = reduce ? LINES[i][0].length : 0;
    renderLine(i,false); syncBlock(i);
  }
  Beam.geom();
  if(reduce){
    setState('live'); setCharge(1); Beam.setStatic(.35);
    termStatic();
    scrollCode(); Beam.geom();
  } else {
    setState('editing'); termIdle(); setCur(0); setCharge(0);
  }
  requestAnimationFrame(function(){requestAnimationFrame(function(){html.classList.remove('init');});});
  __on(window,'resize',function(){Beam.geom(); scrollCode(); if(editing){ metrics(); syncScroll(); }});
  var stage=$id('stage');
  stage.addEventListener('transitionend',function(e){ if(e.target.classList.contains('tilt')) Beam.geom(); });
  if(!reduce){ Beam.start(); loop(); }

  /* ---------- interaction: hover a code line ↔ its block; gentle parallax ---------- */
  function hl(b,on){
    if(!b) return;
    if(blocks[b]) blocks[b].classList.toggle('hl',on);
    lineEls.forEach(function(l){ if(l.getAttribute('data-b')===b) l.classList.toggle('hl',on); });
  }
  linesEl.addEventListener('mouseover',function(e){var l=e.target.closest('.ln');hl(l&&l.getAttribute('data-b'),true);});
  linesEl.addEventListener('mouseout',function(e){var l=e.target.closest('.ln');hl(l&&l.getAttribute('data-b'),false);});
  $id('page').addEventListener('mouseover',function(e){var b=e.target.closest('.blk');hl(b&&b.getAttribute('data-b'),true);});
  $id('page').addEventListener('mouseout',function(e){var b=e.target.closest('.blk');hl(b&&b.getAttribute('data-b'),false);});
  if(!reduce && window.matchMedia('(hover:hover) and (pointer:fine)').matches){
    var raf=0;
    __on(window,'pointermove',function(e){
      if(window.matchMedia('(max-width:900px)').matches||raf||editing) return;
      raf=requestAnimationFrame(function(){
        raf=0;
        var nx=e.clientX/window.innerWidth-.5, ny=e.clientY/window.innerHeight-.5;
        stage.style.setProperty('--ry-l',(6+nx*3).toFixed(2)+'deg');
        stage.style.setProperty('--ry-r',(-6+nx*3).toFixed(2)+'deg');
        stage.style.setProperty('--rx',(2-ny*2).toFixed(2)+'deg');
        Beam.settle(700);
      });
    });
  }

  /* =====================================================================
     v6-interactive · edit mode
     Click/tap the editor (or the 「点击编辑器，自己写一段」 button): autoplay stops at once,
     the code typed so far becomes a real <textarea> (transparent text over a highlighted
     <pre>, same mono metrics), caret where you clicked. Each edit renders your HTML in a
     sandboxed iframe (srcdoc, sandbox="allow-scripts" only — opaque origin, no
     allow-same-origin; nothing is ever eval'd in this page) and fires the beam like a deploy.
     ===================================================================== */
  var editing=false, dirty=false, baseText='', upT=0, idleT=0, confirmT=0, pvFrame=null, LH=20, Z=1;
  var hintBtn=$id('s1Hint'), resumeBtn=$id('s1Resume'), resumeT=$id('s1ResumeT'),
      liveEl=$id('s1Live'), ta=$id('s1Ta'), preEl=$id('s1Pre'),
      gutEl=$id('s1Gut'), curEl=$id('s1Cur'), outEl=$id('s1Out'), outBar=$id('s1Bar');
  var MQ_SMALL=window.matchMedia('(max-width:760px)'), MQ_COARSE=window.matchMedia('(pointer:coarse)');

  /* metrics: on phones/touch the textarea is 16px (no iOS focus-zoom) and scaled down to the visual 12–13px */
  function metrics(){
    var small=MQ_SMALL.matches, fs=small?12:13, lh=small?19:20, gw=small?34:42, gp=small?10:14;
    Z=(small||MQ_COARSE.matches)?fs/16:1;
    var st=liveEl.style;
    st.setProperty('--s1z',String(Z)); st.setProperty('--s1fs',(fs/Z)+'px'); st.setProperty('--s1lh',(lh/Z)+'px');
    st.setProperty('--s1gw',(gw/Z)+'px'); st.setProperty('--s1gp',(gp/Z)+'px'); st.setProperty('--s1pt',(12/Z)+'px');
    LH=lh/Z;
  }
  function currentText(){
    var last=cur; for(var i=typed.length-1;i>last;i--){ if(typed[i]>0){ last=i; break; } }
    var rows=[]; for(var j=0;j<=last;j++) rows.push(LINES[j][0].slice(0,typed[j]));
    return rows.join('\n');
  }
  /* map the click point on the animated lines to an offset in that text */
  function caretFromPoint(x,y,text){
    var rows=text.split('\n'), node=null, off=0, row=-1, col=0;
    try{
      if(document.caretRangeFromPoint){ var r=document.caretRangeFromPoint(x,y); if(r){ node=r.startContainer; off=r.startOffset; } }
      else if(document.caretPositionFromPoint){ var p=document.caretPositionFromPoint(x,y); if(p){ node=p.offsetNode; off=p.offset; } }
    }catch(e){ node=null; }
    var el=node&&(node.nodeType===1?node:node.parentNode), ln=el&&el.closest?el.closest('.ln'):null;
    if(ln && linesEl.contains(ln)){
      row=lineEls.indexOf(ln); var src=ln.lastChild;
      if(node.nodeType===3 && src.contains(node)){
        var w=document.createTreeWalker(src,NodeFilter.SHOW_TEXT), n, c=0;
        while((n=w.nextNode())){ if(n===node){ c+=off; break; } c+=n.nodeValue.length; }
        col=c;
      } else col = (x>src.getBoundingClientRect().left) ? Infinity : 0;
    }
    if(row<0){            /* fell between / below lines: pick by y */
      var vis=lineEls.filter(function(l){ return l.style.display!=='none'; });
      row=rows.length-1; col=Infinity;
      for(var k=0;k<vis.length;k++){ var rc=vis[k].getBoundingClientRect(); if(y<rc.bottom){ row=lineEls.indexOf(vis[k]); col=(x>rc.left+40)?Infinity:0; break; } }
    }
    row=Math.max(0,Math.min(rows.length-1,row));
    col=Math.min(col,(rows[row]||'').length);
    var pos=0; for(var q=0;q<row;q++) pos+=rows[q].length+1;
    return pos+col;
  }
  function hlLine(line){ return tokenize(line).map(function(t){ return '<span class="'+t[1]+'">'+esc(t[0])+'</span>'; }).join(''); }
  function renderHL(){
    var rows=ta.value.split('\n'), g='';
    preEl.innerHTML=rows.map(hlLine).join('\n')+'\n ';
    for(var i=1;i<=rows.length;i++) g+=i+'\n';
    gutEl.textContent=g;
  }
  function caretRow(){ return ta.value.slice(0,ta.selectionStart||0).split('\n').length-1; }
  function updateCur(){ curEl.style.transform='translateY('+(caretRow()*LH-ta.scrollTop)+'px)'; }
  function syncScroll(){
    var t=ta.scrollTop, l=ta.scrollLeft;
    preEl.style.transform='translate('+(-l)+'px,'+(-t)+'px)';
    gutEl.style.transform='translateY('+(-t)+'px)';
    updateCur();
  }
  function keepCaretVisible(){
    var r=caretRow(), top=r*LH, pad=12/Z, h=ta.clientHeight;
    if(top<ta.scrollTop) ta.scrollTop=top;
    else if(top+LH+pad*2>ta.scrollTop+h) ta.scrollTop=top+LH+pad*2-h;
  }

  /* ---- sandboxed preview ---- */
  var COVER="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='120' viewBox='0 0 600 120'%3E%3Crect width='600' height='120' fill='%23f6efe4'/%3E%3Ccircle cx='480' cy='60' r='44' fill='%23d9c3a5'/%3E%3Cpath d='M452 52h56l-16 28h-24z' fill='%23c8742c'/%3E%3Cpath d='M456 82h48c0 18-8 30-24 30s-24-12-24-30z' fill='%23fbf7f0'/%3E%3C/svg%3E";
  var BASE='<!doctype html><html><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; font-src data:">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
    'html{background:#f6efe4}body{margin:0;padding:12px 18px 10px;font:13px/1.6 ui-sans-serif,system-ui,sans-serif,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC";color:#2b1d14;background:radial-gradient(45% 55% at 82% 58%,rgba(217,195,165,.45),transparent 72%),#f6efe4;-webkit-font-smoothing:antialiased}'+
    'nav{display:flex;align-items:center;gap:12px;font-size:12px;color:#5a3d29;padding-bottom:10px;border-bottom:1px solid rgba(43,29,20,.1);margin:0 -18px 10px;padding-left:18px;padding-right:18px}nav b{font:700 15px/1 Georgia,"Times New Roman","Songti SC","Noto Serif SC",serif;color:#2b1d14;letter-spacing:-.01em;margin-right:auto}'+
    '.eyebrow,span.eyebrow{display:block;font-size:10px;letter-spacing:.18em;color:#8a6446;margin-bottom:6px}'+
    'h1{font:700 22px/1.15 "Songti SC","STSong","Noto Serif SC","Noto Serif CJK SC",Georgia,serif;letter-spacing:.04em;margin:0;color:#2b1d14}p{font-size:12px;color:#6f5a49;margin:6px 0 0;letter-spacing:.03em}'+
    'button{margin-top:10px;font:600 12px/1 inherit;color:#fff;background:#c8742c;border:0;border-radius:999px;padding:9px 16px;cursor:pointer;box-shadow:0 8px 18px -8px rgba(200,116,44,.75);letter-spacing:.04em}'+
    'img{display:block;max-width:100%}img.cover{width:100%;height:86px;margin-top:12px;border-radius:12px;object-fit:cover;background:#d9c3a5}'+
    '.pour,div.pour{position:relative;height:100px;margin-top:8px;border-radius:50%;width:100px;margin-left:auto;margin-right:0;background:radial-gradient(circle at 35% 30%,#ecd9bd,#d9c3a5 55%,#c9ab86)}'+
    '.pour::before{content:"";position:absolute;left:50%;top:14%;width:36%;height:18%;margin-left:-18%;background:linear-gradient(135deg,#e7b98a,#c8742c);clip-path:polygon(0 0,100% 0,72% 100%,28% 100%)}'+
    '.pour::after{content:"";position:absolute;left:50%;top:48%;width:48%;height:32%;margin-left:-28%;border-radius:4px 4px 40% 40%;background:#fbf7f0;box-shadow:14px 4px 0 -2px #fbf7f0}'+
    'ul{list-style:none;margin:10px 0 0;padding:0}ul.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}'+
    'ul.cards li{border:1px solid rgba(43,29,20,.12);border-radius:10px;padding:9px 10px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#fbf7f0;font-family:"Songti SC","Noto Serif SC",Georgia,serif}'+
    'footer{margin-top:10px;font-size:10px;color:#6f5a49}a{color:inherit}'+
    '@media (max-width:420px){body{padding:10px 14px 10px}h1{font-size:18px}ul.cards{gap:6px}ul.cards li{font-size:10px;padding:7px}}'+
    '</style></head><body>';
  function buildDoc(src){ return BASE+src.replace(/(src\s*=\s*["']?)beans\.jpg/gi,'$1'+COVER); }
  function render(fx){
    var f=document.createElement('iframe');
    f.className='s1-frame'; f.setAttribute('sandbox','allow-scripts'); f.setAttribute('title','你的代码 · 实时预览');
    f.setAttribute('tabindex','-1'); f.setAttribute('referrerpolicy','no-referrer');
    f.srcdoc=buildDoc(ta.value);              // set before insertion: no history entries, and the old frame stays up until the new one has loaded
    pvFrame=f;
    f.addEventListener('load',function(){
      if(pvFrame!==f){ f.remove(); return; }
      f.classList.add('on');
      [].forEach.call(outEl.querySelectorAll('iframe'),function(x){ if(x!==f) x.remove(); });
    });
    outEl.appendChild(f);
    if(fx){
      outBar.classList.remove('go'); void outBar.offsetWidth; outBar.classList.add('go');
      Beam.kick(.9);
      Beam.fire({size:3.4, trail:150, dur:520, onArrive:function(){ Beam.burst(1); outEl.classList.add('land'); setTimeout(function(){ outEl.classList.remove('land'); },160); }});
      termEdit(true);
    }
  }
  function termEdit(updated){
    term([PROMPT+'<span class="w">npm run dev</span>', updated
      ? '<span class="ok">✓</span> <span class="w">index.html</span> 已更新 <span class="dim">· 右侧实时预览</span>'
      : '<span class="dim">VITE ready ·</span> localhost:5173 <span class="dim">· 热更新已开启</span>']);
  }
  function armIdle(){ clearTimeout(idleT); idleT=setTimeout(function(){ if(editing && !dirty) exitEdit(true); },20000); }
  function resetResume(){ clearTimeout(confirmT); resumeBtn.classList.remove('warn'); resumeT.textContent='继续演示'; }

  function enterEdit(x,y){
    if(editing) return;
    var text=currentText(), pos=(x==null)?text.length:caretFromPoint(x,y,text), off=linesOff;
    editing=true; dirty=false; baseText=text; gen++;          // gen++ → the autoplay loop stops at its next tick
    root.classList.add('s1-edit');
    setState('editing'); setCharge(1); termEdit(false);
    metrics();
    ta.value=text; renderHL();
    try{ ta.focus({preventScroll:true}); }catch(e){ ta.focus(); }   // synchronous, inside the tap → iOS opens the keyboard
    ta.setSelectionRange(pos,pos);
    ta.scrollTop=off/Z; keepCaretVisible(); syncScroll();
    render(false);
    Beam.aim(curEl,outEl);
    armIdle();
  }
  function exitEdit(auto){
    if(!editing) return;
    var hadFocus=liveEl.contains(document.activeElement)||document.activeElement===resumeBtn;
    editing=false; dirty=false; clearTimeout(upT); clearTimeout(idleT); resetResume();
    root.classList.remove('s1-edit');
    [].forEach.call(outEl.querySelectorAll('iframe'),function(x){ x.remove(); }); pvFrame=null;
    ta.value=''; preEl.textContent=''; gutEl.textContent='';
    if(hadFocus && !auto){ try{ hintBtn.focus({preventScroll:true}); }catch(e){} }
    gen++;
    if(cur>=0 && lineEls[cur]) lineEls[cur].classList.remove('cur');
    cur=-1; lastBlock=null;
    for(var i=0;i<LINES.length;i++){ typed[i]=reduce?LINES[i][0].length:0; renderLine(i,false); syncBlock(i); }
    if(reduce){ setState('live'); setCharge(1); termStatic(); scrollCode(); Beam.geom(); }
    else { setState('editing'); termIdle(); setCur(0); setCharge(0); loop(); }
  }

  codeEl.addEventListener('click',function(e){ if(!editing) enterEdit(e.clientX,e.clientY); });
  hintBtn.addEventListener('click',function(){ enterEdit(null,null); });
  resumeBtn.addEventListener('click',function(){
    if(dirty && !resumeBtn.classList.contains('warn')){        // never wipe edits silently: second click confirms
      resumeBtn.classList.add('warn'); resumeT.textContent='放弃修改？再点一次';
      clearTimeout(confirmT); confirmT=setTimeout(resetResume,3500); return;
    }
    exitEdit(false);
  });
  ta.addEventListener('input',function(){
    dirty = ta.value!==baseText;
    renderHL(); syncScroll(); resetResume();
    clearTimeout(upT); upT=setTimeout(function(){ if(editing) render(true); },300);
    armIdle();
  });
  ta.addEventListener('scroll',syncScroll);
  ta.addEventListener('pointerdown',armIdle);
  __on(document,'selectionchange',function(){ if(editing && document.activeElement===ta) updateCur(); });
  function insertText(t){
    var ok=false; try{ ok=document.execCommand('insertText',false,t); }catch(e){}
    if(!ok){ ta.setRangeText(t,ta.selectionStart,ta.selectionEnd,'end'); ta.dispatchEvent(new Event('input')); }
  }
  function outdent(){
    var v=ta.value, a=ta.selectionStart, b=ta.selectionEnd, ls=v.lastIndexOf('\n',a-1)+1, n=0;
    while(n<2 && v[ls+n]===' ') n++;
    if(!n) return;
    ta.setSelectionRange(ls,ls+n);
    var ok=false; try{ ok=document.execCommand('delete'); }catch(e){}
    if(!ok){ ta.setRangeText('',ls,ls+n,'start'); ta.dispatchEvent(new Event('input')); }
    ta.setSelectionRange(Math.max(ls,a-n),Math.max(ls,b-n));
  }
  ta.addEventListener('keydown',function(e){
    if(e.key==='Tab' && !e.altKey && !e.ctrlKey && !e.metaKey){ e.preventDefault(); if(e.shiftKey) outdent(); else insertText('  '); }
    else if(e.key==='Escape'){ e.preventDefault(); resumeBtn.focus(); }
    armIdle();
  });

  __cleanup=function(){ try{ gen++; }catch(_){} };
  })();
  return function(){ __dead=true; __L.forEach(function(x){ x[0].removeEventListener(x[1],x[2],x[3]); }); __cleanup(); };
}
