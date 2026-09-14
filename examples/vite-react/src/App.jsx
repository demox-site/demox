import { useMemo, useState } from "react";

const CATS = ["全部", "吊灯", "壁灯", "落地", "桌灯", "户外"];

const PRODUCTS = [
  {
    id: "nl-p-01",
    sku: "NL-P-01",
    name: "悬丝 01",
    cat: "吊灯",
    kind: "pendant",
    lm: 810,
    cct: 2700,
    cri: 95,
    finish: "喷砂铝，亚麻吊线",
    scene: "四人餐桌。灯罩下沿距桌面约 70 cm。",
    lead: "4 周",
    note: "吊高可调 90–160 cm，电源藏在天花盖里。"
  },
  {
    id: "nl-w-04",
    sku: "NL-W-04",
    name: "岸壁",
    cat: "壁灯",
    kind: "wall",
    lm: 420,
    cct: 2700,
    cri: 93,
    finish: "阳极氧化铝",
    scene: "走廊中段，距地 165 cm，成对使用。",
    lead: "3 周",
    note: "遮光板把光打向墙面，不直射眼睛。"
  },
  {
    id: "nl-f-12",
    sku: "NL-F-12",
    name: "地平",
    cat: "落地",
    kind: "floor",
    lm: 1200,
    cct: 3000,
    cri: 90,
    finish: "铸铁底座，拉丝钢杆",
    scene: "沙发外侧阅读角，灯头朝向纸面。",
    lead: "5 周",
    note: "脚踏开关在电源线上，底座配防滑垫。"
  },
  {
    id: "nl-t-07",
    sku: "NL-T-07",
    name: "桌火",
    cat: "桌灯",
    kind: "table",
    lm: 380,
    cct: 2700,
    cri: 95,
    finish: "乳白玻璃，黄铜触点",
    scene: "书桌左上角，避开屏幕反光。",
    lead: "3 周",
    note: "旋钮在底座侧面，从关到全亮约 270°。"
  },
  {
    id: "nl-l-02",
    sku: "NL-L-02",
    name: "廊道",
    cat: "吊灯",
    kind: "linear",
    lm: 1600,
    cct: 3500,
    cri: 90,
    finish: "挤压铝型材，磨砂罩",
    scene: "展墙或长桌，长度 1.8 m。",
    lead: "6 周",
    note: "可 spl 接两根。默认吊杆，可改吊线。"
  },
  {
    id: "nl-o-09",
    sku: "NL-O-09",
    name: "庭院",
    cat: "户外",
    kind: "post",
    lm: 900,
    cct: 3000,
    cri: 80,
    finish: "阳极氧化，IP65",
    scene: "入口一侧，距墙 40 cm，距地 80 cm。",
    lead: "5 周",
    note: "地埋盒另配。夜间只照地面，不冲大门。"
  }
];

function Lamp({ kind, lit }) {
  return (
    <div className={`lamp lamp-${kind} ${lit ? "is-lit" : ""}`} aria-hidden="true">
      {kind === "pendant" && (
        <>
          <span className="cord" />
          <span className="canopy" />
          <span className="shade" />
          <span className="bulb" />
        </>
      )}
      {kind === "wall" && (
        <>
          <span className="plate" />
          <span className="arm" />
          <span className="shade" />
          <span className="bulb" />
        </>
      )}
      {kind === "floor" && (
        <>
          <span className="base" />
          <span className="stem" />
          <span className="shade" />
          <span className="bulb" />
        </>
      )}
      {kind === "table" && (
        <>
          <span className="base" />
          <span className="stem" />
          <span className="globe" />
        </>
      )}
      {kind === "linear" && (
        <>
          <span className="cord left" />
          <span className="cord right" />
          <span className="bar" />
        </>
      )}
      {kind === "post" && (
        <>
          <span className="base" />
          <span className="stem" />
          <span className="head" />
          <span className="bulb" />
        </>
      )}
    </div>
  );
}

export default function App() {
  const [cat, setCat] = useState("全部");
  const [id, setId] = useState(PRODUCTS[0].id);
  const [copied, setCopied] = useState(false);

  const list = useMemo(
    () => (cat === "全部" ? PRODUCTS : PRODUCTS.filter((p) => p.cat === cat)),
    [cat]
  );
  const selected = list.find((p) => p.id === id) || list[0] || PRODUCTS[0];

  const copySku = async () => {
    try {
      await navigator.clipboard.writeText(selected.sku);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="app">
      <p className="ribbon">
        Demox 公开示例 · Vite + React 构建产物
      </p>

      <div className="split">
        <section className={`stage ${selected ? "is-on" : ""}`} aria-label="灯具预览">
          <div className="stage-grain" />
          <div className="stage-floor" />
          <Lamp kind={selected.kind} lit />
          <p className="stage-caption">
            <span className="sku">{selected.sku}</span>
            <span>{selected.name}</span>
          </p>
        </section>

        <section className="sheet">
          <header className="mast">
            <p className="eyebrow">客户预览 · 2026 春</p>
            <h1>
              <span className="brand">NORTHLINE</span>
              <span className="zh">北线</span>
            </h1>
            <p className="lede">
              本季六件，按现场光线选。不是效果图，是可下单的规格。
            </p>
          </header>

          <div className="filters" role="tablist" aria-label="类型">
            {CATS.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={cat === c}
                className={cat === c ? "is-active" : ""}
                onClick={() => {
                  setCat(c);
                  const next = c === "全部" ? PRODUCTS[0] : PRODUCTS.find((p) => p.cat === c);
                  if (next) setId(next.id);
                }}
              >
                {c}
              </button>
            ))}
          </div>

          <ul className="catalog">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={p.id === selected.id ? "is-selected" : ""}
                  onClick={() => setId(p.id)}
                >
                  <span className="row-sku">{p.sku}</span>
                  <span className="row-name">{p.name}</span>
                  <span className="row-meta">
                    {p.lm} lm · {p.cct}K · CRI {p.cri}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <article className="spec" aria-live="polite">
            <div className="spec-top">
              <h2>
                {selected.name}
                <small>{selected.cat}</small>
              </h2>
              <button type="button" className="copy" onClick={copySku}>
                {copied ? "已复制" : "复制 SKU"}
              </button>
            </div>
            <dl>
              <div>
                <dt>光通量</dt>
                <dd>{selected.lm} lm</dd>
              </div>
              <div>
                <dt>色温 / CRI</dt>
                <dd>
                  {selected.cct}K / {selected.cri}
                </dd>
              </div>
              <div>
                <dt>表面</dt>
                <dd>{selected.finish}</dd>
              </div>
              <div>
                <dt>交期</dt>
                <dd>{selected.lead}</dd>
              </div>
            </dl>
            <p className="scene">{selected.scene}</p>
            <p className="note">{selected.note}</p>
          </article>

          <footer className="foot">
            由 Vite 构建，发布在 Demox。规格以合同确认为准。
          </footer>
        </section>
      </div>
    </div>
  );
}
