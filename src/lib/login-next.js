/**
 * Safe in-app return path after forced re-login (?next=).
 * Only same-origin relative paths; blocks open redirects.
 */
export function isSafeLoginNext(value) {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("://")) return false;
  if (value.includes("\\")) return false;
  return true;
}

/** Build /?next=... from the current location, or plain / when already home. */
export function buildLoginRedirect(currentPathWithSearch) {
  const path = currentPathWithSearch || "/";
  if (!isSafeLoginNext(path) || path === "/") return "/";
  return `/?next=${encodeURIComponent(path)}`;
}

/** Read and validate ?next= from a query string (leading ? optional). */
export function readLoginNext(search) {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(q).get("next");
  return isSafeLoginNext(raw) ? raw : null;
}
