import React, { useEffect, useRef } from "react";
import { CloudUpload, Lock, RotateCcw } from "lucide-react";
import { LAND_MASK_B64 } from "./landMask";
import type { Language } from "@/hooks/use-language";

const D2R = Math.PI / 180;

function decodeLand() {
  const bin = atob(LAND_MASK_B64);
  const bits = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
  return bits;
}

function isLand(bits: Uint8Array, lat: number, lon: number) {
  const r = Math.min(179, Math.max(0, Math.floor(90 - lat)));
  const c = ((Math.floor(lon + 180) % 360) + 360) % 360;
  const k = r * 360 + c;
  return (bits[k >> 3] >> (k & 7)) & 1;
}

function vec(lat: number, lon: number): [number, number, number] {
  const la = lat * D2R;
  const lo = lon * D2R;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

function angle(a: number[], b: number[]) {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

function slerpArc(
  a: number[],
  b: number[],
  n: number,
  lift: (om: number) => number
) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const om = Math.acos(Math.max(-1, Math.min(1, dot)));
  const so = Math.sin(om) || 1;
  const out = new Float32Array((n + 1) * 3);
  const h = lift(om);
  if (om < 1e-4) {
    for (let q = 0; q <= n; q++) {
      out[q * 3] = a[0];
      out[q * 3 + 1] = a[1];
      out[q * 3 + 2] = a[2];
    }
    return { p: out, n, om: 0 };
  }
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const s1 = Math.sin((1 - t) * om) / so;
    const s2 = Math.sin(t * om) / so;
    const r = 1 + h * Math.sin(Math.PI * t);
    out[k * 3] = (a[0] * s1 + b[0] * s2) * r;
    out[k * 3 + 1] = (a[1] * s1 + b[1] * s2) * r;
    out[k * 3 + 2] = (a[2] * s1 + b[2] * s2) * r;
  }
  return { p: out, n, om };
}

function sprite(stops: Array<[number, string]>, size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach((s) => r.addColorStop(s[0], s[1]));
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  return c;
}

const NODE_LATLONS: Array<[number, number]> = [
  [37.5, -122], [40.5, -74.5], [19.5, -99], [-23.5, -46.5], [51.5, 0],
  [50, 8.5], [59.5, 18], [-26, 28], [25, 55.5], [19, 73],
  [1.5, 104], [35.5, 139.5], [37.5, 127], [31, 121.5], [-33.5, 151],
];

const copy = {
  zh: {
    badge: "全球分发",
    title: "从代码到全球",
    sub: "自动分发至全球边缘节点，即刻访问。拿到带 HTTPS 和 CDN 的公开链接。",
    points: [
      {
        title: "上传至边缘网络",
        desc: "跳过服务器配置，demox deploy、网页上传或 MCP 直接发布到边缘。",
      },
      {
        title: "自动 HTTPS",
        desc: "发布后得到公网 HTTPS 地址。独立域名写一条 CNAME，证书由 Demox 签发。",
      },
      {
        title: "更新同一个网站",
        desc: "重新部署后新产物替换当前版本，原分享链接继续可用；边缘缓存最长约 60 秒同步。",
      },
    ],
    tags: ["全球 CDN", "DDoS 防护", "自动 HTTPS", "独立域名"],
    hint: "拖动旋转，点击发布",
    upload: "上传至边缘网络...",
    spread: "自动分发至全球边缘节点",
    live: "即刻访问 · 已部署",
    legend: [
      ["边缘节点", "lg-node"],
      ["部署同步", "lg-sync"],
      ["访问请求", "lg-req"],
    ] as const,
    note: "节点位置为示意",
    aria: "全球节点示意图：拖动或用左右方向键旋转地球；点击地球上的位置或按回车，从那里发起一次部署",
  },
  en: {
    badge: "Global edge",
    title: "From code to global",
    sub: "Auto-distributed to global edge nodes for instant access — HTTPS and CDN included.",
    points: [
      {
        title: "Upload to the edge",
        desc: "Skip server setup — publish via demox deploy, web upload, or MCP.",
      },
      {
        title: "Auto HTTPS",
        desc: "Get a public HTTPS URL. Point a CNAME at Demox for a custom domain and certificate.",
      },
      {
        title: "Redeploy in place",
        desc: "New builds replace the current version; your share link stays the same. Edge cache syncs within ~60s.",
      },
    ],
    tags: ["Global CDN", "DDoS protection", "Auto HTTPS", "Custom domain"],
    hint: "Drag to rotate, click to deploy",
    upload: "Uploading to Edge Network...",
    spread: "Distributing to global edge nodes",
    live: "Live · Deployed",
    legend: [
      ["Edge node", "lg-node"],
      ["Deploy sync", "lg-sync"],
      ["Request", "lg-req"],
    ] as const,
    note: "Node positions are illustrative",
    aria: "Global edge globe: drag or use arrow keys to rotate; click or press Enter to launch a deploy wave",
  },
};

