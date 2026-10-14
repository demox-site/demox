import { INTENT_LANDINGS } from "./intent-landings.mjs";

/**
 * 有中英两版文案的公开页面（英文路径，不带前导斜杠；"" 是首页）。
 * 中文版统一挂在 /zh/ 下：/ ↔ /zh/，/pricing ↔ /zh/pricing，/{intent} ↔ /zh/{intent}。
 * 构建时 generate-seo-pages 为每一对输出静态 HTML、hreflang 和 sitemap 条目。
 */
export const ZH_PAIRED_ROUTES = ["", "pricing", ...INTENT_LANDINGS.map((page) => page.id)];

const PAIRED = new Set(ZH_PAIRED_ROUTES);

/** "/zh" "/zh/" "/zh/pricing" → true */
export function isZhPath(pathname) {
  return pathname === "/zh" || pathname.startsWith("/zh/");
}

/** 去掉 /zh 前缀，返回英文路径（"/zh/" → "/"，"/zh/pricing" → "/pricing"）。 */
export function stripZhPrefix(pathname) {
  if (!isZhPath(pathname)) return pathname;
  const rest = pathname.slice(3).replace(/\/+$/, "");
  return rest || "/";
}

/** 英文路径 → 对应的 route key（"" / "pricing" / intent id），不是成对页面返回 null。 */
export function pairedRouteKey(pathname) {
  const enPath = stripZhPrefix(pathname).replace(/\/+$/, "") || "/";
  const key = enPath === "/" || enPath === "/index" ? "" : enPath.replace(/^\//, "");
  return PAIRED.has(key) ? key : null;
}

export function enPathFor(key) {
  return key ? `/${key}` : "/";
}

export function zhPathFor(key) {
  return key ? `/zh/${key}` : "/zh/";
}
