/**
 * @typedef {Pick<Storage, "length" | "getItem" | "key" | "removeItem" | "setItem">} StorageLike
 */

/**
 * 私有站点登录门在 iframe 内发起授权，但会 `_top` 跳到外站；
 * 回调落在顶层窗口，必须读写 top.sessionStorage，否则 state / next 对不上。
 * @param {Window | undefined} [win]
 * @returns {StorageLike | null}
 */
export function getTopAwareSessionStorage(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return null;
  if (win.top && win.top !== win) {
    try {
      const storage = win.top.sessionStorage;
      void storage.length;
      return storage;
    } catch {
      // cross-origin frame: fall through
    }
  }
  try {
    void win.sessionStorage.length;
    return win.sessionStorage;
  } catch {
    return null;
  }
}
