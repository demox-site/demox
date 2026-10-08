/**
 * Single source of truth for the sample coffee page.
 * Used by: homepage Screen 1 (typed code + preview), the gallery card,
 * and scripts/build-coffee-site.mjs → coffee.demox.site (site-build coffee-v3).
 * All content is fictional sample content (no real address / phone).
 */

// [code, blockId, selector inside .cf, progressive-text?]
// zh is the original page (coffee.demox.site); en is used by the homepage hero when the UI language is English.
// Both variants must keep the same line count, block ids and selectors.
export const COFFEE_LINES_BY_LANG = {
  zh: [
  ['<nav class="nav">'],
  ['  <b class="logo">Coffee<i>.</i></b>', 'logo', '.logo'],
  ['  <a href="#beans">菜单</a> <a href="#visit">门店</a>', 'links', '.nav .lk'],
  ['  <a class="pill" href="#visit">预订</a>', 'pill', '.pill'],
  ['</nav>'],
  ['<section class="hero">'],
  ['  <div class="copy">'],
  ['  <span class="eyebrow">手冲咖啡馆 · 每日现烘</span>', 'ey', '.eyebrow', true],
  ['  <h1>好咖啡 <em>慢慢来</em></h1>', 'h1', '.hero h1'],
  ['  <p>每天清晨现烘，一杯一杯手冲。</p>', 'p', '.hero p', true],
  ['  <a class="btn" href="#visit">预订座位</a>', 'btn', '.btn:not(.ghost)', true],
  ['  <a class="btn ghost" href="#beans">看看今日豆单</a>', 'ghost', '.btn.ghost', true],
  ['  </div>'],
  ['  <div class="pour" aria-hidden="true"><i></i></div>', 'pour', '.pour'],
  ['</section>'],
  ['<section class="beans" id="beans">'],
  ['  <h2>今日豆单</h2>', 'h2', '.beans h2', true],
  ['  <article><small>云南 · 日晒</small><h3>保山小粒</h3><p>莓果 · 红糖</p><b>¥38</b></article>', 'b1', '.beans article:nth-of-type(1)'],
  ['  <article><small>埃塞俄比亚 · 水洗</small><h3>耶加雪菲</h3><p>茉莉 · 柑橘</p><b>¥42</b></article>', 'b2', '.beans article:nth-of-type(2)'],
  ['  <article><small>哥伦比亚 · 蜜处理</small><h3>慧兰</h3><p>焦糖 · 可可</p><b>¥36</b></article>', 'b3', '.beans article:nth-of-type(3)'],
  ['</section>'],
  ['<p class="visit" id="visit"><b>门店</b>每天 08:00–20:00</p>', 'visit', '.visit'],
  ['<footer>© 2026 Coffee. · 示例网站</footer>', 'foot', 'footer', true],
  ],
  en: [
  ['<nav class="nav">'],
  ['  <b class="logo">Coffee<i>.</i></b>', 'logo', '.logo'],
  ['  <a href="#beans">Menu</a> <a href="#visit">Visit</a>', 'links', '.nav .lk'],
  ['  <a class="pill" href="#visit">Book</a>', 'pill', '.pill'],
  ['</nav>'],
  ['<section class="hero">'],
  ['  <div class="copy">'],
  ['  <span class="eyebrow">Pour-over café · Roasted daily</span>', 'ey', '.eyebrow', true],
  ['  <h1>Good coffee <em>takes time</em></h1>', 'h1', '.hero h1'],
  ['  <p>Roasted fresh every morning, brewed one cup at a time.</p>', 'p', '.hero p', true],
  ['  <a class="btn" href="#visit">Book a table</a>', 'btn', '.btn:not(.ghost)', true],
  ['  <a class="btn ghost" href="#beans">See today\u2019s beans</a>', 'ghost', '.btn.ghost', true],
  ['  </div>'],
  ['  <div class="pour" aria-hidden="true"><i></i></div>', 'pour', '.pour'],
  ['</section>'],
  ['<section class="beans" id="beans">'],
  ['  <h2>Today\u2019s beans</h2>', 'h2', '.beans h2', true],
  ['  <article><small>Yunnan · Natural</small><h3>Baoshan Typica</h3><p>Berry · Brown sugar</p><b>¥38</b></article>', 'b1', '.beans article:nth-of-type(1)'],
  ['  <article><small>Ethiopia · Washed</small><h3>Yirgacheffe</h3><p>Jasmine · Citrus</p><b>¥42</b></article>', 'b2', '.beans article:nth-of-type(2)'],
  ['  <article><small>Colombia · Honey</small><h3>Huila</h3><p>Caramel · Cocoa</p><b>¥36</b></article>', 'b3', '.beans article:nth-of-type(3)'],
  ['</section>'],
  ['<p class="visit" id="visit"><b>Hours</b>Open daily 08:00–20:00</p>', 'visit', '.visit'],
  ['<footer>© 2026 Coffee. · Sample site</footer>', 'foot', 'footer', true],
  ],
};

