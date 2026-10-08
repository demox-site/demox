/**
 * Hardcoded-Chinese guard for the frontend.
 *
 * Scans src/ (.js .jsx .ts .tsx .mjs .cjs, tests excluded) for string literals, template
 * text, regex literals and JSX text that contain CJK characters and are NOT localized.
 * A CJK literal counts as localized when it sits:
 *   - under an object property named zh / zh-CN / zh_CN / zhCN (the repo's `translations = { zh, en }` pattern);
 *   - in a branch of a `? :`, `&&`, `||` or `if` whose condition mentions the language (isZh, lang === "zh", …);
 *   - in property `foo` of an object that also has `fooEn` (e.g. gallery cards: caption / captionEn);
 *   - in a file listed in the allowlist `files`, or matching an allowlist `strings` entry
 *     (per file; `text` = exact literal, `contains` = substring for long templates). Every entry needs a `reason`.
 *
 * Enforcement:
 *   - Files in ENFORCED_FILES (the homepage and its components) must have zero offenders.
 *   - Any other file may not exceed its count in scripts/i18n-cjk-baseline.json
 *     (files missing from the baseline, i.e. new files, are allowed zero).
 *
 * CLI:  node scripts/check-hardcoded-cjk.mjs            → check, exit 1 on violations
 *       node scripts/check-hardcoded-cjk.mjs --list     → print every offender
 *       node scripts/check-hardcoded-cjk.mjs --write-baseline
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOWLIST_PATH = path.join(PROJECT_ROOT, "scripts/i18n-cjk-allowlist.json");
export const BASELINE_PATH = path.join(PROJECT_ROOT, "scripts/i18n-cjk-baseline.json");

/** Homepage (/) and everything it renders — must stay at zero hardcoded Chinese. */
export const ENFORCED_FILES = [
  "src/pages/index.tsx",
  "src/components/AuthDialog.tsx",
  "src/components/marketing/HeroStage.tsx",
  "src/components/marketing/GlobeStage.tsx",
  "src/components/marketing/GalleryStage.tsx",
  "src/components/marketing/TaskGuides.tsx",
  "src/components/marketing/gallery-cards.ts",
  "src/components/marketing/engine-s1.ts",
  "src/components/marketing/engine-s2.ts",
  "src/components/marketing/engine-s3.ts",
  "src/components/marketing/coffee-page.mjs",
  "src/components/marketing/index.ts",
];

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const ZH_KEYS = new Set(["zh", "zh-CN", "zh_CN", "zhCN", "zh-cn", "cn"]);
const LANG_COND = /\bis_?zh\b|\bisZh\b|\bisChinese\b|['"`]zh(-CN)?['"`]|['"`]en['"`]|\bzh\b/i;

function propName(node) {
  const n = node.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return null;
}

function isLocalized(node, sf) {
  let child = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) {
      const name = propName(p);
      if (name && ZH_KEYS.has(name)) return true;
      if (name && p.initializer === child && ts.isObjectLiteralExpression(p.parent)) {
        const siblings = p.parent.properties.map(propName);
        if (siblings.includes(`${name}En`)) return true;
      }
    }
    if (ts.isConditionalExpression(p) && child !== p.condition && LANG_COND.test(p.condition.getText(sf))) return true;
    if (ts.isBinaryExpression(p) && child === p.right &&
        (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
        LANG_COND.test(p.left.getText(sf))) return true;
    if (ts.isIfStatement(p) && child !== p.expression && LANG_COND.test(p.expression.getText(sf))) return true;
    if (ts.isCaseClause(p) && LANG_COND.test(p.expression.getText(sf))) return true;
  }
  return false;
}

function literalText(node) {
  if (ts.isJsxText(node)) return node.text.trim();
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  if (ts.isRegularExpressionLiteral(node)) return node.text;
  return null;
}

