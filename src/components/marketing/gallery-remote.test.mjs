import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchRemoteGallery, normalizeGalleryCards, shouldUseRemoteGallery } from "./gallery-remote.mjs";

const row = (partial) => ({
  id: "coffee",
  title: "好咖啡",
  titleEn: "Coffee",
  url: "https://coffee.demox.site/",
  preview: "image",
  image: "https://www.demox.site/gallery/coffee.webp",
  caption: "中文",
  captionEn: "English",
  row: 1,
  order: 1,
  enabled: true,
  ...partial
});

test("both enabled rows are required before remote cards replace the built-in wall", () => {
  assert.equal(shouldUseRemoteGallery([]), false);
  assert.equal(shouldUseRemoteGallery([row({ row: 1 }), row({ id: "b", row: 1 })]), false);
  assert.equal(shouldUseRemoteGallery([row({ row: 1, enabled: false }), row({ id: "b", row: 2 })]), false);
  assert.equal(shouldUseRemoteGallery([row({ row: 1 }), row({ id: "b", row: 2 })]), true);
});

test("english fields accept title_en / caption_en as well as camelCase", () => {
  const [card] = normalizeGalleryCards([{ ...row({ row: 2 }), titleEn: "", title_en: "Night bus", captionEn: "", caption_en: "Event page" }]);
  assert.equal(card.titleEn, "Night bus");
  assert.equal(card.captionEn, "Event page");
  assert.equal(card.row, 2);
});

test("API failure, empty payload, and a single row keep the built-in wall", async () => {
  const fail = await fetchRemoteGallery({
    endpoint: "https://api.demox.site/website/list-gallery-cards",
    fetchImpl: async () => ({ ok: false, json: async () => ({}) })
  });
  assert.equal(fail, null);

  const down = await fetchRemoteGallery({
    endpoint: "https://api.demox.site/website/list-gallery-cards",
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: false }) })
  });
  assert.equal(down, null);

  const oneRow = await fetchRemoteGallery({
    endpoint: "https://api.demox.site/website/list-gallery-cards",
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, data: [row({ row: 1 })] }) })
  });
  assert.equal(oneRow, null);
});

test("a hanging list does not wait: timeout returns null", async () => {
  const started = Date.now();
  const result = await fetchRemoteGallery({
    endpoint: "https://api.demox.site/website/list-gallery-cards",
    timeoutMs: 40,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    })
  });
  assert.equal(result, null);
  assert.ok(Date.now() - started < 500);
});

test("a complete remote list keeps english copy", async () => {
  const cards = await fetchRemoteGallery({
    endpoint: "https://api.demox.site/website/list-gallery-cards",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: [row({ row: 1, titleEn: "", title_en: "Cafe" }), row({ id: "docs", row: 2, titleEn: "Docs", captionEn: "", caption_en: "Manual" })]
      })
    })
  });
  assert.equal(cards.length, 2);
  assert.equal(cards[0].titleEn, "Cafe");
  assert.equal(cards[1].titleEn, "Docs");
  assert.equal(cards[1].captionEn, "Manual");
});

test("GalleryStage paints built-in cards on the first render and does not skeleton the wall", () => {
  const src = readFileSync(new URL("./GalleryStage.tsx", import.meta.url), "utf8");
  assert.match(src, /useState\(GALLERY_CARDS\)/);
  assert.match(src, /fetchRemoteGallery/);
  assert.doesNotMatch(src, /skeleton|animate-pulse|placeholder/i);
});