interface Props {
  language: Language;
}

export const GlobeNodes: React.FC<Props> = ({ language }) => {
  const t = copy[language] ?? copy.zh;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const urlRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bits = decodeLand();
    const ORIGIN = { v: vec(22.3, 114.2) };
    type Node = {
      v: [number, number, number];
      sync: number;
      ping: number;
      blink: number;
      arc?: ReturnType<typeof slerpArc>;
      delay?: number;
      dur?: number;
    };
    const NODES: Node[] = NODE_LATLONS.map((p) => ({
      v: vec(p[0], p[1]),
      sync: 0,
      ping: -9,
      blink: -9,
    }));
    NODES.forEach((nd) => {
      nd.arc = slerpArc(ORIGIN.v, nd.v, 56, (om) => Math.min(0.13, 0.03 + 0.14 * om / Math.PI));
      const a = nd.arc.om;
      nd.delay = 0.12 + a * 0.55;
      nd.dur = 0.75 + a * 0.55;
    });

    const GLOW = sprite(
      [
        [0, "rgba(74,222,128,.9)"],
        [0.18, "rgba(34,197,94,.5)"],
        [0.45, "rgba(34,197,94,.14)"],
        [1, "rgba(34,197,94,0)"],
      ],
      96
    );
    const CORE = sprite(
      [
        [0, "rgba(255,255,255,1)"],
        [0.4, "rgba(240,253,244,1)"],
        [0.65, "rgba(134,239,172,.9)"],
        [1, "rgba(34,197,94,0)"],
      ],
      48
    );

    let W = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let R = 0;
    let cx = 0;
    let cy = 0;
    let PTS: Float32Array | null = null;
    let NP = 0;
    let dotPx = 1.5;
    const DP = 3.4;
    let RS = 1;

    function build() {
      const w = Math.round(wrap!.clientWidth);
      if (!w) return false;
      if (w === W && PTS) return false;
      W = w;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv!.width = Math.round(W * dpr);
      cv!.height = Math.round(W * dpr);
      R = W * 0.4;
      cx = W / 2;
      cy = W * 0.47;
      RS = (R * DP) / Math.sqrt(DP * DP - 1);
      const s = R > 200 ? 6.1 : R > 150 ? 5.4 : 4.9;
      dotPx = R > 200 ? 1.55 : 1.35;
      const N = Math.round((4 * Math.PI * R * R) / (s * s));
      const g = Math.PI * (3 - Math.sqrt(5));
      const tmp: number[] = [];
      for (let k = 0; k < N; k++) {
        const y = 1 - (2 * (k + 0.5)) / N;
        const rr = Math.sqrt(1 - y * y);
        const ph = k * g;
        const x = Math.cos(ph) * rr;
        const z = Math.sin(ph) * rr;
        const lat = Math.asin(y) / D2R;
        const lon = Math.atan2(x, z) / D2R;
        if (lat < -58) continue;
        if (isLand(bits, lat, lon)) tmp.push(x, y, z);
      }
      PTS = new Float32Array(tmp);
      NP = tmp.length / 3;
      return true;
    }

    let rot = 0.55;
    let tilt = 0.36;
    let spin = 0.18;
    let lastInput = 0;
    let running = false;
    let visible = true;
    let simT = 3.1;
    const CYCLE = 9.5;
    const T0 = 0.8;
    let cyc = simT % CYCLE;
    let last = 0;
    type Req = { arc: ReturnType<typeof slerpArc>; node: Node; t0: number; dur: number; done: boolean };
    const reqs: Req[] = [];
    const o = { x: 0, y: 0, z: 0, f: 1, sx: 0, sy: 0 };
    let cr = 1;
    let sr = 0;
    let ct = Math.cos(tilt);
    let st = Math.sin(tilt);
    const L = [-0.45, 0.55, 0.7];
    {
      const m = Math.hypot(L[0], L[1], L[2]);
      L[0] /= m;
      L[1] /= m;
      L[2] /= m;
    }

    function tf(x: number, y: number, z: number) {
      const x1 = x * cr - z * sr;
      const z1 = x * sr + z * cr;
      const y2 = y * ct - z1 * st;
      const z2 = y * st + z1 * ct;
      const f = DP / (DP - z2);
      o.x = x1;
      o.y = y2;
      o.z = z2;
      o.f = f;
      o.sx = cx + x1 * R * f;
      o.sy = cy - y2 * R * f;
      return o;
    }
    function hidden() {
      return o.z < 0;
    }

    let lastState = "";
    function setCard(state: string, prog: number) {
      if (state !== lastState) {
        lastState = state;
        if (cardRef.current) {
          cardRef.current.className =
            "mh-s2-card " + (state === "live" ? "live" : "busy");
        }
        if (statusRef.current) {
          statusRef.current.textContent =
            state === "upload"
              ? t.upload
              : state === "spread"
                ? t.spread
                : t.live;
        }
        if (urlRef.current) {
          urlRef.current.textContent =
            state === "live" ? "https://coffee.demox.site" : "coffee.demox.site";
        }
      }
      if (barRef.current) barRef.current.style.width = (prog * 100).toFixed(1) + "%";
    }

    function spawnReq(age?: number) {
      if (!NP || !PTS) return;
      for (let tries = 0; tries < 14; tries++) {
        const k = ((Math.random() * NP) | 0) * 3;
        const v = [PTS[k], PTS[k + 1], PTS[k + 2]];
        tf(v[0], v[1], v[2]);
        if (o.z < 0.25) continue;
        let best: Node | null = null;
        let ba = 9;
        NODES.forEach((nd) => {
          const a = angle(v, nd.v);
          if (a < ba) {
            ba = a;
            best = nd;
          }
        });
        if (!best || ba < 0.03) continue;
        const arc = slerpArc(v, best.v, 24, (om) => 0.02 + (0.12 * om) / Math.PI);
        reqs.push({ arc, node: best, t0: simT - (age || 0), dur: 0.55 + ba * 1.1, done: false });
        return;
      }
    }

    function drawTrail(
      arc: ReturnType<typeof slerpArc>,
      head: number,
      trail: number,
      color: string,
      width: number,
      glow: boolean
    ) {
      const n = arc.n;
      const p = arc.p;
      const a0 = Math.max(0, head - trail);
      const segs = 10;
      let prevOK = false;
      let px = 0;
      let py = 0;
      for (let s = 0; s <= segs; s++) {
        const tt = a0 + ((head - a0) * s) / segs;
        const fi = tt * n;
        const i0 = Math.min(n - 1, Math.floor(fi));
        const fr = fi - i0;
        const x = p[i0 * 3] + (p[i0 * 3 + 3] - p[i0 * 3]) * fr;
        const y = p[i0 * 3 + 1] + (p[i0 * 3 + 4] - p[i0 * 3 + 1]) * fr;
        const z = p[i0 * 3 + 2] + (p[i0 * 3 + 5] - p[i0 * 3 + 2]) * fr;
        tf(x, y, z);
        const ok = !hidden();
        const sx = o.sx;
        const sy = o.sy;
        const zf = Math.max(
          0,
          Math.min(1, o.z / 0.3, (0.99 - Math.hypot(o.sx - cx, o.sy - cy) / RS) / 0.08)
        );
        if (s > 0 && ok && prevOK) {
          const al = (s / segs) * zf;
          if (glow) {
            ctx!.strokeStyle = `rgba(34,197,94,${0.14 * al})`;
            ctx!.lineWidth = width * 4 * al + 1;
            ctx!.beginPath();
            ctx!.moveTo(px, py);
            ctx!.lineTo(sx, sy);
            ctx!.stroke();
          }
          ctx!.strokeStyle = color.replace(
            "A",
            ((glow ? 0.9 : 0.5) * al * al).toFixed(3)
          );
          ctx!.lineWidth = width * al + 0.4;
          ctx!.beginPath();
          ctx!.moveTo(px, py);
          ctx!.lineTo(sx, sy);
          ctx!.stroke();
        }
        prevOK = ok;
        px = sx;
        py = sy;
      }
      return prevOK
        ? {
            x: px,
            y: py,
            a: Math.max(
              0,
              Math.min(1, o.z / 0.3, (0.99 - Math.hypot(o.sx - cx, o.sy - cy) / RS) / 0.08)
            ),
          }
        : null;
    }

    const B: number[][] = [[], [], [], [], [], []];
    const BA = [0.13, 0.2, 0.28, 0.37, 0.47, 0.58];

    function draw() {
      if (!PTS) return;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, W);
      cr = Math.cos(rot);
      sr = Math.sin(rot);
      ct = Math.cos(tilt);
      st = Math.sin(tilt);

      ctx!.fillStyle = "rgba(17,17,17,.16)";
      ctx!.beginPath();
      for (let k = 0; k < NP; k++) {
        const x = PTS[k * 3];
        const y = PTS[k * 3 + 1];
        const z = PTS[k * 3 + 2];
        tf(x, y, z);
        if (o.z < 0) {
          const d = dotPx * 0.8;
          ctx!.rect(o.sx - d / 2, o.sy - d / 2, d, d);
        }
      }
      ctx!.fill();

      const g = ctx!.createRadialGradient(
        cx - R * 0.38,
        cy - R * 0.42,
        R * 0.05,
        cx,
        cy,
        R * 1.04
      );
      g.addColorStop(0, "rgba(255,255,255,.93)");
      g.addColorStop(0.55, "rgba(250,250,248,.86)");
      g.addColorStop(1, "rgba(232,232,229,.86)");
      ctx!.beginPath();
      ctx!.arc(cx, cy, (R * DP) / Math.sqrt(DP * DP - 1) * 0.985, 0, 6.2832);
      ctx!.fillStyle = g;
      ctx!.fill();
      ctx!.lineWidth = 1;
      ctx!.strokeStyle = "rgba(17,17,17,.12)";
      ctx!.stroke();

      for (let k = 0; k < 6; k++) B[k].length = 0;
      for (let k = 0; k < NP; k++) {
        const x = PTS[k * 3];
        const y = PTS[k * 3 + 1];
        const z = PTS[k * 3 + 2];
        tf(x, y, z);
        if (o.z < 0.02) continue;
        const lam = o.x * L[0] + o.y * L[1] + o.z * L[2];
        const a = 0.1 + 0.5 * Math.pow(o.z, 0.7) * (0.8 + 0.2 * lam);
        const b = Math.min(5, Math.max(0, Math.round((a - 0.13) / 0.09)));
        B[b].push(o.sx, o.sy, o.f);
      }
      for (let k = 0; k < 6; k++) {
        const arr = B[k];
        if (!arr.length) continue;
        ctx!.fillStyle = `rgba(17,17,17,${BA[k]})`;
        ctx!.beginPath();
        for (let j = 0; j < arr.length; j += 3) {
          const dd = dotPx * arr[j + 2];
          ctx!.rect(arr[j] - dd / 2, arr[j + 1] - dd / 2, dd, dd);
        }
        ctx!.fill();
      }

      ctx!.beginPath();
      ctx!.arc(cx, cy, R * 1.0, Math.PI * 1.05, Math.PI * 1.45);
      ctx!.strokeStyle = "rgba(255,255,255,.9)";
      ctx!.lineWidth = 2;
      ctx!.stroke();

      const ph = cyc;
      const ctT = ph - T0;
      let arrived = 0;
      ctx!.lineCap = "round";

      NODES.forEach((nd) => {
        const lt = ctT - (nd.delay || 0);
        const p = lt / (nd.dur || 1);
        if (p < 0 || !nd.arc) return;
        const head = Math.min(1, p);
        if (p >= 1) {
          arrived++;
          nd.sync = Math.min(1, (p - 1) * 2);
          if (nd.blink < 0) nd.blink = simT;
        }
        drawTrail(nd.arc, head, 0.22, "rgba(34,197,94,A)", 2.2, true);
        if (head < 1) {
          const tip = drawTrail(nd.arc, head, 0.001, "rgba(34,197,94,A)", 2.2, false);
          if (tip) {
            const gs = 10 * tip.a;
            ctx!.globalAlpha = 0.9 * tip.a;
            ctx!.drawImage(GLOW, tip.x - gs, tip.y - gs, gs * 2, gs * 2);
            ctx!.globalAlpha = 1;
            const cr2 = 2.6 * tip.a;
            ctx!.drawImage(CORE, tip.x - cr2, tip.y - cr2, cr2 * 2, cr2 * 2);
          }
        }
      });

      // origin
      tf(ORIGIN.v[0], ORIGIN.v[1], ORIGIN.v[2]);
      if (!hidden()) {
        const gs = 14;
        ctx!.globalAlpha = 0.85;
        ctx!.drawImage(GLOW, o.sx - gs, o.sy - gs, gs * 2, gs * 2);
        ctx!.globalAlpha = 1;
        ctx!.beginPath();
        ctx!.arc(o.sx, o.sy, 3.5, 0, 6.2832);
        ctx!.fillStyle = "#111";
        ctx!.fill();
        ctx!.strokeStyle = "#22c55e";
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
      }

      NODES.forEach((nd) => {
        tf(nd.v[0], nd.v[1], nd.v[2]);
        if (hidden()) return;
        const pulse =
          nd.blink > 0 ? Math.max(0, 1 - (simT - nd.blink) * 1.2) : 0;
        const r = 3.2 + pulse * 2;
        ctx!.beginPath();
        ctx!.arc(o.sx, o.sy, r + 4, 0, 6.2832);
        ctx!.fillStyle = `rgba(34,197,94,${0.12 + 0.25 * pulse})`;
        ctx!.fill();
        ctx!.beginPath();
        ctx!.arc(o.sx, o.sy, r, 0, 6.2832);
        ctx!.fillStyle = pulse > 0.1 ? "#4ade80" : "#16a34a";
        ctx!.fill();
        ctx!.strokeStyle = "#fff";
        ctx!.lineWidth = 1.2;
        ctx!.stroke();
      });

      // request arcs
      for (let i = reqs.length - 1; i >= 0; i--) {
        const rq = reqs[i];
        const p = (simT - rq.t0) / rq.dur;
        if (p >= 1) {
          rq.node.ping = simT;
          reqs.splice(i, 1);
          continue;
        }
        drawTrail(rq.arc, Math.min(1, p), 0.35, "rgba(96,165,250,A)", 1.4, false);
      }

      let state = "upload";
      let prog = 0;
      if (ctT < 0) {
        state = "upload";
        prog = Math.max(0, ph / T0);
      } else if (arrived < NODES.length) {
        state = "spread";
        prog = 0.15 + 0.7 * (arrived / NODES.length);
      } else {
        state = "live";
        prog = 1;
      }
      setCard(state, prog);
    }

    function tick(now: number) {
      if (!visible) {
        running = false;
        return;
      }
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      simT += dt;
      cyc = simT % CYCLE;

      const idle = now - lastInput;
      if (!drag) {
        if (Math.abs(spin) > 0.02) {
          rot += spin * dt;
          spin *= Math.exp(-dt * 1.4);
        } else if (idle > 1200) {
          spin += (0.18 - spin) * (1 - Math.exp(-dt / 1.2));
          rot += spin * dt;
        }
      }

      if (Math.random() < dt * 0.55) spawnReq();
      draw();
      requestAnimationFrame(tick);
    }

    function start() {
      if (running || reduce) return;
      running = true;
      last = 0;
      requestAnimationFrame(tick);
    }

    // drag / click
    type Drag = {
      id: number;
      x: number;
      y: number;
      t: number;
      t0: number;
      v: number;
      on: boolean;
      touch: boolean;
    } | null;
    let drag: Drag = null;

    function local(e: PointerEvent) {
      const r = cv!.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * W };
    }

    function pickSphere(p: { x: number; y: number }) {
      const dx = (p.x - cx) / R;
      const dy = -(p.y - cy) / R;
      const rr = dx * dx + dy * dy;
      if (rr > 0.98) return null;
      // inverse of perspective approx: pick nearest front land point
      if (!PTS) return null;
      let best: number[] | null = null;
      let bd = 1e9;
      for (let k = 0; k < NP; k++) {
        tf(PTS[k * 3], PTS[k * 3 + 1], PTS[k * 3 + 2]);
        if (o.z < 0.1) continue;
        const d = Math.hypot(o.sx - p.x, o.sy - p.y);
        if (d < bd) {
          bd = d;
          best = [PTS[k * 3], PTS[k * 3 + 1], PTS[k * 3 + 2]];
        }
      }
      return bd < 28 ? best : best && bd < 48 ? best : null;
    }

    function launch(v: number[] | null) {
      if (!v) {
        // restart wave from current phase
        cyc = T0;
        simT = Math.floor(simT / CYCLE) * CYCLE + T0;
        NODES.forEach((nd) => {
          nd.blink = -9;
          nd.sync = 0;
        });
        return;
      }
      // re-origin arcs from click
      const origin = { v: v as [number, number, number] };
      NODES.forEach((nd) => {
        nd.arc = slerpArc(origin.v, nd.v, 56, (om) =>
          Math.min(0.13, 0.03 + (0.14 * om) / Math.PI)
        );
        const a = nd.arc.om;
        nd.delay = 0.08 + a * 0.45;
        nd.dur = 0.65 + a * 0.5;
        nd.blink = -9;
        nd.sync = 0;
      });
      cyc = T0;
      simT = Math.floor(simT / CYCLE) * CYCLE + T0;
      lastInput = performance.now();
    }

    function onTap(p: { x: number; y: number }) {
      const v = pickSphere(p);
      launch(v);
      if (!running) draw();
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        t0: e.timeStamp,
        v: 0,
        on: false,
        touch: e.pointerType !== "mouse",
      };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.on) {
        if (Math.hypot(dx, dy) < 6) return;
        if (drag.touch && Math.abs(dy) > Math.abs(dx)) {
          drag = null;
          return;
        }
        drag.on = true;
        wrap!.classList.add("s2-dragging");
        try {
          cv!.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      const dts = Math.max(0.001, (e.timeStamp - drag.t) / 1000);
      const dr = -dx / (R * 1.05);
      rot += dr;
      if (!drag.touch) tilt = Math.max(-0.1, Math.min(0.8, tilt + dy / (R * 1.6)));
      drag.v = drag.v * 0.5 + (dr / dts) * 0.5;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.t = e.timeStamp;
      lastInput = performance.now();
      if (!running) draw();
    };
    const endDrag = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      wrap!.classList.remove("s2-dragging");
      if (d.on) {
        spin = e.timeStamp - d.t > 90 ? 0 : Math.max(-5, Math.min(5, d.v));
        lastInput = performance.now();
      } else if (e.type === "pointerup" && e.timeStamp - d.t0 < 700) {
        onTap(local(e));
      }
    };

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", endDrag);
    cv.addEventListener("pointercancel", endDrag);
    cv.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? 1 : -1;
        spin = dir * 1.4;
        lastInput = performance.now();
        if (!running) {
          rot += dir * 0.25;
          draw();
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        launch([ORIGIN.v[0], ORIGIN.v[1], ORIGIN.v[2]]);
      }
    });

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) start();
      },
      { rootMargin: "160px" }
    );
    io.observe(wrap);

    const ro = new ResizeObserver(() => {
      if (build()) {
        if (reduce) draw();
        else if (!running) draw();
      }
    });
    ro.observe(wrap);

    build();
    // seed a few requests
    for (let i = 0; i < 5; i++) spawnReq(Math.random() * 2);
    draw();
    if (!reduce) start();
    else setCard("live", 1);

    return () => {
      visible = false;
      running = false;
      io.disconnect();
      ro.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", endDrag);
      cv.removeEventListener("pointercancel", endDrag);
    };
  }, [language, t]);

  const icons = [CloudUpload, Lock, RotateCcw];

  return (
    <section className="mh-s2" id="workflow" aria-labelledby="mh-s2-title">
      <div className="mh-s2-in">
        <div className="mh-s2-copy">
          <div className="mh-badge">
            <i />
            {t.badge}
          </div>
          <h2 id="mh-s2-title" className="mh-s2-title">
            {t.title}
          </h2>
          <p className="mh-s2-sub">{t.sub}</p>
          <ul className="mh-s2-points">
            {t.points.map((p, i) => {
              const Icon = icons[i];
              return (
                <li key={p.title}>
                  <span className="mh-s2-ic">
                    <Icon size={17} strokeWidth={1.9} />
                  </span>
                  <div>
                    <b>{p.title}</b>
                    <span>{p.desc}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mh-s2-tags">
            {t.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
        <div className="mh-s2-viz">
          <div className="mh-ix-hint mh-s2-hint" aria-hidden="true">
            <RotateCcw size={12} strokeWidth={2.2} />
            {t.hint}
          </div>
          <div className="mh-globe-wrap" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              id="mh-globe"
              tabIndex={0}
              role="button"
              aria-label={t.aria}
            />
          </div>
          <div className="mh-s2-meta">
            <div className="mh-s2-card busy" ref={cardRef} aria-hidden="true">
              <span className="mh-dot" />
              <div className="mh-s2-tx">
                <b>
                  <span ref={statusRef}>{t.upload}</span>
                </b>
                <em ref={urlRef as React.RefObject<HTMLElement>}>coffee.demox.site</em>
                <div className="mh-s2-bar">
                  <i ref={barRef as React.RefObject<HTMLElement>} />
                </div>
              </div>
            </div>
            <div className="mh-s2-legend" aria-hidden="true">
              {t.legend.map(([label, cls]) => (
                <span key={cls}>
                  <i className={cls} />
                  {label}
                </span>
              ))}
              <span className="mh-note">{t.note}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default GlobeNodes;
