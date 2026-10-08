import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import {
  PROJECT_ROOT, BASELINE_PATH, ENFORCED_FILES,
  scanProject, scanSource, evaluate, loadJson,
} from "./check-hardcoded-cjk.mjs";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

test("src/ has no new hardcoded Chinese (homepage = 0, other files ≤ baseline)", async () => {
  const result = await scanProject();
  const violations = evaluate(result, await loadJson(BASELINE_PATH, {}));
  assert.deepEqual(violations, [], "\n" + violations.join("\n") +
    "\nMove the text into the zh/en translations (see src/components/marketing/marketing-translations.ts)," +
    " or add a reasoned entry to scripts/i18n-cjk-allowlist.json if it must stay Chinese.");
});

test("homepage files are never baselined", async () => {
  const baseline = await loadJson(BASELINE_PATH, {});
  for (const f of ENFORCED_FILES) assert.equal(baseline[f], undefined, `${f} must not be in the baseline`);
});

test("a new hardcoded Chinese string on the homepage fails", () => {
  const file = "src/pages/index.tsx";
  const hits = scanSource(`export const X = () => <section aria-label="新功能"><h2>立即上传</h2>{"再试一次"}</section>;`, file);
  assert.equal(hits.length, 3);
  const v = evaluate({ offenders: hits, byFile: { [file]: hits.length } }, {});
  assert.equal(v.length, 3);
});

test("a hardcoded Chinese string in a new (unbaselined) file fails", () => {
  const file = "src/components/NewThing.tsx";
  const hits = scanSource(`export const t = () => toast({ title: "保存成功" });`, file);
  assert.deepEqual(evaluate({ offenders: hits, byFile: { [file]: hits.length } }, {}).length, 1);
});

test("localized patterns are accepted", () => {
  const code = `
    const translations = { zh: { title: "标题", list: ["一", "二"] }, en: { title: "Title" } };
    const a = isZh ? "中文" : "English";
    const b = lang === "zh" ? <b>中文</b> : <b>English</b>;
    const c = { caption: "说明", captionEn: "Caption" };
    // 注释里的中文不算
    if (language === "zh") { label = "中文"; }
  `;
  assert.deepEqual(scanSource(code, "src/x.tsx"), []);
});

/** Collect CJK literals under the object property `en` of a source file. */
async function cjkUnderEn(rel) {
  const code = await readFile(path.join(PROJECT_ROOT, rel), "utf8");
  const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.Latest, true);
  const bad = [];
  const visit = (node, inEn) => {
    if (ts.isPropertyAssignment(node) && node.name && node.name.getText(sf) === "en") inEn = true;
    if (inEn && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CJK.test(node.text)) bad.push(node.text);
    ts.forEachChild(node, (c) => visit(c, inEn));
  };
  visit(sf, false);
  return bad;
}

test("English homepage copy contains no Chinese", async () => {
  assert.deepEqual(await cjkUnderEn("src/components/marketing/marketing-translations.ts"), []);
  assert.deepEqual(await cjkUnderEn("src/components/marketing/coffee-page.mjs"), []);
});

test("English and Chinese coffee demo lines keep the same structure", async () => {
  const { COFFEE_LINES_BY_LANG, COFFEE_LINES } = await import("../src/components/marketing/coffee-page.mjs");
  const { zh, en } = COFFEE_LINES_BY_LANG;
  assert.equal(COFFEE_LINES, zh);
  assert.equal(en.length, zh.length);
  zh.forEach((l, i) => assert.deepEqual(en[i].slice(1), l.slice(1), `line ${i} block/selector`));
});
