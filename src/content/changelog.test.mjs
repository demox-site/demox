import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_ORDER,
  LOG_FOOTER,
  LOG_SECTION_SUBTITLE,
  RELEASES,
  TAG_CATEGORY,
  categoryOf,
  pickLang,
} from "./changelog.mjs";

const isPair = (v) => v && typeof v === "object" && typeof v.zh === "string" && typeof v.en === "string" && v.zh && v.en;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

test("every release has the fields the /log page renders", () => {
  assert.ok(RELEASES.length > 0);
  for (const r of RELEASES) {
    assert.match(r.version, /^(current|v\d+\.\d+\.\d+)$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(isPair(r.name) && isPair(r.dateNote), `${r.date} name/dateNote must be { zh, en }`);
    assert.ok(r.features.length > 0, `${r.name.zh} has no items`);
    for (const f of r.features) {
      assert.ok(f.tag);
      assert.ok(isPair(f.title) && isPair(f.desc), `${f.tag} title/desc must be { zh, en }`);
      if (f.note !== undefined) assert.ok(isPair(f.note));
    }
  }
});

test("releases are newest first", () => {
  const dates = RELEASES.map((r) => r.date);
  assert.deepEqual([...dates].sort().reverse(), dates);
});

test("every tag maps to a filter category", () => {
  for (const r of RELEASES) {
    for (const f of r.features) {
      assert.ok(f.tag in TAG_CATEGORY, `unmapped tag ${f.tag}`);
      assert.ok(CATEGORY_ORDER.includes(categoryOf(f.tag)));
    }
  }
});

test("English copy has no Chinese", () => {
  const pairs = [LOG_SECTION_SUBTITLE, LOG_FOOTER, ...RELEASES.flatMap((r) => [r.name, r.dateNote, ...r.features.flatMap((f) => [f.title, f.desc, f.note])])];
  for (const p of pairs.filter(Boolean)) assert.ok(!CJK.test(p.en), `Chinese left in en: ${p.en}`);
});

test("pickLang picks by language and passes plain strings through", () => {
  assert.equal(pickLang(LOG_SECTION_SUBTITLE, "en"), "Live");
  assert.equal(pickLang(LOG_SECTION_SUBTITLE, "zh"), "已上线");
  assert.equal(pickLang("It Works on My Machine", "zh"), "It Works on My Machine");
  assert.equal(pickLang(undefined, "en"), undefined);
});

test("2026-10-08 is the newest release and the older entries stay", () => {
  assert.equal(RELEASES.length, 12);
  const first = RELEASES[0];
  assert.equal(first.date, "2026-10-08");
  assert.equal(first.version, "current");
  assert.equal(first.name.zh, "换了张脸 (New Face)");
  assert.equal(first.name.en, "New Face");
  assert.deepEqual(first.features.map((f) => f.tag), ["Style", "Fix", "Infra"]);
  assert.equal(RELEASES[1].date, "2026-06-22");
  assert.equal(RELEASES[1].name.zh, "偷窥自己 (Know Thy Traffic)");
});

