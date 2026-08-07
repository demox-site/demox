/**
 * @typedef {"login" | "bind"} GithubOAuthMode
 * @typedef {{ mode: GithubOAuthMode, createdAt: number }} GithubOAuthFlow
 * @typedef {Pick<Storage, "length" | "getItem" | "key" | "removeItem" | "setItem">} StorageLike
 */

import { getTopAwareSessionStorage } from "./top-aware-session-storage.js";

export { getTopAwareSessionStorage } from "./top-aware-session-storage.js";

const FLOW_KEY_PREFIX = "github_oauth_flow:";
const LEGACY_STATE_KEY = "github_oauth_state";
export const GITHUB_OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

/** @param {Uint8Array} bytes */
function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @param {Crypto | undefined} cryptoProvider */
function requireCrypto(cryptoProvider) {
  if (!cryptoProvider?.getRandomValues) {
    throw new Error("当前浏览器不支持安全的 GitHub 登录，请升级浏览器后重试");
  }
  return cryptoProvider;
}

/** @param {string} state */
function flowKey(state) {
  return `${FLOW_KEY_PREFIX}${state}`;
}

/** @param {string} value */
function isValidState(value) {
  return /^(login|bind)\.[A-Za-z0-9_-]{32}$/.test(value);
}

/**
 * @param {unknown} value
 * @param {string} state
 * @param {number} now
 * @returns {value is GithubOAuthFlow}
 */
function isValidFlow(value, state, now) {
  if (!value || typeof value !== "object") return false;
  const flow = /** @type {Partial<GithubOAuthFlow>} */ (value);
  const stateMode = state.startsWith("bind.") ? "bind" : "login";
  return (
    flow.mode === stateMode &&
    typeof flow.createdAt === "number" &&
    flow.createdAt <= now + 60_000 &&
    now - flow.createdAt <= GITHUB_OAUTH_FLOW_TTL_MS
  );
}

/**
 * @param {StorageLike} storage
 * @param {number} [now]
 */
export function purgeExpiredGithubOAuthFlows(storage, now = Date.now()) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key) => Boolean(key?.startsWith(FLOW_KEY_PREFIX))
  );

  for (const key of keys) {
    const state = key.slice(FLOW_KEY_PREFIX.length);
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      if (!isValidState(state) || !isValidFlow(value, state, now)) storage.removeItem(key);
    } catch {
      storage.removeItem(key);
    }
  }

  storage.removeItem(LEGACY_STATE_KEY);
}

/**
 * @param {GithubOAuthMode} mode
 * @param {StorageLike} [storage]
 * @param {Crypto | undefined} [cryptoProvider]
 * @param {number} [now]
 */
export function beginGithubOAuthFlow(
  mode,
  storage = getTopAwareSessionStorage() || undefined,
  cryptoProvider = globalThis.crypto,
  now = Date.now()
) {
  if (!storage) {
    throw new Error("无法保存 GitHub 登录状态，请检查浏览器隐私设置后重试");
  }
  const crypto = requireCrypto(cryptoProvider);
  purgeExpiredGithubOAuthFlows(storage, now);

  const state = `${mode}.${base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)))}`;
  storage.setItem(flowKey(state), JSON.stringify({ mode, createdAt: now }));
  return { state };
}

/**
 * @param {string} state
 * @param {StorageLike} [storage]
 * @param {number} [now]
 * @returns {GithubOAuthFlow | null}
 */
export function consumeGithubOAuthFlow(
  state,
  storage = getTopAwareSessionStorage() || undefined,
  now = Date.now()
) {
  if (!storage || !isValidState(state)) return null;

  const key = flowKey(state);
  const raw = storage.getItem(key);
  storage.removeItem(key);
  // 兼容旧版单 key；仅当值完全匹配时接受，避免误放行
  if (!raw) {
    const legacy = storage.getItem(LEGACY_STATE_KEY);
    storage.removeItem(LEGACY_STATE_KEY);
    if (legacy && legacy === state && /^(login|bind)\./.test(state)) {
      return { mode: state.startsWith("bind.") ? "bind" : "login", createdAt: now };
    }
    return null;
  }

  try {
    const flow = JSON.parse(raw);
    return isValidFlow(flow, state, now) ? flow : null;
  } catch {
    return null;
  }
}

/** 清掉回调 URL 上的 code/state，避免刷新或前进/后退再次消耗授权码 */
export function clearOAuthCallbackSearch() {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (!url.search && !url.hash.includes("?")) return;
  url.search = "";
  const hashPath = url.hash.split("?")[0];
  url.hash = hashPath === "#" ? "" : hashPath;
  window.history.replaceState({}, "", `${url.pathname}${url.hash}`);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function describeGithubLoginError(error) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("bad_verification_code") ||
    normalized.includes("incorrect or expired") ||
    normalized.includes("code has already been used")
  ) {
    return "授权码已失效或已被使用（常见于页面缓存/刷新），请重新发起 GitHub 登录";
  }
  if (normalized.includes("授权状态校验失败") || normalized.includes("oauth flow")) {
    return "登录状态已过期或浏览器缓存干扰，请重新发起 GitHub 登录";
  }
  return message || "GitHub 登录失败";
}