export function scanSource(code, file) {
  const kind = file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX
    : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JSX; // .js/.mjs/.cjs may contain JSX
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, kind);
  const hits = [];
  const visit = (node) => {
    const text = literalText(node);
    if (text != null && CJK.test(text) && !isLocalized(node, sf)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      hits.push({ file, line: line + 1, text: text.replace(/\s+/g, " ").trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

async function walk(dir, out = []) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== "node_modules") await walk(full, out); continue; }
    if (!EXTS.has(path.extname(ent.name))) continue;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(ent.name) || /\.d\.ts$/.test(ent.name)) continue;
    out.push(full);
  }
  return out;
}

export async function loadJson(p, fallback) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; }
}

/** Returns { offenders: [{file,line,text}], byFile: {file: count} } after applying the allowlist. */
export async function scanProject({ root = PROJECT_ROOT, allowlist } = {}) {
  allowlist = allowlist || (await loadJson(ALLOWLIST_PATH, { files: [], strings: [] }));
  const allowFiles = new Set((allowlist.files || []).map((f) => f.file || f));
  const allowStrings = (allowlist.strings || []).map((s) => ({ ...s, used: false }));
  const files = await walk(path.join(root, "src"));
  const offenders = [];
  for (const full of files.sort()) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (allowFiles.has(rel)) continue;
    for (const hit of scanSource(await readFile(full, "utf8"), rel)) {
      const a = allowStrings.find((s) => s.file === rel && (s.text != null ? s.text === hit.text : hit.text.includes(s.contains)));
      if (a) { a.used = true; continue; }
      offenders.push(hit);
    }
  }
  const byFile = {};
  for (const o of offenders) byFile[o.file] = (byFile[o.file] || 0) + 1;
  return { offenders, byFile, unusedAllow: allowStrings.filter((s) => !s.used) };
}

/** Compare a scan against the enforced list + baseline. Returns human-readable violations. */
export function evaluate({ offenders, byFile }, baseline = {}, enforced = ENFORCED_FILES) {
  const violations = [];
  const enforcedSet = new Set(enforced);
  for (const o of offenders) {
    if (enforcedSet.has(o.file)) violations.push(`${o.file}:${o.line} hardcoded Chinese on the homepage: "${o.text.slice(0, 60)}"`);
  }
  for (const [file, count] of Object.entries(byFile)) {
    if (enforcedSet.has(file)) continue;
    const allowed = baseline[file] || 0;
    if (count > allowed) {
      const lines = offenders.filter((o) => o.file === file).map((o) => o.line).join(", ");
      violations.push(`${file}: ${count} hardcoded Chinese strings (baseline ${allowed}) — lines ${lines}`);
    }
  }
  return violations;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const result = await scanProject();
  if (process.argv.includes("--list")) {
    for (const o of result.offenders) console.log(`${o.file}:${o.line}\t${o.text.slice(0, 80)}`);
  }
  if (process.argv.includes("--write-baseline")) {
    const enforced = new Set(ENFORCED_FILES);
    const base = Object.fromEntries(Object.entries(result.byFile).filter(([f]) => !enforced.has(f)).sort());
    await writeFile(BASELINE_PATH, JSON.stringify(base, null, 2) + "\n");
    console.log(`baseline written: ${Object.keys(base).length} files, ${Object.values(base).reduce((a, b) => a + b, 0)} strings`);
  }
  const baseline = await loadJson(BASELINE_PATH, {});
  const violations = evaluate(result, baseline);
  const total = result.offenders.length;
  console.log(`hardcoded-CJK scan: ${total} pre-existing offenders in ${Object.keys(result.byFile).length} non-homepage files (baseline), ${violations.length} violations`);
  for (const a of result.unusedAllow) console.warn(`allowlist entry no longer matches: ${a.file} "${a.text ?? a.contains}"`);
  if (violations.length) { for (const v of violations) console.error("✗ " + v); process.exit(1); }
}
