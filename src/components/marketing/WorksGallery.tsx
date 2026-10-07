import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, ExternalLink, X } from "lucide-react";
import type { Language } from "@/hooks/use-language";

type CardKind = "real" | "sample";

type GalleryCard = {
  id: string;
  kind: CardKind;
  url: string;
  title: { zh: string; en: string };
  meta: { zh: string; en: string };
  href?: string;
  preview: "coffee" | "demox" | "preview" | "ai" | "review" | "doc-insight" | "fn" | "sheet" | "doc-warm" | "pdf" | "doc-dark";
};

const ROW_A: GalleryCard[] = [
  {
    id: "coffee",
    kind: "real",
    url: "coffee.demox.site",
    href: "https://coffee.demox.site/",
    title: { zh: "好咖啡 · Coffee.", en: "Coffee. — brew slow" },
    meta: {
      zh: "用 Demox 搭建并发布的咖啡馆网站",
      en: "Coffee shop site built and deployed with Demox",
    },
    preview: "coffee",
  },
  {
    id: "www",
    kind: "real",
    url: "www.demox.site",
    href: "https://www.demox.site/how-demox-hosts-itself",
    title: { zh: "Demox 主站", en: "Demox homepage" },
    meta: {
      zh: "第一方案例 · demox deploy ./dist",
      en: "First-party case · demox deploy ./dist",
    },
    preview: "demox",
  },
  {
    id: "ai",
    kind: "sample",
    url: "ai-page.demox.site",
    title: { zh: "AI 生成页面", en: "AI-generated page" },
    meta: {
      zh: "HTML 单页 · CLI 或 MCP 直接发布",
      en: "Single HTML · publish via CLI or MCP",
    },
    preview: "ai",
  },
  {
    id: "review",
    kind: "sample",
    url: "review.demox.site",
    title: { zh: "客户评审", en: "Client review" },
    meta: {
      zh: "发链接给客户在线看效果",
      en: "Share a link for online review",
    },
    preview: "review",
  },
  {
    id: "doc-insight",
    kind: "sample",
    url: "notes.demox.site",
    title: { zh: "文档网页化 · 见解", en: "Docs → web · Insight" },
    meta: {
      zh: "克制留白的浅色阅读版",
      en: "Light reading template with generous whitespace",
    },
    preview: "doc-insight",
  },
  {
    id: "fn",
    kind: "sample",
    url: "api-demo.demox.site",
    title: { zh: "Node 云函数", en: "Node functions" },
    meta: {
      zh: "demox functions push",
      en: "demox functions push",
    },
    preview: "fn",
  },
];

const ROW_B: GalleryCard[] = [
  {
    id: "preview",
    kind: "real",
    url: "preview.demox.site",
    href: "https://preview.demox.site/",
    title: { zh: "本页预览站", en: "This preview site" },
    meta: {
      zh: "验收预览站 preview.demox.site · demox deploy",
      en: "Acceptance preview · demox deploy",
    },
    preview: "preview",
  },
  {
    id: "sheet",
    kind: "sample",
    url: "sheet.demox.site",
    title: { zh: "表格转网页", en: "Spreadsheet → web" },
    meta: {
      zh: ".csv / .xlsx / .xls / .ods",
      en: ".csv / .xlsx / .xls / .ods",
    },
    preview: "sheet",
  },
  {
    id: "doc-warm",
    kind: "sample",
    url: "essay.demox.site",
    title: { zh: "文档网页化 · 温暖", en: "Docs → web · Warm" },
    meta: {
      zh: "暖米底色衬线、亲和",
      en: "Warm paper tone with serif type",
    },
    preview: "doc-warm",
  },
  {
    id: "pdf",
    kind: "sample",
    url: "pdf.demox.site",
    title: { zh: "PDF 预览", en: "PDF preview" },
    meta: {
      zh: "自动生成预览页",
      en: "Auto-generated preview page",
    },
    preview: "pdf",
  },
  {
    id: "doc-dark",
    kind: "sample",
    url: "changelog.demox.site",
    title: { zh: "文档网页化 · 暗", en: "Docs → web · Dark" },
    meta: {
      zh: "深色护眼，贴合控制台",
      en: "Dark theme, console-friendly",
    },
    preview: "doc-dark",
  },
];

