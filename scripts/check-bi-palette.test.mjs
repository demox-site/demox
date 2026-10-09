// 设计规则（DESIGN-PRINCIPLES.md 第 1 节 + 第 7 节「要清理的」）：
// 整个控制台和管理后台只用黑 / 白 / 灰；唯一的彩色是 --success（Tailwind 里写 text-success / bg-success），只表示变好或成功；
// 坏消息用墨色加图标，不用红色。emerald-* / green-* 等写死的绿色一律不允许（亮色下太浅，且会出现好几种绿）。
// 原来只查 BI 看板（src/pages/admin/bi），v13 起扩大到整个控制台和后台。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const SCOPE = [
  "src/pages/admin",
  "src/pages/AdminDashboard.tsx",
  "src/pages/console",
  "src/components/console",
  "src/components/home", // 控制台站点页用的组件（站点行、设置、域名、删除确认）
  "src/layouts/ConsoleLayout.tsx",
  "src/layouts/components/header.tsx", // 顶部导航，每个页面都有
  "src/pages/home.jsx", // 控制台「部署」页
  "src/components/ui/toast.tsx",
  "src/components/ui/toaster.tsx",
  "src/components/ui/confirm-destructive.tsx",
  "src/lib/ink-palette.ts"
];
const SKIP = new Set(["src/pages/admin/bi/fixtures.ts"]);

function walk(p) {
  const abs = join(ROOT, p);
  if (statSync(abs).isFile()) return [p];
  return readdirSync(abs).flatMap((f) => walk(join(p, f)));
}
const files = SCOPE.flatMap(walk).filter((f) => /\.(tsx?|jsx?|css)$/.test(f) && !/\.test\./.test(f) && !SKIP.has(f));

// Tailwind 彩色色板一律不允许（包括 emerald / green）；成功用 success token。
const TW_COLORS = /\b(?:bg|text|border|from|via|to|ring|fill|stroke|decoration|outline|shadow|divide|accent|caret|placeholder)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate)-\d{2,3}\b/g;
const STATUS_TOKENS = /\b(?:bg|text|border|ring|fill|stroke)-(warning|brand|link)\b|hsl\(var\(--(warning|brand|link)\)/g;

function isGray(hex) {
  const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) <= 12; // zinc/neutral 允许极轻微色偏
}

function paletteViolations(src) {
  const bad = [];
  for (const m of src.matchAll(TW_COLORS)) bad.push(m[0]);
  for (const m of src.matchAll(STATUS_TOKENS)) bad.push(m[0]);
  for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) if (!isGray(m[0])) bad.push(m[0]);
  for (const m of src.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    const [r, g, b] = m.slice(1, 4).map(Number);
    if (Math.max(r, g, b) - Math.min(r, g, b) > 12) bad.push(m[0]);
  }
  for (const m of src.matchAll(/\b(violet|purple|amber|cyan|teal|emerald)\b/gi)) bad.push(m[0]);
  return bad;
}

test("scope covers the console, every admin tab and the site analytics page", () => {
  for (const must of ["src/pages/console/SiteAnalyticsPage.tsx", "src/pages/AdminDashboard.tsx", "src/pages/admin/bi/BiSections.tsx"]) {
    assert.ok(files.includes(must), `${must} 不在检查范围里`);
  }
  assert.ok(files.length >= 25, `只扫到 ${files.length} 个文件`);
});

for (const f of files) {
  test(`palette: ${f}`, () => {
    assert.deepEqual(paletteViolations(readFileSync(join(ROOT, f), "utf8")), [], `${f} 用了黑白灰 / emerald 以外的颜色`);
  });
}

// --step-1/2/3 和 --destructive 在控制台里被直接使用（流程步骤、危险按钮、报错 toast），所以 token 本身必须是墨色。
test("--step-1/2/3 and --destructive are ink (saturation 0) in light and dark", () => {
  const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
  for (const name of ["step-1", "step-2", "step-3", "destructive", "destructive-foreground"]) {
    const values = [...css.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());
    assert.equal(values.length, 2, `--${name} 应该在 :root 和 .dark 各定义一次`);
    for (const v of values) {
      const [, s] = v.split(/\s+/);
      assert.equal(s, "0%", `--${name}: ${v} 不是灰色`);
    }
  }
  assert.doesNotMatch(css, /rgba\(25,\s*45,\s*90/, "卡片阴影不要偏蓝");
});

// 图表：每张图最多 3 条数据线，线名直接标在线尾（label=），不用图例。
test("charts have at most 3 series, end labels on every line/area, and no legend", () => {
  for (const f of files.filter((x) => /\.tsx$/.test(x))) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /<Legend\b/, `${f} 用了图例`);
    for (const m of src.matchAll(/<(LineChart|AreaChart|BarChart|ComposedChart)\b[\s\S]*?<\/\1>/g)) {
      const series = [...m[0].matchAll(/<(Line|Area|Bar)\s[\s\S]*?\/>/g)];
      assert.ok(series.length <= 3, `${f}: 一张图有 ${series.length} 条数据线`);
      for (const s of series) {
        if (s[1] === "Bar") continue;
        assert.match(s[0], /\blabel=/, `${f}: 这条线没有标线尾名字\n${s[0].slice(0, 120)}`);
      }
    }
  }
});

