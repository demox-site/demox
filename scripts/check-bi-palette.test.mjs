// 设计规则：BI 看板只用黑 / 白 / 灰，绿色（emerald）只表示变好或成功，其他颜色都不允许。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../src/pages/admin/bi/", import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => /\.(tsx?|css)$/.test(f) && f !== "fixtures.ts");
const TW_COLORS = /\b(?:bg|text|border|from|via|to|ring|fill|stroke|decoration|outline|shadow|divide|accent|caret)-(red|orange|amber|yellow|lime|green|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

function isGray(hex) {
  const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) <= 12; // zinc/neutral 允许极轻微色偏
}

for (const f of files) {
  test(`palette: ${f}`, () => {
    const src = readFileSync(join(DIR, f), "utf8");
    const bad = [];
    for (const m of src.matchAll(TW_COLORS)) bad.push(m[0]);
    for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) if (!isGray(m[0])) bad.push(m[0]);
    for (const m of src.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
      const [r, g, b] = m.slice(1, 4).map(Number);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 12) bad.push(m[0]);
    }
    for (const m of src.matchAll(/\b(violet|purple|amber)\b/gi)) bad.push(m[0]);
    assert.deepEqual(bad, [], `${f} 用了黑白灰 / emerald 以外的颜色`);
  });
}
