'use strict';

const crypto = require('crypto');
const { badRequest } = require('./errors.js');
const { platformWebsiteId } = require('./site-binding.js');
const { platformSiteInProcess } = require('./platform-site.js');
const { isTimerEvent, timerNameOf } = require('./function-events.js');
const { routeMatches } = require('./system-router.js');

/** 网关进程上的应用层主密钥。不使用 KMS，也不读取 ENCRYPTION_KEY。 */
const PLATFORM_SECRET_KEY_ENV = 'PLATFORM_SECRETS_KEY';
/** 写入新密文的 key id。轮换时改这个 id，旧 id 放进 PLATFORM_SECRETS_KEYRING。 */
const PLATFORM_SECRET_KEY_ID_ENV = 'PLATFORM_SECRETS_KEY_ID';
/** JSON 对象：key id → 密钥材料。只用于解密旧密文。 */
const PLATFORM_SECRET_KEYRING_ENV = 'PLATFORM_SECRETS_KEYRING';
/** 逗号分隔的路径或 timer 名。空字符串表示全部关闭，平台流量仍在进程内。 */
const PLATFORM_PREFIX_SWITCH_ENV = 'FUNCTIONS_PLATFORM_RUNTIME_PREFIXES';
const PLATFORM_POOL_FUNCTION = 'demox-platform-nodejs';
const USER_POOL_FUNCTION = 'demox-user-nodejs';

const FALLBACK_CODES = new Set([
  'PLATFORM_SITE_IN_PROCESS',
  'PLATFORM_RUNTIME_NOT_CONFIGURED',
  'PLATFORM_SECRET_KEY_MISSING'
]);

const BLOCKED_PREFIXES = new Set(['/health', '/functions', '/env', '/api']);
const BLOCKED_FIRST = new Set(['health', 'functions', 'env', 'api']);
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_ENV_KEYS = 128;
const MAX_PLAIN_BYTES = 2048;
const MAX_SECRET_BYTES = 8192;

function isPlatformProject(websiteId, env = process.env) {
  return String(websiteId || '') === platformWebsiteId(env);
}

function activeKeyId(env = process.env) {
  const id = String(env[PLATFORM_SECRET_KEY_ID_ENV] || 'k1').trim();
  if (!KEY_ID_PATTERN.test(id)) {
    const error = new Error('PLATFORM_SECRETS_KEY_ID 非法');
    error.code = 'PLATFORM_SECRET_KEY_ID_INVALID';
    throw error;
  }
  return id;
}

function loadKeyring(env = process.env) {
  const ring = {};
  const raw = env[PLATFORM_SECRET_KEYRING_ENV];
  if (raw != null && String(raw).trim() !== '') {
    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      const error = new Error('PLATFORM_SECRETS_KEYRING 不是 JSON 对象');
      error.code = 'PLATFORM_SECRET_KEYRING_INVALID';
      throw error;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const error = new Error('PLATFORM_SECRETS_KEYRING 不是 JSON 对象');
      error.code = 'PLATFORM_SECRET_KEYRING_INVALID';
      throw error;
    }
    for (const [id, material] of Object.entries(parsed)) {
      if (!KEY_ID_PATTERN.test(id) || typeof material !== 'string' || material.length < 16) {
        const error = new Error('PLATFORM_SECRETS_KEYRING 含有非法条目');
        error.code = 'PLATFORM_SECRET_KEYRING_INVALID';
        throw error;
      }
      ring[id] = material;
    }
  }
  const current = env[PLATFORM_SECRET_KEY_ENV];
  if (typeof current === 'string' && current.length >= 16) {
    ring[activeKeyId(env)] = current;
  }
  return ring;
}

function deriveAesKey(material) {
  return crypto.createHash('sha256').update(String(material), 'utf8').digest();
}