// 坏消息用「墨色 + 图标」：控制台里所有报错提示都要带图标。
test("error messages in the console carry an icon", () => {
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/<(div|p)[^>]*role="alert"[^>]*>([\s\S]{0,200})/g)) {
      assert.match(m[2], /<(AlertCircle|AlertTriangle|XCircle|Ban)\b/, `${f}: role="alert" 没有图标`);
    }
  }
});

test("the checker itself rejects red, purple, blue, amber and hard-coded greens", () => {
  assert.deepEqual(paletteViolations('className="text-red-400 bg-violet-500/10" style={{ color: "#38bdf8" }} stroke="#f59e0b"'),
    ["text-red-400", "bg-violet-500", "#38bdf8", "#f59e0b", "violet"]);
  assert.deepEqual(paletteViolations('className="text-emerald-400 bg-green-500/10" fill="#22c55e"'),
    ["text-emerald-400", "bg-green-500", "#22c55e", "emerald"]);
  assert.deepEqual(paletteViolations('className="text-success bg-success/10 text-zinc-300" fill="#111111" stroke="rgba(17,17,17,.1)"'), []);
});

// --success 是唯一的绿色：亮色下要够深（小字在白底上能读），暗色下要够亮。
test("--success is the single green and readable in both themes", () => {
  const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
  const values = [...css.matchAll(/--success:\s*([^;]+);/g)].map((m) => m[1].trim().split(/\s+/));
  assert.equal(values.length, 2, "--success 应该在 :root 和 .dark 各定义一次");
  const [light, dark] = values;
  assert.ok(parseFloat(light[2]) <= 35, `亮色 --success 太浅（L=${light[2]}），白底上的小字看不清`);
  assert.ok(parseFloat(dark[2]) >= 50, `暗色 --success 太暗（L=${dark[2]}）`);
});

// 图表颜色要跟着亮 / 暗主题走：页面里不能写死十六进制颜色，统一从 src/lib/ink-palette.ts（useInkPalette）取。
test("no hard-coded hex colors outside ink-palette.ts (charts must be theme-aware)", () => {
  for (const f of files.filter((x) => /\.(tsx|jsx)$/.test(x))) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.deepEqual(src.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/g) || [], [], `${f} 写死了颜色，改用 useInkPalette()`);
  }
});

// 危险操作确认：统一用 ConfirmDestructive（墨色实心按钮 + 警告图标），按钮写后果，不写「确定 / OK」，也不用 window.confirm。
test("destructive confirms use ConfirmDestructive with a consequence label", () => {
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /window\.confirm\(/, `${f} 用了 window.confirm（只能显示「确定 / OK」）`);
    if (!f.endsWith("confirm-destructive.tsx")) {
      assert.doesNotMatch(src, /<AlertDialogAction\b/, `${f} 直接用了 AlertDialogAction，改用 ConfirmDestructive`);
    }
    for (const m of src.matchAll(/confirmLabel=\{?\s*["'`]([^"'`]+)["'`]/g)) {
      assert.doesNotMatch(m[1], /^(确定|确认|好的?|OK|Ok|Confirm|Yes)$/, `${f}: 按钮要写后果，不要写「${m[1]}」`);
    }
  }
  const tr = readFileSync(join(ROOT, "src/pages/home-translations.js"), "utf8");
  for (const key of ["deleteConfirmButton", "projectDeleteConfirm"]) {
    for (const m of tr.matchAll(new RegExp(`${key}:\\s*"([^"]+)"`, "g"))) {
      assert.match(m[1], /删除|Delete/, `${key}「${m[1]}」要写清后果`);
      assert.doesNotMatch(m[1], /^(确定|确认)/, `${key}「${m[1]}」不要以「确定 / 确认」开头`);
    }
  }
  const dialog = readFileSync(join(ROOT, "src/components/ui/confirm-destructive.tsx"), "utf8");
  assert.match(dialog, /<AlertTriangle\b/, "确认弹窗要有警告图标");
  assert.match(dialog, /bg-\[var\(--stitch-ink\)\]/, "确认按钮要是实心墨色");
});

// 设计规则：KPI 卡标题 / 说明不允许用省略号截断（手机端改用短标题 + 换行）。
test("no ellipsis truncation in KPI cards", () => {
  const src = readFileSync(join(ROOT, "src/pages/admin/bi/AdminBiOverview.tsx"), "utf8");
  assert.deepEqual(src.match(/\b(truncate|text-ellipsis|line-clamp-\d)\b/g) || [], []);
});

