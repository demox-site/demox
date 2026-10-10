import type { Language } from "@/hooks/use-language";

export function fmtNum(v: number | null | undefined, language: Language): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString(language === "en" ? "en-US" : "zh-CN");
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** 环比：返回相对变化（0.12 = +12%），上期为 0 时返回 null */
export function delta(value: number | null | undefined, prev: number | null | undefined): number | null {
  if (value == null || prev == null || !Number.isFinite(value) || !Number.isFinite(prev) || prev === 0) return null;
  return (value - prev) / prev;
}

/** 埋点开始日期的短写法："2026-10-09" → 中文 "10-09"，英文 "Oct 9" */
export function fmtSinceDate(key: string | null | undefined, language: Language): string {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  if (language === "en") return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return key.slice(5);
}

/** 迷你折线只画有记录的日子：null（还没埋点）直接跳过，不当 0 画 */
export function definedValues(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v));
}
