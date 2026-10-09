/**
 * 统计日期统一按 Asia/Shanghai（UTC+8）切日，与 website-api index.js 里的 statTime 一致。
 * 不依赖浏览器时区：海外管理员看到的日期和后端聚合的日期是同一天。
 */
export const STAT_TZ = "Asia/Shanghai";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function statDateKey(value: number | Date = Date.now()): string {
  const ms = value instanceof Date ? value.getTime() : value;
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

/** 最近 days 天（含今天）的日期键，升序 */
export function listStatDateKeys(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(statDateKey(now - i * DAY_MS));
  return out;
}

/** "2026-10-09" → "10/9" */
export function shortDateLabel(key: string): string {
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)}`;
}