const copy = {
  zh: {
    badge: "都是用 Demox 发出来的页面",
    title: "我能用它做什么",
    sub: "静态页面和 Node 接口都能发。上传你的页面，30 秒拿到一个能打开的链接。",
    upload: "立即上传",
    selfHost: "阅读自托管说明",
    real: "真实",
    sample: "示例",
    hint: "拖动浏览，点击查看",
    realNote: "真实：用 Demox 部署的线上站点",
    sampleNote: "示例：示意画面，非用户作品",
    modalNote: "示意画面，非用户作品",
    modalCta: "立即上传",
    close: "关闭预览",
    sr: "作品墙：两排卡片缓慢横向滚动，可以左右拖动；点击「示例」卡片会打开放大预览。标注「真实」的是 www.demox.site、用 Demox 发布的咖啡馆网站 coffee.demox.site 和本预览站 preview.demox.site；其余标注「示例」的卡片是 Demox 支持的发布类型的示意画面，不是用户作品。",
  },
  en: {
    badge: "Pages shipped with Demox",
    title: "What can I use it for?",
    sub: "Static pages and Node APIs both ship here. Upload your page and get a working link in 30 seconds.",
    upload: "Upload now",
    selfHost: "How Demox hosts itself",
    real: "Live",
    sample: "Sample",
    hint: "Drag to browse, click to preview",
    realNote: "Live: first-party sites deployed with Demox",
    sampleNote: "Sample: illustrative previews, not user sites",
    modalNote: "Illustrative preview — not a user site",
    modalCta: "Upload now",
    close: "Close preview",
    sr: "Gallery wall: two drifting rows you can drag. Sample cards open a larger preview. Live cards are www.demox.site, coffee.demox.site, and preview.demox.site.",
  },
};

