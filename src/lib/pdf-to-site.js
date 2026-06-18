/**
 * pdf-to-site.js
 * 把用户上传的 PDF 在浏览器端用 pdf.js 逐页渲染成图片，
 * 生成一个「画册式」网页 index.html，连同逐页图片与原始 PDF 一起打包成 .zip File。
 *
 * 与旧版差异：旧版只用 <iframe> 套浏览器原生 PDF 阅读器，
 * 现在变成真正的网页文档——套用 demox stitch 设计语言、移动端友好、
 * 保留原始 PDF 作为可下载资源，保真度 100%。
 *
 * 解析/渲染全部在浏览器端完成，后端无需改动：产物就是一个根目录含 index.html 的标准 zip。
 */
import * as pdfjsLib from "pdfjs-dist";
// Vite 会把 worker 文件作为独立资源打包，?url 拿到其最终 URL
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import JSZip from "jszip";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** 支持的扩展名（用于 input accept 与校验） */
export const SUPPORTED_PDF_EXTENSIONS = [".pdf"];

/** 取小写扩展名（含点），无扩展名返回空串 */
const extOf = (name) => {
  const i = String(name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

/** 判断文件是否为受支持的 PDF */
export const isSupportedPdf = (file) =>
  !!file && SUPPORTED_PDF_EXTENSIONS.includes(extOf(file.name));

/** 去掉扩展名作为默认标题 */
const stripExt = (name) => {
  const i = String(name || "").lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : String(name || "");
};

/** HTML 转义，把标题安全放进 <title> 与可见标题 */
const escapeHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * 纯 ASCII 的资源文件名片段：仅保留字母数字与连字符，避免 href 编码问题。
 * 与 doc-to-site 的 safeSlug 不同，这里刻意丢弃中文，确保文件名与链接安全。
 */
const asciiSlug = (name) =>
  stripExt(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "document";

/** 三位补零页码，用于图片文件名 */
const pad3 = (n) => String(n).padStart(3, "0");

/** 读 File 为 ArrayBuffer */
const readArrayBuffer = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });

/** canvas 转 JPEG Blob，quality 0.85 在清晰度与体积间取平衡 */
const canvasToJpegBlob = (canvas, quality = 0.85) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality
    );
  });

/**
 * renderPdfToImages
 * 用 pdf.js 逐页渲染 PDF 为 JPEG Blob 数组。
 * @param {File} file
 * @param {{ scale?:number, onProgress?:(current:number,total:number)=>void }} [opts]
 * @returns {Promise<{ pages: { blob:Blob, width:number, height:number }[], numPages:number }>}
 */
async function renderPdfToImages(file, opts = {}) {
  const scale = opts.scale ?? 1.5;
  const data = await readArrayBuffer(file);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const pages = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    // 白底，避免透明 PDF 页渲染出黑色
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvasToJpegBlob(canvas);
    pages.push({ blob, width: canvas.width, height: canvas.height });
    page.cleanup();
    if (opts.onProgress) opts.onProgress(i, numPages);
  }
  await pdf.cleanup();
  await pdf.destroy();
  return { pages, numPages };
}

/**
 * renderGalleryHtml
 * 增强画册式预览页：
 * - sticky 顶栏（标题 + 当前页/总页 + 视图切换 + 全屏 + 下载）
 * - 左侧缩略图侧栏（可折叠，点击跳页，当前页高亮）
 * - 两种视图：连续滚动（默认）/ 单页翻页
 * - 键盘快捷键：← → 翻页、F 全屏、T 切换缩略图、V 切换视图
 * - 全屏演示模式（黑底居中，触摸/键盘翻页）
 * - 底部进度条
 * 套用 demox stitch 设计语言，移动端响应式。
 * @param {{ title:string, numPages:number, pdfName:string, pageNames:string[] }} o
 */
