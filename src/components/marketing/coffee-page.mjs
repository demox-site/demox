/**
 * Single source of truth for the sample coffee page.
 * Used by: homepage Screen 1 (typed code + preview), the gallery card,
 * and scripts/build-coffee-site.mjs → coffee.demox.site (site-build coffee-v2).
 * All content is fictional sample content (no real address / phone).
 */

// [code, blockId, selector inside .cf, progressive-text?]
export const COFFEE_LINES = [
  ['<nav class="nav">'],
  ['  <b class="logo">Coffee<i>.</i></b>', 'logo', '.logo'],
  ['  <a href="#beans">菜单</a> <a href="#visit">门店</a>', 'links', '.nav .lk'],
  ['  <a class="pill" href="#visit">预订</a>', 'pill', '.pill'],
  ['</nav>'],
  ['<section class="hero">'],
  ['  <div class="copy">'],
  ['  <span class="eyebrow">手冲咖啡馆 · 每日现烘</span>', 'ey', '.eyebrow', true],
  ['  <h1>好咖啡，<em>慢慢来</em></h1>', 'h1', '.hero h1'],
  ['  <p>每天清晨现烘，一杯一杯手冲。</p>', 'p', '.hero p', true],
  ['  <a class="btn" href="#visit">预订座位</a>', 'btn', '.btn:not(.ghost)', true],
  ['  <a class="btn ghost" href="#beans">看看今日豆单</a>', 'ghost', '.btn.ghost', true],
  ['  <div class="pour" aria-hidden="true"><i></i></div>', 'pour', '.pour'],
  ['</section>'],
  ['<section class="beans" id="beans">'],
  ['  <h2>今日豆单</h2>', 'h2', '.beans h2', true],
  ['  <article><h3>云南日晒</h3><p>莓果 · 红糖</p><b>¥38</b></article>', 'b1', '.beans article:nth-of-type(1)'],
  ['  <article><h3>埃塞俄比亚水洗</h3><p>茉莉 · 柑橘</p><b>¥42</b></article>', 'b2', '.beans article:nth-of-type(2)'],
  ['  <article><h3>哥伦比亚蜜处理</h3><p>焦糖 · 可可</p><b>¥36</b></article>', 'b3', '.beans article:nth-of-type(3)'],
  ['</section>'],
  ['<p class="visit" id="visit">门店 · 每天 08:00–20:00</p>', 'visit', '.visit', true],
  ['<footer>© 2026 Coffee. · 示例网站</footer>', 'foot', 'footer', true],
];

/** The typed source (what the editor shows) */
export const COFFEE_BODY = COFFEE_LINES.map((l) => l[0]).join('\n');

/** Markup actually rendered: same body, nav links wrapped so they can be revealed as one block */
export function renderBody(src = COFFEE_BODY) {
  return src.replace(
    /(<a href="#beans">菜单<\/a> <a href="#visit">门店<\/a>)/,
    '<span class="lk">$1</span>'
  );
}

/** Shared stylesheet. Responsive via a container query on .cq so the scaled
 *  homepage preview and the real site switch layouts identically. */