function PreviewArt({ kind }: { kind: GalleryCard["preview"] }) {
  if (kind === "coffee") {
    return (
      <div className="mh-pi mh-pv-cf">
        <div className="mh-nv">
          <b>
            Coffee<span className="mh-dt">.</span>
          </b>
          <span className="mh-lk">菜单</span>
          <span className="mh-lk">门店</span>
          <span className="mh-pl">预订</span>
        </div>
        <div className="mh-hr">
          <div className="mh-cp">
            <span className="mh-ey">手冲咖啡馆 · 每日现烘</span>
            <h4>
              好咖啡，
              <br />
              <span className="mh-sf">慢慢来</span>
            </h4>
            <p>每天清晨现烘，一杯一杯手冲。</p>
            <span className="mh-bt">预订座位</span>
          </div>
          <div className="mh-ar" aria-hidden="true">
            <i className="mh-cup" />
            <i className="mh-hd" />
            <i className="mh-sm" />
          </div>
        </div>
      </div>
    );
  }
  if (kind === "demox") {
    return (
      <div className="mh-pi mh-pv-dx">
        <div className="mh-nv">
          <b>demox</b>
          <i className="mh-ln" />
          <i className="mh-ln" />
          <i className="mh-ln" />
          <span className="mh-lg">登录</span>
        </div>
        <h4>
          免费静态网站发布平台，
          <br />
          支持 CLI 和 MCP
        </h4>
        <span className="mh-bt">立即上传</span>
        <div className="mh-tm">
          <span className="mh-g">➜</span> demox deploy
          <br />
          <span className="mh-g">成功！已部署至：</span>
        </div>
      </div>
    );
  }
  if (kind === "preview") {
    return (
      <div className="mh-pi mh-pv-me">
        <h4>一键发布为公网网站</h4>
        <div className="mh-st">
          <div className="mh-pn l">
            <i className="mh-ln" />
            <i className="mh-ln" />
            <i className="mh-ln" />
            <i className="mh-ln" />
          </div>
          <div className="mh-lk">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect width="16" height="16" rx="2" fill="#111" />
              <path
                d="M8 13.9L2.763 8.349A3.35 3.35 0 1 1 8 4.211A3.35 3.35 0 1 1 13.237 8.349Z"
                fill="#fff"
              />
            </svg>
          </div>
          <div className="mh-pn r">
            <div className="mh-bx" />
            <i className="mh-ln" />
            <i className="mh-ln s" />
          </div>
        </div>
      </div>
    );
  }
  if (kind === "ai") {
    return (
      <div className="mh-pi mh-pv-ai">
        <span className="mh-pl">index.html</span>
        <h4>把想法发布成网页</h4>
        <i className="mh-ln" />
        <i className="mh-ln" />
        <span className="mh-bt">开始使用</span>
      </div>
    );
  }
  if (kind === "review") {
    return (
      <div className="mh-pi mh-pv-rev">
        <div className="mh-hd">
          <i className="mh-ln d" />
          <i className="mh-ln" />
        </div>
        <div className="mh-im">
          <span className="mh-pin" style={{ left: "68%", top: 22 }}>
            1
          </span>
          <span className="mh-bub" style={{ right: "calc(32% + 10px)", top: 20 }}>
            标题再大一点？
          </span>
        </div>
        <div className="mh-rw">
          <i className="mh-ln" />
          <i className="mh-ln" />
          <i className="mh-ln" />
        </div>
      </div>
    );
  }
  if (kind === "fn") {
    return (
      <div className="mh-pi mh-pv-fn">
        <pre>
          <b>export default async function</b> handler(request, env) {"{"}
          {"\n"}
          {"  "}return Response.json({"{"} ok: true {"}"}){"\n"}
          {"}"}
        </pre>
        <div className="mh-rq">
          <i />
          fetch(&apos;/api/hello&apos;)
          <em>{`{ "ok": true }`}</em>
        </div>
      </div>
    );
  }
  if (kind === "sheet") {
    return (
      <div className="mh-pi mh-pv-sh">
        <div className="mh-tt">
          <b>data.xlsx</b>
          <i className="mh-ln" />
        </div>
        <table>
          <tbody>
            <tr>
              <th>A</th>
              <th>B</th>
              <th>C</th>
            </tr>
            {[70, 50, 82, 60].map((w, i) => (
              <tr key={i}>
                <td>
                  <i className="mh-ln" style={{ width: `${w}%` }} />
                </td>
                <td>
                  <i className="mh-ln" style={{ width: `${40 + i * 8}%` }} />
                </td>
                <td>
                  <i className="mh-ln" style={{ width: `${55 - i * 5}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <div className="mh-pi mh-pv-pdf">
        <div className="mh-tb">
          <span>1 / 3</span>
          <span>−&nbsp;&nbsp;100%&nbsp;&nbsp;+</span>
        </div>
        <div className="mh-pg">
          <i className="mh-ln h" />
          <i className="mh-ln" />
          <i className="mh-ln" />
          <i className="mh-ln s" />
          <i className="mh-ln" />
          <i className="mh-ln" />
        </div>
      </div>
    );
  }
  const theme =
    kind === "doc-warm" ? "t-warm" : kind === "doc-dark" ? "t-dark" : "t-insight";
  const heading =
    kind === "doc-warm" ? "读书笔记" : kind === "doc-dark" ? "更新日志" : "快速开始";
  return (
    <div className={`mh-pi mh-pv-doc ${theme}`}>
      <div className="mh-toc">
        <i className="mh-ln on" />
        <i className="mh-ln" />
        <i className="mh-ln" />
        <i className="mh-ln" />
      </div>
      <div className="mh-bd">
        <h4>{heading}</h4>
        <i className="mh-ln" />
        <i className="mh-ln" />
        <i className="mh-ln s" />
        <i className="mh-ln h" />
        <i className="mh-ln" />
        <div className="mh-cb" />
      </div>
    </div>
  );
}

function CardView({
  card,
  lang,
  t,
  onSample,
}: {
  card: GalleryCard;
  lang: Language;
  t: (typeof copy)["zh"];
  onSample: (c: GalleryCard) => void;
}) {
  const title = card.title[lang];
  const meta = card.meta[lang];
  const chip =
    card.kind === "real" ? (
      <span className="mh-s3-chip real">
        <i />
        {t.real}
      </span>
    ) : (
      <span className="mh-s3-chip">{t.sample}</span>
    );

  const inner = (
    <>
      <div className="mh-s3-bar">
        <span className="mh-s3-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="mh-s3-url">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>{card.url}</span>
        </span>
      </div>
      <div className="mh-s3-pv" aria-hidden="true">
        <PreviewArt kind={card.preview} />
      </div>
      <div className="mh-s3-cap">
        <div className="mh-s3-cap-t">
          <b>{title}</b>
          {chip}
        </div>
        <div className="mh-s3-cap-m">{meta}</div>
      </div>
    </>
  );

  if (card.kind === "real" && card.href) {
    return (
      <a
        className="mh-s3-card is-real"
        href={card.href}
        target="_blank"
        rel="noopener noreferrer"
        draggable={false}
      >
        {inner}
      </a>
    );
  }

  return (
    <article
      className="mh-s3-card"
      tabIndex={0}
      role="button"
      aria-haspopup="dialog"
      aria-label={`${lang === "zh" ? "查看示例" : "View sample"}: ${title}`}
      onClick={() => onSample(card)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSample(card);
        }
      }}
    >
      {inner}
    </article>
  );
}

interface Props {
  language: Language;
  onUpload: () => void;
}

export const WorksGallery: React.FC<Props> = ({ language, onUpload }) => {
  const t = copy[language] ?? copy.zh;
  const stageRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([null, null]);
  const [modal, setModal] = useState<GalleryCard | null>(null);
  const lastDragEnd = useRef(-1e9);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const SPEED = [34, 28];
    type Row = {
      el: HTMLDivElement;
      tr: HTMLDivElement;
      base: number;
      v: number;
      x: number;
      w: number;
      hover: boolean;
      focus: boolean;
      drag: unknown;
      init: boolean;
    };
    const rows: Row[] = rowRefs.current
      .filter(Boolean)
      .map((el, i) => {
        const node = el!;
        const base = (node.classList.contains("rev") ? 1 : -1) * SPEED[i];
        return {
          el: node,
          tr: node.querySelector(".mh-s3-track") as HTMLDivElement,
          base,
          v: base,
          x: 0,
          w: 0,
          hover: false,
          focus: false,
          drag: null,
          init: false,
        };
      });

    function cloneSet(set: Element) {
      const c = set.cloneNode(true) as HTMLElement;
      c.setAttribute("aria-hidden", "true");
      c.querySelectorAll(".mh-s3-card").forEach((a) => {
        a.setAttribute("tabindex", "-1");
        a.removeAttribute("role");
        a.removeAttribute("aria-label");
        a.removeAttribute("aria-haspopup");
      });
      return c;
    }
    function wrap(r: Row) {
      if (r.focus || !r.w) return;
      r.x = r.x - Math.floor(r.x / r.w) * r.w - 2 * r.w;
    }
    function apply(r: Row) {
      r.tr.style.transform = `translate3d(${r.x.toFixed(2)}px,0,0)`;
    }

    let lastW = 0;
    function layout() {
      const vw = stage.offsetWidth;
      if (!vw || vw === lastW) return;
      lastW = vw;
      const small = window.innerWidth <= 760;
      rows.forEach((r, i) => {
        const tr = r.tr;
        const set = tr.querySelector(".mh-s3-set:not([aria-hidden])") as HTMLElement;
        tr.querySelectorAll(".mh-s3-set[aria-hidden]").forEach((x) => tr.removeChild(x));
        if (reduce) {
          tr.style.transform = "";
          return;
        }
        const w = set.offsetWidth;
        tr.insertBefore(cloneSet(set), set);
        const need = Math.max(1, Math.ceil((vw * 1.5) / w));
        for (let n = 0; n < need; n++) tr.appendChild(cloneSet(set));
        if (!r.init) {
          r.init = true;
          const f = small ? (i ? 0.05 : 0.99) : i ? 0.62 : 0.72;
          r.x = (r.base < 0 ? -f * w : -(1 - f) * w) - w;
        } else if (r.w) r.x = (r.x / r.w) * w;
        r.w = w;
        wrap(r);
        apply(r);
      });
    }

    let running = false;
    let visible = true;
    let last = 0;
    let modalOpen = false;

    function tick(now: number) {
      if (!visible) {
        running = false;
        return;
      }
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      rows.forEach((r) => {
        if (r.drag && (r.drag as { on?: boolean }).on) return;
        const target = r.hover || r.focus || modalOpen ? 0 : r.base;
        const fling = Math.abs(r.v) > Math.abs(r.base) * 1.6;
        r.v += (target - r.v) * (1 - Math.exp(-dt / (fling ? 0.5 : 0.35)));
        r.x += r.v * dt;
        wrap(r);
        apply(r);
      });
      requestAnimationFrame(tick);
    }
    function start() {
      if (running || reduce) return;
      running = true;
      last = 0;
      requestAnimationFrame(tick);
    }

    type D = {
      r: Row;
      id: number;
      x0: number;
      y0: number;
      sx: number;
      on: boolean;
      s: Array<[number, number]>;
    } | null;
    let Dstate: D = null;

    function rowAt(e: PointerEvent) {
      const el = (e.target as HTMLElement).closest?.(".mh-s3-row");
      for (let i = 0; i < rows.length; i++) if (rows[i].el === el) return rows[i];
      let best: Row | null = null;
      let bd = 1e9;
      rows.forEach((r) => {
        const c = r.el.querySelector(".mh-s3-card");
        if (!c) return;
        const b = c.getBoundingClientRect();
        const d = Math.abs(e.clientY - (b.top + b.height / 2));
        if (d < bd) {
          bd = d;
          best = r;
        }
      });
      return best;
    }

    const onDown = (e: PointerEvent) => {
      if (reduce || Dstate || (e.pointerType === "mouse" && e.button !== 0)) return;
      const r = rowAt(e);
      if (!r) return;
      Dstate = {
        r,
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        sx: r.x,
        on: false,
        s: [[e.timeStamp, e.clientX]],
      };
    };
    const onMove = (e: PointerEvent) => {
      if (!Dstate || Dstate.id !== e.pointerId) return;
      const r = Dstate.r;
      const dx = e.clientX - Dstate.x0;
      const dy = e.clientY - Dstate.y0;
      if (!Dstate.on) {
        if (Math.abs(dx) < 6) {
          if (Math.abs(dy) > 10) Dstate = null;
          return;
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          Dstate = null;
          return;
        }
        Dstate.on = true;
        Dstate.sx = r.x - dx;
        r.v = 0;
        r.drag = Dstate;
        try {
          stage.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        stage.classList.add("s3-dragging");
      }
      r.x = Dstate.sx + (e.clientX - Dstate.x0);
      wrap(r);
      apply(r);
      Dstate.s.push([e.timeStamp, e.clientX]);
      while (Dstate.s.length > 2 && e.timeStamp - Dstate.s[0][0] > 100) Dstate.s.shift();
    };
    const endDrag = (e: PointerEvent) => {
      if (!Dstate || Dstate.id !== e.pointerId) return;
      const d = Dstate;
      const r = d.r;
      Dstate = null;
      r.drag = null;
      if (!d.on) return;
      stage.classList.remove("s3-dragging");
      lastDragEnd.current = performance.now();
      const a = d.s[0];
      const b = d.s[d.s.length - 1];
      const dts = (b[0] - a[0]) / 1000;
      const v =
        e.type === "pointerup" && dts > 0.012 && e.timeStamp - b[0] < 80
          ? (b[1] - a[1]) / dts
          : 0;
      r.v = Math.max(-2600, Math.min(2600, v));
    };

    const onClick = (e: MouseEvent) => {
      if (performance.now() - lastDragEnd.current < 350) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    stage.addEventListener("click", onClick, true);
    stage.addEventListener("dragstart", (e) => e.preventDefault());

    rows.forEach((r) => {
      r.el.addEventListener("pointerenter", (e) => {
        if ((e as PointerEvent).pointerType === "mouse") r.hover = true;
      });
      r.el.addEventListener("pointerleave", (e) => {
        if ((e as PointerEvent).pointerType === "mouse") r.hover = false;
      });
    });

    const ro = new ResizeObserver(() => layout());
    ro.observe(stage);
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) start();
      },
      { rootMargin: "120px" }
    );
    io.observe(stage);

    layout();
    if (!reduce) start();

    // expose modal pause
    const mo = new MutationObserver(() => {
      modalOpen = !!document.querySelector(".mh-s3-modal.is-open");
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });

    return () => {
      visible = false;
      running = false;
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", endDrag);
      stage.removeEventListener("pointercancel", endDrag);
      stage.removeEventListener("click", onClick, true);
    };
  }, [language]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [modal]);

  const openSample = (c: GalleryCard) => {
    if (performance.now() - lastDragEnd.current < 350) return;
    if (c.kind !== "sample") return;
    setModal(c);
  };

  return (
    <section className="mh-s3" id="use-cases" aria-labelledby="mh-s3-title">
      <div className="mh-s3-head">
        <div className="mh-badge">
          <i />
          {t.badge}
        </div>
        <h2 id="mh-s3-title">{t.title}</h2>
        <p className="mh-s3-sub">{t.sub}</p>
        <div className="mh-s3-acts">
          <button type="button" className="mh-s3-cta" onClick={onUpload}>
            {t.upload}
            <ArrowRight size={16} />
          </button>
          <a className="mh-s3-link" href="/how-demox-hosts-itself">
            {t.selfHost}
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
      <p className="sr-only">{t.sr}</p>
      <div className="mh-s3-stage" ref={stageRef} id="examples">
        <div className="mh-s3-wall">
          <div
            className="mh-s3-row"
            ref={(el) => {
              rowRefs.current[0] = el;
            }}
          >
            <div className="mh-s3-track">
              <div className="mh-s3-set">
                {ROW_A.map((c) => (
                  <CardView key={c.id} card={c} lang={language} t={t} onSample={openSample} />
                ))}
              </div>
            </div>
          </div>
          <div
            className="mh-s3-row rev"
            ref={(el) => {
              rowRefs.current[1] = el;
            }}
          >
            <div className="mh-s3-track">
              <div className="mh-s3-set">
                {ROW_B.map((c) => (
                  <CardView key={c.id} card={c} lang={language} t={t} onSample={openSample} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mh-s3-note">
        <span className="mh-ix-hint mh-s3-hint" aria-hidden="true">
          {t.hint}
        </span>
        <span className="mh-k">
          <i />
          {t.realNote}
        </span>
        <span className="mh-k">
          <em>{t.sample}</em> {t.sampleNote.replace(/^示例[：:]?\s*/, "").replace(/^Sample[:\s]*/i, "")}
        </span>
      </div>

      {modal && (
        <div className={`mh-s3-modal is-open`} role="presentation">
          <div className="mh-s3-mbk" onClick={() => setModal(null)} />
          <div
            className="mh-s3-dlg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mh-s3mt"
            tabIndex={-1}
          >
            <div className="mh-s3-mbar">
              <span className="mh-s3-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="mh-s3-url">
                <span>{modal.url}</span>
              </span>
              <button
                type="button"
                className="mh-s3-x"
                aria-label={t.close}
                onClick={() => setModal(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="mh-s3-mpv" aria-hidden="true">
              <PreviewArt kind={modal.preview} />
            </div>
            <div className="mh-s3-mcap">
              <div className="mh-s3-cap-t">
                <b id="mh-s3mt">{modal.title[language]}</b>
                <span className="mh-s3-chip">{t.sample}</span>
              </div>
              <p className="mh-s3-md">{modal.meta[language]}</p>
              <div className="mh-s3-mft">
                <span className="mh-s3-mnote">{t.modalNote}</span>
                <button type="button" className="mh-s3-mcta" onClick={onUpload}>
                  {t.modalCta} <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default WorksGallery;
