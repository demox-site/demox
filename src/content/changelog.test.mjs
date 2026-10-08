import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_ORDER,
  LOG_TRANSLATIONS,
  RELEASES,
  TAG_CATEGORY,
  categoryOf,
  translateLogText,
} from "./changelog.mjs";

test("every release has the fields the /log page renders", () => {
  assert.ok(RELEASES.length > 0);
  for (const r of RELEASES) {
    assert.match(r.version, /^(current|v\d+\.\d+\.\d+)$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.name && r.dateNote);
    assert.ok(r.features.length > 0, `${r.name} has no items`);
    for (const f of r.features) assert.ok(f.tag && f.title && f.desc);
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

test("all Chinese copy has an English translation", () => {
  const texts = RELEASES.flatMap((r) => [r.name, r.dateNote, ...r.features.flatMap((f) => [f.title, f.desc, f.note])]);
  for (const text of texts.filter(Boolean)) {
    if (/[\u4e00-\u9fff]/.test(text)) assert.ok(text in LOG_TRANSLATIONS, `missing en: ${text}`);
  }
  assert.equal(translateLogText("已上线", "en"), "Live");
  assert.equal(translateLogText("已上线", "zh"), "已上线");
  assert.equal(translateLogText("Demox & Logo", "en"), "Demox & Logo");
});