export const COFFEE_CSS = `
.cq{container-type:inline-size;container-name:cf}
.cf{--cream:#f6efe4;--paper:#fbf7f0;--latte:#d9c3a5;--mocha:#8a6446;--brown:#5a3d29;--espresso:#2b1d14;--muted:#6f5a49;--accent:#c8742c;--accent-deep:#a95d1f;--line:rgba(43,29,20,.12);
  --serif:"Songti SC","STSong","Noto Serif SC","Noto Serif CJK SC","Source Han Serif SC",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Noto Sans CJK SC",system-ui,-apple-system,"Segoe UI",sans-serif;
  font-family:var(--sans);color:var(--espresso);line-height:1.7;font-size:16px;-webkit-font-smoothing:antialiased;
  background:radial-gradient(40% 46% at 80% 26%,rgba(217,195,165,.55),transparent 72%),var(--cream);min-height:100%}
.cf *{box-sizing:border-box}
.cf a{color:inherit;text-decoration:none}
.cf h1,.cf h2,.cf h3{font-family:var(--serif);font-weight:700;margin:0;letter-spacing:.03em;line-height:1.2}
.cf p{margin:0}
.cf .nav{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:28px;height:68px;padding:0 48px;background:rgba(246,239,228,.9);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line);font-size:15px;color:var(--brown)}
.cf .logo{font:700 26px/1 Georgia,"Times New Roman",var(--serif);color:var(--espresso);margin-right:auto;letter-spacing:-.01em}
.cf .logo i{font-style:normal;color:var(--accent)}
.cf .lk{display:flex;gap:28px}
.cf .pill{background:var(--espresso);color:var(--cream);padding:7px 18px;border-radius:999px;font-size:14px}
.cf .hero{display:grid;grid-template-columns:1.15fr .85fr;align-items:center;gap:40px;padding:64px 48px 56px;max-width:1120px;margin:0 auto}
.cf .eyebrow{display:block;font-size:13px;letter-spacing:.24em;color:var(--mocha);margin-bottom:18px}
.cf .hero h1{font-size:76px;line-height:1.12;letter-spacing:.04em}
.cf .hero h1 em{font-style:normal;color:var(--accent);display:block}
.cf .hero p{margin-top:18px;font-size:19px;color:var(--muted);letter-spacing:.06em}
.cf .btn{display:inline-flex;align-items:center;margin:30px 12px 0 0;padding:14px 28px;border-radius:999px;font-weight:600;font-size:16px;letter-spacing:.06em;background:var(--accent);color:#fff;box-shadow:0 10px 24px -10px rgba(200,116,44,.75)}
.cf .btn.ghost{background:transparent;color:var(--brown);border:1.5px solid rgba(90,61,41,.3);box-shadow:none}
.cf .pour{position:relative;justify-self:center;width:320px;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ecd9bd,#d9c3a5 55%,#c9ab86);box-shadow:inset 0 -18px 50px rgba(90,61,41,.18)}
.cf .pour::before{content:"";position:absolute;left:50%;top:16%;width:34%;height:20%;margin-left:-17%;background:linear-gradient(135deg,#e7b98a,#c8742c 60%,#8f4a1d);clip-path:polygon(0 0,100% 0,72% 100%,28% 100%);border-radius:4px 4px 0 0}
.cf .pour::after{content:"";position:absolute;left:50%;top:48%;width:46%;height:30%;margin-left:-26%;border-radius:6px 6px 44% 44%;background:var(--paper);box-shadow:0 14px 24px -12px rgba(43,29,20,.4)}
.cf .pour i{position:absolute;left:50%;top:51%;width:16%;height:16%;margin-left:16%;border-radius:50%;border:9px solid var(--paper);z-index:1}
.cf .beans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding:24px 48px 40px;max-width:1120px;margin:0 auto}
.cf .beans h2{grid-column:1/-1;font-size:36px;margin-bottom:4px}
.cf .beans article{background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:22px 24px;display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:baseline}
.cf .beans article::before{content:"";grid-column:1/-1;height:6px;width:40%;border-radius:6px;background:linear-gradient(90deg,var(--latte),var(--accent));margin-bottom:12px}
.cf .beans h3{font-size:21px}
.cf .beans article p{grid-column:1;font-size:14px;color:var(--muted)}
.cf .beans article b{grid-column:2;grid-row:2/4;font-family:var(--serif);font-size:22px;color:var(--accent-deep)}
.cf .visit{max-width:1120px;margin:0 auto;padding:18px 48px;font-size:15px;color:var(--brown);border-top:1px dashed var(--line)}
.cf footer{max-width:1120px;margin:0 auto;padding:10px 48px 36px;font-size:13px;color:var(--muted)}
@container cf (max-width:720px){
  .cf .nav{gap:16px;height:58px;padding:0 20px;font-size:14px}
  .cf .logo{font-size:22px}
  .cf .lk{gap:16px}
  .cf .pill{padding:5px 14px;font-size:13px}
  .cf .hero{grid-template-columns:1fr;gap:24px;padding:36px 20px 28px}
  .cf .eyebrow{font-size:11px;letter-spacing:.18em;margin-bottom:12px}
  .cf .hero h1{font-size:44px}
  .cf .hero p{font-size:16px;margin-top:12px}
  .cf .btn{margin-top:22px;padding:12px 20px;font-size:15px}
  .cf .pour{width:200px;order:-1}
  .cf .beans{grid-template-columns:1fr;gap:12px;padding:16px 20px 28px}
  .cf .beans h2{font-size:28px}
  .cf .beans article{padding:16px 18px;border-radius:16px}
  .cf .visit,.cf footer{padding-left:20px;padding-right:20px}
}
`;

/** Full HTML for the real site (coffee.demox.site) */
export function coffeeSiteDocument() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="site-build" content="coffee-v2">
<title>Coffee. 好咖啡，慢慢来</title>
<meta name="description" content="Coffee. 示例网站：每天清晨现烘，一杯一杯手冲。用 Demox 发布。">
<meta name="theme-color" content="#f6efe4">
<link rel="canonical" href="https://coffee.demox.site/">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%232b1d14'/%3E%3Cpath d='M13 26h32v8c0 9-7 16-16 16s-16-7-16-16z' fill='%23f6efe4'/%3E%3Crect x='10' y='52' width='38' height='4' rx='2' fill='%23c8742c'/%3E%3C/svg%3E">
<style>html,body{margin:0;background:#f6efe4;scroll-behavior:smooth}${COFFEE_CSS}</style>
</head>
<body>
<div class="cq"><div class="cf">
${renderBody()}
</div></div>
</body>
</html>
`;
}

/** Sandboxed srcdoc for the homepage edit mode (strict CSP, allow-scripts iframe only) */
export function coffeeSandboxDocument(src) {
  const csp = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#f6efe4}${COFFEE_CSS}</style></head><body><div class="cq"><div class="cf">${renderBody(src)}</div></div></body></html>`;
}
