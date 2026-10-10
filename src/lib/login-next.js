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

/**
 * Controlled AlertDialog open policy for forced re-login.
 * - open → keep/show dialog
 * - close attempt → caller must run the same clear-tokens + ?next= path as「去登录」
 *   (Esc/overlay are also preventDefault'd; this is the safety net if a close still lands)
 * @returns {'open'|'force-login'}
 */
export function reloginDialogOpenChangeAction(nextOpen) {
  return nextOpen ? "open" : "force-login";
}

/** Radix Content handlers: block Esc + outside dismiss (prefer hard-lock). */
export function reloginDialogLockHandlers() {
  const lock = (event) => {
    event.preventDefault();
  };
  return {
    onEscapeKeyDown: lock,
    onPointerDownOutside: lock,
    onInteractOutside: lock
  };
}