/** Original (zh) lines — coffee.demox.site is built from these */
export const COFFEE_LINES = COFFEE_LINES_BY_LANG.zh;
export const coffeeLines = (lang) => COFFEE_LINES_BY_LANG[lang] || COFFEE_LINES;

/** The typed source (what the editor shows) */
export const COFFEE_BODY = COFFEE_LINES.map((l) => l[0]).join('\n');
export const coffeeBody = (lang) => coffeeLines(lang).map((l) => l[0]).join('\n');

/** Markup actually rendered: same body, nav links wrapped so they can be revealed as one block */
export function renderBody(src = COFFEE_BODY) {
  return src.replace(
    /(<a href="#beans">[^<]*<\/a> <a href="#visit">[^<]*<\/a>)/,
    '<span class="lk">$1</span>'
  );
}

/** Shared stylesheet. Responsive via a container query on .cq so the scaled
 *  homepage preview and the real site switch layouts identically. */
export const COFFEE_CSS = `
.cq{container-type:inline-size;container-name:cf}
.cf{--cream:#f5eee3;--paper:#fffaf2;--sand:#e6d6bf;--ink:#1f150e;--brown:#4a3324;--muted:#6b5646;--accent:#b8642a;--accent-deep:#93491a;--line:rgba(31,21,14,.14);
  --serif:"Songti SC","STSong","Noto Serif SC","Noto Serif CJK SC","Source Han Serif SC",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Noto Sans CJK SC",system-ui,-apple-system,"Segoe UI",sans-serif;
  font-family:var(--sans);color:var(--ink);line-height:1.6;font-size:16px;-webkit-font-smoothing:antialiased;min-height:100%;
  background:repeating-linear-gradient(0deg,transparent 0 31px,rgba(31,21,14,.025) 31px 32px),var(--cream)}
.cf *{box-sizing:border-box}
.cf a{color:inherit;text-decoration:none}
.cf h1,.cf h2,.cf h3{font-family:var(--serif);font-weight:700;margin:0;line-height:1.15}
.cf p{margin:0}
.cf .nav{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:32px;height:72px;padding:0 max(48px,calc(50% - 512px));background:rgba(245,238,227,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line);font-size:15px;color:var(--brown)}
.cf .logo{font:700 26px/1 Georgia,"Times New Roman",var(--serif);color:var(--ink);margin-right:auto;letter-spacing:-.01em;display:flex;align-items:baseline;gap:12px}
.cf .logo i{font-style:normal;color:var(--accent);margin-left:-12px}
.cf .logo::after{content:"SPECIALTY ROASTERS";font:600 10px/1 var(--sans);letter-spacing:.24em;color:var(--muted);padding-left:12px;border-left:1px solid var(--line)}
.cf .lk{display:flex;gap:32px;letter-spacing:.08em}
.cf .lk a{padding:4px 0;border-bottom:1px solid transparent}
.cf .lk a:hover{border-color:var(--accent)}
.cf .pill{background:var(--ink);color:var(--paper);padding:8px 20px;border-radius:999px;font-size:14px;letter-spacing:.1em}
.cf .hero{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:72px;padding:72px 48px 64px;max-width:1120px;margin:0 auto}
.cf .eyebrow{display:inline-flex;align-items:center;gap:12px;font-size:12px;font-weight:600;letter-spacing:.32em;color:var(--accent-deep);margin-bottom:24px}
.cf .eyebrow::before{content:"";width:32px;height:1px;background:var(--accent)}
.cf .hero h1{font-size:84px;line-height:1.08;letter-spacing:.02em;color:var(--ink)}
.cf .hero h1 em{font-style:normal;color:var(--accent);display:block}
.cf .hero p{margin:24px 0 8px;max-width:26em;font-size:18px;line-height:1.75;color:var(--muted);letter-spacing:.04em;padding-top:24px;border-top:1px solid var(--line)}
.cf .btn{display:inline-flex;align-items:center;margin:24px 16px 0 0;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;letter-spacing:.08em;background:var(--accent);color:#fff;box-shadow:0 12px 24px -12px rgba(147,73,26,.8)}
.cf .btn.ghost{background:transparent;color:var(--ink);box-shadow:none;padding:14px 4px;border-radius:0;border-bottom:1px solid var(--ink)}
.cf .btn.ghost::after{content:"→";margin-left:8px}
.cf .pour{position:relative;width:100%;max-width:400px;justify-self:end;aspect-ratio:4/5;border-radius:4px;overflow:hidden;
  background:radial-gradient(60% 40% at 50% 34%,#f3dcb8,transparent 70%),linear-gradient(180deg,#e9d6b9,#c9a57c);
  box-shadow:0 0 0 8px var(--paper),0 0 0 9px var(--line),0 32px 64px -32px rgba(31,21,14,.5)}
.cf .pour::before{content:"";position:absolute;left:31%;top:20%;width:38%;height:16%;background:linear-gradient(135deg,#f0f0ec,#cfcac0);clip-path:polygon(0 0,100% 0,64% 100%,36% 100%);border-top:6px solid #fff}
.cf .pour::after{content:"";position:absolute;left:28%;top:46%;width:44%;height:34%;border-radius:12% 12% 40% 40%/10% 10% 30% 30%;
  background:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,.1) 30%,#6b3c1c 30%,#3b2010);box-shadow:inset 0 0 0 2px rgba(255,255,255,.55),0 16px 24px -12px rgba(31,21,14,.5)}
.cf .pour i{position:absolute;left:calc(50% - 1px);top:36%;width:2px;height:20%;background:linear-gradient(#7a4520,#3b2010);z-index:1}
.cf .pour i::after{content:"No.07 · 今日手冲";position:absolute;left:-130px;width:260px;top:290%;text-align:center;font:600 11px/1 var(--sans);letter-spacing:.3em;color:var(--brown);white-space:nowrap}
.cf:lang(en) .pour i::after{content:"No.07 · TODAY'S POUR"}
.cf .beans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;padding:48px 48px 56px;max-width:1120px;margin:0 auto;border-top:1px solid var(--line)}
.cf .beans h2{grid-column:1/-1;font-size:32px;letter-spacing:.06em;margin-bottom:8px}
.cf .beans article{background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:24px;display:grid;grid-template-columns:1fr auto;gap:8px 16px;align-items:baseline;box-shadow:0 1px 0 var(--line)}
.cf .beans small{grid-column:1/-1;font-size:11px;font-weight:600;letter-spacing:.24em;color:var(--accent-deep);padding-bottom:12px;border-bottom:1px solid var(--line);margin-bottom:4px}
.cf .beans h3{font-size:22px;letter-spacing:.04em}
.cf .beans article b{grid-column:2;grid-row:2;font-family:Georgia,var(--serif);font-size:22px;color:var(--ink)}
.cf .beans article p{grid-column:1/-1;font-size:14px;color:var(--muted);letter-spacing:.08em}
.cf .visit{max-width:1024px;margin:0 auto;padding:16px 24px;display:flex;align-items:center;gap:16px;font-size:15px;color:var(--paper);background:var(--ink);border-radius:4px;letter-spacing:.08em}
.cf .visit b{font-size:11px;letter-spacing:.3em;color:#e9b98d;padding-right:16px;border-right:1px solid rgba(255,250,242,.25)}
.cf footer{max-width:1120px;margin:0 auto;padding:24px 48px 40px;font-size:13px;color:var(--muted);letter-spacing:.06em}
@container cf (max-width:720px){
  .cf .nav{gap:16px;height:56px;padding:0 20px;font-size:14px}
  .cf .logo{font-size:22px}
  .cf .logo::after{display:none}
  .cf .lk{gap:16px}
  .cf .pill{padding:6px 14px;font-size:13px}
  .cf .hero{grid-template-columns:1fr;gap:32px;padding:40px 20px 40px}
  .cf .eyebrow{font-size:11px;letter-spacing:.24em;margin-bottom:16px}
  .cf .hero h1{font-size:48px}
  .cf .hero p{font-size:16px;margin-top:20px;padding-top:20px}
  .cf .btn{margin-top:20px;padding:12px 22px;font-size:14px}
  .cf .btn.ghost{padding:12px 2px}
  .cf .pour{justify-self:stretch;max-width:none;aspect-ratio:16/10}
  .cf .pour::before{left:38%;width:24%;top:14%;height:20%}
  .cf .pour::after{left:37%;width:26%;top:44%;height:40%}
  .cf .pour i::after{display:none}
  .cf .beans{grid-template-columns:1fr;gap:16px;padding:32px 20px 40px}
  .cf .beans h2{font-size:26px}
  .cf .visit{margin:0 20px}
  .cf footer{padding:24px 20px 32px}
}
`;

/** Full HTML for the real site (coffee.demox.site) */
export function coffeeSiteDocument() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="site-build" content="coffee-v3">
<title>Coffee. 好咖啡 慢慢来</title>
<meta name="description" content="Coffee. 示例网站：每天清晨现烘，一杯一杯手冲。用 Demox 发布。">
<meta name="theme-color" content="#f5eee3">
<link rel="canonical" href="https://coffee.demox.site/">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%232b1d14'/%3E%3Cpath d='M13 26h32v8c0 9-7 16-16 16s-16-7-16-16z' fill='%23f6efe4'/%3E%3Crect x='10' y='52' width='38' height='4' rx='2' fill='%23c8742c'/%3E%3C/svg%3E">
<style>html,body{margin:0;background:#f5eee3;scroll-behavior:smooth}${COFFEE_CSS}</style>
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
export function coffeeSandboxDocument(src, lang = 'zh') {
  const csp = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";
  return `<!doctype html><html lang="${lang === 'en' ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#f5eee3}${COFFEE_CSS}</style></head><body><div class="cq"><div class="cf">${renderBody(src)}</div></div></body></html>`;
}
