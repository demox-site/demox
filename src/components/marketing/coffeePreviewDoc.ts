/** Sandboxed iframe srcdoc shell — cream coffee look matching coffee.demox.site */
const COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='120' viewBox='0 0 600 120'%3E%3Crect width='600' height='120' fill='%23f6efe4'/%3E%3Ccircle cx='480' cy='60' r='44' fill='%23d9c3a5'/%3E%3Cpath d='M452 52h56l-16 28h-24z' fill='%23c8742c'/%3E%3Cpath d='M456 82h48c0 18-8 30-24 30s-24-12-24-30z' fill='%23fbf7f0'/%3E%3C/svg%3E";

const CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:";

const BASE_STYLES = `
html{background:#f6efe4}
body{margin:0;padding:12px 18px 10px;font:13px/1.6 ui-sans-serif,system-ui,sans-serif,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC";color:#2b1d14;background:radial-gradient(45% 55% at 82% 58%,rgba(217,195,165,.45),transparent 72%),#f6efe4;-webkit-font-smoothing:antialiased}
nav{display:flex;align-items:center;gap:12px;font-size:12px;color:#5a3d29;padding-bottom:10px;border-bottom:1px solid rgba(43,29,20,.1);margin:0 -18px 10px;padding-left:18px;padding-right:18px}
nav b{font:700 15px/1 Georgia,"Times New Roman","Songti SC","Noto Serif SC",serif;color:#2b1d14;letter-spacing:-.01em;margin-right:auto}
.eyebrow,span.eyebrow{display:block;font-size:10px;letter-spacing:.18em;color:#8a6446;margin-bottom:6px}
h1{font:700 22px/1.15 "Songti SC","STSong","Noto Serif SC","Noto Serif CJK SC",Georgia,serif;letter-spacing:.04em;margin:0;color:#2b1d14}
p{font-size:12px;color:#6f5a49;margin:6px 0 0;letter-spacing:.03em}
button{margin-top:10px;font:600 12px/1 inherit;color:#fff;background:#c8742c;border:0;border-radius:999px;padding:9px 16px;cursor:pointer;box-shadow:0 8px 18px -8px rgba(200,116,44,.75);letter-spacing:.04em}
.pour,div.pour{position:relative;height:100px;margin-top:8px;border-radius:50%;width:100px;margin-left:auto;margin-right:0;background:radial-gradient(circle at 35% 30%,#ecd9bd,#d9c3a5 55%,#c9ab86)}
.pour::before{content:"";position:absolute;left:50%;top:14%;width:36%;height:18%;margin-left:-18%;background:linear-gradient(135deg,#e7b98a,#c8742c);clip-path:polygon(0 0,100% 0,72% 100%,28% 100%)}
.pour::after{content:"";position:absolute;left:50%;top:48%;width:48%;height:32%;margin-left:-28%;border-radius:4px 4px 40% 40%;background:#fbf7f0;box-shadow:14px 4px 0 -2px #fbf7f0}
ul{list-style:none;margin:10px 0 0;padding:0}
ul.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
ul.cards li{border:1px solid rgba(43,29,20,.12);border-radius:10px;padding:9px 10px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#fbf7f0;font-family:"Songti SC","Noto Serif SC",Georgia,serif}
footer{margin-top:10px;font-size:10px;color:#6f5a49}
a{color:inherit}
@media (max-width:420px){body{padding:10px 14px}h1{font-size:18px}ul.cards{gap:6px}ul.cards li{font-size:10px;padding:7px}}
`.replace(/\n/g, "");

export const COFFEE_LIVE_URL = "https://coffee.demox.site";

export function buildCoffeePreviewDoc(bodyHtml: string): string {
  const safe = bodyHtml.replace(/(src\s*=\s*["']?)beans\.jpg/gi, `$1${COVER}`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}</style></head><body>${safe}</body></html>`;
}

/** Full typed demo source (AI-generated coffee page) */
export const DEMO_HTML_LINES: Array<{
  code: string;
  block?: string;
  revealAt?: number;
}> = [
  { code: "<!doctype html>" },
  { code: "<nav><b>Coffee.</b> <a>菜单</a> <a>门店</a> <a>预订</a></nav>", block: "nav", revealAt: 5 },
  { code: '<section class="hero">' },
  { code: '  <span class="eyebrow">手冲咖啡馆 · 每日现烘</span>', block: "ey" },
  { code: "  <h1>好咖啡，慢慢来</h1>", block: "h1" },
  { code: "  <p>每天清晨现烘，一杯一杯手冲。</p>", block: "p" },
  { code: "  <button>预订座位</button>", block: "btn" },
  { code: '  <div class="pour" aria-hidden="true"></div>', block: "cover" },
  { code: "</section>" },
  { code: '<ul class="cards">' },
  { code: "  <li>云南日晒</li>", block: "c1" },
  { code: "  <li>埃塞俄比亚水洗</li>", block: "c2" },
  { code: "  <li>哥伦比亚蜜处理</li>", block: "c3" },
  { code: "</ul>" },
  { code: "<footer>© 2026 Coffee.</footer>", block: "foot" },
];

export const DEMO_HTML_FULL = DEMO_HTML_LINES.map((l) => l.code).join("\n");
