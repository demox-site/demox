export const SITE_AUTH_NEXT_KEY = "demox_site_auth_next";

export function isAllowedSiteReturnUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && host !== "www.demox.site" && /^[^.]+\.demox\.site$/.test(host);
  } catch {
    return false;
  }
}

export function rememberSiteAuthNext(next: string) {
  if (typeof sessionStorage === "undefined") return;
  if (isAllowedSiteReturnUrl(next)) {
    sessionStorage.setItem(SITE_AUTH_NEXT_KEY, next);
  }
}

export function consumeSiteAuthNext(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const next = sessionStorage.getItem(SITE_AUTH_NEXT_KEY);
  if (next) sessionStorage.removeItem(SITE_AUTH_NEXT_KEY);
  return isAllowedSiteReturnUrl(next) ? next : null;
}