function encryptPlatformSecret(plain, env = process.env) {
  const id = activeKeyId(env);
  const material = loadKeyring(env)[id];
  if (!material) {
    const error = new Error('缺少 PLATFORM_SECRETS_KEY，平台密钥不能明文落库');
    error.code = 'PLATFORM_SECRET_KEY_MISSING';
    throw error;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveAesKey(material), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `ds1:${id}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

function decryptPlatformSecret(payload, env = process.env) {
  const match = /^ds1:([A-Za-z0-9][A-Za-z0-9._-]{0,31}):([A-Za-z0-9+/=]+)$/.exec(String(payload || ''));
  if (!match) {
    const error = new Error('平台密钥密文无法识别');
    error.code = 'PLATFORM_SECRET_CIPHERTEXT_INVALID';
    throw error;
  }
  const material = loadKeyring(env)[match[1]];
  if (!material) {
    const error = new Error(`没有 key id ${match[1]} 的 PLATFORM_SECRETS_KEY`);
    error.code = 'PLATFORM_SECRET_KEY_MISSING';
    throw error;
  }
  const raw = Buffer.from(match[2], 'base64');
  if (raw.length < 29) {
    const error = new Error('平台密钥密文无法识别');
    error.code = 'PLATFORM_SECRET_CIPHERTEXT_INVALID';
    throw error;
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveAesKey(material), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function assertEnvKey(key) {
  if (!ENV_KEY_PATTERN.test(key)) throw badRequest(`环境变量名非法: ${key}`, 'INVALID_ENV_KEY');
}

function parseEnvAssignment(env) {
  if (env === undefined || env === null) return { plain: {}, secrets: {}, keep: [] };
  if (typeof env !== 'object' || Array.isArray(env)) throw badRequest('env 必须是对象', 'INVALID_ENV');
  const entries = Object.entries(env);
  if (entries.length > MAX_ENV_KEYS) throw badRequest('环境变量不能超过 128 个', 'ENV_TOO_LARGE');
  const plain = {};
  const secrets = {};
  const keep = [];
  for (const [key, value] of entries) {
    assertEnvKey(key);
    if (typeof value === 'string') {
      if (Buffer.byteLength(value) > MAX_PLAIN_BYTES) throw badRequest(`环境变量值非法: ${key}`, 'INVALID_ENV_VALUE');
      plain[key] = value;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && value.type === 'secret') {
      if (value.value == null || value.value === '') {
        keep.push(key);
        continue;
      }
      if (typeof value.value !== 'string' || Buffer.byteLength(value.value) > MAX_SECRET_BYTES) {
        throw badRequest(`环境变量值非法: ${key}`, 'INVALID_ENV_VALUE');
      }
      secrets[key] = value.value;
      continue;
    }
    throw badRequest(`环境变量值非法: ${key}`, 'INVALID_ENV_VALUE');
  }
  return { plain, secrets, keep };
}

function publicEnvView(plain, cipher) {
  const output = { ...(plain || {}) };
  for (const key of Object.keys(cipher || {})) output[key] = { type: 'secret' };
  return output;
}

function normalizeRoute(value) {
  const pathValue = String(value || '/');
  if (pathValue.length > 1 && pathValue.endsWith('/')) return pathValue.slice(0, -1);
  return pathValue || '/';
}

function enabledPlatformPrefixes(env = process.env) {
  const raw = String(env[PLATFORM_PREFIX_SWITCH_ENV] == null ? '' : env[PLATFORM_PREFIX_SWITCH_ENV]);
  const output = [];
  for (const part of raw.split(',')) {
    const item = part.trim();
    if (!item || item === '/') continue;
    if (item.startsWith('timer:') || !item.startsWith('/')) {
      const name = item.startsWith('timer:') ? item.slice('timer:'.length).trim() : item;
      if (/^[A-Za-z0-9._-]{1,64}$/.test(name)) output.push({ kind: 'timer', name });
      continue;
    }
    const prefix = normalizeRoute(item);
    if (BLOCKED_PREFIXES.has(prefix.toLowerCase())) continue;
    const first = prefix.split('/').filter(Boolean)[0];
    if (first && BLOCKED_FIRST.has(first.toLowerCase())) continue;
    output.push({ kind: 'path', prefix });
  }
  return output;
}

function eventRequestsPlatformPool(event = {}, env = process.env) {
  const prefixes = enabledPlatformPrefixes(env);
  if (!prefixes.length) return false;
  if (isTimerEvent(event)) {
    const name = timerNameOf(event);
    return prefixes.some((item) => item.kind === 'timer' && item.name === name);
  }
  const pathValue = normalizeRoute(event.path || event.rawPath || event.requestContext?.http?.path || '/');
  if (BLOCKED_PREFIXES.has(pathValue.toLowerCase())) return false;
  const first = pathValue.split('/').filter(Boolean)[0];
  if (first && BLOCKED_FIRST.has(first.toLowerCase())) return false;
  return prefixes.some((item) => item.kind === 'path' && routeMatches(pathValue, item.prefix));
}

/**
 * user：用户池（或 user-runtime 回滚）。不注入平台密钥。
 * platform：平台池。只在前缀开关命中时。
 * in-process：当前默认。开关为空，或路径被排除。
 */
function platformDispatchPool(functionRecord, event = {}, env = process.env) {
  if (!functionRecord || !isPlatformProject(functionRecord.websiteId, env)) return 'user';
  if (eventRequestsPlatformPool(event, env)) return 'platform';
  if (platformSiteInProcess(env)) return 'in-process';
  return 'user';
}

function isPlatformPoolFallback(error) {
  return FALLBACK_CODES.has(error?.code);
}

module.exports = {
  PLATFORM_SECRET_KEY_ENV,
  PLATFORM_SECRET_KEY_ID_ENV,
  PLATFORM_SECRET_KEYRING_ENV,
  PLATFORM_PREFIX_SWITCH_ENV,
  PLATFORM_POOL_FUNCTION,
  USER_POOL_FUNCTION,
  isPlatformProject,
  activeKeyId,
  encryptPlatformSecret,
  decryptPlatformSecret,
  parseEnvAssignment,
  publicEnvView,
  enabledPlatformPrefixes,
  eventRequestsPlatformPool,
  platformDispatchPool,
  isPlatformPoolFallback
};
