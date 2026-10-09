'use strict';

/* demox-log-redact:begin v1
 * 日志脱敏：任何 console 输出里的 token / JWT / PAT / OAuth code / 邮箱都替换成占位符，原文不进日志。
 * 同一份代码内联在 website-api、auth-api、mcp-api 的入口和 function-api/log-redact.js；
 * `demox functions push` 只上传入口文件，所以不能 require 新的共享文件。
 * scripts/check-log-redaction.test.mjs 会校验几份完全一致。 */
const LOG_REDACT_MARK = Symbol.for('demox.logRedact.v1');
const LOG_REDACT_SENSITIVE_KEYS = /^(?:access_?token|refresh_?token|id_?token|token|tokens|jwt|pat|client_?secret|secret|password|current_?password|new_?password|code_?verifier|code_?challenge|auth(?:orization)?_?code|oauth_?code|verification_?code|ticket|authorization|cookie|set-cookie|x-demox-runtime-token|runtime_?invoke_?secret|secret_?key|secret_?id|session_?token|email|emails|to|mail)$/i;
const LOG_REDACT_RULES = [
  // JWT（网页登录、PAT、OAuth access token 都是 HS256 JWT）
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[jwt]'],
  // GitHub token
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[token]'],
  // Authorization 头
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 [token]'],
  // key=value / "key":"value" 形式的敏感字段
  [/((?:^|[?&#"'\s{,(])(?:access_?token|refresh_?token|id_?token|token|client_?secret|password|code_?verifier|ticket|secret_?key|session_?token)["']?\s*[:=]\s*["']?)(?!\[)[^"'&\s,;})]{4,}/gi, '$1[redacted]'],
  // OAuth 授权码（64 位随机串）和邮箱验证码（4–8 位数字）
  [/((?:^|[?&#"'\s{,(])code["']?\s*[:=]\s*["']?)(?:\d{4,8}|(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,})(?=$|["'&\s,;})])/gi, '$1[code]'],
  [/(验证码[^0-9\n]{0,40})\d{4,8}/g, '$1[code]'],
  // 邮箱
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]'],
  // 40 位以上的不透明随机串（refresh token、OAuth code、密钥）
  [/\b[A-Za-z0-9]{40,}\b/g, '[opaque]']
];

function redactLogText(input) {
  let text = String(input);
  for (const [pattern, replacement] of LOG_REDACT_RULES) text = text.replace(pattern, replacement);
  return text;
}

function redactLogValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactLogText(value);
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (typeof value === 'symbol' || typeof value === 'function') return value;
  if (Buffer.isBuffer(value)) return `[buffer ${value.length}B]`;
  if (value instanceof Error) {
    const code = value.code ? `[${value.code}] ` : '';
    return redactLogText(`${code}${value.stack || `${value.name}: ${value.message}`}`);
  }
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return redactLogText(String(value));
  if (seen.has(value)) return '[circular]';
  if (depth >= 6) return '[object]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactLogValue(item, depth + 1, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (LOG_REDACT_SENSITIVE_KEYS.test(key) && item !== null && item !== undefined && item !== '') {
      out[key] = typeof item === 'boolean' || typeof item === 'number' ? item : '[redacted]';
    } else {
      out[key] = redactLogValue(item, depth + 1, seen);
    }
  }
  return out;
}

function installLogRedaction(target = console) {
  if (!target || target[LOG_REDACT_MARK]) return target;
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    target[method] = function redactedConsoleMethod(...args) {
      let safe;
      try {
        safe = args.map((arg) => redactLogValue(arg));
      } catch {
        safe = ['[log redaction failed]'];
      }
      return original.apply(target, safe);
    };
  }
  Object.defineProperty(target, LOG_REDACT_MARK, { value: true, enumerable: false });
  return target;
}
/* demox-log-redact:end */

module.exports = { redactLogText, redactLogValue, installLogRedaction };
