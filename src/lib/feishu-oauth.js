/**
 * @typedef {"login" | "bind"} FeishuOAuthMode
 * @typedef {{ mode: FeishuOAuthMode, verifier: string, challenge: string, createdAt: number }} FeishuOAuthFlow
 * @typedef {Pick<Storage, "length" | "getItem" | "key" | "removeItem" | "setItem">} StorageLike
 */

const FLOW_KEY_PREFIX = "feishu_oauth_flow:";
const LEGACY_STATE_KEY = "feishu_oauth_state";
const LEGACY_VERIFIER_KEY = "feishu_pkce_verifier";
export const FEISHU_OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

/** @param {Uint8Array} bytes */
function base64UrlEncode(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** @param {Crypto | undefined} cryptoProvider */
function requirePkceCrypto(cryptoProvider) {
  if (!cryptoProvider?.getRandomValues || !cryptoProvider?.subtle) {
    throw new Error("当前浏览器不支持安全的飞书登录，请升级浏览器后重试");
  }
  return cryptoProvider;
}

/** @param {Crypto | undefined} [cryptoProvider] */
export function assertFeishuPkceSupport(cryptoProvider = globalThis.crypto) {
  requirePkceCrypto(cryptoProvider);
}

/**
 * @param {string} verifier
 * @param {Crypto | undefined} [cryptoProvider]
 */
export async function derivePkceChallenge(verifier, cryptoProvider = globalThis.crypto) {
  const crypto = requirePkceCrypto(cryptoProvider);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

/** @param {Crypto | undefined} [cryptoProvider] */
export async function createPkcePair(cryptoProvider = globalThis.crypto) {
  const crypto = requirePkceCrypto(cryptoProvider);
  // 32 random bytes encode to the 43-character verifier shape used by Feishu's examples.
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge: await derivePkceChallenge(verifier, crypto) };
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
 * @returns {value is FeishuOAuthFlow}
 */
function isValidFlow(value, state, now) {
  if (!value || typeof value !== "object") return false;
  const flow = /** @type {Partial<FeishuOAuthFlow>} */ (value);
  const stateMode = state.startsWith("bind.") ? "bind" : "login";
  return (
    flow.mode === stateMode &&
    typeof flow.verifier === "string" &&
    /^[A-Za-z0-9._~-]{43,128}$/.test(flow.verifier) &&
    typeof flow.challenge === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(flow.challenge) &&
    typeof flow.createdAt === "number" &&
    flow.createdAt <= now + 60_000 &&
    now - flow.createdAt <= FEISHU_OAUTH_FLOW_TTL_MS
  );
}

/**
 * @param {StorageLike} storage
 * @param {number} [now]
 */
export function purgeExpiredFeishuOAuthFlows(storage, now = Date.now()) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key) => Boolean(key?.startsWith(FLOW_KEY_PREFIX)));

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
  storage.removeItem(LEGACY_VERIFIER_KEY);
}

/**
 * @param {FeishuOAuthMode} mode
 * @param {StorageLike} [storage]
 * @param {Crypto | undefined} [cryptoProvider]
 * @param {number} [now]
 */
export async function beginFeishuOAuthFlow(
  mode,
  storage = sessionStorage,
  cryptoProvider = globalThis.crypto,
  now = Date.now()
) {
  const crypto = requirePkceCrypto(cryptoProvider);
  purgeExpiredFeishuOAuthFlows(storage, now);

  const { verifier, challenge } = await createPkcePair(crypto);
  const state = `${mode}.${base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)))}`;
  storage.setItem(flowKey(state), JSON.stringify({ mode, verifier, challenge, createdAt: now }));
  return { state, verifier, challenge };
}

/**
 * @param {string} state
 * @param {StorageLike} [storage]
 * @param {number} [now]
 * @returns {FeishuOAuthFlow | null}
 */
export function consumeFeishuOAuthFlow(state, storage = sessionStorage, now = Date.now()) {
  if (!isValidState(state)) return null;

  const key = flowKey(state);
  const raw = storage.getItem(key);
  storage.removeItem(key);
  if (!raw) return null;

  try {
    const flow = JSON.parse(raw);
    return isValidFlow(flow, state, now) ? flow : null;
  } catch {
    return null;
  }
}
