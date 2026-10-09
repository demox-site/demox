import { useTheme } from "@/hooks/use-theme";

/**
 * 控制台图表的墨色三档（设计原则：图表只用黑 / 深灰 / 浅灰，最多 3 条线，名字直接标在线尾，
 * 必要时用虚线区分；绿色只表示变好或成功；坏消息用墨色加图标，不用红色）。
 * 亮色主题和暗色主题各一套，数值和 --stitch-ink / --stitch-muted 对齐。
 */
export type InkPalette = {
  ink: string;
  mid: string;
  low: string;
  /** 柱状图里「正常 / 成功」的主体：比 ink 弱、比 low 强 */
  soft: string;
  /** 悬停时柱状图背后的高亮带、迷你折线下的淡填充 */
  wash: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  /** 地图：没有数据的国家、描边、四档访问强度（弱 → 强） */
  mapEmpty: string;
  mapStroke: string;
  mapLevels: [string, string, string, string];
};

export const INK_LIGHT: InkPalette = {
  ink: "#111111",
  mid: "#5f5f5f",
  low: "#a8a8a8",
  soft: "#6b6b6b",
  wash: "rgba(17,17,17,.06)",
  grid: "rgba(17,17,17,.08)",
  axis: "#696969",
  tooltipBg: "#ffffff",
  tooltipBorder: "rgba(17,17,17,.14)",
  tooltipText: "#111111",
  mapEmpty: "#ececea",
  mapStroke: "#ffffff",
  mapLevels: ["#c4c4c4", "#8f8f8f", "#555555", "#111111"]
};

export const INK_DARK: InkPalette = {
  ink: "#f5f5f5",
  mid: "#a3a3a3",
  low: "#5c5c5c",
  soft: "#d4d4d4",
  wash: "rgba(255,255,255,.06)",
  grid: "rgba(255,255,255,.08)",
  axis: "#a3a3a3",
  tooltipBg: "#0a0a0a",
  tooltipBorder: "rgba(255,255,255,.14)",
  tooltipText: "#f5f5f5",
  mapEmpty: "#1c1c1c",
  mapStroke: "#050505",
  mapLevels: ["#4a4a4a", "#7a7a7a", "#b4b4b4", "#f5f5f5"]
};

export function useInkPalette(): InkPalette {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? INK_DARK : INK_LIGHT;
}

/** 访问量 → 地图上的墨色强度（越多越接近主墨色）。 */
export function inkLevel(palette: InkPalette, value: number, max: number) {
  if (!value) return palette.mapEmpty;
  const intensity = value / Math.max(1, max);
  if (intensity > 0.8) return palette.mapLevels[3];
  if (intensity > 0.55) return palette.mapLevels[2];
  if (intensity > 0.3) return palette.mapLevels[1];
  return palette.mapLevels[0];
}
