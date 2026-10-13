'use strict';
/**
 * 健康检查里的 fail_open_24h（过去 24 小时限速放行次数）。
 * - 只有请求头 X-Demox-Check-Key 与环境变量 FAIL_OPEN_CHECK_KEY 一致才返回；环境变量没设一律不返回。
 * - 比对用 sha256 摘要 + crypto.timingSafeEqual（长度固定，常量时间）。
 * - 查库失败返回 null（不是 0）；只缓存成功结果 60 秒，失败下次重试。
 * - 密钥和请求头永不写日志。
 */
const crypto = require('crypto');

const HEADER = 'x-demox-check-key';
const CACHE_MS = 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function headerValue(headers) {
  if (!headers || typeof headers !== 'object') return null;
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === HEADER) {
      const v = headers[k];
      return typeof v === 'string' ? v : null;
    }
  }
  return null;
}

function digest(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest();
}

function checkKeyValid(headers, env = process.env) {
  const expected = env.FAIL_OPEN_CHECK_KEY;
  if (!expected) return false;
  const got = headerValue(headers);
  if (!got) return false;
  return crypto.timingSafeEqual(digest(got), digest(expected));
}

function createFailOpenCounter({ query, now = () => Date.now() } = {}) {
  let cached = null; // { value, at }
  return async function failOpen24h() {
    const t = now();
    if (cached && t - cached.at < CACHE_MS) return cached.value;
    try {
      const rows = await query(
        'SELECT COUNT(*) AS n FROM login_throttle_fail_open WHERE created_at_ms >= ?',
        [t - WINDOW_MS]
      );
      const n = Number(rows && rows[0] && rows[0].n);
      if (!Number.isFinite(n) || n < 0) return null;
      cached = { value: n, at: t };
      return n;
    } catch (_e) {
      return null;
    }
  };
}

module.exports = { checkKeyValid, createFailOpenCounter, CACHE_MS, WINDOW_MS };
