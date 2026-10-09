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
