import { OFFICIAL_DOMAINS } from "./official-domains";
import { getTopAwareSessionStorage } from "./top-aware-session-storage";

export const SITE_AUTH_NEXT_KEY = "demox_site_auth_next";
export const SITE_AUTH_HANDOFF_KEY = "demox_site_auth_handoff";
export const SITE_AUTH_COMPLETE_PATH = "/.demox/auth-complete";

function siteAuthStorage(): Storage | null {
  return getTopAwareSessionStorage() as Storage | null;
}

export function isAllowedSiteReturnUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && OFFICIAL_DOMAINS.some((domain) =>
      host !== `www.${domain}` &&
      host.endsWith(`.${domain}`) &&
      host.slice(0, -domain.length - 1).indexOf(".") === -1
    );
  } catch {
    return false;
  }
}

export function rememberSiteAuthNext(next: string) {
  const storage = siteAuthStorage();
  if (!storage) return;
  if (isAllowedSiteReturnUrl(next)) {
    storage.setItem(SITE_AUTH_NEXT_KEY, next);
  }
}

export function rememberSiteAuthHandoff(enabled: boolean) {
  const storage = siteAuthStorage();
  if (!storage) return;
  if (enabled) {
    storage.setItem(SITE_AUTH_HANDOFF_KEY, "1");
  } else {
    storage.removeItem(SITE_AUTH_HANDOFF_KEY);
  }
}

export function consumeSiteAuthNext(): string | null {
  const storage = siteAuthStorage();
  if (!storage) return null;
  const next = storage.getItem(SITE_AUTH_NEXT_KEY);
  if (next) storage.removeItem(SITE_AUTH_NEXT_KEY);
  return isAllowedSiteReturnUrl(next) ? next : null;
}

export function consumeSiteAuthHandoff(): boolean {
  const storage = siteAuthStorage();
  if (!storage) return false;
  const enabled = storage.getItem(SITE_AUTH_HANDOFF_KEY) === "1";
  storage.removeItem(SITE_AUTH_HANDOFF_KEY);
  return enabled;
}

export function submitSiteAuthCompletion(next: string, token: string): boolean {
  if (!isAllowedSiteReturnUrl(next) || !token || typeof document === "undefined") {
    return false;
  }

  const nextUrl = new URL(next);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${nextUrl.origin}${SITE_AUTH_COMPLETE_PATH}`;
  form.target = "_top";
  form.style.display = "none";

  for (const [name, value] of [["token", token], ["next", next]]) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  return true;
}