const renderGalleryHtml = ({ title, numPages, pdfName, pageNames }) => {
  const thumbs = pageNames
    .map(
      (name, i) =>
        `<button type="button" class="thumb" data-page="${i}" title="第 ${i + 1} 页"><img src="${name}" alt="" loading="lazy" /><span class="thumb-no">${i + 1}</span></button>`
    )
    .join("\n");

  const pages = pageNames
    .map(
      (name, i) =>
        `<div class="page" data-page="${i}"><span class="page-no">${i + 1} / ${numPages}</span><img src="${name}" alt="第 ${i + 1} 页" loading="lazy" /></div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<title>${escapeHtml(title)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{
    --bg:#f7f7f5;--surface:rgba(255,255,255,.84);--surface-strong:rgba(255,255,255,.96);
    --ink:#111;--muted:#696969;--line:rgba(17,17,17,.14);--blue-soft:rgba(17,17,17,.07);
    --shadow:0 24px 70px rgba(0,0,0,.11);--radius:12px;
    --font:"Google Sans Text","Google Sans",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
    --bar-h:56px;--rail-w:200px;
  }
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:linear-gradient(180deg,var(--bg),#fff 42%,var(--bg));color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-x:hidden}

  /* 顶栏 */
  .bar{position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:.6rem;padding:0 .85rem;height:var(--bar-h);background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(180%) blur(12px);-webkit-backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--line)}
  .bar .menu-btn{display:none;flex:0 0 auto;width:36px;height:36px;border:1px solid var(--line);border-radius:8px;background:var(--surface-strong);cursor:pointer;align-items:center;justify-content:center;color:var(--ink)}
  .bar .menu-btn:hover{background:var(--blue-soft)}
  .bar .menu-btn svg{width:18px;height:18px}
  .bar .title{font-size:.92rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto}
  .bar .counter{font-family:var(--mono);font-size:.72rem;color:var(--muted);flex:0 0 auto;min-width:64px;text-align:center}
  .bar .counter b{color:var(--ink);font-weight:600}
  .bar .actions{display:flex;gap:.4rem;flex:0 0 auto}
  .bar .btn{display:inline-flex;align-items:center;justify-content:center;gap:.35rem;font-size:.78rem;color:var(--ink);text-decoration:none;padding:.38rem .7rem;border:1px solid var(--line);border-radius:999px;background:var(--surface-strong);cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap;font-family:var(--font)}
  .bar .btn:hover{background:var(--blue-soft);border-color:var(--ink)}
  .bar .btn svg{width:14px;height:14px}
  .bar .btn.icon-only{padding:.38rem .5rem}
  .bar .btn.active{background:var(--ink);color:#fff;border-color:var(--ink)}

  /* 主体布局 */
  .layout{display:flex;min-height:calc(100vh - var(--bar-h))}
  .rail{
    flex:0 0 var(--rail-w);position:sticky;top:var(--bar-h);height:calc(100vh - var(--bar-h));
    overflow-y:auto;overflow-x:hidden;border-right:1px solid var(--line);
    background:color-mix(in srgb,var(--bg) 60%,transparent);
    padding:.75rem .5rem;transition:margin-left .25s ease,opacity .25s ease
  }
  .rail.collapsed{margin-left:calc(-1 * var(--rail-w));opacity:0}
  .thumb{display:block;width:100%;border:2px solid transparent;border-radius:6px;overflow:hidden;cursor:pointer;background:var(--surface-strong);margin-bottom:.5rem;position:relative;transition:border-color .15s,transform .15s}
  .thumb:hover{transform:scale(1.02)}
  .thumb.active{border-color:var(--ink)}
  .thumb img{display:block;width:100%;height:auto;opacity:.82}
  .thumb.active img{opacity:1}
  .thumb-no{position:absolute;bottom:3px;right:3px;font-family:var(--mono);font-size:.6rem;color:#fff;background:rgba(0,0,0,.6);border-radius:4px;padding:1px 4px}

  /* 内容区 */
  .content{flex:1 1 auto;min-width:0}
  .pages-scroll{max-width:900px;margin:0 auto;padding:2rem 1rem 4rem;display:flex;flex-direction:column;gap:1.5rem}
  .page{position:relative;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:#fff;box-shadow:var(--shadow)}
  .page img{display:block;width:100%;height:auto}
  .page-no{position:absolute;top:.6rem;right:.6rem;font-family:var(--mono);font-size:.68rem;color:var(--ink);background:var(--surface-strong);border:1px solid var(--line);border-radius:999px;padding:.2rem .55rem;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}

  /* 单页模式 */
  body.single .pages-scroll{display:none}
  .single-view{display:none;align-items:center;justify-content:center;min-height:calc(100vh - var(--bar-h));padding:2rem 1rem}
  body.single .single-view{display:flex}
  .single-view .page{max-width:900px;width:100%}
  .nav-arrow{position:fixed;top:50%;transform:translateY(-50%);z-index:50;width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:var(--surface-strong);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--ink);transition:background .15s,opacity .15s;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .nav-arrow:hover{background:var(--blue-soft)}
  .nav-arrow:disabled{opacity:.3;cursor:default}
  .nav-arrow.prev{left:1rem}
  .nav-arrow.next{right:1rem}
  .nav-arrow svg{width:20px;height:20px}

  /* 进度条 */
  .progress{position:fixed;bottom:0;left:0;right:0;height:3px;background:transparent;z-index:90}
  .progress-bar{height:100%;background:var(--ink);width:0;transition:width .1s ease}

  /* 全屏演示 */
  .fullscreen{display:none;position:fixed;inset:0;z-index:200;background:#0a0a0a;align-items:center;justify-content:center}
  .fullscreen.open{display:flex}
  .fullscreen .fs-page{max-width:100vw;max-height:100vh;object-fit:contain;display:none}
  .fullscreen .fs-page.active{display:block}
  .fullscreen .fs-close{position:fixed;top:1rem;right:1rem;z-index:210;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)}
  .fullscreen .fs-close:hover{background:rgba(255,255,255,.15)}
  .fullscreen .fs-close svg{width:18px;height:18px}
  .fullscreen .fs-counter{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);z-index:210;font-family:var(--mono);font-size:.8rem;color:rgba(255,255,255,.7);background:rgba(0,0,0,.4);padding:.3rem 1rem;border-radius:999px;backdrop-filter:blur(8px)}
  .fullscreen .fs-arrow{position:fixed;top:50%;transform:translateY(-50%);z-index:210;width:48px;height:48px;border-radius:50%;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
  .fullscreen .fs-arrow:hover{background:rgba(255,255,255,.15)}
  .fullscreen .fs-arrow:disabled{opacity:.25;cursor:default}
  .fullscreen .fs-arrow.prev{left:1rem}
  .fullscreen .fs-arrow.next{right:1rem}
  .fullscreen .fs-arrow svg{width:22px;height:22px}

  .footer{text-align:center;font-size:.72rem;color:var(--muted);padding:1.5rem 1rem 3rem;font-family:var(--mono)}
  .footer a{color:var(--muted);text-decoration:underline;text-underline-offset:2px}

  @media(max-width:768px){
    :root{--rail-w:260px}
    .bar .menu-btn{display:flex}
    .bar .title{font-size:.85rem}
    .bar .btn span.label{display:none}
    .bar .btn{padding:.38rem .5rem}
    .rail{position:fixed;top:var(--bar-h);left:0;bottom:0;z-index:150;height:auto;background:var(--surface-strong);box-shadow:2px 0 20px rgba(0,0,0,.08)}
    .rail.collapsed{margin-left:calc(-1 * var(--rail-w))}
    .pages-scroll{padding:1rem .5rem 3rem;gap:1rem}
    .nav-arrow{width:36px;height:36px}
    .nav-arrow.prev{left:.5rem}
    .nav-arrow.next{right:.5rem}
  }
</style>
</head>
<body>

<div class="bar">
  <button class="menu-btn" id="menuBtn" title="缩略图 (T)" aria-label="切换缩略图">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  </button>
  <span class="title">${escapeHtml(title)}</span>
  <span class="counter"><b id="curPage">1</b> / ${numPages}</span>
  <span class="actions">
    <button class="btn icon-only" id="viewBtn" title="切换视图 (V)" aria-label="切换视图">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
    </button>
    <button class="btn icon-only" id="fsBtn" title="全屏演示 (F)" aria-label="全屏演示">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
    </button>
    <a class="btn" href="${pdfName}" download>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span class="label">PDF</span>
    </a>
  </span>
</div>

<div class="layout">
  <aside class="rail" id="rail">
    ${thumbs}
  </aside>
  <div class="content">
    <div class="pages-scroll" id="pagesScroll">
      ${pages}
    </div>
    <div class="single-view" id="singleView">
      <button class="nav-arrow prev" id="singlePrev" aria-label="上一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg></button>
      <div class="page" id="singlePage"><span class="page-no"></span><img id="singleImg" alt="" /></div>
      <button class="nav-arrow next" id="singleNext" aria-label="下一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></button>
    </div>
  </div>
</div>

<div class="progress"><div class="progress-bar" id="progressBar"></div></div>

<div class="fullscreen" id="fullscreen">
  <button class="fs-close" id="fsClose" aria-label="退出"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  <button class="fs-arrow prev" id="fsPrev" aria-label="上一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg></button>
  <img class="fs-page active" id="fsImg" alt="" />
  <button class="fs-arrow next" id="fsNext" aria-label="下一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg></button>
  <span class="fs-counter" id="fsCounter">1 / ${numPages}</span>
</div>

<div class="footer">由 <a href="https://demox.site" target="_blank" rel="noopener">demox</a> 部署</div>

<script>
(function(){
  var N=${numPages},cur=0,singleMode=false;
  var pages=[${pageNames.map(function(n){return '"'+n+'"'}).join(",")}];
  var scrollEl=document.getElementById('pagesScroll');
  var pageEls=scrollEl.querySelectorAll('.page');
  var rail=document.getElementById('rail');
  var thumbs=rail.querySelectorAll('.thumb');
  var curEl=document.getElementById('curPage');
  var progBar=document.getElementById('progressBar');
  var singleView=document.getElementById('singleView');
  var singleImg=document.getElementById('singleImg');
  var singleNo=singleView.querySelector('.page-no');
  var singlePrev=document.getElementById('singlePrev');
  var singleNext=document.getElementById('singleNext');
  var fs=document.getElementById('fullscreen');
  var fsImg=document.getElementById('fsImg');
  var fsCounter=document.getElementById('fsCounter');
  var fsPrev=document.getElementById('fsPrev');
  var fsNext=document.getElementById('fsNext');

  function setActive(i){
    cur=Math.max(0,Math.min(N-1,i));
    curEl.textContent=cur+1;
    progBar.style.width=((cur+1)/N*100)+'%';
    thumbs.forEach(function(t,idx){t.classList.toggle('active',idx===cur)});
    // 缩略图滚到可见
    var at=thumbs[cur];if(at&&rail)rail.scrollTop=at.offsetTop-rail.clientHeight/2+at.clientHeight/2;
    if(singleMode){singleImg.src=pages[cur];singleNo.textContent=(cur+1)+' / '+N;singlePrev.disabled=cur<=0;singleNext.disabled=cur>=N-1}
  }

  // 滚动追踪（连续模式）
  function onScroll(){
    if(singleMode)return;
    var st=window.scrollY+window.innerHeight*0.35;
    var best=0;
    for(var i=0;i<pageEls.length;i++){if(pageEls[i].offsetTop<=st)best=i;else break}
    if(best!==cur)setActive(best);
  }
  window.addEventListener('scroll',onScroll,{passive:true});

  // 跳转到某页（连续模式滚动 / 单页模式切换）
  function goTo(i){
    i=Math.max(0,Math.min(N-1,i));
    if(singleMode){setActive(i)}
    else{var el=pageEls[i];if(el)window.scrollTo({top:el.offsetTop-window.innerHeight*0.15,behavior:'smooth'});setActive(i)}
  }

  // 缩略图点击
  thumbs.forEach(function(t){t.addEventListener('click',function(){goTo(parseInt(t.dataset.page))})});

  // 视图切换
  function toggleView(){
    singleMode=!singleMode;
    document.body.classList.toggle('single',singleMode);
    document.getElementById('viewBtn').classList.toggle('active',singleMode);
    if(singleMode){setActive(cur)}
    else{goTo(cur)}
  }
  document.getElementById('viewBtn').addEventListener('click',toggleView);

  // 单页模式箭头
  singlePrev.addEventListener('click',function(){goTo(cur-1)});
  singleNext.addEventListener('click',function(){goTo(cur+1)});

  // 缩略图侧栏切换
  function toggleRail(){rail.classList.toggle('collapsed')}
  document.getElementById('menuBtn').addEventListener('click',toggleRail);

  // 全屏演示
  function openFs(){fsImg.src=pages[cur];fsCounter.textContent=(cur+1)+' / '+N;fsPrev.disabled=cur<=0;fsNext.disabled=cur>=N-1;fs.classList.add('open');document.body.style.overflow='hidden'}
  function closeFs(){fs.classList.remove('open');document.body.style.overflow='';fsImg.src=''}
  function fsGo(i){i=Math.max(0,Math.min(N-1,i));setActive(i);fsImg.src=pages[cur];fsCounter.textContent=(cur+1)+' / '+N;fsPrev.disabled=cur<=0;fsNext.disabled=cur>=N-1}
  document.getElementById('fsBtn').addEventListener('click',openFs);
  document.getElementById('fsClose').addEventListener('click',closeFs);
  fsPrev.addEventListener('click',function(){fsGo(cur-1)});
  fsNext.addEventListener('click',function(){fsGo(cur+1)});

  // 全屏触摸滑动
  var tx=0;
  fs.addEventListener('touchstart',function(e){tx=e.touches[0].clientX},{passive:true});
  fs.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>50){dx>0?fsGo(cur-1):fsGo(cur+1)}});

  // 键盘
  document.addEventListener('keydown',function(e){
    if(fs.classList.contains('open')){
      if(e.key==='ArrowLeft'){fsGo(cur-1);e.preventDefault()}
      else if(e.key==='ArrowRight'){fsGo(cur+1);e.preventDefault()}
      else if(e.key==='Escape'){closeFs()}
      return
    }
    if(e.key==='ArrowLeft'){goTo(cur-1);e.preventDefault()}
    else if(e.key==='ArrowRight'){goTo(cur+1);e.preventDefault()}
    else if(e.key==='f'||e.key==='F'){openFs();e.preventDefault()}
    else if(e.key==='t'||e.key==='T'){toggleRail();e.preventDefault()}
    else if(e.key==='v'||e.key==='V'){toggleView();e.preventDefault()}
  });

  // 初始化
  setActive(0);
  // 移动端默认折叠侧栏
  if(window.innerWidth<=768)rail.classList.add('collapsed');
})();
</script>
</body>
</html>`;
};

/**
 * buildPdfSiteZipFile
 * 逐页渲染 PDF 为图片，生成画册式 index.html，连同逐页图片与原始 PDF 打包成 .zip File，
 * 可直接交给 uploadZipFile。
 * @param {{ file:File, onProgress?:(current:number,total:number)=>void }} o
 * @returns {Promise<{ zipFile:File, title:string, numPages:number }>}
 */
export async function buildPdfSiteZipFile({ file, onProgress }) {
  if (!file) throw new Error("缺少文件");

  const title = stripExt(file.name) || "document";
  const slug = asciiSlug(file.name);
  const pdfName = `${slug}.pdf`;

  const { pages, numPages } = await renderPdfToImages(file, { onProgress });

  const pageNames = pages.map((_, i) => `page-${pad3(i + 1)}.jpg`);
  const html = renderGalleryHtml({ title, numPages, pdfName, pageNames });

  const zip = new JSZip();
  zip.file("index.html", html);
  pages.forEach((p, i) => {
    zip.file(pageNames[i], p.blob, { compression: "STORE" });
  });
  // 保留原始 PDF 作为可下载资源，STORE 避免重复压缩
  zip.file(pdfName, file, { compression: "STORE" });

  const blob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([blob], `${slug}.zip`, { type: "application/zip" });
  return { zipFile, title, numPages };
}
