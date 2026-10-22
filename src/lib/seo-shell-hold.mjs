/** 首页 SEO 静态壳在 React 接管前停留的时间。 */
export const SEO_SHELL_HOLD_MS = 3000;

/**
 * 英文首页、/index、中文首页先停在爬虫用的静态壳上。
 * 控制台和其他公开页立即渲染，避免多等这一段。
 */
export function seoShellHoldMs(pathname) {
  const path = String(pathname || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/index" || path === "/zh") return SEO_SHELL_HOLD_MS;
  return 0;
}
