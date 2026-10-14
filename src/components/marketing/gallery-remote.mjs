/**
 * Homepage gallery remote list.
 *
 * The wall paints built-in cards first. This module only decides whether a
 * successful response is complete enough to replace them. A hang, timeout,
 * non-200, or a payload that does not fill both rows returns null so the
 * caller keeps the built-in wall (no blank, no placeholder).
 */

const PREVIEWS = new Set(["image", "coffee", "www", "preview"]);

export function normalizeGalleryCards(rows) {
  if (!Array.isArray(rows)) return [];
  const cards = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id || "").trim();
    const title = String(row.title || "").trim();
    const url = String(row.url || "").trim();
    if (!id || !title || !url) continue;
    const preview = PREVIEWS.has(row.preview) ? row.preview : "image";
    const rowNum = Number(row.row) === 2 ? 2 : 1;
    cards.push({
      id,
      title,
      titleEn: String(row.titleEn || row.title_en || ""),
      url,
      href: String(row.href || ""),
      preview,
      image: String(row.image || ""),
      caption: String(row.caption || ""),
      captionEn: String(row.captionEn || row.caption_en || ""),
      row: rowNum,
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
      enabled: row.enabled !== false && row.enabled !== 0 && row.enabled !== "0"
    });
  }
  return cards;
}

/** Remote cards replace the built-in wall only when both rows have an enabled card. */
export function shouldUseRemoteGallery(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return false;
  let row1 = false;
  let row2 = false;
  for (const card of cards) {
    if (!card || card.enabled === false) continue;
    if (card.row === 1) row1 = true;
    else if (card.row === 2) row2 = true;
  }
  return row1 && row2;
}

/**
 * @param {{ endpoint: string, timeoutMs?: number, fetchImpl?: typeof fetch, signal?: AbortSignal }} options
 * @returns {Promise<Array|null>} cards to render, or null to keep the built-in wall
 */
export async function fetchRemoteGallery({ endpoint, timeoutMs = 2000, fetchImpl = globalThis.fetch, signal } = {}) {
  if (!endpoint || typeof fetchImpl !== "function") return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_gallery_cards" }),
      signal: ac.signal
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || data.success !== true) return null;
    const cards = normalizeGalleryCards(data.data);
    return shouldUseRemoteGallery(cards) ? cards : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}
