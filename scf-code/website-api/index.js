/**
 * Demox Website API - SCF 云函数
 * 网站管理服务
 */

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
installLogRedaction(console);

const AdmZip = require('adm-zip');
const nodeCrypto = require('crypto');
const https = require('https');
const http = require('http');
const path = require('path');
// IP 归属地：直接在磁盘上查 geoip-lite 自带的数据文件，不把库读进内存。
// geoip-lite 在 require 时会把约 150MB 的 .dat 整份读进内存（实测 RSS +140MB），
// 而 website worker 常驻在 demox-user-nodejs 里，新旧版本同时在线时会撞 512MB 上限。
// 这里按 geoip-lite 1.4.x 的文件格式（定长记录，按起始 IP 排序）用 fs.readSync 二分查找，
// 查找逻辑与 geoip-lite 的 lookup4/lookup6 一致；只读 country/region/city。
// 数据文件不存在时 getGeoip() 返回 null，调用方回落为 UNKNOWN（与原来加载失败时相同）。
const fs = require('fs');
const net = require('net');
const tls = require('tls');
let geoip = null;
let geoipLoadAttempted = false;

function createDiskGeoip(dataDir) {
  const file = (name) => path.join(dataDir, name);
  const exists = (f) => { try { return fs.statSync(f).size > 0; } catch (e) { return false; } };
  const LOC_RECORD = 88;
  let v4 = null;
  let v6 = null;
  let locFd = null;
  if (exists(file('geoip-city-names.dat')) && exists(file('geoip-city.dat'))) {
    locFd = fs.openSync(file('geoip-city-names.dat'), 'r');
    v4 = { fd: fs.openSync(file('geoip-city.dat'), 'r'), size: fs.statSync(file('geoip-city.dat')).size, rec: 24, city: true };
  } else if (exists(file('geoip-country.dat'))) {
    v4 = { fd: fs.openSync(file('geoip-country.dat'), 'r'), size: fs.statSync(file('geoip-country.dat')).size, rec: 10, city: false };
  }
  if (exists(file('geoip-city6.dat')) && locFd !== null) {
    v6 = { fd: fs.openSync(file('geoip-city6.dat'), 'r'), size: fs.statSync(file('geoip-city6.dat')).size, rec: 48, city: true };
  } else if (exists(file('geoip-country6.dat'))) {
    v6 = { fd: fs.openSync(file('geoip-country6.dat'), 'r'), size: fs.statSync(file('geoip-country6.dat')).size, rec: 34, city: false };
  }
  if (!v4) return null;
  const buf = Buffer.alloc(LOC_RECORD);
  const read = (fd, pos, len) => { fs.readSync(fd, buf, 0, len, pos); return buf; };
  const cstr = (b, from, to) => b.toString('utf8', from, to).replace(/\u0000.*/, '');
  const readLoc = (locId) => {
    const b = read(locFd, locId * LOC_RECORD, LOC_RECORD);
    return { country: cstr(b, 0, 2), region: cstr(b, 2, 5), city: cstr(b, 42, LOC_RECORD) };
  };
  v4.lastLine = v4.size / v4.rec - 1;
  v4.firstIP = read(v4.fd, 0, 4).readUInt32BE(0);
  v4.lastIP = read(v4.fd, v4.lastLine * v4.rec + 4, 4).readUInt32BE(0);
  const private4 = [[0x0A000000, 0x0AFFFFFF], [0xAC100000, 0xAC1FFFFF], [0xC0A80000, 0xC0A8FFFF]];
  const aton4 = (a) => {
    const p = a.split('.');
    return ((parseInt(p[0], 10) << 24) >>> 0) + ((parseInt(p[1], 10) << 16) >>> 0) + ((parseInt(p[2], 10) << 8) >>> 0) + (parseInt(p[3], 10) >>> 0);
  };
  const aton6 = (input) => {
    const a = input.replace(/"/g, '').split(/:/);
    const l = a.length - 1;
    if (a[l] === '') a[l] = 0;
    if (l < 7) {
      a.length = 8;
      for (let i = l; i >= 0 && a[i] !== ''; i--) a[7 - l + i] = a[i];
    }
    for (let i = 0; i < 8; i++) a[i] = a[i] ? parseInt(a[i], 16) : 0;
    const r = [];
    for (let i = 0; i < 4; i++) r.push(((a[2 * i] << 16) + a[2 * i + 1]) >>> 0);
    return r;
  };
  const cmp6 = (a, b) => {
    for (let i = 0; i < 2; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };
  // geoip-lite 的二分写法（含 fline/cline 收尾分支）原样保留，保证边界结果一致。
  function search(lastLine, readRange, inRange, below) {
    let fline = 0;
    let cline = lastLine;
    for (;;) {
      const line = Math.round((cline - fline) / 2) + fline;
      const range = readRange(line);
      if (inRange(range)) return line;
      if (fline === cline) return -1;
      if (fline === cline - 1) {
        if (line === fline) fline = cline; else cline = fline;
      } else if (below(range)) {
        cline = line;
      } else {
        fline = line;
      }
    }
  }
  function lookup4(ip) {
    if (ip > v4.lastIP || ip < v4.firstIP) return null;
    for (const [lo, hi] of private4) if (ip >= lo && ip <= hi) return null;
    const line = search(v4.lastLine,
      (n) => { const b = read(v4.fd, n * v4.rec, 8); return [b.readUInt32BE(0), b.readUInt32BE(4)]; },
      ([lo, hi]) => lo <= ip && hi >= ip,
      ([lo]) => lo > ip);
    if (line < 0) return null;
    const out = { country: '', region: '', city: '' };
    if (!v4.city) {
      out.country = read(v4.fd, line * v4.rec + 8, 2).toString('utf8', 0, 2);
      return out;
    }
    const locId = read(v4.fd, line * v4.rec + 8, 4).readUInt32BE(0);
    if ((-1 >>> 0) > locId) Object.assign(out, readLoc(locId));
    return out;
  }
  function lookup6(ip) {
    if (!v6) return null;
    const readip = (n, off) => { const b = read(v6.fd, n * v6.rec + off * 16, 8); return [b.readUInt32BE(0), b.readUInt32BE(4)]; };
    const lastLine = v6.size / v6.rec - 1;
    if (cmp6(ip, readip(lastLine, 1)) > 0 || cmp6(ip, readip(0, 0)) < 0) return null;
    const line = search(lastLine,
      (n) => [readip(n, 0), readip(n, 1)],
      ([lo, hi]) => cmp6(lo, ip) <= 0 && cmp6(hi, ip) >= 0,
      ([lo]) => cmp6(lo, ip) > 0);
    if (line < 0) return null;
    const out = { country: '', region: '', city: '' };
    if (!v6.city) {
      out.country = cstr(read(v6.fd, line * v6.rec + 32, 2), 0, 2);
      return out;
    }
    const locId = read(v6.fd, line * v6.rec + 32, 4).readUInt32BE(0);
    if ((-1 >>> 0) > locId) Object.assign(out, readLoc(locId));
    return out;
  }
  return {
    lookup(ip) {
      if (!ip) return null;
      if (net.isIP(ip) === 4) return lookup4(aton4(ip));
      if (net.isIP(ip) === 6) {
        const upper = ip.toUpperCase();
        for (const prefix of ['0:0:0:0:0:FFFF:', '::FFFF:']) {
          if (upper.indexOf(prefix) === 0) return lookup4(aton4(upper.substring(prefix.length)));
        }
        return lookup6(aton6(ip));
      }
      return null;
    }
  };
}

function getGeoip() {
  if (!geoipLoadAttempted) {
    geoipLoadAttempted = true;
    try {
      const libDir = path.dirname(require.resolve('geoip-lite'));
      geoip = createDiskGeoip(path.resolve(libDir, process.env.GEODATADIR || '../data/'));
    } catch (e) {
      geoip = null;
    }
  }
  return geoip;
}
const dnsPromises = require('dns').promises;
const psl = require('psl');
const { query, transaction } = require('./shared/db.js');
const { getUserId, authenticate, sign } = require('./shared/jwt.js');
const { AsyncLocalStorage } = require('async_hooks');
const { createProvider } = require('./shared/storage.js');
const buckets = require('./shared/buckets.js');
const { encrypt, decrypt } = require('./shared/crypto.js');
const { createFeishuDirectoryClient, FeishuDirectoryError } = require('./shared/feishu-directory.js');
let createGithubDirectoryClient;
let GithubDirectoryError;
try {
  ({ createGithubDirectoryClient, GithubDirectoryError } = require('./shared/github-directory.js'));
} catch (error) {
  console.warn('github-directory module missing, GitHub invite disabled:', error.message);
  GithubDirectoryError = class GithubDirectoryError extends Error {
    constructor(message, code = null, details = null) {
      super(message);
      this.name = 'GithubDirectoryError';
      this.code = code;
      this.details = details;
    }
  };
  createGithubDirectoryClient = () => ({
    searchUsers: async () => {
      throw new GithubDirectoryError('GitHub 目录模块未部署', 'MODULE_MISSING');
    },
    getUserById: async () => null,
    getUserByLogin: async () => null
  });
}
const {
  DEPLOY_UPLOAD_CHUNK_SIZE,
  DEPLOY_UPLOAD_TTL_SECONDS,
  COMPLETING_STALE_SECONDS,
  sha256Hex,
  normalizeSha256,
  decodeBase64Chunk,
  expectedChunkSize,
  uploadObjectPrefix,
  uploadObjectKey,
  parseResultJson,
  isDeployUploadExpired,
  needsDeployUploadExpiryMigration
} = require('./shared/deploy-upload.js');
const { scanZipEntries, createImsModerator, listBlockedPhrasesCatalog } = require('./shared/content-scan.js');
const {
  effectiveRoleIds,
  membershipSummary,
  resolveGrantExpiry
} = require('./shared/membership.js');

// ─────────────────────────────────────────────────────────────
// 注意：线上 website 函数是 `demox functions push` 只上传 index.js，
// shared/ 目录来自已部署的统一 worker 包（发布 index.js 不会带上新的 shared 文件）。
// 所以统计时区和 BI 汇总直接内联在这里，不新增 shared 模块。
// ─────────────────────────────────────────────────────────────
const statTime = (() => {
  /**
   * 统计口径时区：Asia/Shanghai（UTC+8，无夏令时）。
   *
   * 为什么固定 +08:00：
   * - 管理员和绝大多数用户在中国 / 新加坡（同为 UTC+8），按 UTC 切日会把早上 8 点前的访问算到前一天；
   * - 数据库会话时区固定为 UTC（见 shared/db.js），TIMESTAMP 列读出的是 UTC instant，
   *   需要在 SQL 里用 CONVERT_TZ(col, '+00:00', '+08:00') 或在 JS 里加 8 小时再切日；
   * - 用数字偏移而不是 'Asia/Shanghai' 名称，因为 TencentDB 不一定装了时区表，CONVERT_TZ 名称会返回 NULL。
   *
   * 历史数据：本改动之前写入的 site_*_daily_stats.stat_date 是 UTC 日期，不回写。
   * 切换当天（发布日）会混合两种口径，之后全部按 UTC+8。
   */

  const STAT_TZ = 'Asia/Shanghai';
  const STAT_TZ_OFFSET = '+08:00';
  const STAT_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** 毫秒时间戳（或 Date）→ UTC+8 的 YYYY-MM-DD */
  function statDateKey(value = Date.now()) {
    const ms = value instanceof Date ? value.getTime() : Number(value);
    const safe = Number.isFinite(ms) ? ms : Date.now();
    return new Date(safe + STAT_TZ_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** UTC+8 下“今天往前 n 天”的日期键（n=0 即今天） */
  function statDateKeyDaysAgo(n, now = Date.now()) {
    return statDateKey(Number(now) - Number(n || 0) * DAY_MS);
  }

  /** 最近 days 天（含今天）的日期键，按时间升序 */
  function listStatDateKeys(days, now = Date.now()) {
    const out = [];
    for (let i = Number(days) - 1; i >= 0; i -= 1) out.push(statDateKeyDaysAgo(i, now));
    return out;
  }

  /**
   * UTC+8 日期键当天 00:00 对应的 UTC 'YYYY-MM-DD HH:MM:SS'，
   * 用于和 TIMESTAMP/DATETIME 列（会话时区 UTC）比较。
   */
  function statDayStartUtc(dateKey) {
    const ms = Date.parse(`${dateKey}T00:00:00.000Z`) - STAT_TZ_OFFSET_MS;
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  }

  /** SQL 片段：把 UTC 时间列换成 UTC+8 日期。col 只能是代码里写死的列名。 */
  function sqlStatDate(col) {
    if (!/^[a-z_][a-z0-9_.]*$/i.test(col)) throw new Error('invalid column');
    return `DATE(CONVERT_TZ(${col}, '+00:00', '${STAT_TZ_OFFSET}'))`;
  }

  /** mysql2（timezone:'Z'）读出的 DATE 列 / 字符串 → YYYY-MM-DD */
  function toDateKey(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value || '').slice(0, 10);
  }
  return {
    STAT_TZ,
    STAT_TZ_OFFSET,
    STAT_TZ_OFFSET_MS,
    statDateKey,
    statDateKeyDaysAgo,
    listStatDateKeys,
    statDayStartUtc,
    sqlStatDate,
    toDateKey
  };
})();
// 统计“今天”（UTC+8）。会话时区是 UTC，CURDATE() 会按 UTC 切日，统一用这个。
const STAT_TODAY_SQL = `DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '${statTime.STAT_TZ_OFFSET}'))`;

const adminBiLib = (() => {
  /**
   * 管理后台 BI 汇总（get_admin_bi）。
   *
   * 约束：
   * - 只做 SELECT，不调用任何 ensure* 或 backfill，表不存在时该项返回 null，不报错；
   * - 全部参数化，时间范围只允许 7 / 30 / 90 天；
   * - 统计口径时区 UTC+8（见上面的 statTime）。site_*_daily_stats 在切换前写入的是 UTC 日期，不回写；
   * - 结果按 range 缓存 60 秒（进程内），避免看板反复刷新压库。
   *
   * 数据来源：
   * - 新用户：users.created_at
   * - 新站点 / 站点总数 / 存储：websites
   * - 部署次数、成功率、来源、活跃部署者：product_events 里服务端写入的 deploy_success / deploy_fail（page 以 server: 开头），
   *   同一个分块上传（uploadId）多次失败只算一次，之后成功则不算失败；
   *   活跃部署者另外并上 deploy_upload_sessions（COMPLETED）和新建站点的 user_id（服务端埋点上线前的兜底）
   * - PV：site_path_daily_stats（去掉扫描器路径，与旧概览口径一致）
   * - UV：site_access_logs 按 (脱敏 IP, UA) 去重，近似值
   * - 首页漏斗：product_events landing_view → deploy_click → 服务端 deploy_success（同一 visitor_id）
   * - 专业会员：user_roles（含 30 天内到期）
   * - 举报：site_reports status='open'
   */


  const ALLOWED_RANGES = [7, 30, 90];
  const CACHE_TTL_MS = 60 * 1000;
  const MAX_DEPLOY_EVENT_ROWS = 50000;
  const DEPLOY_SOURCES = ['web', 'cli', 'mcp', 'github', 'token', 'api'];

  function normalizeRange(input) {
    const n = Number(input);
    return ALLOWED_RANGES.includes(n) ? n : 30;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function parseProps(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }

  /** 计算当前窗口和上一同长窗口（全部是 UTC+8 日期键 + 对应的 UTC 起点） */
  function buildWindow(range, now = Date.now()) {
    const todayKey = statTime.statDateKeyDaysAgo(0, now);
    const startKey = statTime.statDateKeyDaysAgo(range - 1, now);
    const prevStartKey = statTime.statDateKeyDaysAgo(range * 2 - 1, now);
    const days = statTime.listStatDateKeys(range, now);
    return {
      range,
      todayKey,
      startKey,
      prevStartKey,
      days,
      startUtc: statTime.statDayStartUtc(startKey),
      prevStartUtc: statTime.statDayStartUtc(prevStartKey),
      // 7 天活跃窗口（与所选 range 无关）
      active7StartUtc: statTime.statDayStartUtc(statTime.statDateKeyDaysAgo(6, now)),
      activePrev7StartUtc: statTime.statDayStartUtc(statTime.statDateKeyDaysAgo(13, now))
    };
  }

  /** 把 [{d, c}] 按日期切成 当前 / 上期 合计 + 当前日序列 */
  function splitDaily(rows, win, valueKey = 'c') {
    const byDay = new Map();
    let cur = 0;
    let prev = 0;
    for (const r of rows || []) {
      const key = statTime.toDateKey(r.d);
      const v = num(r[valueKey]);
      if (key >= win.startKey) {
        cur += v;
        byDay.set(key, (byDay.get(key) || 0) + v);
      } else if (key >= win.prevStartKey) {
        prev += v;
      }
    }
    return { cur, prev, byDay };
  }

  async function safe(label, fn, warnings) {
    try {
      return await fn();
    } catch (e) {
      warnings.push(`${label}: ${e && e.code ? e.code : 'ERROR'}`);
      return null;
    }
  }

  /** 部署事件聚合（纯函数，便于单测） */
  function aggregateDeployEvents(rows, win) {
    const empty = () => ({ success: 0, fail: 0 });
    const cur = empty();
    const prev = empty();
    const bySource = {};
    const byDay = new Map();
    const errorCodes = {};
    const deployers7 = new Set();
    const deployersPrev7 = new Set();
    const succeededUploads = new Set();
    const failSeen = new Set();

    const normalized = (rows || []).map((r, i) => {
      const props = parseProps(r.props);
      const ts = r.created_at instanceof Date ? r.created_at.getTime() : Date.parse(String(r.created_at || '').replace(' ', 'T') + (String(r.created_at || '').endsWith('Z') ? '' : 'Z'));
      return {
        ok: r.event_name === 'deploy_success',
        id: r.id != null ? String(r.id) : `row${i}`,
        ts,
        day: statTime.statDateKey(ts),
        uploadId: props.uploadId ? String(props.uploadId) : '',
        userId: props.userId ? String(props.userId) : '',
        source: DEPLOY_SOURCES.includes(props.source) ? props.source : 'api',
        errorCode: props.errorCode ? String(props.errorCode).slice(0, 64) : 'UNKNOWN'
      };
    });
    for (const e of normalized) if (e.ok && e.uploadId) succeededUploads.add(e.uploadId);

    const active7Start = Date.parse(win.active7StartUtc.replace(' ', 'T') + 'Z');
    const activePrev7Start = Date.parse(win.activePrev7StartUtc.replace(' ', 'T') + 'Z');

    for (const e of normalized) {
      if (!Number.isFinite(e.ts)) continue;
      if (e.ok && e.userId) {
        if (e.ts >= active7Start) deployers7.add(e.userId);
        else if (e.ts >= activePrev7Start) deployersPrev7.add(e.userId);
      }
      if (!e.ok) {
        // 同一 uploadId：后来成功了不算失败；多次失败只算一次
        if (e.uploadId && succeededUploads.has(e.uploadId)) continue;
        const k = e.uploadId ? `u:${e.uploadId}` : `e:${e.id}`;
        if (failSeen.has(k)) continue;
        failSeen.add(k);
      }
      const isCur = e.day >= win.startKey;
      const isPrev = !isCur && e.day >= win.prevStartKey;
      if (!isCur && !isPrev) continue;
      const bucket = isCur ? cur : prev;
      bucket[e.ok ? 'success' : 'fail'] += 1;
      if (isCur) {
        bySource[e.source] = bySource[e.source] || empty();
        bySource[e.source][e.ok ? 'success' : 'fail'] += 1;
        const d = byDay.get(e.day) || empty();
        d[e.ok ? 'success' : 'fail'] += 1;
        byDay.set(e.day, d);
        if (!e.ok) errorCodes[e.errorCode] = (errorCodes[e.errorCode] || 0) + 1;
      }
    }
    const rate = (b) => (b.success + b.fail ? b.success / (b.success + b.fail) : null);
    return {
      cur: { ...cur, total: cur.success + cur.fail, successRate: rate(cur) },
      prev: { ...prev, total: prev.success + prev.fail, successRate: rate(prev) },
      bySource: DEPLOY_SOURCES.filter((s) => bySource[s]).map((s) => ({ source: s, ...bySource[s] })),
      byDay,
      topErrors: Object.entries(errorCodes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, count]) => ({ code, count })),
      deployers7,
      deployersPrev7
    };
  }

  /** mysql2 读出的 TIMESTAMP（Date 或 'YYYY-MM-DD HH:MM:SS' UTC 字符串）→ 毫秒；读不出返回 null */
  function toMs(v) {
    if (v == null) return null;
    if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
    const str = String(v);
    const ms = Date.parse(str.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? '' : 'Z'));
    return Number.isFinite(ms) ? ms : null;
  }

  function msToUtcSql(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  }

  /**
   * 埋点开始时间：每个事件第一次出现的时间（部署只看服务端写的 server: 行）。
   * 早于开始时间的日期在序列里是 null（没有记录），不是 0。
   */
  function parseTrackingStarts(rows) {
    const out = { deploys: null, landing: null, deployClick: null };
    for (const r of rows || []) {
      const ms = toMs(r.t);
      if (ms == null) continue;
      const key = r.event_name === 'landing_view' ? 'landing'
        : r.event_name === 'deploy_click' ? 'deployClick'
          : (r.event_name === 'deploy_success' || r.event_name === 'deploy_fail') ? 'deploys' : null;
      if (key && (out[key] == null || ms < out[key])) out[key] = ms;
    }
    return out;
  }

  /**
   * 服务端部署埋点之前的「补算」：每个 (UTC+8 日期, 站点) 算一次部署，来源取并集去重：
   * - websites.created_at：新站点只在第一次部署成功时插入，所以每个新站点 = 当天至少 1 次成功部署；
   * - deploy_upload_sessions（COMPLETED）的 updated_at：分块上传完成 = 一次成功部署（这张表只留约 7 天）。
   * 同一站点同一天多次部署只算 1 次，删掉的站点也找不回来，所以是**下限**；只有总数，没有成功 / 失败拆分，也没有渠道。
   */
  function aggregateDerivedDeploys(siteRows, sessionRows) {
    const pairs = new Set();
    for (const r of [...(siteRows || []), ...(sessionRows || [])]) {
      const d = statTime.toDateKey(r.d);
      if (!d || !r.website_id) continue;
      pairs.add(`${d}|${String(r.website_id).toUpperCase()}`);
    }
    const byDay = new Map();
    for (const k of pairs) {
      const d = k.slice(0, 10);
      byDay.set(d, (byDay.get(d) || 0) + 1);
    }
    return byDay;
  }

  /**
   * 两种补算按天取较大值（同一批部署的两种估计，不能相加）：
   * - sites：上面的站点记录补算；
   * - logs：deploy_daily_backfill（source='log_backfill'，从 CLS 日志一次性算出的成功次数）。
   * 返回 Map(date → { total, from })，from 标出取的是哪一种（相等时记 sites）。
   */
  function mergeDerived(siteByDay, logByDay) {
    const out = new Map();
    const dates = new Set([...(siteByDay ? siteByDay.keys() : []), ...(logByDay ? logByDay.keys() : [])]);
    for (const d of dates) {
      const a = (siteByDay && siteByDay.get(d)) || 0;
      const b = (logByDay && logByDay.get(d)) || 0;
      const total = Math.max(a, b);
      if (total > 0) out.set(d, { total, from: b > a ? 'logs' : 'sites' });
    }
    return out;
  }

  /**
   * 部署按天：每一天标出数据来源和是否知道成功 / 失败。
   * - events：服务端埋点，success / fail 都是真实值（0 就是 0）；
   * - derived：埋点前，按站点记录 / 日志补算，只有 deployDerived 总数，success / fail 为 null（不按比例拆）；
   * - mixed：埋点开始那天。只画一种：埋点总数 ≥ 补算时画埋点（success / fail），否则画补算总数。
   *   取两者较大值，从不相加（相加会把同一批部署算两次，柱子也会叠成一根尖刺）；
   * - none：没有任何记录，三个值都是 null（图上留空，不画 0）。
   */
  function buildDeployDay(date, deployStartKey, liveByDay, derivedByDay) {
    const live = deployStartKey != null && date >= deployStartKey;
    const dv = derivedByDay.get(date);
    const derived = dv == null ? 0 : (typeof dv === 'number' ? dv : dv.total);
    const derivedFrom = derived > 0 ? (typeof dv === 'number' ? 'sites' : dv.from) : null;
    const l = liveByDay.get(date) || { success: 0, fail: 0 };
    const liveTotal = l.success + l.fail;
    if (live && derived > 0) {
      const asLive = liveTotal >= derived;
      return {
        deploySuccess: asLive ? l.success : null,
        deployFail: asLive ? l.fail : null,
        deployDerived: asLive ? null : derived,
        deploySource: 'mixed',
        deploySplitKnown: false,
        deployDerivedFrom: derivedFrom,
        deployLiveTotal: liveTotal
      };
    }
    return {
      deploySuccess: live ? l.success : null,
      deployFail: live ? l.fail : null,
      deployDerived: !live && derived > 0 ? derived : null,
      deploySource: live ? 'events' : (derived > 0 ? 'derived' : 'none'),
      deploySplitKnown: live,
      deployDerivedFrom: !live && derived > 0 ? derivedFrom : null,
      deployLiveTotal: live ? liveTotal : null
    };
  }

  async function computeAdminBi({ query, range, now = Date.now(), wwwWebsiteId = 'EPX2UU43', scannerPathPredicate }) {
    const win = buildWindow(range, now);
    const warnings = [];
    const pathPred = typeof scannerPathPredicate === 'function' ? scannerPathPredicate : () => '1=1';
    const sd = statTime.sqlStatDate;

    // 1. 新用户
    const usersDaily = await safe('users', () => query(
      `SELECT ${sd('created_at')} AS d, COUNT(*) AS c
       FROM users WHERE created_at >= ?
       GROUP BY d`,
      [win.prevStartUtc]
    ), warnings);
    const usersTotal = await safe('usersTotal', () => query('SELECT COUNT(*) AS c FROM users'), warnings);
    const users = splitDaily(usersDaily, win);

    // 2. 站点
    const sitesDaily = await safe('sites', () => query(
      `SELECT ${sd('created_at')} AS d, COUNT(*) AS c
       FROM websites WHERE created_at >= ?
       GROUP BY d`,
      [win.prevStartUtc]
    ), warnings);
    const sitesTotalRows = await safe('sitesTotal', () => query(
      `SELECT COUNT(*) AS sites, COUNT(DISTINCT user_id) AS owners,
              COALESCE(SUM(COALESCE(deployed_size, storage_size, 0)), 0) AS storage
       FROM websites`
    ), warnings);
    const sitesExtraRows = await safe('sitesExtra', () => query(
      `SELECT COALESCE(SUM(CASE WHEN subdomain IS NOT NULL AND subdomain <> '' THEN 1 ELSE 0 END), 0) AS customSubdomain,
              COALESCE(SUM(CASE WHEN hide_watermark = 1 THEN 1 ELSE 0 END), 0) AS hideWatermark
       FROM websites`
    ), warnings);
    const sites = splitDaily(sitesDaily, win);

    // 3. 部署（服务端埋点）
    const deployRows = await safe('deployEvents', () => query(
      `SELECT id, event_name, created_at, props
       FROM product_events
       WHERE event_name IN ('deploy_success', 'deploy_fail')
         AND page LIKE 'server:%'
         AND created_at >= ?
       ORDER BY id ASC
       LIMIT ${MAX_DEPLOY_EVENT_ROWS}`,
      [win.prevStartUtc < win.activePrev7StartUtc ? win.prevStartUtc : win.activePrev7StartUtc]
    ), warnings);
    const deploys = aggregateDeployEvents(deployRows || [], win);

    // 3b. 埋点开始时间 + 埋点之前的补算（只读、读时计算，不回写）
    const trackingRows = await safe('trackingStart', () => query(
      `SELECT event_name, MIN(created_at) AS t
       FROM product_events
       WHERE (event_name IN ('landing_view', 'deploy_click'))
          OR (event_name IN ('deploy_fail', 'deploy_success') AND page LIKE 'server:%')
       GROUP BY event_name`
    ), warnings);
    // 查不到开始时间（表 / 权限问题）时退回旧口径：窗口内每天都按埋点算
    const tracking = trackingRows ? parseTrackingStarts(trackingRows) : { deploys: 0, landing: 0, deployClick: 0 };
    const windowStartMs = Date.parse(win.prevStartUtc.replace(' ', 'T') + 'Z');
    const deployStartKey = tracking.deploys != null ? statTime.statDateKey(tracking.deploys) : null;
    let derivedByDay = new Map();
    // 窗口（含上期）里有埋点之前的日子才需要补算
    if (tracking.deploys == null || tracking.deploys > windowStartMs) {
      const until = msToUtcSql(tracking.deploys != null ? tracking.deploys : now);
      const derivedSites = await safe('derivedSites', () => query(
        `SELECT DISTINCT ${sd('created_at')} AS d, website_id
         FROM websites WHERE created_at >= ? AND created_at < ?`,
        [win.prevStartUtc, until]
      ), warnings);
      const derivedSessions = await safe('derivedUploads', () => query(
        `SELECT DISTINCT ${sd('updated_at')} AS d, website_id
         FROM deploy_upload_sessions WHERE status = 'COMPLETED' AND updated_at >= ? AND updated_at < ?`,
        [win.prevStartUtc, until]
      ), warnings);
      // 日志回填（迁移 022 建表后才有；表不存在时安静跳过，不算数据缺失）
      let logRows = null;
      try {
        logRows = await query(
          `SELECT stat_date AS d, total
           FROM deploy_daily_backfill
           WHERE source = 'log_backfill' AND stat_date >= ? AND stat_date <= ?`,
          [win.prevStartKey, statTime.statDateKey(tracking.deploys != null ? tracking.deploys : now)]
        );
      } catch (e) {
        if (!(e && (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146))) warnings.push(`logBackfill: ${e && e.code ? e.code : 'ERROR'}`);
      }
      const logByDay = new Map();
      for (const r of logRows || []) logByDay.set(statTime.toDateKey(r.d), num(r.total));
      derivedByDay = mergeDerived(aggregateDerivedDeploys(derivedSites, derivedSessions), logByDay);
    }
    const deployDays = new Map(win.days.map((date) => [date, buildDeployDay(date, deployStartKey, deploys.byDay, derivedByDay)]));
    // 本期画出来的补算总数（开始那天按「只画一种」的规则）
    const derivedCur = win.days.reduce((a, d) => a + (deployDays.get(d).deployDerived || 0), 0);
    // 本期 / 上期是否完整被埋点覆盖（开始那天只覆盖半天，不算完整）
    const deploysCurComplete = deployStartKey != null && win.startKey > deployStartKey;
    const deploysPrevComplete = deployStartKey != null && win.prevStartKey > deployStartKey;
    const landingStartKey = tracking.landing != null ? statTime.statDateKey(tracking.landing) : null;
    const clickStartKey = tracking.deployClick != null ? statTime.statDateKey(tracking.deployClick) : null;
    const funnelPrevComplete = landingStartKey != null && clickStartKey != null
      && win.prevStartKey > landingStartKey && win.prevStartKey > clickStartKey;

    // 活跃部署者兜底：分块上传完成 + 新建站点
    const sessionDeployers = await safe('uploadSessions', () => query(
      `SELECT DISTINCT user_id FROM deploy_upload_sessions
       WHERE status = 'COMPLETED' AND updated_at >= ?`,
      [win.active7StartUtc]
    ), warnings);
    const sessionDeployersPrev = await safe('uploadSessionsPrev', () => query(
      `SELECT DISTINCT user_id FROM deploy_upload_sessions
       WHERE status = 'COMPLETED' AND updated_at >= ? AND updated_at < ?`,
      [win.activePrev7StartUtc, win.active7StartUtc]
    ), warnings);
    const siteCreators = await safe('siteCreators', () => query(
      `SELECT DISTINCT user_id, (created_at >= ?) AS is_cur FROM websites WHERE created_at >= ?`,
      [win.active7StartUtc, win.activePrev7StartUtc]
    ), warnings);
    const active = new Set(deploys.deployers7);
    const activePrev = new Set(deploys.deployersPrev7);
    for (const r of sessionDeployers || []) if (r.user_id) active.add(String(r.user_id));
    for (const r of sessionDeployersPrev || []) if (r.user_id) activePrev.add(String(r.user_id));
    for (const r of siteCreators || []) {
      if (!r.user_id) continue;
      (num(r.is_cur) ? active : activePrev).add(String(r.user_id));
    }

    // 4. PV
    const pvDaily = await safe('pv', () => query(
      `SELECT stat_date AS d, SUM(views) AS c
       FROM site_path_daily_stats
       WHERE stat_date >= ? AND ${pathPred('path')}
       GROUP BY stat_date`,
      [win.prevStartKey]
    ), warnings);
    const pv = splitDaily(pvDaily, win);

    // 5. UV（近似）
    const uvKey = `CONCAT(COALESCE(ip_masked, ''), '|', LEFT(COALESCE(user_agent, ''), 255))`;
    const uvTotals = await safe('uv', () => query(
      `SELECT COUNT(DISTINCT CASE WHEN event_ts >= ? THEN ${uvKey} END) AS cur,
              COUNT(DISTINCT CASE WHEN event_ts < ? THEN ${uvKey} END) AS prev
       FROM site_access_logs
       WHERE event_ts >= ? AND event_type = 'view'`,
      [win.startUtc, win.startUtc, win.prevStartUtc]
    ), warnings);
    const uvDaily = await safe('uvDaily', () => query(
      `SELECT ${sd('event_ts')} AS d, COUNT(DISTINCT ${uvKey}) AS c
       FROM site_access_logs
       WHERE event_ts >= ? AND event_type = 'view'
       GROUP BY d`,
      [win.startUtc]
    ), warnings);
    const uvDay = splitDaily(uvDaily, win);

    // 6. 首页漏斗（访客去重）
    const funnelRows = await safe('funnel', () => query(
      `SELECT event_name,
              COUNT(DISTINCT CASE WHEN created_at >= ? THEN visitor_id END) AS cur,
              COUNT(DISTINCT CASE WHEN created_at < ? THEN visitor_id END) AS prev
       FROM product_events
       WHERE event_name IN ('landing_view', 'deploy_click', 'intent_guide_click')
         AND created_at >= ?
       GROUP BY event_name`,
      [win.startUtc, win.startUtc, win.prevStartUtc]
    ), warnings);
    const convertedRows = await safe('funnelConverted', () => query(
      `SELECT COUNT(DISTINCT s.visitor_id) AS c
       FROM product_events s
       WHERE s.event_name = 'deploy_success' AND s.page LIKE 'server:%' AND s.created_at >= ?
         AND EXISTS (
           SELECT 1 FROM product_events l
           WHERE l.visitor_id = s.visitor_id AND l.event_name = 'landing_view' AND l.created_at >= ?
         )`,
      [win.startUtc, win.startUtc]
    ), warnings);
    const funnelDaily = await safe('funnelDaily', () => query(
      `SELECT ${sd('created_at')} AS d, event_name, COUNT(DISTINCT visitor_id) AS c
       FROM product_events
       WHERE event_name IN ('landing_view', 'deploy_click') AND created_at >= ?
       GROUP BY d, event_name`,
      [win.startUtc]
    ), warnings);
    const funnelBy = {};
    for (const r of funnelRows || []) funnelBy[r.event_name] = { cur: num(r.cur), prev: num(r.prev) };
    const landing = funnelBy.landing_view || { cur: 0, prev: 0 };
    const click = funnelBy.deploy_click || { cur: 0, prev: 0 };
    const guide = funnelBy.intent_guide_click || { cur: 0, prev: 0 };
    const converted = convertedRows ? num(convertedRows[0] && convertedRows[0].c) : 0;
    const landingDay = new Map();
    const clickDay = new Map();
    for (const r of funnelDaily || []) {
      const key = statTime.toDateKey(r.d);
      (r.event_name === 'landing_view' ? landingDay : clickDay).set(key, num(r.c));
    }

    // 7. 专业会员
    const roleRows = await safe('pro', () => query('SELECT roles, pro_expires_at FROM user_roles'), warnings);
    let pro = null;
    if (roleRows) {
      const nowDate = new Date(now);
      pro = { active: 0, lifetime: 0, expiring30d: 0, expired: 0 };
      for (const row of roleRows) {
        const m = membershipSummary(row.roles, row.pro_expires_at, nowDate);
        if (m.hasPro) {
          pro.active += 1;
          if (m.proLifetime) pro.lifetime += 1;
          else if (m.remainingDays != null && m.remainingDays <= 30) pro.expiring30d += 1;
        }
        if (m.proExpired) pro.expired += 1;
      }
    }

    // 8. 举报
    const reportRows = await safe('reports', () => query(
      `SELECT COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS recent
       FROM site_reports`,
      [win.startUtc]
    ), warnings);

    // 9. Top 榜（当前窗口）
    const topReferrers = await safe('topReferrers', () => query(
      `SELECT referrer_host AS k, SUM(views) AS v
       FROM site_referrer_daily_stats WHERE stat_date >= ?
       GROUP BY referrer_host ORDER BY v DESC LIMIT 10`,
      [win.startKey]
    ), warnings);
    const topCountries = await safe('topCountries', () => query(
      `SELECT country AS k, SUM(views) AS v
       FROM site_country_daily_stats WHERE stat_date >= ?
       GROUP BY country ORDER BY v DESC LIMIT 10`,
      [win.startKey]
    ), warnings);
    const topPaths = await safe('topPaths', () => query(
      `SELECT path AS k, SUM(views) AS v
       FROM site_path_daily_stats
       WHERE website_id = ? AND stat_date >= ? AND ${pathPred('path')}
       GROUP BY path ORDER BY v DESC LIMIT 15`,
      [wwwWebsiteId, win.startKey]
    ), warnings);
    const topSites = await safe('topSites', () => query(
      `SELECT s.website_id AS k, MAX(w.name) AS name, SUM(s.views) AS v
       FROM site_path_daily_stats s
       LEFT JOIN websites w ON w.website_id = s.website_id
       WHERE s.stat_date >= ? AND ${pathPred('s.path')}
       GROUP BY s.website_id ORDER BY v DESC LIMIT 10`,
      [win.startKey]
    ), warnings);

    // 10. 健康：统计管道延迟
    const ingestRows = await safe('ingestLag', () => query(
      'SELECT MAX(created_at) AS last_ingest, MAX(event_ts) AS last_event FROM site_analytics_ingested_events'
    ), warnings);

    const series = win.days.map((date) => ({
      date,
      newUsers: users.byDay.get(date) || 0,
      newSites: sites.byDay.get(date) || 0,
      ...deployDays.get(date),
      pv: pv.byDay.get(date) || 0,
      uv: uvDaily ? (uvDay.byDay.get(date) || 0) : null,
      // 埋点开始之前：null（没有记录），不是 0
      landing: landingStartKey != null && date >= landingStartKey ? (landingDay.get(date) || 0) : null,
      deployClick: clickStartKey != null && date >= clickStartKey ? (clickDay.get(date) || 0) : null
    }));

    const tops = (rows) => (rows || []).map((r) => ({ key: String(r.k == null ? '' : r.k), views: num(r.v), ...(r.name ? { name: String(r.name) } : {}) }));
    const totalSites = sitesTotalRows ? num(sitesTotalRows[0] && sitesTotalRows[0].sites) : null;
    const lastIngest = ingestRows && ingestRows[0] && ingestRows[0].last_ingest ? new Date(ingestRows[0].last_ingest) : null;

    return {
      generatedAt: new Date(now).toISOString(),
      tz: statTime.STAT_TZ,
      range: { days: win.range, start: win.startKey, end: win.todayKey, prevStart: win.prevStartKey },
      kpis: {
        newUsers: usersDaily ? { value: users.cur, prev: users.prev, total: usersTotal ? num(usersTotal[0] && usersTotal[0].c) : null } : null,
        activeDeployers7d: { value: active.size, prev: activePrev.size },
        deploys: deployRows ? {
          value: deploys.cur.total,
          // 上期没被埋点完整覆盖时为 null：前端据此不显示涨跌箭头
          prev: deploysPrevComplete ? deploys.prev.total : null,
          success: deploys.cur.success,
          fail: deploys.cur.fail,
          successRate: deploys.cur.successRate,
          prevSuccessRate: deploysPrevComplete ? deploys.prev.successRate : null,
          trackedSince: deployStartKey,
          complete: deploysCurComplete,
          derivedTotal: derivedCur
        } : null,
        sites: sitesDaily ? { value: sites.cur, prev: sites.prev, total: totalSites } : null,
        pv: pvDaily ? { value: pv.cur, prev: pv.prev } : null,
        uv: uvTotals ? { value: num(uvTotals[0] && uvTotals[0].cur), prev: num(uvTotals[0] && uvTotals[0].prev), approx: true } : null,
        funnel: funnelRows ? {
          landing: landing.cur,
          deployClick: click.cur,
          guideClick: guide.cur,
          deploySuccess: converted,
          prevLanding: funnelPrevComplete ? landing.prev : null,
          prevDeployClick: funnelPrevComplete ? click.prev : null,
          // 「部署成功」这一步用的是服务端部署埋点，从这天开始
          deploySuccessSince: deployStartKey,
          clickRate: landing.cur ? click.cur / landing.cur : null,
          successRate: landing.cur ? converted / landing.cur : null
        } : null,
        pro,
        reports: reportRows ? { open: num(reportRows[0] && reportRows[0].open), recent: num(reportRows[0] && reportRows[0].recent) } : null
      },
      series,
      deploySources: deploys.bySource,
      deployErrors: deploys.topErrors,
      usage: {
        totalSites,
        siteOwners: sitesTotalRows ? num(sitesTotalRows[0] && sitesTotalRows[0].owners) : null,
        storageBytes: sitesTotalRows ? num(sitesTotalRows[0] && sitesTotalRows[0].storage) : null,
        customSubdomainSites: sitesExtraRows ? num(sitesExtraRows[0] && sitesExtraRows[0].customSubdomain) : null,
        hideWatermarkSites: sitesExtraRows ? num(sitesExtraRows[0] && sitesExtraRows[0].hideWatermark) : null
      },
      tops: {
        referrers: tops(topReferrers),
        countries: tops(topCountries),
        wwwPaths: tops(topPaths),
        sites: tops(topSites)
      },
      health: {
        analyticsLastIngestAt: lastIngest && !Number.isNaN(lastIngest.getTime()) ? lastIngest.toISOString() : null,
        analyticsLagMinutes: lastIngest && !Number.isNaN(lastIngest.getTime()) ? Math.max(0, Math.round((now - lastIngest.getTime()) / 60000)) : null,
        deployFailRate: deploys.cur.successRate == null ? null : 1 - deploys.cur.successRate
      },
      tracking: {
        deploys: deployStartKey,
        deploysAt: trackingRows && tracking.deploys != null ? new Date(tracking.deploys).toISOString() : null,
        deploysDerivedFrom: ['websites.created_at', 'deploy_upload_sessions.updated_at', 'deploy_daily_backfill(log_backfill)'],
        landing: landingStartKey,
        deployClick: clickStartKey
      },
      notes: {
        deploysSince: 'server-side deploy events start at tracking.deploysAt; earlier days are derived from site records and log backfill (max of the two per day, total only, lower bound)',
        uvApprox: 'distinct (masked IP, user agent) from site_access_logs',
        statDateTz: 'stat_date rows written before the UTC+8 switch are UTC dates'
      },
      warnings
    };
  }

  function createAdminBiService({ query, ttlMs = CACHE_TTL_MS, now = () => Date.now(), wwwWebsiteId, scannerPathPredicate }) {
    const cache = new Map();
    return {
      async get(rangeInput) {
        const range = normalizeRange(rangeInput);
        const t = now();
        const hit = cache.get(range);
        if (hit && t - hit.at < ttlMs) return { ...hit.data, cached: true };
        const data = await computeAdminBi({ query, range, now: t, wwwWebsiteId, scannerPathPredicate });
        cache.set(range, { at: t, data });
        return { ...data, cached: false };
      },
      clear() { cache.clear(); }
    };
  }
  return {
    ALLOWED_RANGES,
    CACHE_TTL_MS,
    DEPLOY_SOURCES,
    normalizeRange,
    buildWindow,
    aggregateDeployEvents,
    aggregateDerivedDeploys,
    mergeDerived,
    buildDeployDay,
    parseTrackingStarts,
    computeAdminBi,
    createAdminBiService
  };
})();
const { createAdminBiService } = adminBiLib;

const defaultDomain = 'demox.site';
const unsupportedOfficialDomains = new Set(['vibeme.cn', 'vibemd.cn']);
const builtinOfficialDomains = ['demox.site'];
const officialDomains = Array.from(new Set([
  defaultDomain,
  ...builtinOfficialDomains,
  ...(process.env.OFFICIAL_SITE_DOMAINS || '').split(',')
])).map(normalizeDomainValue).filter((domain) => domain && !unsupportedOfficialDomains.has(domain));
const officialDomainSet = new Set(officialDomains);
const CUSTOM_DOMAIN_CNAME_TARGET = String(process.env.CUSTOM_DOMAIN_CNAME_TARGET || 'customers.demox.site')
  .trim()
  .toLowerCase()
  .replace(/\.+$/, '');
const CUSTOM_DOMAIN_GATEWAY_IPS = new Set(
  String(process.env.CUSTOM_DOMAIN_GATEWAY_IPS || '119.91.123.2')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
);
const CUSTOM_DOMAIN_PROVISION_URL = String(process.env.CUSTOM_DOMAIN_PROVISION_URL || '').trim();
const CUSTOM_DOMAIN_PROVISION_SECRET = String(process.env.CUSTOM_DOMAIN_PROVISION_SECRET || '').trim();
const CUSTOM_DOMAIN_STATUS_PENDING = 'pending';
const CUSTOM_DOMAIN_STATUS_ACTIVE = 'active';
const VISIBILITY_PUBLIC = 'public';
const VISIBILITY_PRIVATE = 'private';
const VISIBILITY_DISABLED = 'disabled';
const PROJECT_ROLE_OWNER = 'owner';
const PROJECT_ROLE_ADMIN = 'admin';
const PROJECT_ROLE_MEMBER = 'member';
const PROJECT_ROLES = [PROJECT_ROLE_OWNER, PROJECT_ROLE_ADMIN, PROJECT_ROLE_MEMBER];
const PROJECT_WRITE_ROLES = [PROJECT_ROLE_OWNER, PROJECT_ROLE_ADMIN];
const FEISHU_PRINCIPAL_USER = 'user';
const FEISHU_PRINCIPAL_DEPARTMENT = 'department';
const FEISHU_DIRECTORY_TTL_MS = 15 * 60 * 1000;
const feishuDirectory = createFeishuDirectoryClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET
});
const githubDirectory = createGithubDirectoryClient();

function normalizeDomainValue(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/^\.+|\.+$/g, '');
}

function normalizeOfficialDomain(input) {
  const domain = normalizeDomainValue(input) || defaultDomain;
  return officialDomainSet.has(domain) ? domain : null;
}

function parseOfficialHost(host) {
  const normalized = normalizeDomainValue(host);
  for (const domain of officialDomains) {
    const suffix = `.${domain}`;
    if (!normalized.endsWith(suffix)) continue;
    const label = normalized.slice(0, -suffix.length);
    if (label && !label.includes('.')) {
      return { label, domain };
    }
  }
  return null;
}

function normalizeCustomHostname(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const withoutScheme = raw.replace(/^https?:\/\//i, '');
  const hostPort = withoutScheme.split('/')[0].split('?')[0].split('#')[0];
  const host = hostPort.replace(/:\d+$/, '');
  return normalizeDomainValue(host);
}

function isValidCustomHostname(hostname) {
  if (!hostname || hostname.length > 253 || hostname.includes('..')) return false;
  if (!hostname.includes('.')) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  return /^(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(hostname);
}

function isOfficialOwnedHost(hostname) {
  const host = normalizeCustomHostname(hostname);
  if (!host) return false;
  if (officialDomainSet.has(host)) return true;
  if (parseOfficialHost(host)) return true;
  for (const domain of officialDomains) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function isValidCustomRouteLabel(label) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
}

// 用公共后缀表区分根域名和子域名（example.com.cn 是根域名，shop.example.com.cn 是子域名）。
function customDomainParts(hostname) {
  const host = normalizeDomainValue(hostname);
  const parsed = host ? psl.parse(host) : null;
  if (parsed && !parsed.error && parsed.domain) {
    return { host, registrable: parsed.domain, sub: parsed.subdomain || '' };
  }
  const labels = host.split('.');
  return { host, registrable: labels.slice(-2).join('.'), sub: labels.slice(0, -2).join('.') };
}

// DNS 服务商里填的「主机记录」：a.b.example.com → a.b，根域名 → @
function customDomainCnameHost(hostname) {
  return customDomainParts(hostname).sub || '@';
}

async function defaultLookupCustomDomainNameservers(domain) {
  try {
    const records = await Promise.race([
      dnsPromises.resolveNs(domain),
      new Promise((resolve) => setTimeout(() => resolve([]), 3000))
    ]);
    return Array.isArray(records) ? records.map((item) => normalizeDomainValue(item)).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

/**
 * 告诉用户该加哪条记录。用户不用选，一律 CNAME 到入口：
 * - 子域名 → CNAME <子域名部分> → 入口
 * - 根域名 → CNAME @ → 入口（Cloudflare、DNSPod 等都支持根域名 CNAME / 拍平）
 * - 根域名再附一条备用：DNS 服务商不支持根域名 CNAME 时，改用 A 记录 @ → 网关 IP。
 *   检测两种都认，已经用 A 记录接入的域名照常生效。
 */
async function customDomainRecordInstruction(hostname) {
  const { sub, registrable } = customDomainParts(hostname);
  if (sub) {
    return { apex: false, recordType: 'CNAME', recordName: sub, recordValue: CUSTOM_DOMAIN_CNAME_TARGET, dnsProvider: null, fallbackRecordType: null, fallbackRecordValue: null };
  }
  const nameservers = await lookupCustomDomainNameservers(registrable).catch(() => []);
  const onCloudflare = nameservers.some((ns) => ns.endsWith('.ns.cloudflare.com'));
  const gatewayIp = [...CUSTOM_DOMAIN_GATEWAY_IPS][0] || null;
  const fallback = !onCloudflare && gatewayIp;
  return {
    apex: true,
    recordType: 'CNAME',
    recordName: '@',
    recordValue: CUSTOM_DOMAIN_CNAME_TARGET,
    dnsProvider: onCloudflare ? 'cloudflare' : null,
    fallbackRecordType: fallback ? 'A' : null,
    fallbackRecordValue: fallback ? gatewayIp : null
  };
}

function customDomainValidationError(hostname) {
  if (!hostname) return { reason: 'invalid', message: '请填写要绑定的域名' };
  if (!isValidCustomHostname(hostname)) {
    return { reason: 'invalid', message: '域名不合法，请填写如 www.example.com 或 demo.example.com' };
  }
  if (isOfficialOwnedHost(hostname)) {
    return { reason: 'official', message: '官方域名不能当作自定义域名绑定，请使用你自己的域名' };
  }
  if (hostname === CUSTOM_DOMAIN_CNAME_TARGET) {
    return { reason: 'reserved', message: '不能绑定平台入口域名' };
  }
  return null;
}

async function lookupCustomDomainCname(hostname) {
  const chain = [];
  let current = hostname;
  const seen = new Set();
  for (let i = 0; i < 8; i += 1) {
    if (!current || seen.has(current)) break;
    seen.add(current);
    let records = [];
    try {
      records = await dnsPromises.resolveCname(current);
    } catch (error) {
      break;
    }
    if (!Array.isArray(records) || !records.length) break;
    current = normalizeDomainValue(records[0]);
    if (!current) break;
    chain.push(current);
    if (current === CUSTOM_DOMAIN_CNAME_TARGET) {
      return { matched: true, chain };
    }
  }
  return { matched: false, chain };
}

function cnamePointsAtOfficialSite(chain) {
  return (chain || []).some((host) => {
    const value = normalizeDomainValue(host);
    return value
      && value !== CUSTOM_DOMAIN_CNAME_TARGET
      && (value === defaultDomain || value.endsWith(`.${defaultDomain}`));
  });
}

// Cloudflare 代理（橙色云）会把 CNAME 拍平成自己的 IP，公网只看得到 A 记录。
// 列表来自 https://www.cloudflare.com/ips-v4 （只用于给出准确提示，不参与放行）。
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
].map((cidr) => {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return { base: ipv4ToInt(base) & mask, mask };
});

function ipv4ToInt(ip) {
  const parts = String(ip || '').split('.').map((item) => Number(item));
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isCloudflareIpv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return CLOUDFLARE_IPV4_RANGES.some((range) => ((value & range.mask) >>> 0) === range.base);
}

async function defaultLookupCustomDomainHostAddresses(hostname) {
  try {
    const records = await dnsPromises.resolve4(hostname);
    return Array.isArray(records) ? records.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

/**
 * 第一步「解析」：返回是否已经指到 Demox 入口，以及没指到时的具体原因。
 * reason: cname | gateway_ip | official_target | cloudflare_proxy | other_cname | other_ip | no_record
 */
async function inspectCustomDomainDns(hostname) {
  const lookup = await lookupCustomDomainCname(hostname);
  if (lookup.matched) return { matched: true, via: 'cname', reason: 'cname', chain: lookup.chain, addresses: [] };
  if (cnamePointsAtOfficialSite(lookup.chain)) {
    return { matched: false, reason: 'official_target', chain: lookup.chain, addresses: [] };
  }
  const addresses = await lookupCustomDomainHostAddresses(hostname);
  // 根域名没法写 CNAME，或 DNS 服务商把 CNAME 拍平了：只要 A 记录正好是网关 IP，也算指对了。
  if (!lookup.chain.length && addresses.length && CUSTOM_DOMAIN_GATEWAY_IPS.size
    && addresses.every((ip) => CUSTOM_DOMAIN_GATEWAY_IPS.has(ip))) {
    return { matched: true, via: 'a', reason: 'gateway_ip', chain: [], addresses };
  }
  if (addresses.length && addresses.some((ip) => isCloudflareIpv4(ip))) {
    return { matched: false, reason: 'cloudflare_proxy', chain: lookup.chain, addresses };
  }
  if (lookup.chain.length) return { matched: false, reason: 'other_cname', chain: lookup.chain, addresses };
  if (addresses.length) return { matched: false, reason: 'other_ip', chain: [], addresses };
  return { matched: false, reason: 'no_record', chain: [], addresses: [] };
}

async function defaultLookupCustomDomainGatewayAddresses() {
  try {
    const records = await dnsPromises.resolve4(CUSTOM_DOMAIN_CNAME_TARGET);
    return Array.isArray(records) ? records.map((item) => String(item || '').trim()).filter(Boolean) : [];
  } catch (error) {
    return [];
  }
}

function defaultProbeCustomDomainHttps(hostname) {
  const host = normalizeCustomHostname(hostname);
  if (!host) return Promise.resolve({ ok: false, reason: 'invalid' });
  return new Promise((resolve) => {
    const req = https.request(
      {
        method: 'GET',
        host,
        path: '/',
        timeout: 8000,
        rejectUnauthorized: true,
        headers: { 'User-Agent': 'Demox-CustomDomain-Probe' }
      },
      (res) => {
        res.resume();
        const status = res.statusCode || 0;
        if (status === 418) {
          resolve({ ok: false, reason: 'teapot', status });
          return;
        }
        if (status >= 200 && status < 500) {
          resolve({ ok: true, status });
          return;
        }
        resolve({ ok: false, reason: `http_${status}`, status });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, reason: 'timeout' });
    });
    req.on('error', (error) => {
      resolve({ ok: false, reason: error.code || error.message || 'request_failed' });
    });
    req.end();
  });
}

function defaultTriggerCustomDomainProvision(hostname) {
  const host = normalizeCustomHostname(hostname);
  if (!host || !CUSTOM_DOMAIN_PROVISION_URL || !CUSTOM_DOMAIN_PROVISION_SECRET) {
    return Promise.resolve({ ok: false, skipped: true });
  }
  let parsed;
  try {
    parsed = new URL(CUSTOM_DOMAIN_PROVISION_URL);
  } catch (error) {
    return Promise.resolve({ ok: false, reason: 'bad_provision_url' });
  }
  const body = JSON.stringify({ hostname: host });
  const transport = parsed.protocol === 'http:' ? http : https;
  const hostHeader = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)
    ? CUSTOM_DOMAIN_CNAME_TARGET
    : parsed.hostname;
  return new Promise((resolve) => {
    const req = transport.request(
      {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        timeout: 25000,
        headers: {
          Authorization: `Bearer ${CUSTOM_DOMAIN_PROVISION_SECRET}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Host: hostHeader
        }
      },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, reason: 'timeout' });
    });
    req.on('error', (error) => resolve({ ok: false, reason: error.code || error.message }));
    req.end(body);
  });
}


// ---- ICP 备案检测 ----
// 网关在大陆（腾讯云）。未备案域名打到网关时，腾讯云会：
//   80 端口：302 跳到 dnspod.qcloud.com/static/webblock.html
//   443 端口：收到 ClientHello 后直接断开
// 直接拿网关 IP + Host/SNI 探测，不依赖用户 DNS，加域名时就能判断。
// 只有看到明确的拦截信号才判定为未备案，其他情况一律当作「不确定 / 已备案」，避免误伤。
const ICP_WEBBLOCK_RE = /dnspod\.qcloud\.com\/static\/webblock|webblock\.html/i;

function defaultProbeCustomDomainIcpHttp(hostname, gatewayIp) {
  return new Promise((resolve) => {
    const req = http.request({
      method: 'GET',
      host: gatewayIp,
      port: 80,
      path: '/.well-known/acme-challenge/demox-icp-probe',
      timeout: 5000,
      headers: { Host: hostname, 'User-Agent': 'Demox-ICP-Probe' }
    }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode || 0, location: String(res.headers.location || ''), server: String(res.headers.server || '') });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.on('error', (error) => resolve({ ok: false, reason: error.code || error.message || 'error' }));
    req.end();
  });
}

function defaultProbeCustomDomainIcpTls(servername, gatewayIp) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; socket.destroy(); resolve(value); } };
    const socket = tls.connect({ host: gatewayIp, port: 443, servername, rejectUnauthorized: false, timeout: 5000 });
    socket.once('secureConnect', () => done({ handshake: true }));
    socket.once('timeout', () => done({ handshake: false, reason: 'timeout' }));
    socket.once('error', (error) => done({ handshake: false, reason: error.code || error.message || 'error' }));
    socket.once('close', () => done({ handshake: false, reason: 'closed' }));
  });
}

let probeCustomDomainIcpHttp = defaultProbeCustomDomainIcpHttp;
let probeCustomDomainIcpTls = defaultProbeCustomDomainIcpTls;

/** 返回 { status: 'filed' | 'unfiled' | 'unknown', signal } */
async function checkCustomDomainIcp(hostname) {
  const gatewayIp = [...CUSTOM_DOMAIN_GATEWAY_IPS][0];
  if (!gatewayIp || String(process.env.CUSTOM_DOMAIN_ICP_CHECK || 'on') === 'off') return { status: 'unknown', signal: 'disabled' };
  const httpProbe = await probeCustomDomainIcpHttp(hostname, gatewayIp).catch(() => ({ ok: false }));
  if (httpProbe.ok) {
    if (httpProbe.status >= 300 && httpProbe.status < 400 && ICP_WEBBLOCK_RE.test(httpProbe.location)) {
      return { status: 'unfiled', signal: 'http_webblock' };
    }
    // 拿到了网关自己的响应（nginx），说明没被拦
    return { status: 'filed', signal: `http_${httpProbe.status}` };
  }
  // 80 端口没结果时看 443：本域名 SNI 被断开、对照 SNI 能握手，才算被拦
  const [mine, control] = await Promise.all([
    probeCustomDomainIcpTls(hostname, gatewayIp).catch(() => ({ handshake: false })),
    probeCustomDomainIcpTls(CUSTOM_DOMAIN_CNAME_TARGET, gatewayIp).catch(() => ({ handshake: false }))
  ]);
  if (mine.handshake) return { status: 'filed', signal: 'tls_ok' };
  if (control.handshake && ['ECONNRESET', 'closed', 'EPIPE'].includes(mine.reason)) {
    return { status: 'unfiled', signal: 'tls_reset' };
  }
  return { status: 'unknown', signal: `http_${httpProbe.reason || 'fail'}/tls_${mine.reason || 'fail'}` };
}

let lookupCustomDomainGatewayAddresses = defaultLookupCustomDomainGatewayAddresses;
let lookupCustomDomainHostAddresses = defaultLookupCustomDomainHostAddresses;
let lookupCustomDomainNameservers = defaultLookupCustomDomainNameservers;
let probeCustomDomainHttps = defaultProbeCustomDomainHttps;
let triggerCustomDomainProvision = defaultTriggerCustomDomainProvision;

function setCustomDomainRuntime(hooks = {}) {
  lookupCustomDomainGatewayAddresses = hooks.lookupGatewayAddresses || defaultLookupCustomDomainGatewayAddresses;
  lookupCustomDomainHostAddresses = hooks.lookupHostAddresses || defaultLookupCustomDomainHostAddresses;
  lookupCustomDomainNameservers = hooks.lookupNameservers || defaultLookupCustomDomainNameservers;
  probeCustomDomainIcpHttp = hooks.probeIcpHttp || defaultProbeCustomDomainIcpHttp;
  probeCustomDomainIcpTls = hooks.probeIcpTls || defaultProbeCustomDomainIcpTls;
  probeCustomDomainHttps = hooks.probeHttps || defaultProbeCustomDomainHttps;
  triggerCustomDomainProvision = hooks.provision || defaultTriggerCustomDomainProvision;
}

async function assertCustomDomainGateway() {
  if (!CUSTOM_DOMAIN_GATEWAY_IPS.size) return { ok: true, addresses: [] };
  const addresses = await lookupCustomDomainGatewayAddresses();
  const matched = addresses.filter((ip) => CUSTOM_DOMAIN_GATEWAY_IPS.has(ip));
  if (!matched.length) {
    return {
      ok: false,
      reason: 'gateway',
      message: '平台入口 customers.demox.site 未指向网关，域名还不能生效'
    };
  }
  return { ok: true, addresses: matched };
}

function customDomainPendingMessage({ dns, gateway, live, hostname, instruction }) {
  const host = CUSTOM_DOMAIN_CNAME_TARGET;
  const recordName = (instruction && instruction.recordName) || customDomainCnameHost(hostname);
  const want = `CNAME ${recordName} 指向 ${host}`;
  if (!dns || !dns.matched) {
    switch (dns && dns.reason) {
      case 'official_target':
        return `CNAME 不能指向 xxx.demox.site，请改成 ${host}`;
      case 'cloudflare_proxy':
        return `开着 Cloudflare 代理，查不到 CNAME。到 Cloudflare 把这条记录的橙色云点成灰色（仅 DNS）：类型 CNAME，名称 ${recordName}，内容 ${host}`;
      case 'other_cname':
        return `CNAME 指向了 ${dns.chain[dns.chain.length - 1]}，请改成 ${want}`;
      case 'other_ip':
        return `解析到了 ${dns.addresses.slice(0, 2).join('、')}，不是 Demox。请改成 ${want}`;
      default:
        return `还查不到记录。请确认 ${want}，新记录一般 1–10 分钟生效`;
    }
  }
  if (gateway && gateway.ok === false) {
    return gateway.message || `平台入口 ${host} 未指向网关，域名还不能生效`;
  }
  if (live && live.ok === false) {
    return '解析已通，正在签发证书。会自动检测，不用点，也不用改 DNS';
  }
  return `还查不到记录。请确认 ${want}`;
}

function customDomainCheckStep({ dns, gateway, live }) {
  if (!dns || !dns.matched) return 'dns';
  if (gateway && gateway.ok === false) return 'gateway';
  if (!live || !live.ok) return 'cert';
  return 'active';
}

function getSupportedOfficialBinding(row) {
  const label = String(row?.subdomain || '').trim().toLowerCase();
  const stored = normalizeDomainValue(row?.subdomain_domain || row?.subdomainDomain) || defaultDomain;
  if (!label || !officialDomainSet.has(stored)) {
    return { subdomain: null, subdomainDomain: defaultDomain };
  }
  return { subdomain: label, subdomainDomain: stored };
}

function getRowSubdomainDomain(row) {
  return getSupportedOfficialBinding(row).subdomainDomain;
}

function buildDefaultSiteUrl(websiteId) {
  const label = String(websiteId || '').trim().toLowerCase();
  return label ? `https://${label}.${defaultDomain}/` : '';
}

function buildCustomSiteUrl(subdomain, domain) {
  const label = String(subdomain || '').trim().toLowerCase();
  const suffix = normalizeOfficialDomain(domain) || defaultDomain;
  return label ? `https://${label}.${suffix}/` : '';
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1 || value === '1';
}

async function loadCustomHostsByNumericIds(numericIds) {
  const ids = [...new Set((numericIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Map();
  try {
    await ensureCustomDomainsTable();
    const rows = await query(
      `SELECT r.website_id AS numeric_id, cd.hostname AS root_hostname, r.label
       FROM custom_domain_routes r
       JOIN custom_domains cd ON cd.id = r.custom_domain_id
       WHERE r.website_id IN (${ids.map(() => '?').join(',')})
       ORDER BY r.label = '' DESC, r.label ASC, r.id ASC`,
      ids
    );
    const map = new Map();
    for (const row of rows) {
      const root = String(row.root_hostname || '').trim().toLowerCase();
      const label = String(row.label || '').trim().toLowerCase();
      const host = label ? `${label}.${root}` : root;
      if (!host) continue;
      const key = String(row.numeric_id);
      const list = map.get(key) || [];
      if (!list.includes(host)) list.push(host);
      map.set(key, list);
    }
    return map;
  } catch (error) {
    console.warn('读取站点自定义域名失败，跳过:', error.message);
    return new Map();
  }
}

async function formatWebsitesForClient(rows) {
  const formatted = (rows || []).map(formatWebsiteForClient);
  const hostsById = await loadCustomHostsByNumericIds((rows || []).map((row) => row.id));
  return formatted.map((website, index) => {
    const hosts = hostsById.get(String(rows[index].id)) || [];
    const customUrl = hosts[0] ? `https://${hosts[0]}/` : '';
    const preferredUrl = customUrl || website.preferredUrl || website.url || '';
    return {
      ...website,
      custom_hosts: hosts,
      customHosts: hosts,
      url: preferredUrl,
      preferred_url: preferredUrl,
      preferredUrl
    };
  });
}

function formatWebsiteForClient(row) {
  const defaultUrl = buildDefaultSiteUrl(row.website_id || row.websiteId);
  const binding = getSupportedOfficialBinding(row);
  const subdomainDomain = binding.subdomainDomain;
  const customUrl = buildCustomSiteUrl(binding.subdomain, subdomainDomain);
  const preferredUrl = customUrl || defaultUrl || row.url || '';
  const visibility = normalizeVisibility(row.visibility);
  const userNickname = String(row.user_nickname || row.userNickname || '').trim();
  const projectPublicId = row.project_key || row.projectKey || row.project_public_id || row.projectPublicId || row.project_id || row.projectId || null;

  return {
    ...row,
    visibility,
    hide_watermark: normalizeBooleanFlag(row.hide_watermark),
    hideWatermark: normalizeBooleanFlag(row.hide_watermark),
    deployedSize: row.deployed_size != null || row.deployedSize != null
      ? Number(row.deployed_size ?? row.deployedSize ?? 0)
      : (row.storage_size != null ? Number(row.storage_size) : null),
    project_id: projectPublicId == null ? null : String(projectPublicId),
    projectId: projectPublicId == null ? null : String(projectPublicId),
    projectInternalId: row.project_id == null ? null : String(row.project_id),
    project_key: row.project_key || row.projectKey || null,
    projectKey: row.project_key || row.projectKey || null,
    projectRole: row.project_role || row.projectRole || null,
    user_nickname: userNickname,
    userNickname,
    url: preferredUrl,
    subdomain: binding.subdomain,
    subdomain_domain: subdomainDomain,
    subdomainDomain,
    default_url: defaultUrl,
    custom_url: customUrl || null,
    preferred_url: preferredUrl,
    defaultUrl,
    customUrl: customUrl || null,
    preferredUrl
  };
}

// 旧默认桶的兜底配置（storage_buckets 表未建/未注册时仍能部署，保证迁移期不中断）。
// 迁移完成后这只是 fallback：正常流程一律走 storage_buckets 注册表。
const LEGACY_BUCKET = {
  provider: 'cos',
  bucket: 'resource-game-1307257815',
  region: 'ap-chengdu',
  endpoint: null,
  originHost: 'sites.demox.site',
  hasOwnCreds: false // 用 SCF 运行角色临时凭证
};

/**
 * 解析"该用哪个桶"。优先 storage_buckets 注册表；表不存在或为空时回退 LEGACY_BUCKET。
 * @param {number|null} bucketId 指定桶 id；为空则取默认桶。
 * @returns {Promise<object>} buckets.rowToConfig 形态的配置
 */
async function resolveBucketConfig(bucketId) {
  try {
    let cfg = bucketId ? await buckets.getBucketById(bucketId) : await buckets.getDefaultBucket();
    if (!cfg && bucketId) cfg = await buckets.getDefaultBucket();
    if (cfg) return cfg;
  } catch (e) {
    // storage_buckets 表还没建（迁移前），回退旧桶
    console.warn('读取 storage_buckets 失败，回退旧默认桶:', e.message);
  }
  return LEGACY_BUCKET;
}

/** 按桶配置造 provider（解析凭证 → createProvider）。 */
function providerFor(cfg) {
  return createProvider(buckets.resolveCreds(cfg));
}

/**
 * 腾讯云 TC3-HMAC-SHA256 请求。这里不用引入完整 SDK，避免拉大 SCF 包体积。
 * 生产由 SCF 运行角色注入 TENCENTCLOUD_*；COS_SECRET_* 仅兼容本地/旧配置。
 * @param {{ service:string, host:string, version:string, action:string, payload:object, region?:string }} opts
 */
async function callTencentCloudApi(opts) {
  const secretId =
    process.env.TENCENTCLOUD_SECRETID ||
    process.env.TENCENT_SECRET_ID ||
    process.env.COS_SECRET_ID;
  const secretKey =
    process.env.TENCENTCLOUD_SECRETKEY ||
    process.env.TENCENT_SECRET_KEY ||
    process.env.COS_SECRET_KEY;
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN || '';

  if (!secretId || !secretKey) {
    throw new Error('缺少腾讯云 API 密钥');
  }

  const body = JSON.stringify(opts.payload || {});
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${opts.host}`,
    `x-tc-action:${opts.action.toLowerCase()}`
  ].join('\n') + '\n';
  const hashedPayload = nodeCrypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n');

  const credentialScope = `${date}/${opts.service}/tc3_request`;
  const hashedCanonicalRequest = nodeCrypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    hashedCanonicalRequest
  ].join('\n');

  const sign = (key, msg, enc) => nodeCrypto.createHmac('sha256', key).update(msg).digest(enc);
  const secretDate = sign(`TC3${secretKey}`, date);
  const secretService = sign(secretDate, opts.service);
  const secretSigning = sign(secretService, 'tc3_request');
  const signature = sign(secretSigning, stringToSign, 'hex');
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    Authorization: authorization,
    'Content-Type': contentType,
    Host: opts.host,
    'X-TC-Action': opts.action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': opts.version,
    'X-TC-Region': opts.region || process.env.SCF_REGION || 'ap-guangzhou'
  };
  if (token) headers['X-TC-Token'] = token;

  const raw = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        host: opts.host,
        path: '/',
        headers,
        timeout: 10000
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`腾讯云 API HTTP ${res.statusCode}: ${data}`));
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('腾讯云 API 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const parsed = JSON.parse(raw);
  if (parsed.Response && parsed.Response.Error) {
    const err = parsed.Response.Error;
    throw new Error(`${err.Code || 'TencentCloudError'}: ${err.Message || '请求失败'}`);
  }
  return parsed.Response || parsed;
}

function encodeSesBody(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

async function sendSesEmail({ to, subject, text, html }) {
  const from = String(process.env.SES_FROM_EMAIL || 'Demox <noreply@mail.demox.site>').trim();
  const region = String(process.env.SES_REGION || 'ap-hongkong').trim() || 'ap-hongkong';
  return callTencentCloudApi({
    service: 'ses',
    host: 'ses.tencentcloudapi.com',
    version: '2020-10-02',
    action: 'SendEmail',
    region,
    payload: {
      FromEmailAddress: from,
      Destination: [to],
      Subject: subject,
      TriggerType: 1,
      Simple: {
        Text: encodeSesBody(text),
        Html: encodeSesBody(html)
      }
    }
  });
}

function escapeEmailText(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSiteDisabledNotice({ ownerName, siteName, siteUrl, websiteId, reason }) {
  const greeting = ownerName ? `${ownerName}，你好：` : '你好：';
  const text = [
    greeting,
    '',
    '你在 Demox 发布的站点已被管理员停用，访客目前无法打开该站点。',
    '',
    `站点名称：${siteName}`,
    `站点地址：${siteUrl}`,
    `站点 ID：${websiteId}`,
    '',
    '停用理由：',
    reason,
    '',
    '如对本次处理有异议，可回复本邮件说明情况。',
    '',
    'Demox 团队',
    'https://www.demox.site/'
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<body style="margin:0;padding:24px;background:#f4f4f5;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 28px 24px;">
    <p style="margin:0 0 16px;">${escapeEmailText(greeting)}</p>
    <p style="margin:0 0 16px;">你在 Demox 发布的站点已被管理员停用，访客目前无法打开该站点。</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#71717a;width:96px;">站点名称</td><td>${escapeEmailText(siteName)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a;">站点地址</td><td><a href="${escapeEmailText(siteUrl)}">${escapeEmailText(siteUrl)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#71717a;">站点 ID</td><td>${escapeEmailText(websiteId)}</td></tr>
    </table>
    <p style="margin:0 0 8px;font-weight:700;">停用理由</p>
    <pre style="margin:0 0 20px;white-space:pre-wrap;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f4f4f5;padding:12px 14px;border-radius:10px;">${escapeEmailText(reason)}</pre>
    <p style="margin:0 0 20px;color:#52525b;font-size:14px;">如对本次处理有异议，可回复本邮件说明情况。</p>
    <p style="margin:0;font-size:13px;color:#71717a;">Demox 团队<br><a href="https://www.demox.site/">https://www.demox.site/</a></p>
  </div>
</body>
</html>`;
  return {
    subject: `【Demox】你的站点「${siteName}」已被停用`,
    text,
    html
  };
}

let _disableReasonColumnEnsured = false;
async function ensureWebsiteDisableReasonColumn() {
  if (_disableReasonColumnEnsured) return;
  try {
    const cols = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites'
         AND COLUMN_NAME IN ('disable_reason','disabled_at')`
    );
    const have = new Set((cols || []).map((row) => row.COLUMN_NAME));
    if (!have.has('disable_reason')) {
      await query("ALTER TABLE websites ADD COLUMN disable_reason VARCHAR(500) NULL");
    }
    if (!have.has('disabled_at')) {
      await query('ALTER TABLE websites ADD COLUMN disabled_at TIMESTAMP NULL');
    }
  } catch (e) {
    console.warn('ensureWebsiteDisableReasonColumn skipped:', e.message);
  }
  _disableReasonColumnEnsured = true;
}

async function createEdgeOnePurgeTask({ type, targets, method }) {
  const zoneId = process.env.EDGEONE_ZONE_ID || process.env.TEO_ZONE_ID || 'zone-3kplfkbflnd6';
  const payload = { ZoneId: zoneId, Type: type, Targets: targets };
  if (method) payload.Method = method;
  const resp = await callTencentCloudApi({
    service: 'teo',
    host: 'teo.tencentcloudapi.com',
    version: '2022-09-01',
    action: 'CreatePurgeTask',
    region: process.env.EDGEONE_REGION || process.env.TEO_REGION || process.env.SCF_REGION || 'ap-guangzhou',
    payload
  });
  return {
    type,
    targets,
    jobId: resp.JobId || null,
    requestId: resp.RequestId || null,
    failedList: resp.FailedList || []
  };
}

/**
 * 组装边缘函数回源路径的 purge_prefix。
 * 边缘 fetch 的是 originHost + websites.path（默认 sites.demox.site/sites/{user}/{id}/...），
 * 只清公开域名不够，回源 HTML 仍会 HIT。
 */
function buildOriginPurgeTargets({ originHost, originPath, ownerId, websiteId }) {
  const host = String(originHost || LEGACY_BUCKET.originHost || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,63}(?:\.[a-z0-9.-]+)+$/.test(host)) return [];
  const targets = new Set();
  const addPrefix = (raw) => {
    const clean = String(raw || '').trim().replace(/^\/+|\/+$/g, '');
    if (!clean || clean.includes('..') || clean.includes('\\')) return;
    if (/[^A-Za-z0-9._/@-]|\/\//.test(clean)) return;
    targets.add(`https://${host}/${clean}/`);
  };
  addPrefix(originPath);
  const owner = String(ownerId == null ? '' : ownerId).trim();
  const id = String(websiteId || '').trim();
  if (owner && id) addPrefix(`sites/${owner}/${id}`);
  const parts = String(originPath || '').trim().replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts[0] === 'sites' && parts.length >= 3) addPrefix(`sites/${parts[1]}/${parts[2]}`);
  return Array.from(targets);
}

async function originArgsFromSite(site) {
  if (!site) return {};
  let originHost = LEGACY_BUCKET.originHost;
  try {
    const cfg = await resolveBucketConfig(site.bucket_id);
    if (cfg && cfg.originHost) originHost = cfg.originHost;
  } catch (_) {
    // 读桶失败时仍按默认回源域清理，避免漏 purge
  }
  return {
    originHost,
    originPath: site.path,
    ownerId: site.user_id
  };
}

/**
 * 部署完成后主动清理 EdgeOne 缓存，替代 URL 上拼 ?v=timestamp 的缓存绕过方案。
 * - purge_prefix: 公开域名、自定义前缀，以及边缘函数回源 origin prefix。
 * - purge_url: 清理边缘函数 resolveSite 使用的 label->path 解析缓存 key（best effort）。
 *
 * 缓存清理失败会退避重试；仍失败不回滚部署，但通过 cachePurge.success=false 和响应 warning 字段显式暴露。
 */
let purgeTaskRunner = (task) => createEdgeOnePurgeTask(task);
let purgeRetryDelaysMs = [500, 1500, 4000];
let purgeSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setPurgeRuntime(hooks = {}) {
  purgeTaskRunner = hooks.runTask || ((task) => createEdgeOnePurgeTask(task));
  purgeRetryDelaysMs = Array.isArray(hooks.retryDelaysMs) ? hooks.retryDelaysMs : [500, 1500, 4000];
  purgeSleep = hooks.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
}

/**
 * 提交单个 purge 任务，失败（抛错或 FailedList 非空）按 purgeRetryDelaysMs 退避重试。
 * 返回值总带 attempts；最终失败时 success=false 并附最后一次错误。
 */
async function runPurgeTaskWithRetry(task) {
  const maxAttempts = purgeRetryDelaysMs.length + 1;
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await purgeTaskRunner(task);
      const failedList = (result && result.failedList) || [];
      if (!failedList.length) return { ...result, success: true, attempts: attempt };
      lastError = `部分目标清理失败: ${failedList.map((f) => (f && (f.Target || f.target)) || String(f)).join(', ')}`;
    } catch (e) {
      lastError = (e && e.message) || String(e);
    }
    console.warn(`EdgeOne ${task.type} 缓存清理失败（第 ${attempt}/${maxAttempts} 次）:`, lastError);
    if (attempt < maxAttempts) await purgeSleep(purgeRetryDelaysMs[attempt - 1]);
  }
  return { type: task.type, targets: task.targets, success: false, attempts: maxAttempts, message: lastError };
}

/** 缓存清理失败时给响应附带的 warning 文案；成功/跳过返回 null。 */
function cachePurgeWarning(cachePurge) {
  if (!cachePurge || cachePurge.success) return null;
  const failed = (cachePurge.tasks || []).filter((t) => !t.success);
  const detail = failed.map((t) => `${t.type}: ${t.message || 'unknown'}`).join('; ');
  return `CDN 缓存清理失败，线上可能短时间仍返回旧内容（${detail || 'unknown'}）`;
}

/**
 * 清理站点相关的 EdgeOne 缓存（页面前缀 + 边缘函数解析缓存 key）。
 * - subdomain/subdomainDomain：当前自定义前缀；extraSubdomains：额外要清的前缀（如 set_subdomain 前的旧前缀）。
 * - customHosts：绑定到该站点的自定义域名（边缘解析缓存 key resolve.demox.site/v2/custom/<host>）。
 * 解析缓存 key 同时清 v2（当前边缘函数格式，存放「最近一次正常结果」，供 stale-if-error 使用）和旧无版本格式。
 */
async function purgeSiteCache({
  websiteId,
  subdomain,
  subdomainDomain,
  extraSubdomains = [],
  customHosts = [],
  originHost,
  originPath,
  ownerId
}) {
  const hosts = new Set();
  const resolveKeys = new Set();
  const customResolveHosts = new Set();
  const defaultLabel = String(websiteId || '').trim().toLowerCase();
  if (defaultLabel) {
    hosts.add(`${defaultLabel}.${defaultDomain}`);
    resolveKeys.add(`${defaultDomain}|${defaultLabel}`);
  }
  const bindings = [{ subdomain, subdomainDomain }, ...(Array.isArray(extraSubdomains) ? extraSubdomains : [])];
  for (const binding of bindings) {
    const label = String((binding && binding.subdomain) || '').trim().toLowerCase();
    if (!label) continue;
    const domain = normalizeOfficialDomain(binding.subdomainDomain) || defaultDomain;
    hosts.add(`${label}.${domain}`);
    resolveKeys.add(`${domain}|${label}`);
  }
  for (const raw of Array.isArray(customHosts) ? customHosts : []) {
    const host = String(raw || '').trim().toLowerCase().replace(/\.+$/, '');
    if (/^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/.test(host)) customResolveHosts.add(host);
  }

  const safeHosts = Array.from(hosts).filter(host => /^[a-z0-9-]{1,63}\.[a-z0-9.-]+$/.test(host));
  const originTargets = buildOriginPurgeTargets({ originHost, originPath, ownerId, websiteId });
  if (safeHosts.length === 0 && originTargets.length === 0 && customResolveHosts.size === 0) {
    return { success: true, skipped: true, reason: 'no_valid_hosts' };
  }

  const publicTargets = safeHosts.map(host => `https://${host}/`);
  const prefixTargets = [...publicTargets, ...originTargets];
  // 边缘函数解析缓存 key：v2 为当前格式（edge-functions/subdomain-router.js RESOLVE_CACHE_PREFIX），
  // 旧无版本格式保留，兼容边缘函数回滚到旧版本的情况。
  const resolveTargets = [];
  for (const key of resolveKeys) {
    const [domain, label] = key.split('|');
    const suffix = `${encodeURIComponent(domain)}/${encodeURIComponent(label)}`;
    resolveTargets.push(`https://resolve.${defaultDomain}/v2/host/${suffix}`);
    resolveTargets.push(`https://resolve.${defaultDomain}/host/${suffix}`);
  }
  for (const host of customResolveHosts) {
    resolveTargets.push(`https://resolve.${defaultDomain}/v2/custom/${encodeURIComponent(host)}`);
    resolveTargets.push(`https://resolve.${defaultDomain}/custom/${encodeURIComponent(host)}`);
  }
  const tasks = [];

  for (const task of [
    { type: 'purge_prefix', method: 'delete', targets: prefixTargets },
    { type: 'purge_url', targets: resolveTargets }
  ]) {
    if (!task.targets.length) continue;
    tasks.push(await runPurgeTaskWithRetry(task));
  }

  return {
    success: tasks.every(t => t.success),
    skipped: false,
    hosts: safeHosts,
    originTargets,
    tasks
  };
}

/** 站点绑定的自定义域名完整 host 列表（best effort，失败返回空数组）。websiteDbId = websites.id */
async function listCustomHostsForWebsite(websiteDbId) {
  if (!websiteDbId) return [];
  try {
    await ensureCustomDomainsTable();
    const rows = await query(
      `SELECT cd.hostname AS hostname, r.label AS label
       FROM custom_domain_routes r
       JOIN custom_domains cd ON cd.id = r.custom_domain_id
       WHERE r.website_id = ?`,
      [websiteDbId]
    );
    return (rows || [])
      .map((row) => (row.label ? `${row.label}.${row.hostname}` : String(row.hostname || '')))
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
  } catch (e) {
    console.warn('读取站点自定义域名失败（跳过其解析缓存清理）:', e.message);
    return [];
  }
}

/** 清理缓存但绝不让主流程失败。 */
async function purgeSiteCacheSafely(args) {
  try {
    return await purgeSiteCache(args);
  } catch (e) {
    console.warn('站点缓存清理异常:', e && e.message);
    return { success: false, skipped: false, tasks: [{ type: 'unknown', success: false, message: (e && e.message) || String(e) }] };
  }
}

/**
 * SCF 云函数入口
 */
exports.main = async (event, context) => {
  const auditContext = { admin: null };
  let response;
  let thrown = null;
  try {
    response = await adminAuditStorage.run(auditContext, () => dispatchWebsiteRequest(event, context));
  } catch (error) {
    thrown = error;
  }
  if (auditContext.admin) {
    await recordAdminAudit(event, auditContext.admin, thrown ? { statusCode: 500 } : response);
  }
  if (thrown) throw thrown;
  return response;
};

async function dispatchWebsiteRequest(event, context) {
  try {
    // 解析 body
    let body = event.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }
    event.body = body;

    const pathUrl = event.path || body?.path || event.queryString?.path || '/';
    const method = event.httpMethod || 'POST';

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers: getCORSHeaders(), body: '' };
    }

    // PAT（个人访问令牌）吊销拦截：PAT 是带 jti 声明的长效 JWT，
    // 现有 authenticate 可正常解析；此处仅查表确认未吊销。
    // 会话 JWT 无 jti 声明，直接跳过，零影响。
    const _authPayload = authenticate(event);
    if (_authPayload && _authPayload.jti) {
      try {
        await ensureAccessTokensTable();
        const _patRows = await query(
          'SELECT revoked_at, expires_at FROM access_tokens WHERE jti = ? LIMIT 1',
          [_authPayload.jti]
        );
        const _revoked = !_patRows.length || _patRows[0].revoked_at;
        const _expired = _patRows[0] && _patRows[0].expires_at && new Date(_patRows[0].expires_at) < new Date();
        if (_revoked || _expired) {
          return {
            statusCode: 401,
            headers: getCORSHeaders(),
            body: JSON.stringify({ success: false, error: 'Token已吊销或过期' })
          };
        }
        // fire-and-forget 更新最近使用时间，不阻塞请求
        query('UPDATE access_tokens SET last_used_at = NOW() WHERE jti = ?', [_authPayload.jti]).catch(() => {});
      } catch (e) {
        console.warn('PAT 吊销检查失败，放行:', e.message);
      }
    }

    // 路由分发
    // 优先按 body.action 精确分发(前端总是带 action);
    // path 含义模糊(如 /list 会匹配 /list-user-roles),仅作无 action 时的回退。
    const action = body?.action;
    const actionMap = {
      upload_and_deploy: handleUploadAndDeploy,
      init_deploy_upload: handleInitDeployUpload,
      upload_deploy_chunk: handleUploadDeployChunk,
      complete_deploy_upload: handleCompleteDeployUpload,
      abort_deploy_upload: handleAbortDeployUpload,
      list: handleListWebsites,
      delete: handleDeleteWebsite,
      list_all: handleListAllWebsites,
      update_name: handleUpdateWebsiteName,
      update_tags: handleUpdateWebsiteTags,
      set_subdomain: handleSetSubdomain,
      check_subdomain: handleCheckSubdomain,
      clear_subdomain: handleClearSubdomain,
      update_visibility: handleUpdateWebsiteVisibility,
      update_watermark: handleUpdateWebsiteWatermark,
      update_seo: handleUpdateSeo,
      resolve_subdomain: handleResolveSubdomain,
      list_project_custom_domains: handleListProjectCustomDomains,
      add_project_custom_domain: handleAddProjectCustomDomain,
      set_project_custom_domain_route: handleSetProjectCustomDomainRoute,
      remove_project_custom_domain_route: handleRemoveProjectCustomDomainRoute,
      remove_project_custom_domain: handleRemoveProjectCustomDomain,
      verify_project_custom_domain: handleVerifyProjectCustomDomain,
      list_blocked_phrases: handleListBlockedPhrases,
      check_site_access: handleCheckSiteAccess,
      track_site_event: handleTrackSiteEvent,
      report_site: handleReportSite,
      list_site_reports: handleListSiteReports,
      update_site_report: handleUpdateSiteReport,
      get_site_stats: handleGetSiteStats,
      get_site_access_logs: handleGetSiteAccessLogs,
      rollup_site_analytics: handleRollupSiteAnalytics,
      backfill_site_analytics_geo: handleBackfillSiteAnalyticsGeo,
      list_projects: handleListProjects,
      create_project: handleCreateProject,
      update_project: handleUpdateProject,
      archive_project: handleArchiveProject,
      delete_project: handleDeleteProject,
      set_website_project: handleSetWebsiteProject,
      list_project_members: handleListProjectMembers,
      search_project_invite_users: handleSearchProjectInviteUsers,
      invite_project_member: handleInviteProjectMember,
      search_feishu_project_principals: handleSearchFeishuProjectPrincipals,
      grant_project_to_feishu: handleGrantProjectToFeishu,
      remove_project_feishu_grant: handleRemoveProjectFeishuGrant,
      search_github_project_principals: handleSearchGithubProjectPrincipals,
      grant_project_to_github: handleGrantProjectToGithub,
      remove_project_github_grant: handleRemoveProjectGithubGrant,
      update_project_member_role: handleUpdateProjectMemberRole,
      remove_project_member: handleRemoveProjectMember,
      bucket_stats: handleBucketStats,
      list_user_roles: handleListUserRoles,
      get_user_overview: handleGetUserOverview,
      get_platform_overview: handleGetPlatformOverview,
      set_user_role: handleSetUserRole,
      delete_user_role: handleDeleteUserRole,
      list_role_limits: handleListRoleLimits,
      set_role_limit: handleSetRoleLimit,
      delete_role_limit: handleDeleteRoleLimit,
      resolve_user_emails: handleResolveUserEmails,
      get_role_limits: handleGetRoleLimits,
      get_usage: handleGetUsage,
      create_token: handleCreateToken,
      list_tokens: handleListTokens,
      revoke_token: handleRevokeToken,
      track_product_event: handleTrackProductEvent,
      get_product_funnel: handleGetProductFunnel,
      get_admin_bi: handleGetAdminBi,
      list_admin_audit: handleListAdminAudit,
      revoke_oauth_refresh_token: handleRevokeOAuthRefreshToken,
      // 多云存储桶注册制
      list_buckets: handleListBuckets,
      register_bucket: handleRegisterBucket,
      update_bucket: handleUpdateBucket,
      delete_bucket: handleDeleteBucket,
      set_default_bucket: handleSetDefaultBucket
    };

    if (action && actionMap[action]) {
      return await actionMap[action](event);
    }

    if (isAnalyticsRollupTimerEvent(event)) {
      await ensureTeamAdminGrant(); // 023：团队管理员账号授权，未配置时什么也不做
      // v14：顺带清理过期的管理员审计（每实例每小时最多一次，失败不影响聚合）。
      await pruneAdminAuditLog();
      return await handleRollupSiteAnalytics(event);
    }

    // 无 action 时按 path 回退(兼容旧调用)。注意顺序:更长/更具体的放前面。
    if (pathUrl.includes('/deploy-upload/init')) {
      return await handleInitDeployUpload(event);
    } else if (pathUrl.includes('/deploy-upload/chunk')) {
      return await handleUploadDeployChunk(event);
    } else if (pathUrl.includes('/deploy-upload/complete')) {
      return await handleCompleteDeployUpload(event);
    } else if (pathUrl.includes('/deploy-upload/abort')) {
      return await handleAbortDeployUpload(event);
    } else if (pathUrl.includes('/upload')) {
      return await handleUploadAndDeploy(event);
    } else if (pathUrl.includes('/list-user-roles')) {
      return await handleListUserRoles(event);
    } else if (pathUrl.includes('/get-user-overview')) {
      return await handleGetUserOverview(event);
    } else if (pathUrl.includes('/get-platform-overview')) {
      return await handleGetPlatformOverview(event);
    } else if (pathUrl.includes('/list-role-limits')) {
      return await handleListRoleLimits(event);
    } else if (pathUrl.includes('/get-usage')) {
      return await handleGetUsage(event);
    } else if (pathUrl.includes('/create-token')) {
      return await handleCreateToken(event);
    } else if (pathUrl.includes('/list-tokens')) {
      return await handleListTokens(event);
    } else if (pathUrl.includes('/revoke-oauth-refresh-token')) {
      return await handleRevokeOAuthRefreshToken(event);
    } else if (pathUrl.includes('/revoke-token')) {
      return await handleRevokeToken(event);
    } else if (pathUrl.includes('/track-product-event')) {
      return await handleTrackProductEvent(event);
    } else if (pathUrl.includes('/get-product-funnel')) {
      return await handleGetProductFunnel(event);
    } else if (pathUrl.includes('/get-admin-bi')) {
      return await handleGetAdminBi(event);
    } else if (pathUrl.includes('/list-admin-audit')) {
      return await handleListAdminAudit(event);
    } else if (pathUrl.includes('/list-project-custom-domains')) {
      return await handleListProjectCustomDomains(event);
    } else if (pathUrl.includes('/add-project-custom-domain')) {
      return await handleAddProjectCustomDomain(event);
    } else if (pathUrl.includes('/set-project-custom-domain-route')) {
      return await handleSetProjectCustomDomainRoute(event);
    } else if (pathUrl.includes('/remove-project-custom-domain-route')) {
      return await handleRemoveProjectCustomDomainRoute(event);
    } else if (pathUrl.includes('/remove-project-custom-domain')) {
      return await handleRemoveProjectCustomDomain(event);
    } else if (pathUrl.includes('/verify-project-custom-domain')) {
      return await handleVerifyProjectCustomDomain(event);
    } else if (pathUrl.includes('/list-projects')) {
      return await handleListProjects(event);
    } else if (pathUrl.includes('/create-project')) {
      return await handleCreateProject(event);
    } else if (pathUrl.includes('/update-project')) {
      return await handleUpdateProject(event);
    } else if (pathUrl.includes('/archive-project')) {
      return await handleArchiveProject(event);
    } else if (pathUrl.includes('/delete-project')) {
      return await handleDeleteProject(event);
    } else if (pathUrl.includes('/set-website-project')) {
      return await handleSetWebsiteProject(event);
    } else if (pathUrl.includes('/list-project-members')) {
      return await handleListProjectMembers(event);
    } else if (pathUrl.includes('/invite-project-member')) {
      return await handleInviteProjectMember(event);
    } else if (pathUrl.includes('/search-github-project-principals')) {
      return await handleSearchGithubProjectPrincipals(event);
    } else if (pathUrl.includes('/grant-project-to-github')) {
      return await handleGrantProjectToGithub(event);
    } else if (pathUrl.includes('/remove-project-github-grant')) {
      return await handleRemoveProjectGithubGrant(event);
    } else if (pathUrl.includes('/update-project-member-role')) {
      return await handleUpdateProjectMemberRole(event);
    } else if (pathUrl.includes('/remove-project-member')) {
      return await handleRemoveProjectMember(event);
    } else if (pathUrl.includes('/list-all')) {
      return await handleListAllWebsites(event);
    } else if (pathUrl.includes('/list')) {
      return await handleListWebsites(event);
    } else if (pathUrl.includes('/delete')) {
      return await handleDeleteWebsite(event);
    } else if (pathUrl.includes('/update-name')) {
      return await handleUpdateWebsiteName(event);
    } else if (pathUrl.includes('/update-tags')) {
      return await handleUpdateWebsiteTags(event);
    } else if (pathUrl.includes('/set-subdomain')) {
      return await handleSetSubdomain(event);
    } else if (pathUrl.includes('/check-subdomain')) {
      return await handleCheckSubdomain(event);
    } else if (pathUrl.includes('/clear-subdomain')) {
      return await handleClearSubdomain(event);
    } else if (pathUrl.includes('/update-visibility')) {
      return await handleUpdateWebsiteVisibility(event);
    } else if (pathUrl.includes('/update-watermark')) {
      return await handleUpdateWebsiteWatermark(event);
    } else if (pathUrl.includes('/update-seo')) {
      return await handleUpdateSeo(event);
    } else if (pathUrl.includes('/content-scan/phrases')) {
      return await handleListBlockedPhrases();
    } else if (pathUrl.includes('/resolve-subdomain')) {
      return await handleResolveSubdomain(event);
    } else if (pathUrl.includes('/check-site-access')) {
      return await handleCheckSiteAccess(event);
    } else if (pathUrl.includes('/track-site-event') || pathUrl.includes('/analytics/track')) {
      return await handleTrackSiteEvent(event);
    } else if (pathUrl.includes('/list-site-reports')) {
      return await handleListSiteReports(event);
    } else if (pathUrl.includes('/update-site-report')) {
      return await handleUpdateSiteReport(event);
    } else if (pathUrl.includes('/report-site')) {
      return await handleReportSite(event);
    } else if (pathUrl.includes('/site-stats') || pathUrl.includes('/analytics/stats')) {
      return await handleGetSiteStats(event);
    } else if (pathUrl.includes('/site-access-logs') || pathUrl.includes('/analytics/access-logs')) {
      return await handleGetSiteAccessLogs(event);
    } else if (pathUrl.includes('/analytics/rollup')) {
      return await handleRollupSiteAnalytics(event);
    } else if (pathUrl.includes('/analytics/backfill-geo')) {
      return await handleBackfillSiteAnalyticsGeo(event);
    } else {
      return {
        statusCode: 404,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: 'Not Found', message: '接口不存在' })
      };
    }
  } catch (error) {
    console.error('处理请求失败:', error);
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: 'Internal Server Error', message: error.message })
    };
  }
}

/**
 * 从数据库获取用户角色配置
 */
async function getUserLimits(userId) {
  try {
    // 1. 获取用户的角色
    const userRolesResult = await query('SELECT * FROM user_roles WHERE user_id = ?', [userId]);

    if (userRolesResult.length === 0) {
      // 没有角色配置，返回默认普通用户配置
      return {
        name: 'user',
        priority: 10,
        deployment_limit: 10,
        max_file_size: 50 * 1024 * 1024,
        max_file_count: 100
      };
    }

    const userRoles = effectiveRoleIds(userRolesResult[0].roles, userRolesResult[0].pro_expires_at);

    // 2. 获取所有角色配置
    const rolesConfig = await query('SELECT * FROM roles WHERE enabled = 1 ORDER BY priority DESC');

    // 3. 找到用户拥有的最高优先级角色
    let highestRole = null;
    for (const role of rolesConfig) {
      if (userRoles.includes(role.id)) {
        if (!highestRole || role.priority > highestRole.priority) {
          highestRole = role;
        }
      }
    }

    if (!highestRole) {
      // 没有匹配的角色，返回默认配置
      return {
        name: 'user',
        priority: 10,
        deployment_limit: 10,
        max_file_size: 50 * 1024 * 1024,
        max_file_count: 100
      };
    }

    return {
      name: highestRole.name,
      priority: highestRole.priority,
      deployment_limit: highestRole.deployment_limit,
      max_file_size: highestRole.max_file_size || 50 * 1024 * 1024,
      max_file_count: highestRole.max_file_count
    };
  } catch (e) {
    console.error('获取用户角色配置失败:', e);
    // 返回默认配置
    return {
      name: 'user',
      priority: 10,
      deployment_limit: 10,
      max_file_size: 50 * 1024 * 1024,
      max_file_count: 100
    };
  }
}

/**
 * 幂等确保 websites 表存在用量列。
 * 冷启动后只检查一次；列已存在时仅一次轻量 information_schema 查询。
 * 未执行 008 迁移的历史库也能自动补列，避免部署写入失败。
 */
let _usageColumnsEnsured = false;
async function ensureUsageColumns() {
  if (_usageColumnsEnsured) return;
  try {
    const cols = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites'
         AND COLUMN_NAME IN ('file_count','storage_size','deployed_size')`
    );
    const have = new Set((cols || []).map((r) => r.COLUMN_NAME));
    if (!have.has('file_count')) {
      await query(`ALTER TABLE websites ADD COLUMN file_count INT DEFAULT NULL COMMENT '本次部署的文件数量（单次上传包）'`);
    }
    if (!have.has('storage_size')) {
      await query(`ALTER TABLE websites ADD COLUMN storage_size BIGINT DEFAULT NULL COMMENT '本次部署的上传包体积(字节)'`);
    }
    if (!have.has('deployed_size')) {
      await query(`ALTER TABLE websites ADD COLUMN deployed_size BIGINT DEFAULT NULL COMMENT '当前部署解压后文件体积(字节)'`);
    }
  } catch (e) {
    // 列可能已存在（并发）或库不可用；写入时若仍缺列会再兜底。
    console.warn('ensureUsageColumns 跳过:', e.message);
  }
  _usageColumnsEnsured = true;
}

/**
 * 幂等确保 websites 表存在 seo_title / seo_description / og_image 列。
 * 冷启动后只检查一次；用于边缘函数在回源时向 <head> 注入 SEO meta。
 */
let _seoColumnsEnsured = false;
async function ensureSeoColumns() {
  if (_seoColumnsEnsured) return;
  try {
    const cols = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites'
         AND COLUMN_NAME IN ('seo_title','seo_description','og_image')`
    );
    const have = new Set((cols || []).map((r) => r.COLUMN_NAME));
    if (!have.has('seo_title')) {
      await query(`ALTER TABLE websites ADD COLUMN seo_title VARCHAR(255) NULL COMMENT 'SEO 标题，为空回退 name'`);
    }
    if (!have.has('seo_description')) {
      await query(`ALTER TABLE websites ADD COLUMN seo_description VARCHAR(500) NULL COMMENT 'SEO 描述（meta description）'`);
    }
    if (!have.has('og_image')) {
      await query(`ALTER TABLE websites ADD COLUMN og_image VARCHAR(500) NULL COMMENT 'OG 图片外链 URL'`);
    }
  } catch (e) {
    console.warn('ensureSeoColumns 跳过:', e.message);
  }
  _seoColumnsEnsured = true;
}

/** Ensure the per-site watermark preference exists before reads or writes. */
let _watermarkColumnEnsured = false;
async function ensureWatermarkColumn() {
  if (_watermarkColumnEnsured) return;
  try {
    const cols = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites'
         AND COLUMN_NAME = 'hide_watermark'`
    );
    if (!cols.length) {
      await query(
        `ALTER TABLE websites ADD COLUMN hide_watermark TINYINT(1) NOT NULL DEFAULT 0
         COMMENT 'Whether the hosted-page Demox watermark is hidden'`
      );
    }
  } catch (e) {
    console.warn('ensureWatermarkColumn skipped:', e.message);
  }
  _watermarkColumnEnsured = true;
}

/** Ensure GitHub project grants can be stored before reads or writes. */
let _githubGrantsTableEnsured = false;
async function ensureGithubGrantsTable() {
  if (_githubGrantsTableEnsured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS project_github_grants (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        project_id BIGINT NOT NULL,
        principal_type VARCHAR(16) NOT NULL DEFAULT 'user',
        key_type VARCHAR(32) NOT NULL DEFAULT 'github_id',
        principal_key VARCHAR(255) NOT NULL,
        github_login VARCHAR(255) DEFAULT NULL,
        display_name VARCHAR(120) DEFAULT NULL,
        avatar_url VARCHAR(512) DEFAULT NULL,
        role VARCHAR(16) NOT NULL DEFAULT 'member',
        created_by VARCHAR(64) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_project_github_principal (project_id, principal_type, key_type, principal_key),
        INDEX idx_project_github_principal (principal_type, key_type, principal_key, active),
        INDEX idx_project_github_project (project_id, active, role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
  } catch (e) {
    console.warn('ensureGithubGrantsTable skipped:', e.message);
  }
  _githubGrantsTableEnsured = true;
}

let _customDomainsTableEnsured = false;
async function ensureCustomDomainsTable() {
  if (_customDomainsTableEnsured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS custom_domains (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        project_id BIGINT NOT NULL,
        hostname VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        created_by VARCHAR(64) NOT NULL,
        verified_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_custom_domain_hostname (hostname),
        INDEX idx_custom_domains_project (project_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    await query(
      `CREATE TABLE IF NOT EXISTS custom_domain_routes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        custom_domain_id BIGINT NOT NULL,
        label VARCHAR(63) NOT NULL DEFAULT '',
        website_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_custom_domain_route (custom_domain_id, label),
        INDEX idx_custom_domain_routes_website (website_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    const legacy = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_domains' AND COLUMN_NAME = 'website_id'`
    );
    if (legacy.length) {
      await query(
        `INSERT IGNORE INTO custom_domain_routes (custom_domain_id, label, website_id)
         SELECT id, '', website_id FROM custom_domains WHERE website_id IS NOT NULL`
      );
    }
  } catch (e) {
    console.warn('ensureCustomDomainsTable skipped:', e.message);
  }
  _customDomainsTableEnsured = true;
}

/**
 * 幂等确保 access_tokens 表存在（个人访问令牌）。
 */
let _accessTokensTableEnsured = false;
async function ensureAccessTokensTable() {
  if (_accessTokensTableEnsured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS access_tokens (
        id           BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id      VARCHAR(64) NOT NULL COMMENT '所属用户ID',
        name         VARCHAR(255) NOT NULL COMMENT '令牌名称（用户自取）',
        jti          VARCHAR(64) NOT NULL COMMENT 'JWT ID，用于吊销查表',
        prefix       VARCHAR(32) NOT NULL COMMENT '令牌前缀（展示用，不可还原）',
        expires_at   TIMESTAMP NULL DEFAULT NULL COMMENT '过期时间',
        last_used_at TIMESTAMP NULL DEFAULT NULL COMMENT '最近使用时间',
        revoked_at   TIMESTAMP NULL DEFAULT NULL COMMENT '吊销时间',
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_access_tokens_jti (jti),
        INDEX idx_access_tokens_user (user_id),
        INDEX idx_access_tokens_prefix (prefix)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='个人访问令牌'`
    );
  } catch (e) {
    console.warn('ensureAccessTokensTable 跳过:', e.message);
  }
  _accessTokensTableEnsured = true;
}

/**
 * 幂等确保 product_events 表存在（产品漏斗埋点）。
 */
let _productEventsTableEnsured = false;
async function ensureProductEventsTable() {
  if (_productEventsTableEnsured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS product_events (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        event_name  VARCHAR(64) NOT NULL COMMENT '事件名',
        visitor_id  VARCHAR(64) NOT NULL DEFAULT '' COMMENT '匿名访客ID',
        page        VARCHAR(128) NOT NULL DEFAULT '' COMMENT '触发页面路径',
        props       JSON NULL COMMENT '附加属性（JSON）',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_events_name_time (event_name, created_at),
        INDEX idx_product_events_visitor (visitor_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品漏斗埋点'`
    );
  } catch (e) {
    console.warn('ensureProductEventsTable 跳过:', e.message);
  }
  _productEventsTableEnsured = true;
}

/**
 * 检查管理员权限
 */
let _proExpiresColumnEnsured = false;

async function ensureProExpiresColumn() {
  if (_proExpiresColumnEnsured) return;
  await ensureColumn(
    'user_roles',
    'pro_expires_at',
    "ALTER TABLE user_roles ADD COLUMN pro_expires_at DATETIME DEFAULT NULL COMMENT '专业会员到期时间，NULL=永久'"
  );
  _proExpiresColumnEnsured = true;
}

async function getUserRoleIds(userId) {
  const roles = await query('SELECT * FROM user_roles WHERE user_id = ?', [userId]);
  if (roles.length === 0) {
    return [];
  }
  return effectiveRoleIds(roles[0].roles, roles[0].pro_expires_at);
}

async function checkAdmin(userId) {
  return (await getUserRoleIds(userId)).includes('admin');
}

const PRO_AND_ABOVE_ROLES = new Set(['pro', 'admin']);

function hasProOrAboveRoleIds(roleIds) {
  return (Array.isArray(roleIds) ? roleIds : []).some((role) =>
    PRO_AND_ABOVE_ROLES.has(String(role).trim().toLowerCase())
  );
}

async function hasProOrAboveRole(userId) {
  return hasProOrAboveRoleIds(await getUserRoleIds(userId));
}

async function canHideWebsiteWatermark(userId) {
  return hasProOrAboveRole(userId);
}

function proFeatureDenied(code, message) {
  return ok({
    success: false,
    code,
    message: `${message}。需要更多技术支持，欢迎联系 phosa@qq.com。`
  });
}

/**
 * 查询站点列表并附带项目展示字段。项目表未迁移时自动降级为只查 websites。
 */
async function queryWebsitesWithProjects({ userId = null, includeAll = false, projectId = null } = {}) {
  const normalizedProjectId = await resolveProjectId(projectId);

  try {
    const grantRoles = includeAll ? new Map() : await getGrantedProjectRoles(userId);
    const grantedProjectIds = Array.from(grantRoles.keys());
    const params = [];
    const where = [];
    let roleSelect = 'NULL AS project_role';
    let memberJoin = '';

    if (!includeAll) {
      roleSelect =
        `CASE
           WHEN p.user_id = ? THEN '${PROJECT_ROLE_OWNER}'
           WHEN pm.role IN ('${PROJECT_ROLE_ADMIN}', '${PROJECT_ROLE_MEMBER}') THEN pm.role
           ELSE NULL
         END AS project_role`;
      params.push(userId);
      memberJoin = 'LEFT JOIN project_members pm ON pm.project_id = w.project_id AND pm.user_id = ?';
      params.push(userId);
      const grantSql = grantedProjectIds.length
        ? ` OR w.project_id IN (${grantedProjectIds.map(() => '?').join(', ')})`
        : '';
      where.push(`(w.user_id = ? OR p.user_id = ? OR pm.user_id = ?${grantSql})`);
      params.push(userId, userId, userId);
      params.push(...grantedProjectIds);
    }
    if (normalizedProjectId) {
      where.push('w.project_id = ?');
      params.push(normalizedProjectId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await query(
      `SELECT w.*,
              p.name AS project_name,
              p.project_key AS project_key,
              p.slug AS project_slug,
              p.archived AS project_archived,
              ${roleSelect},
              u.nickname AS user_nickname
       FROM websites w
       LEFT JOIN projects p ON p.id = w.project_id
       ${memberJoin}
       LEFT JOIN users u ON u.id = w.user_id
       ${whereSql}
       ORDER BY w.created_at DESC`,
      params
    );
    return rows.map((row) => ({
      ...row,
      project_role: strongestProjectRole(row.project_role, grantRoles.get(String(row.project_id)))
    }));
  } catch (e) {
    console.warn('查询站点项目/协作字段失败，降级只查归属站点:', e.message);
    const fallbackWhere = [];
    const fallbackParams = [];
    if (!includeAll) {
      fallbackWhere.push('user_id = ?');
      fallbackParams.push(userId);
    }
    if (normalizedProjectId) {
      fallbackWhere.push('project_id = ?');
      fallbackParams.push(normalizedProjectId);
    }
    const fallbackWhereSql = fallbackWhere.length ? `WHERE ${fallbackWhere.join(' AND ')}` : '';
    return await query(
      `SELECT * FROM websites ${fallbackWhereSql} ORDER BY created_at DESC`,
      fallbackParams
    );
  }
}

/**
 * 获取用户网站列表
 */
async function handleListWebsites(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  await ensureWatermarkColumn();
  const projectId = (event.body || event).projectId;
  const websites = await queryWebsitesWithProjects({ userId, projectId });

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      websites: await formatWebsitesForClient(websites),
      count: websites.length
    })
  };
}

/**
 * 管理员查看所有网站
 */
async function handleListAllWebsites(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const isAdmin = await checkAdmin(userId);
  if (!isAdmin) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '仅管理员可访问' })
    };
  }
  markAdminAction(event, userId, 'admin_only');

  await ensureWatermarkColumn();
  const projectId = (event.body || event).projectId;
  const websites = await queryWebsitesWithProjects({ includeAll: true, projectId });

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      websites: await formatWebsitesForClient(websites),
      count: websites.length
    })
  };
}

/**
 * 删除网站
 */
async function handleDeleteWebsite(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { id, websiteId, key } = event.body || event;

  if (!id && !websiteId && !key) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: id 或 websiteId 或 key' })
    };
  }

  const where = [];
  const params = [];

  if (id) {
    where.push('id = ?');
    params.push(id);
  } else if (websiteId) {
    where.push('website_id = ?');
    params.push(websiteId);
  } else if (key) {
    where.push('path = ?');
    params.push(key);
  }

  const rows = await query(`SELECT * FROM websites WHERE ${where.join(' AND ')} LIMIT 1`, params);
  const site = rows[0];
  if (!site || !(await canUserManageSite(userId, site))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限删除该记录' })
    };
  }

  try {
    const bucketCfg = await resolveBucketConfig(site.bucket_id || null);
    const prefix = websiteStoragePrefix(site.user_id, site.website_id)
      || websitePrefixFromTarget(site.path);
    if (prefix) {
      const provider = providerFor(bucketCfg);
      const objects = await provider.list(prefix);
      await Promise.all(objects.map((object) => provider.delete(object.key)));
    }
  } catch (e) {
    console.warn('删除站点存储失败:', e.message);
  }

  const customHosts = await listCustomHostsForWebsite(site.id);
  try {
    await ensureCustomDomainsTable();
    await query('DELETE FROM custom_domain_routes WHERE website_id = ?', [site.id]);
  } catch (e) {
    console.warn('删除站点自定义域名失败:', e.message);
  }

  // 路由表在 websites.subdomain 列里，删除行即清理。
  const result = await query('DELETE FROM websites WHERE id = ?', [site.id]);

  // 清边缘解析缓存（含 v2 key 上保存的「最近一次正常结果」）和页面/回源缓存；失败不影响删除结果。
  const cachePurge = await purgeSiteCacheSafely({
    websiteId: site.website_id,
    subdomain: site.subdomain,
    subdomainDomain: site.subdomain_domain,
    customHosts,
    ...(await originArgsFromSite(site))
  });

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '删除成功',
      deletedCount: result.affectedRows,
      cachePurge,
      ...(cachePurgeWarning(cachePurge) ? { warning: cachePurgeWarning(cachePurge) } : {})
    })
  };
}

/**
 * 更新网站名称
 */
async function handleUpdateWebsiteName(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, name } = event.body || event;

  if (!docId || !name) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: docId, name' })
    };
  }

  const websites = await query('SELECT * FROM websites WHERE id = ?', [docId]);
  if (websites.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '记录不存在' })
    };
  }

  if (!(await canUserManageSite(userId, websites[0]))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限更新该记录' })
    };
  }

  await query(
    'UPDATE websites SET name = ?, updated_at = NOW() WHERE id = ?',
    [name, docId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '名称已更新',
      name
    })
  };
}

/**
 * 更新网站标签
 */
async function handleUpdateWebsiteTags(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, tags } = event.body || event;

  if (!docId || !Array.isArray(tags)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: docId, tags' })
    };
  }

  const cleanTags = tags
    .map(t => String(t || '').trim())
    .filter(t => t.length > 0 && t.length <= 32);

  if (cleanTags.length > 20) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '标签数量不能超过20个' })
    };
  }

  const websites = await query('SELECT * FROM websites WHERE id = ?', [docId]);
  if (websites.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '记录不存在' })
    };
  }

  if (!(await canUserManageSite(userId, websites[0]))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限更新该记录' })
    };
  }

  await query(
    'UPDATE websites SET tags = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(cleanTags), docId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '标签已更新',
      tags: cleanTags
    })
  };
}


/**
 * 校验自定义子域名前缀(label)：只允许小写字母、数字、连字符，
 * 不以连字符开头/结尾，长度 5-63；并排除会与旧格式/平台冲突的前缀。
 */
const SUBDOMAIN_MIN_LENGTH = 5;
const SUBDOMAIN_MAX_LENGTH = 63;
const SUBDOMAIN_RULE_MESSAGE = `仅限小写字母、数字、连字符，${SUBDOMAIN_MIN_LENGTH}-${SUBDOMAIN_MAX_LENGTH} 位，且不能用保留词`;
const RESERVED_LABELS = new Set([
  'www', 'sites', 'kv-admin', 'api', 'app', 'admin', 'mail', 'ftp',
  'cdn', 'static', 'assets', 'blog', 'demox'
]);

function normalizeLabel(input) {
  return String(input || '').trim().toLowerCase();
}

function isValidLabel(label) {
  if (typeof label !== 'string') return false;
  if (label.length < SUBDOMAIN_MIN_LENGTH || label.length > SUBDOMAIN_MAX_LENGTH) return false;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
  // 旧格式以 sites- 开头，避免与向后兼容正则冲突
  if (label.startsWith('sites-')) return false;
  if (RESERVED_LABELS.has(label)) return false;
  return true;
}

/**
 * 设置/修改站点的自定义子域名前缀。
 * 流程：校验归属 + 前缀合法/未占用 → 写 KV(label->{path}) → 删旧 label 的 KV → 落库。
 * 访问地址：https://{label}.{officialDomain}
 */
/**
 * 实时检测前缀是否可用(供前端输入时防抖调用)。
 * 返回 { success, available, reason }。无需写库,只读。
 */
async function handleCheckSubdomain(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, websiteId, subdomain } = event.body || event;
  const body = event.body || event;
  const label = normalizeLabel(subdomain);
  const domain = normalizeOfficialDomain(body.domain || body.subdomainDomain || body.subdomain_domain);

  if (!isValidLabel(label)) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        available: false,
        reason: 'invalid',
        message: SUBDOMAIN_RULE_MESSAGE
      })
    };
  }
  if (!domain) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        available: false,
        reason: 'invalid_domain',
        message: `不支持的官方域名，可选：${officialDomains.join(', ')}`
      })
    };
  }

  // 找出当前站点(用于判断"前缀已属于自己"算可用)
  let selfId = null;
  try {
    if (docId) {
      const rows = await query('SELECT * FROM websites WHERE id = ?', [docId]);
      if (rows[0] && (await canUserManageSite(userId, rows[0]))) selfId = String(rows[0].id);
    } else if (websiteId) {
      const rows = await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId]);
      if (rows[0] && (await canUserManageSite(userId, rows[0]))) selfId = String(rows[0].id);
    }
  } catch (e) {}

  // 占用判断:① 被别的站点用作同一官方域名下的自定义前缀 ② 撞到默认域名 websiteId(仅 demox.site)
  const occupied = await query(
    'SELECT id FROM websites WHERE subdomain = ? AND COALESCE(NULLIF(subdomain_domain, \'\'), ?) = ? LIMIT 1',
    [label, defaultDomain, domain]
  );
  const takenByOther = occupied.length > 0 && String(occupied[0].id) !== selfId;

  // 自己站点的 websiteId(小写)允许作为 demox.site 前缀(等于默认域名,无意义但不算冲突);别人的 websiteId 则冲突
  let widConflict = false;
  if (domain === defaultDomain) {
    const widHit = await query('SELECT id FROM websites WHERE LOWER(website_id) = ? LIMIT 1', [label]);
    widConflict = widHit.length > 0 && String(widHit[0].id) !== selfId;
  }

  const blocked = takenByOther || widConflict;
  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      available: !blocked,
      domain,
      reason: blocked ? 'taken' : 'ok',
      message: blocked ? '该前缀已被占用' : '可用'
    })
  };
}

async function handleSetSubdomain(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, websiteId, subdomain } = event.body || event;
  const body = event.body || event;
  const label = normalizeLabel(subdomain);
  const domain = normalizeOfficialDomain(body.domain || body.subdomainDomain || body.subdomain_domain);

  if (!isValidLabel(label)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        reason: 'invalid',
        message: `前缀不合法：${SUBDOMAIN_RULE_MESSAGE}`
      })
    };
  }
  if (!domain) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        reason: 'invalid_domain',
        message: `不支持的官方域名，可选：${officialDomains.join(', ')}`
      })
    };
  }

  // 定位站点并校验归属
  let site;
  if (docId) {
    const rows = await query('SELECT * FROM websites WHERE id = ?', [docId]);
    site = rows[0];
  } else if (websiteId) {
    const rows = await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId]);
    site = rows[0];
  }

  if (!site) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '站点不存在' })
    };
  }
  if (!(await canUserManageSite(userId, site))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '无权操作该站点' })
    };
  }

  // 并发安全：不做"先查后写"（有 TOCTOU 竞争），直接靠 subdomain 列的唯一索引兜底。
  // 用条件 UPDATE：仅当目标前缀未被别人占用(不存在 / 或就是本站点)时才写入。
  try {
    // 前缀不能撞 demox.site 下别的站点 websiteId(那是它的默认域名,保留)
    if (domain === defaultDomain) {
      const widHit = await query('SELECT id FROM websites WHERE LOWER(website_id) = ? LIMIT 1', [label]);
      if (widHit.length > 0 && String(widHit[0].id) !== String(site.id)) {
        return {
          statusCode: 409,
          headers: getCORSHeaders(),
          body: JSON.stringify({ success: false, code: 'DUPLICATE', message: '该前缀已被占用，请换一个' })
        };
      }
    }

    // 先确认该前缀当前是否已属于本站点（幂等：重复设置同一个前缀直接成功）
    const currentDomain = normalizeOfficialDomain(site.subdomain_domain) || defaultDomain;
    if (site.subdomain === label && currentDomain === domain) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: true,
          subdomain: label,
          subdomainDomain: domain,
          subdomain_domain: domain,
          url: buildCustomSiteUrl(label, domain),
          message: '该前缀已是当前站点'
        })
      };
    }

    // 条件写入：唯一索引保证并发下只有一个请求能成功；重复会抛 ER_DUP_ENTRY
    await query(
      'UPDATE websites SET subdomain = ?, subdomain_domain = ?, updated_at = NOW() WHERE id = ?',
      [label, domain, site.id]
    );

    // 新前缀上可能缓存着「不存在」，旧前缀上缓存着「正常」：两边的解析缓存都清掉。
    const cachePurge = await purgeSiteCacheSafely({
      websiteId: site.website_id,
      subdomain: label,
      subdomainDomain: domain,
      extraSubdomains: site.subdomain ? [{ subdomain: site.subdomain, subdomainDomain: site.subdomain_domain }] : []
    });

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        subdomain: label,
        subdomainDomain: domain,
        subdomain_domain: domain,
        url: buildCustomSiteUrl(label, domain),
        cachePurge,
        ...(cachePurgeWarning(cachePurge) ? { warning: cachePurgeWarning(cachePurge) } : {}),
        message: '设置成功，访问可能有最长 60 秒的边缘缓存同步延迟'
      })
    };
  } catch (error) {
    // 唯一索引冲突 = 并发下被别的站点抢先占用
    if (error && (error.code === 'ER_DUP_ENTRY' || /duplicate/i.test(error.message || ''))) {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, code: 'DUPLICATE', message: '该前缀已被占用，请换一个' })
      };
    }
    console.error('设置子域名失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: error.message || '设置失败' })
    };
  }
}

/**
 * 清除站点的自定义子域名前缀（删 KV + 清库），站点仍可用原始长地址访问。
 */
async function handleClearSubdomain(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, websiteId } = event.body || event;

  let site;
  if (docId) {
    const rows = await query('SELECT * FROM websites WHERE id = ?', [docId]);
    site = rows[0];
  } else if (websiteId) {
    const rows = await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId]);
    site = rows[0];
  }

  if (!site) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '站点不存在' })
    };
  }
  if (!(await canUserManageSite(userId, site))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '无权操作该站点' })
    };
  }

  if (!site.subdomain) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: true, message: '该站点未设置自定义前缀' })
    };
  }

  try {
    await query(
      'UPDATE websites SET subdomain = NULL, subdomain_domain = ?, updated_at = NOW() WHERE id = ?',
      [defaultDomain, site.id]
    );
    const cachePurge = await purgeSiteCacheSafely({
      websiteId: site.website_id,
      subdomain: site.subdomain,
      subdomainDomain: site.subdomain_domain
    });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        cachePurge,
        ...(cachePurgeWarning(cachePurge) ? { warning: cachePurgeWarning(cachePurge) } : {}),
        message: '已清除自定义前缀'
      })
    };
  } catch (error) {
    console.error('清除子域名失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: error.message || '清除失败' })
    };
  }
}

/**
 * 设置站点访问级别。public 可匿名访问；private 仅 owner/admin 可访问。
 */
async function handleUpdateWebsiteVisibility(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, error: '未登录或token已过期' })
    };
  }

  const body = event.body || event;
  const docId = normalizePositiveId(body.docId || body.id);
  const websiteId = body.websiteId ? String(body.websiteId).trim() : '';
  const rawVisibility = String(body.visibility || '').trim().toLowerCase();
  if (![VISIBILITY_PUBLIC, VISIBILITY_PRIVATE, VISIBILITY_DISABLED].includes(rawVisibility)) {
    return ok({ success: false, message: 'visibility 只能是 public、private 或 disabled' });
  }
  if (!docId && !websiteId) {
    return ok({ success: false, message: '缺少 docId 或 websiteId' });
  }

  try {
    const site = await getWebsiteByIdentity({ docId, websiteId });
    if (!site) {
      return ok({ success: false, message: '站点不存在或无权限' });
    }
    const current = normalizeVisibility(site.visibility);
    const needsAdmin = rawVisibility === VISIBILITY_DISABLED || current === VISIBILITY_DISABLED;
    if (needsAdmin) {
      if (!(await checkAdmin(userId))) {
        return ok({ success: false, message: '仅管理员可禁用或恢复被禁用的站点' });
      }
      markAdminAction(event, userId, 'admin_only');
    } else if (!(await canUserManageSite(userId, site))) {
      return ok({ success: false, message: '站点不存在或无权限' });
    }
    if (rawVisibility === VISIBILITY_DISABLED && isProtectedOfficialSite(site)) {
      return ok({ success: false, message: '不能禁用 Demox 主站' });
    }

    const disableReason = String(body.disableReason || body.reason || '').trim();
    let emailed = null;
    if (rawVisibility === VISIBILITY_DISABLED) {
      if (disableReason.length < 8) {
        return ok({ success: false, message: '禁用必须填写理由（至少 8 个字）' });
      }
      const owner = await getUserById(site.user_id);
      const ownerEmail = normalizeEmail(owner && owner.email);
      if (!ownerEmail || !isValidEmail(ownerEmail)) {
        return ok({ success: false, message: '站点所有者没有可用邮箱，无法发送停用通知' });
      }
      await ensureWebsiteDisableReasonColumn();
      await query(
        'UPDATE websites SET visibility = ?, disable_reason = ?, disabled_at = NOW(), updated_at = NOW() WHERE id = ?',
        [rawVisibility, disableReason.slice(0, 500), site.id]
      );
      const siteUrl = String(site.url || `https://${String(site.website_id).toLowerCase()}.demox.site/`);
      const notice = buildSiteDisabledNotice({
        ownerName: owner.nickname || '',
        siteName: site.name || site.file_name || site.website_id,
        siteUrl,
        websiteId: site.website_id,
        reason: disableReason
      });
      try {
        await sendSesEmail({
          to: ownerEmail,
          subject: notice.subject,
          text: notice.text,
          html: notice.html
        });
        emailed = true;
      } catch (mailErr) {
        console.error('停用通知邮件发送失败:', mailErr);
        emailed = false;
      }
      const reportId = parseInt(body.reportId, 10);
      if (reportId) {
        await ensureSiteReportsTable();
        await query(
          "UPDATE site_reports SET status = 'reviewed' WHERE id = ?",
          [reportId]
        );
      }
      const cachePurge = await purgeSiteCache({
        websiteId: site.website_id,
        subdomain: site.subdomain,
        subdomainDomain: site.subdomain_domain,
        customHosts: await listCustomHostsForWebsite(site.id),
        ...(await originArgsFromSite(site))
      });
      return ok({
        success: true,
        visibility: rawVisibility,
        websiteId: site.website_id,
        emailed,
        cachePurge,
        message: emailed === false
          ? '站点已禁用，但通知邮件发送失败'
          : '站点已禁用，已邮件通知所有者'
      });
    }

    await query(
      rawVisibility === VISIBILITY_PUBLIC
        ? 'UPDATE websites SET visibility = ?, disable_reason = NULL, disabled_at = NULL, updated_at = NOW() WHERE id = ?'
        : 'UPDATE websites SET visibility = ?, updated_at = NOW() WHERE id = ?',
      [rawVisibility, site.id]
    );
    const cachePurge = await purgeSiteCache({
      websiteId: site.website_id,
      subdomain: site.subdomain,
      subdomainDomain: site.subdomain_domain,
      customHosts: await listCustomHostsForWebsite(site.id),
      ...(await originArgsFromSite(site))
    });
    return ok({
      success: true,
      visibility: rawVisibility,
      websiteId: site.website_id,
      cachePurge,
      ...(cachePurgeWarning(cachePurge) ? { warning: cachePurgeWarning(cachePurge) } : {}),
      message: rawVisibility === VISIBILITY_PRIVATE ? '站点已设为私有' : '站点已公开'
    });
  } catch (error) {
    console.error('更新站点访问级别失败:', error);
    return ok({ success: false, message: error.message || '更新访问级别失败' });
  }
}

/**
 * Configure whether EdgeOne injects the hosted-page watermark.
 * This is a role capability: only pro/admin users may change the setting.
 */
async function handleUpdateWebsiteWatermark(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, error: '未登录或token已过期' })
    };
  }

  const body = event.body || event;
  const docId = normalizePositiveId(body.docId || body.id);
  const websiteId = body.websiteId ? String(body.websiteId).trim() : '';
  if (!docId && !websiteId) {
    return ok({ success: false, message: '缺少 docId 或 websiteId' });
  }
  if (typeof body.hideWatermark !== 'boolean') {
    return ok({ success: false, message: 'hideWatermark 必须是布尔值' });
  }

  try {
    await ensureWatermarkColumn();
    const site = await getWebsiteByIdentity({ docId, websiteId });
    if (!site || !(await canUserManageSite(userId, site))) {
      return ok({ success: false, message: '站点不存在或无权限' });
    }
    if (!(await canHideWebsiteWatermark(userId))) {
      return proFeatureDenied('WATERMARK_ROLE_REQUIRED', '仅专业用户及以上可以配置页面水印');
    }

    const hideWatermark = body.hideWatermark;
    await query(
      'UPDATE websites SET hide_watermark = ?, updated_at = NOW() WHERE id = ?',
      [hideWatermark ? 1 : 0, site.id]
    );
    const cachePurge = await purgeSiteCache({
      websiteId: site.website_id,
      subdomain: site.subdomain,
      subdomainDomain: site.subdomain_domain,
      ...(await originArgsFromSite(site))
    });
    return ok({
      success: true,
      hideWatermark,
      websiteId: site.website_id,
      cachePurge,
      ...(cachePurgeWarning(cachePurge) ? { warning: cachePurgeWarning(cachePurge) } : {}),
      message: hideWatermark ? '页面水印已关闭' : '页面水印已开启'
    });
  } catch (error) {
    console.error('更新页面水印设置失败:', error);
    return ok({ success: false, message: error.message || '更新页面水印设置失败' });
  }
}

/**
 * 更新站点 SEO 元信息（title / description / og_image）。
 * 边缘函数在回源时读取这些字段，向 <head> 注入 meta 标签。
 * 修改后清边缘缓存，约 60s 内生效。
 */
async function handleUpdateSeo(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, error: '未登录或token已过期' })
    };
  }

  const body = event.body || event;
  const docId = normalizePositiveId(body.docId || body.id);
  const websiteId = body.websiteId ? String(body.websiteId).trim() : '';
  if (!docId && !websiteId) {
    return ok({ success: false, message: '缺少 docId 或 websiteId' });
  }

  const seoTitle = String(body.seoTitle || '').trim().slice(0, 255);
  const seoDescription = String(body.seoDescription || '').trim().slice(0, 500);
  const ogImage = String(body.ogImage || '').trim().slice(0, 500);

  try {
    await ensureSeoColumns();
    const site = await getWebsiteByIdentity({ docId, websiteId });
    if (!site || !(await canUserManageSite(userId, site))) {
      return ok({ success: false, message: '站点不存在或无权限' });
    }
    if (!(await hasProOrAboveRole(userId))) {
      return proFeatureDenied('SEO_ROLE_REQUIRED', '仅专业用户及以上可以配置 SEO');
    }

    await query(
      'UPDATE websites SET seo_title = ?, seo_description = ?, og_image = ?, updated_at = NOW() WHERE id = ?',
      [seoTitle || null, seoDescription || null, ogImage || null, site.id]
    );
    const cachePurge = await purgeSiteCache({
      websiteId: site.website_id,
      subdomain: site.subdomain,
      subdomainDomain: site.subdomain_domain,
      ...(await originArgsFromSite(site))
    });
    return ok({
      success: true,
      seo: {
        title: seoTitle || null,
        description: seoDescription || null,
        ogImage: ogImage || null
      },
      websiteId: site.website_id,
      cachePurge,
      ...(cachePurgeWarning(cachePurge) ? { warning: cachePurgeWarning(cachePurge) } : {}),
      message: 'SEO 设置已更新'
    });
  } catch (error) {
    console.error('更新 SEO 失败:', error);
    return ok({ success: false, message: error.message || '更新 SEO 失败' });
  }
}

/**
 * 管理员鉴权辅助：返回 { userId } 或 错误响应对象。
 */
async function requireAdmin(event) {
  const userId = getUserId(event);
  if (!userId) {
    return { err: { statusCode: 401, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '未登录或token已过期' }) } };
  }
  const ok = await checkAdmin(userId);
  if (!ok) {
    return { err: { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '仅管理员可访问' }) } };
  }
  markAdminAction(event, userId, 'admin_only');
  return { userId };
}

function ok(obj) {
  return { statusCode: 200, headers: getCORSHeaders(), body: JSON.stringify(obj) };
}

// ── 管理员操作审计（v13，迁移 021_add_admin_audit_log.sql）─────────────────────
// 每个请求在 AsyncLocalStorage 里带一个审计上下文。只要这次请求用到了管理员身份
// （仅管理员接口，或者用管理员身份操作别人的站点/项目），请求结束后就写一行
// admin_audit_log：操作人 uid、时间、action、目标、凭证类型（jwt/pat/oauth）、结果。
const adminAuditStorage = new AsyncLocalStorage();
const ADMIN_AUDIT_TARGET_KEYS = [
  'uid', 'targetUserId', 'userId', 'websiteId', 'website_id', 'docId', 'id', 'projectId',
  'reportId', 'bucketId', 'role', 'roles', 'status', 'visibility', 'name', 'proDays', 'proLifetime',
  'archived', 'includeAll', 'range', 'days', 'subdomain', 'operatorUid', 'beforeId'
];
const ADMIN_AUDIT_READ_ACTION = /^(?:list|get|check|resolve|search|bucket_stats)/;
// v14：只返回汇总数字、不涉及具体用户的看板读接口不记审计（BI 页每次打开/刷新都会调，
// 占了绝大多数行）。看具体用户、站点、举报的读操作照常记；写操作全部记。
const ADMIN_AUDIT_SKIP_READ_ACTIONS = new Set([
  'get_admin_bi', 'get_platform_overview', 'get_product_funnel', 'list_admin_audit'
]);
// 处理函数自己写审计行的接口（例如作废刷新令牌：删除和审计在同一个事务里，审计写不进去就不删）。
const ADMIN_AUDIT_SELF_RECORDED = new Set(['revoke_oauth_refresh_token']);
// v14：保留期，默认 180 天，ADMIN_AUDIT_RETENTION_DAYS 可调（7–3650）。
const ADMIN_AUDIT_RETENTION_DEFAULT_DAYS = 180;
const ADMIN_AUDIT_PRUNE_BATCH = 5000;
const ADMIN_AUDIT_PRUNE_MAX_BATCHES = 20;
const ADMIN_AUDIT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function markAdminAction(_event, userId, via) {
  const store = adminAuditStorage.getStore();
  if (!store || !userId) return;
  if (!store.admin) store.admin = { uid: String(userId), via: new Set() };
  store.admin.via.add(via || 'admin_only');
}

function adminAuthMethod(payload) {
  if (!payload || typeof payload !== 'object') return 'jwt';
  if (payload.jti || payload.type === 'pat') return 'pat';
  if (Array.isArray(payload.scopes) || typeof payload.scope === 'string') return 'oauth';
  return 'jwt';
}

function adminAuditActionName(event) {
  const body = event && event.body && typeof event.body === 'object' ? event.body : {};
  if (body.action) return String(body.action).slice(0, 64);
  const pathUrl = String((event && event.path) || '').split('?')[0];
  const last = pathUrl.split('/').filter(Boolean).pop() || 'unknown';
  return last.replace(/-/g, '_').slice(0, 64);
}

function adminAuditTarget(event) {
  const body = event && event.body && typeof event.body === 'object' ? event.body : {};
  const parts = [];
  for (const key of ADMIN_AUDIT_TARGET_KEYS) {
    const value = body[key];
    if (value === undefined || value === null || value === '') continue;
    let text = Array.isArray(value) ? value.slice(0, 10).join(',') : (typeof value === 'object' ? '[object]' : String(value));
    text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]').slice(0, 64);
    parts.push(`${key}=${text}`);
  }
  if (Array.isArray(body.userIds)) parts.push(`userIds=${body.userIds.length}`);
  return parts.join(';').slice(0, 255);
}

function adminAuditOutcome(response) {
  const statusCode = Number(response && response.statusCode) || 0;
  let success = statusCode >= 200 && statusCode < 300;
  if (success && response && typeof response.body === 'string' && response.body.length < 2_000_000) {
    try {
      const parsed = JSON.parse(response.body);
      if (parsed && typeof parsed === 'object') {
        if (parsed.success === false) success = false;
        if (Number(parsed.code) >= 400) success = false;
      }
    } catch {
      // 非 JSON 响应按状态码判断
    }
  }
  return { statusCode, success };
}

let adminAuditTableReady = null;
function ensureAdminAuditTable() {
  if (!adminAuditTableReady) {
    adminAuditTableReady = query(`CREATE TABLE IF NOT EXISTS admin_audit_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      operator_uid VARCHAR(64) NOT NULL,
      auth_method VARCHAR(8) NOT NULL,
      action VARCHAR(64) NOT NULL,
      kind VARCHAR(8) NOT NULL DEFAULT 'write',
      target VARCHAR(255) NOT NULL DEFAULT '',
      via VARCHAR(64) NOT NULL DEFAULT 'admin_only',
      status_code SMALLINT NOT NULL DEFAULT 0,
      success TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_admin_audit_time (created_at),
      INDEX idx_admin_audit_operator_time (operator_uid, created_at),
      INDEX idx_admin_audit_action_time (action, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员操作审计'`).catch((error) => {
      adminAuditTableReady = null;
      throw error;
    });
  }
  return adminAuditTableReady;
}

function adminAuditSkipped(action) {
  return ADMIN_AUDIT_SKIP_READ_ACTIONS.has(action);
}

function adminAuditRetentionDays(env = process.env) {
  const raw = String(env.ADMIN_AUDIT_RETENTION_DAYS || '').trim();
  const n = Number.parseInt(raw, 10);
  if (!raw || !Number.isFinite(n)) return ADMIN_AUDIT_RETENTION_DEFAULT_DAYS;
  return Math.max(7, Math.min(3650, n));
}

let adminAuditLastPruneAt = 0;
/**
 * 删除 admin_audit_log 里早于保留期的行。只 DELETE 这一张表、只按 created_at 删，分批（每批 5000 行，
 * 单次最多 20 批）。由 5 分钟统计聚合定时器顺带调用，每个实例每小时最多跑一次；失败只记日志。
 */
async function pruneAdminAuditLog({ now = Date.now(), force = false } = {}) {
  if (!force && now - adminAuditLastPruneAt < ADMIN_AUDIT_PRUNE_INTERVAL_MS) return { skipped: true, deleted: 0 };
  adminAuditLastPruneAt = now;
  const days = adminAuditRetentionDays();
  let deleted = 0;
  try {
    for (let batch = 0; batch < ADMIN_AUDIT_PRUNE_MAX_BATCHES; batch += 1) {
      const result = await query(
        'DELETE FROM admin_audit_log WHERE created_at < (CURRENT_TIMESTAMP(3) - INTERVAL ? DAY) ORDER BY created_at LIMIT ?',
        [days, ADMIN_AUDIT_PRUNE_BATCH]
      );
      const affected = Number(result && result.affectedRows) || 0;
      deleted += affected;
      if (affected < ADMIN_AUDIT_PRUNE_BATCH) break;
    }
    return { skipped: false, deleted, days };
  } catch (error) {
    if (error && (error.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/.test(String(error.message)))) {
      return { skipped: false, deleted: 0, days, tableMissing: true };
    }
    console.error('清理管理员审计失败:', error && (error.code || error.message));
    return { skipped: false, deleted, days, error: true };
  }
}

async function recordAdminAudit(event, admin, response) {
  try {
    const action = adminAuditActionName(event);
    if (adminAuditSkipped(action)) return;
    // 自己在处理函数里写审计的接口（和业务写在同一个事务里），这里不再重复记。
    if (ADMIN_AUDIT_SELF_RECORDED.has(action)) return;
    const kind = ADMIN_AUDIT_READ_ACTION.test(action) ? 'read' : 'write';
    const { statusCode, success } = adminAuditOutcome(response);
    const via = [...admin.via].sort().join(',').slice(0, 64);
    await ensureAdminAuditTable();
    await query(
      `INSERT INTO admin_audit_log (operator_uid, auth_method, action, kind, target, via, status_code, success)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [admin.uid, adminAuthMethod(authenticate(event)), action, kind, adminAuditTarget(event), via, statusCode, success ? 1 : 0]
    );
  } catch (error) {
    // 审计写失败不回滚已经完成的操作，但要在日志里留痕（不含目标和凭证）。
    console.error('写管理员审计失败:', error && (error.code || error.message));
  }
}

/**
 * 管理员：只读查看管理员操作审计。
 * body: { limit?: 1-200（默认 50）, beforeId?: 翻页游标, operatorUid?, auditAction?, authMethod? }
 */
async function handleListAdminAudit(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const body = event.body || event;
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
  const where = [];
  const params = [];
  const beforeId = Number(body.beforeId);
  if (Number.isSafeInteger(beforeId) && beforeId > 0) { where.push('id < ?'); params.push(beforeId); }
  if (body.operatorUid) { where.push('operator_uid = ?'); params.push(String(body.operatorUid).slice(0, 64)); }
  if (body.auditAction) { where.push('action = ?'); params.push(String(body.auditAction).slice(0, 64)); }
  if (['jwt', 'pat', 'oauth'].includes(body.authMethod)) { where.push('auth_method = ?'); params.push(body.authMethod); }
  params.push(limit);
  try {
    const rows = await query(
      `SELECT id, operator_uid, auth_method, action, kind, target, via, status_code, success, created_at
       FROM admin_audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id DESC
       LIMIT ?`,
      params
    );
    const items = rows.map((row) => ({
      id: Number(row.id),
      operatorUid: String(row.operator_uid),
      authMethod: row.auth_method,
      action: row.action,
      kind: row.kind,
      target: row.target || '',
      via: row.via || '',
      statusCode: Number(row.status_code) || 0,
      success: Number(row.success) === 1,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
    }));
    return ok({ success: true, items, nextBeforeId: items.length === limit ? items[items.length - 1].id : null });
  } catch (error) {
    if (error && (error.code === 'ER_NO_SUCH_TABLE' || /doesn't exist/.test(String(error.message)))) {
      return ok({ success: true, items: [], nextBeforeId: null, tableMissing: true });
    }
    console.error('读取管理员审计失败:', error && (error.code || error.message));
    return ok({ success: false, message: '读取管理员审计失败' });
  }
}

// ── 管理员按指纹作废 OAuth 刷新令牌（2026-10-10 日志泄露处置）──────────────────
// 背景：泄露排查脚本（oauth-leak-id.py）只输出刷新令牌的指纹 rt_fp = sha256(令牌原文) 的 hex 前 12 位，
// 不输出令牌本身。这个接口让管理员凭「用户 ID + 指纹」删掉那一行，不用再直连数据库。
// - 只收 userId + fingerprint；请求里出现任何令牌字段或多余字段一律 400，永远不接收令牌原文。
// - 指纹在数据库里算：DELETE ... WHERE user_id = ? AND LEFT(SHA2(token, 256), 12) = ?，令牌不出库。
// - 一次只处理一个用户；单次删除超过 REVOKE_RT_MAX_ROWS 行视为异常，整笔回滚。
// - 限流：每个管理员每 60 秒最多 REVOKE_RT_RATE_LIMIT 次（按 admin_audit_log 里本接口的记录数，查不到就拒绝）。
// - 审计：删除和审计行在同一个事务里，审计写失败则不删。拒绝、限流、出错也都记一行。
// - 返回只有 { success, revoked }，不带任何令牌内容。
const REVOKE_RT_ACTION = 'revoke_oauth_refresh_token';
const REVOKE_RT_RATE_LIMIT = 5;
const REVOKE_RT_RATE_WINDOW_SECONDS = 60;
const REVOKE_RT_MAX_ROWS = 5;
const REVOKE_RT_FP_PATTERN = /^[0-9a-f]{12}$/;
const REVOKE_RT_USER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const REVOKE_RT_ALLOWED_KEYS = new Set(['action', 'path', 'userId', 'fingerprint']);
const REVOKE_RT_TOKEN_KEYS = /token|secret|password|credential|^rt$|^at$/i;

function revokeRtResponse(statusCode, obj) {
  return { statusCode, headers: getCORSHeaders(), body: JSON.stringify(obj) };
}

/** 校验请求体。返回 { userId, fingerprint } 或 { error }（error 里不回显任何输入值）。 */
function parseRevokeRtInput(body) {
  const src = body && typeof body === 'object' ? body : {};
  const keys = Object.keys(src);
  if (keys.some((k) => REVOKE_RT_TOKEN_KEYS.test(k))) {
    return { error: '只接收指纹（fingerprint），不要传令牌原文' };
  }
  if (keys.some((k) => !REVOKE_RT_ALLOWED_KEYS.has(k))) {
    return { error: '只接受 userId 和 fingerprint 两个参数' };
  }
  const userId = typeof src.userId === 'string' ? src.userId.trim() : '';
  if (!REVOKE_RT_USER_ID_PATTERN.test(userId)) {
    return { error: 'userId 格式不对' };
  }
  const rawFp = typeof src.fingerprint === 'string' ? src.fingerprint.trim() : '';
  if (rawFp.length > 12 && /^[A-Za-z0-9_\-.]+$/.test(rawFp)) {
    return { error: 'fingerprint 必须是 12 位十六进制指纹，不要传令牌原文' };
  }
  const fingerprint = rawFp.toLowerCase();
  if (!REVOKE_RT_FP_PATTERN.test(fingerprint)) {
    return { error: 'fingerprint 必须是 12 位十六进制（sha256 前 12 位）' };
  }
  return { userId, fingerprint };
}

function revokeRtAuditTarget({ userId, fingerprint, revoked }) {
  const parts = [];
  if (userId) parts.push(`userId=${userId}`);
  if (fingerprint) parts.push(`fp=${fingerprint}`);
  if (revoked !== undefined) parts.push(`revoked=${revoked}`);
  return parts.join(';').slice(0, 255);
}

async function writeRevokeRtAudit(runner, event, adminUid, { target, statusCode, success }) {
  return runner(
    `INSERT INTO admin_audit_log (operator_uid, auth_method, action, kind, target, via, status_code, success)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [String(adminUid), adminAuthMethod(authenticate(event)), REVOKE_RT_ACTION, 'write', target, 'admin_only', statusCode, success ? 1 : 0]
  );
}

/** 失败路径的审计：尽力写，写不进去只记错误码，不影响返回。 */
async function recordRevokeRtFailure(event, adminUid, target, statusCode) {
  try {
    await ensureAdminAuditTable();
    await writeRevokeRtAudit(query, event, adminUid, { target, statusCode, success: false });
  } catch (error) {
    console.error('写管理员审计失败:', error && (error.code || error.message));
  }
}

/**
 * 管理员：按指纹作废某个用户的 OAuth 刷新令牌。
 * body: { action: 'revoke_oauth_refresh_token', userId: '<用户 ID>', fingerprint: '<12 位十六进制>' }
 * 返回: { success: true, revoked: <删掉的行数> }
 */
async function handleRevokeOAuthRefreshToken(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const adminUid = a.userId;
  const body = event.body && typeof event.body === 'object' ? event.body : {};

  // 1) 限流（先于参数校验，乱传参数也算次数）。查不到计数就拒绝，不放行。
  try {
    await ensureAdminAuditTable();
    const rows = await query(
      `SELECT COUNT(*) AS n FROM admin_audit_log
       WHERE operator_uid = ? AND action = ? AND created_at > (CURRENT_TIMESTAMP(3) - INTERVAL ? SECOND)`,
      [String(adminUid), REVOKE_RT_ACTION, REVOKE_RT_RATE_WINDOW_SECONDS]
    );
    const n = Number(rows && rows[0] && rows[0].n) || 0;
    if (n >= REVOKE_RT_RATE_LIMIT) {
      await recordRevokeRtFailure(event, adminUid, 'rate_limited', 429);
      return revokeRtResponse(429, { success: false, error: `操作太频繁，每分钟最多 ${REVOKE_RT_RATE_LIMIT} 次，请稍后再试` });
    }
  } catch (error) {
    console.error('作废刷新令牌：限流检查失败', error && (error.code || error.message));
    return revokeRtResponse(503, { success: false, error: '暂时无法处理，请稍后再试' });
  }

  // 2) 参数校验
  const input = parseRevokeRtInput(body);
  if (input.error) {
    await recordRevokeRtFailure(event, adminUid, 'invalid_input', 400);
    return revokeRtResponse(400, { success: false, error: input.error });
  }

  // 3) 删除 + 审计，同一个事务
  try {
    const revoked = await transaction(async (conn) => {
      const run = async (sql, params) => (await conn.query(sql, params))[0];
      const result = await run(
        'DELETE FROM oauth_refresh_tokens WHERE user_id = ? AND LEFT(SHA2(token, 256), 12) = ?',
        [input.userId, input.fingerprint]
      );
      const affected = Number(result && result.affectedRows) || 0;
      if (affected > REVOKE_RT_MAX_ROWS) {
        throw Object.assign(new Error('too many rows'), { code: 'REVOKE_RT_TOO_MANY' });
      }
      await writeRevokeRtAudit(run, event, adminUid, {
        target: revokeRtAuditTarget({ ...input, revoked: affected }),
        statusCode: 200,
        success: true
      });
      return affected;
    });
    return revokeRtResponse(200, { success: true, revoked });
  } catch (error) {
    const tooMany = error && error.code === 'REVOKE_RT_TOO_MANY';
    if (!tooMany) console.error('作废刷新令牌失败:', error && (error.code || error.message));
    const statusCode = tooMany ? 409 : 500;
    await recordRevokeRtFailure(event, adminUid, revokeRtAuditTarget({ ...input, revoked: 0 }), statusCode);
    return revokeRtResponse(statusCode, {
      success: false,
      error: tooMany ? `匹配到的行数超过 ${REVOKE_RT_MAX_ROWS}，已整笔撤销，请人工核对` : '作废失败，已回滚'
    });
  }
}

exports._revokeRtForTest = { parseRevokeRtInput, revokeRtAuditTarget, REVOKE_RT_RATE_LIMIT, REVOKE_RT_MAX_ROWS };

// ── 023：给团队管理员账号授 admin（2026-10-10，Chief 批准思路，等账号建好再填 ID）──────────
// 团队用一个专门的 Demox 账号调用管理员接口（例如 revoke_oauth_refresh_token），不再借用 phosa 的账号。
// 账号注册好以后，把它的用户 ID 填进下面的常量 TEAM_ADMIN_USER_ID，改代码、走评审再发布。
// 不读环境变量（云架构 2026-10-10 要求：改函数环境变量的权限不能变成授 admin 的权限）。
// - 没填：什么也不做（no-op）。
// - 幂等：已经是 admin 就不写；只追加 admin，不删任何已有角色。
// - 只授一次：admin_audit_log 里已经有这个 ID 的 grant_team_admin 成功记录就不再授，
//   所以之后有人在后台手动撤掉它的 admin，这里不会偷偷加回来（要彻底撤销：先把常量改回空字符串再撤角色）。
// - 有审计：改 user_roles 和写 admin_audit_log 在同一个事务里（operator_uid=system:023，auth_method=system）。
// - 用户不存在 / ID 格式不对：不写，只打一行警告（不含 ID 以外的信息）。
// 由 5 分钟统计定时器顺带调用，每个实例每小时最多查一次；SQL 等价版本见 migrations/023_grant_team_admin.sql。
const TEAM_ADMIN_USER_ID = '1791604277396366896'; // demox-team2@demox.site（2026-10-10 11:51 注册，#20 上线后；Chief 11:37 批准）。旧账号 1791602821563094181 已撤 admin 停用。只认这里，环境变量无效
const TEAM_ADMIN_AUDIT_ACTION = 'grant_team_admin';
const TEAM_ADMIN_OPERATOR = 'system:023';
const TEAM_ADMIN_CHECK_INTERVAL_MS = 60 * 60 * 1000;
let teamAdminLastCheckAt = 0;

// 只读代码常量，故意不读环境变量：能改函数环境变量的人（例如 demox-ops）不应能借此给任意账号授 admin。
function configuredTeamAdminUserId(constant = TEAM_ADMIN_USER_ID) {
  const raw = String(constant || '').trim();
  if (!raw) return { userId: '' };
  if (!REVOKE_RT_USER_ID_PATTERN.test(raw)) return { userId: '', invalid: true };
  return { userId: raw };
}

function parseRoleList(value) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  return Array.isArray(list) ? list.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean) : [];
}

async function ensureTeamAdminGrant({ now = Date.now(), force = false, constant = TEAM_ADMIN_USER_ID } = {}) {
  const { userId, invalid } = configuredTeamAdminUserId(constant);
  if (invalid) {
    console.warn('TEAM_ADMIN_USER_ID 格式不对，已跳过团队管理员授权');
    return { skipped: true, reason: 'invalid' };
  }
  if (!userId) return { skipped: true, reason: 'unset' };
  if (!force && now - teamAdminLastCheckAt < TEAM_ADMIN_CHECK_INTERVAL_MS) return { skipped: true, reason: 'throttled' };
  teamAdminLastCheckAt = now;
  try {
    await ensureAdminAuditTable();
    const granted = await query(
      'SELECT id FROM admin_audit_log WHERE action = ? AND target = ? AND success = 1 LIMIT 1',
      [TEAM_ADMIN_AUDIT_ACTION, `uid=${userId};role=admin`]
    );
    if (granted.length) return { skipped: true, reason: 'already_granted_once' };
    const users = await query('SELECT id FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!users.length) {
      console.warn('TEAM_ADMIN_USER_ID 对应的用户不存在，已跳过团队管理员授权');
      return { skipped: true, reason: 'user_not_found' };
    }
    return await transaction(async (conn) => {
      const run = async (sql, params) => (await conn.query(sql, params))[0];
      const rows = await run('SELECT roles FROM user_roles WHERE user_id = ? LIMIT 1 FOR UPDATE', [userId]);
      const current = rows.length ? parseRoleList(rows[0].roles) : [];
      if (current.includes('admin')) return { skipped: true, reason: 'already_admin' };
      const next = [...new Set(['user', ...current, 'admin'])];
      await run(
        `INSERT INTO user_roles (user_id, roles, updated_at) VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE roles = VALUES(roles), updated_at = NOW()`,
        [userId, JSON.stringify(next)]
      );
      await run(
        `INSERT INTO admin_audit_log (operator_uid, auth_method, action, kind, target, via, status_code, success)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [TEAM_ADMIN_OPERATOR, 'system', TEAM_ADMIN_AUDIT_ACTION, 'write', `uid=${userId};role=admin`, 'migration', 200, 1]
      );
      console.log('团队管理员授权完成');
      return { skipped: false, granted: true, roles: next };
    });
  } catch (error) {
    console.error('团队管理员授权失败:', error && (error.code || error.message));
    return { skipped: true, reason: 'error' };
  }
}

exports._teamAdminForTest = { ensureTeamAdminGrant, configuredTeamAdminUserId, TEAM_ADMIN_USER_ID };

exports._adminAuditForTest = { adminAuthMethod, adminAuditTarget, adminAuditActionName, adminAuditOutcome, adminAuditSkipped, adminAuditRetentionDays, pruneAdminAuditLog };

function normalizeProjectKey(input) {
  const value = String(input || '').trim().toUpperCase();
  if (!value || /^\d+$/.test(value)) return '';
  return /^[A-Z0-9]{6,20}$/.test(value) ? value : '';
}

function generateProjectKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'P';
  while (out.length < 10) {
    out += chars[nodeCrypto.randomInt(0, chars.length)];
  }
  return out;
}

async function createUniqueProjectKey() {
  for (let i = 0; i < 20; i += 1) {
    const key = generateProjectKey();
    try {
      const rows = await query('SELECT id FROM projects WHERE project_key = ? LIMIT 1', [key]);
      if (rows.length === 0) return key;
    } catch (e) {
      return key;
    }
  }
  throw new Error('生成项目 ID 失败，请重试');
}

async function resolveProjectId(input) {
  const numeric = normalizePositiveId(input);
  if (numeric) return numeric;
  const key = normalizeProjectKey(input);
  if (!key) return null;
  try {
    const rows = await query('SELECT id FROM projects WHERE project_key = ? LIMIT 1', [key]);
    return rows[0]?.id || null;
  } catch (e) {
    return null;
  }
}

async function ensureProjectKeyForId(projectId) {
  const id = normalizePositiveId(projectId);
  if (!id) return null;
  try {
    const rows = await query('SELECT project_key FROM projects WHERE id = ? LIMIT 1', [id]);
    if (rows[0]?.project_key) return rows[0].project_key;
    for (let i = 0; i < 20; i += 1) {
      const key = await createUniqueProjectKey();
      const res = await query('UPDATE projects SET project_key = ? WHERE id = ? AND (project_key IS NULL OR project_key = \'\')', [key, id]);
      if (res.affectedRows) return key;
    }
  } catch (e) {
    console.warn('补齐项目随机 ID 失败:', e.message);
  }
  return null;
}

function formatProjectForClient(row) {
  const publicId = row.project_key || row.projectKey || row.id;
  return {
    id: publicId == null ? null : String(publicId),
    _id: publicId == null ? null : String(publicId),
    numericId: row.id == null ? null : String(row.id),
    projectKey: row.project_key || row.projectKey || null,
    userId: row.user_id,
    name: row.name || 'default',
    slug: row.slug || 'default',
    description: row.description || '',
    color: row.color || null,
    icon: row.icon || null,
    role: row.project_role || row.role || null,
    ownerUserId: row.user_id || null,
    ownerEmail: row.owner_email || row.ownerEmail || '',
    ownerNickname: row.owner_nickname || row.ownerNickname || '',
    archived: !!row.archived,
    websitesCount: Number(row.websites_count || row.websitesCount || 0),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined
  };
}

function normalizeProjectSlug(input) {
  const slug = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'project';
}

function normalizeProjectRole(input) {
  const role = String(input || PROJECT_ROLE_MEMBER).trim().toLowerCase();
  return PROJECT_ROLES.includes(role) ? role : PROJECT_ROLE_MEMBER;
}

function projectRoleRank(role) {
  if (role === PROJECT_ROLE_OWNER) return 3;
  if (role === PROJECT_ROLE_ADMIN) return 2;
  if (role === PROJECT_ROLE_MEMBER) return 1;
  return 0;
}

function strongestProjectRole(...roles) {
  return roles
    .filter((role) => PROJECT_ROLES.includes(role))
    .sort((a, b) => projectRoleRank(b) - projectRoleRank(a))[0] || null;
}

function normalizeFeishuGrantInput(body) {
  const principalType = body.principalType === FEISHU_PRINCIPAL_DEPARTMENT
    ? FEISHU_PRINCIPAL_DEPARTMENT
    : FEISHU_PRINCIPAL_USER;
  const keyType = principalType === FEISHU_PRINCIPAL_DEPARTMENT ? 'open_department_id' : 'open_id';
  const principalKey = String(body.principalKey || body.identifier || '').trim();
  const validKey = principalType === FEISHU_PRINCIPAL_DEPARTMENT
    ? /^od-[A-Za-z0-9_-]+$/.test(principalKey)
    : /^ou_[A-Za-z0-9_-]+$/.test(principalKey);
  return {
    principalType,
    keyType,
    principalKey,
    valid: validKey && principalKey.length <= 255
  };
}

function formatFeishuProjectGrant(row) {
  const name = row.display_name || '';
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    principalType: row.principal_type,
    keyType: row.key_type,
    principalKey: row.principal_key,
    tenantKey: row.tenant_key || null,
    name,
    displayName: name,
    role: normalizeProjectRole(row.role),
    createdBy: row.created_by || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined
  };
}

function mergeGrantedRole(roles, row) {
  const key = String(row.project_id);
  roles.set(key, roles.has(key) ? strongestProjectRole(roles.get(key), row.role) : normalizeProjectRole(row.role));
}

function parseDepartmentIds(value) {
  if (Array.isArray(value)) return value.filter((id) => typeof id === 'string' && id.startsWith('od-'));
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id.startsWith('od-')) : [];
  } catch (e) {
    return [];
  }
}

function isDirectoryIdentityFresh(identity) {
  if (!identity?.directorySyncedAt) return false;
  return Date.now() - new Date(identity.directorySyncedAt).getTime() <= FEISHU_DIRECTORY_TTL_MS;
}

async function refreshFeishuDirectoryIdentity(userId, identity) {
  if (!identity?.openId) return { ...identity, directoryFresh: false };
  if (isDirectoryIdentityFresh(identity)) return { ...identity, directoryFresh: true };
  try {
    const directory = await feishuDirectory.getUserDepartmentClosure(identity.openId);
    await query(
      `UPDATE users
       SET feishu_department_ids = ?, feishu_directory_synced_at = NOW(), updated_at = NOW()
       WHERE id = ? AND feishu_open_id = ?`,
      [JSON.stringify(directory.departmentIds), userId, identity.openId]
    );
    return {
      ...identity,
      departmentIds: directory.departmentIds,
      directorySyncedAt: new Date(),
      directoryFresh: true
    };
  } catch (error) {
    console.warn('刷新飞书部门身份失败:', JSON.stringify({ code: error.code || null, message: error.message }));
    return { ...identity, departmentIds: [], directoryFresh: false };
  }
}

async function getFeishuGrantedProjectRoles(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return new Map();
  const roles = new Map();
  try {
    const identityRows = await query(
      `SELECT feishu_open_id, feishu_union_id, feishu_tenant_key,
              feishu_department_ids, feishu_directory_synced_at
       FROM users WHERE id = ? LIMIT 1`,
      [uid]
    );
    const row = identityRows[0];
    if (!row?.feishu_open_id) return roles;
    let identity = {
      openId: row.feishu_open_id,
      unionId: row.feishu_union_id || null,
      tenantKey: row.feishu_tenant_key || null,
      departmentIds: parseDepartmentIds(row.feishu_department_ids),
      directorySyncedAt: row.feishu_directory_synced_at || null
    };

    const directRows = await query(
      `SELECT project_id, role
       FROM project_feishu_grants
       WHERE active = 1 AND principal_type = '${FEISHU_PRINCIPAL_USER}'
         AND key_type = 'open_id' AND principal_key = ?
         AND tenant_key = ?`,
      [identity.openId, identity.tenantKey]
    );
    directRows.forEach((grant) => mergeGrantedRole(roles, grant));

    if (!identity.tenantKey) return roles;
    const departmentGrantCount = await query(
      `SELECT COUNT(*) AS c FROM project_feishu_grants
       WHERE active = 1 AND principal_type = '${FEISHU_PRINCIPAL_DEPARTMENT}'
         AND key_type = 'open_department_id' AND tenant_key = ?`,
      [identity.tenantKey]
    );
    if (Number(departmentGrantCount[0]?.c || 0) === 0) return roles;

    identity = await refreshFeishuDirectoryIdentity(uid, identity);
    if (!identity.directoryFresh || identity.departmentIds.length === 0) return roles;
    const placeholders = identity.departmentIds.map(() => '?').join(', ');
    const departmentRows = await query(
      `SELECT project_id, role
       FROM project_feishu_grants
       WHERE active = 1 AND principal_type = '${FEISHU_PRINCIPAL_DEPARTMENT}'
         AND key_type = 'open_department_id' AND tenant_key = ?
         AND principal_key IN (${placeholders})`,
      [identity.tenantKey, ...identity.departmentIds]
    );
    departmentRows.forEach((grant) => mergeGrantedRole(roles, grant));
  } catch (e) {
    if (!/project_feishu_grants|feishu_tenant_key|feishu_department_ids|feishu_directory_synced_at/i.test(e.message || '')) {
      console.warn('读取飞书项目授权失败:', e.message);
    }
  }
  return roles;
}

async function getGithubGrantedProjectRoles(userId) {
  const uid = String(userId || '').trim();
  const roles = new Map();
  if (!uid) return roles;
  try {
    await ensureGithubGrantsTable();
    const identityRows = await query(
      'SELECT github_id, github_login FROM users WHERE id = ? LIMIT 1',
      [uid]
    );
    const githubId = String(identityRows[0]?.github_id || '').trim();
    if (!githubId) return roles;
    const grantRows = await query(
      `SELECT project_id, role
       FROM project_github_grants
       WHERE active = 1 AND principal_type = 'user'
         AND key_type = 'github_id' AND principal_key = ?`,
      [githubId]
    );
    grantRows.forEach((grant) => mergeGrantedRole(roles, grant));
  } catch (e) {
    if (!/project_github_grants|github_id/i.test(e.message || '')) {
      console.warn('读取 GitHub 项目授权失败:', e.message);
    }
  }
  return roles;
}

async function getGrantedProjectRoles(userId) {
  const merged = new Map();
  const [feishu, github] = await Promise.all([
    getFeishuGrantedProjectRoles(userId),
    getGithubGrantedProjectRoles(userId)
  ]);
  feishu.forEach((role, key) => merged.set(key, role));
  github.forEach((role, key) => mergeGrantedRole(merged, { project_id: key, role }));
  return merged;
}

function normalizeGithubGrantInput(body) {
  const principalKey = String(body.principalKey || body.githubId || '').trim();
  return {
    principalType: 'user',
    keyType: 'github_id',
    principalKey,
    githubLogin: String(body.githubLogin || body.login || '').trim(),
    valid: /^\d{1,16}$/.test(principalKey)
  };
}

function formatGithubProjectGrant(row) {
  const name = row.display_name || row.github_login || '';
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    principalType: row.principal_type || 'user',
    keyType: row.key_type || 'github_id',
    principalKey: row.principal_key,
    githubLogin: row.github_login || '',
    name,
    displayName: name,
    secondaryText: row.github_login ? `@${row.github_login}` : '',
    avatarUrl: row.avatar_url || null,
    role: normalizeProjectRole(row.role),
    createdBy: row.created_by || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined
  };
}

function githubDirectoryFailure(error) {
  if (error instanceof GithubDirectoryError) {
    return {
      success: false,
      message: error.code === 'RATE_LIMITED'
        ? 'GitHub 搜索次数过多，请稍后再试'
        : error.message,
      errorCode: error.code || null
    };
  }
  return { success: false, message: 'GitHub 搜索失败：' + error.message };
}

function formatProjectMemberForClient(row) {
  const role = normalizeProjectRole(row.role);
  const email = String(row.email || '').trim();
  const nickname = String(row.nickname || '').trim();
  return {
    userId: row.user_id || row.userId,
    email,
    nickname,
    role,
    isOwner: role === PROJECT_ROLE_OWNER,
    joinedAt: row.joined_at ? new Date(row.joined_at).getTime() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined
  };
}

function formatProjectInvitationForClient(row) {
  return {
    id: row.id == null ? null : String(row.id),
    projectId: row.project_id == null ? null : String(row.project_id),
    email: row.email || '',
    role: normalizeProjectRole(row.role),
    status: row.status || 'pending',
    invitedBy: row.invited_by || null,
    acceptedBy: row.accepted_by || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : undefined
  };
}

function normalizeEmail(input) {
  return String(input || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function getUserById(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  try {
    const rows = await query('SELECT id, email, nickname FROM users WHERE id = ? LIMIT 1', [uid]);
    return rows[0] || null;
  } catch (e) {
    return null;
  }
}

async function getUserByEmail(email) {
  const clean = normalizeEmail(email);
  if (!clean) return null;
  const rows = await query('SELECT id, email, nickname FROM users WHERE email = ? LIMIT 1', [clean]);
  return rows[0] || null;
}

async function getGithubIdentityForUser(userId) {
  try {
    const rows = await query(
      'SELECT github_id, github_login FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const row = rows[0];
    if (!row?.github_id) return null;
    return {
      githubId: String(row.github_id),
      githubLogin: row.github_login || null
    };
  } catch (e) {
    return null;
  }
}

async function getFeishuIdentityForUser(userId) {
  try {
    const rows = await query(
      `SELECT feishu_open_id, feishu_union_id, feishu_tenant_key, feishu_email, feishu_name,
              feishu_department_ids, feishu_directory_synced_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row?.feishu_open_id) return null;
    return {
      openId: row.feishu_open_id,
      unionId: row.feishu_union_id || null,
      tenantKey: row.feishu_tenant_key || null,
      email: row.feishu_email || null,
      name: row.feishu_name || null,
      departmentIds: parseDepartmentIds(row.feishu_department_ids),
      directorySyncedAt: row.feishu_directory_synced_at || null
    };
  } catch (e) {
    return null;
  }
}

async function ensureProjectOwnerMembership(projectId, ownerId) {
  const pid = normalizePositiveId(projectId);
  const uid = String(ownerId || '').trim();
  if (!pid || !uid) return;
  await query(
    `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
     VALUES (?, ?, '${PROJECT_ROLE_OWNER}', ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE role = '${PROJECT_ROLE_OWNER}', updated_at = NOW()`,
    [pid, uid, uid]
  );
}

async function ensureProjectOwnerMembershipBestEffort(projectId, ownerId) {
  try {
    await ensureProjectOwnerMembership(projectId, ownerId);
  } catch (e) {
    // Collaboration migration may not be applied yet. Keep legacy project flows working.
    console.warn('确保项目 owner 成员关系失败，跳过:', e.message);
  }
}

async function getProjectWithUserRole(userId, projectId, { includeArchived = true } = {}) {
  const pid = await resolveProjectId(projectId);
  const uid = String(userId || '').trim();
  if (!pid || !uid) return null;

  const archivedSql = includeArchived ? '' : 'AND p.archived = 0';
  try {
    const grantRoles = await getGrantedProjectRoles(uid);
    const grantRole = grantRoles.get(String(pid)) || null;
    const rows = await query(
      `SELECT p.*,
              CASE
                WHEN p.user_id = ? THEN '${PROJECT_ROLE_OWNER}'
                WHEN pm.role IN ('${PROJECT_ROLE_ADMIN}', '${PROJECT_ROLE_MEMBER}') THEN pm.role
                ELSE NULL
              END AS project_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE p.id = ? ${archivedSql}
         AND (p.user_id = ? OR pm.user_id = ? OR ? IS NOT NULL)
       LIMIT 1`,
      [uid, uid, pid, uid, uid, grantRole]
    );
    if (!rows[0]) return null;
    return { ...rows[0], project_role: strongestProjectRole(rows[0].project_role, grantRole) };
  } catch (e) {
    const rows = await query(
      `SELECT *, '${PROJECT_ROLE_OWNER}' AS project_role
       FROM projects
       WHERE id = ? AND user_id = ? ${includeArchived ? '' : 'AND archived = 0'}
       LIMIT 1`,
      [pid, uid]
    );
    if (!rows[0]) return null;
    return { ...rows[0], project_role: PROJECT_ROLE_OWNER };
  }
}

async function getProjectRoleForUser(userId, projectId) {
  const project = await getProjectWithUserRole(userId, projectId);
  return project ? project.project_role : null;
}

async function canUserReadProject(userId, projectId) {
  if (!userId || !projectId) return false;
  const member = await getProjectWithUserRole(userId, projectId);
  if (member) return true;
  if (await checkAdmin(userId)) {
    markAdminAction(null, userId, 'override');
    return true;
  }
  return false;
}

async function canUserWriteProject(userId, projectId) {
  if (!userId || !projectId) return false;
  const pid = await resolveProjectId(projectId);
  if (!pid) return false;
  const project = await getProjectWithUserRole(userId, pid, { includeArchived: false });
  if (project && PROJECT_WRITE_ROLES.includes(project.project_role)) return true;
  if (await checkAdmin(userId)) {
    const rows = await query('SELECT id FROM projects WHERE id = ? AND archived = 0 LIMIT 1', [pid]);
    if (rows.length > 0) markAdminAction(null, userId, 'override');
    return rows.length > 0;
  }
  return false;
}

async function getWebsiteByIdentity({ docId, websiteId }) {
  const params = [];
  const where = [];
  const id = normalizePositiveId(docId);
  if (id) {
    where.push('id = ?');
    params.push(id);
  } else if (websiteId) {
    where.push('website_id = ?');
    params.push(String(websiteId).trim());
  } else {
    return null;
  }
  const rows = await query(`SELECT * FROM websites WHERE ${where.join(' AND ')} LIMIT 1`, params);
  return rows[0] || null;
}

async function canUserManageSite(userId, site) {
  if (!userId || !site) return false;
  if (String(site.user_id || '') === String(userId)) return true;
  if (await checkAdmin(userId)) {
    markAdminAction(null, userId, 'override');
    return true;
  }
  if (!site.project_id) return false;
  return await canUserWriteProject(userId, site.project_id);
}

async function canUserReadSite(userId, site) {
  if (!userId || !site) return false;
  if (String(site.user_id || '') === String(userId)) return true;
  if (await checkAdmin(userId)) {
    markAdminAction(null, userId, 'override');
    return true;
  }
  if (!site.project_id) return false;
  return await canUserReadProject(userId, site.project_id);
}

async function acceptPendingProjectInvitationsForUser(userId) {
  const user = await getUserById(userId);
  const email = normalizeEmail(user?.email);
  if (!email) return 0;

  try {
    const invitations = await query(
      `SELECT pi.*
       FROM project_invitations pi
       JOIN projects p ON p.id = pi.project_id
       WHERE pi.email = ?
         AND pi.status = 'pending'
         AND (pi.expires_at IS NULL OR pi.expires_at > NOW())
         AND p.archived = 0`,
      [email]
    );
    if (invitations.length === 0) return 0;

    await transaction(async (conn) => {
      for (const inv of invitations) {
        const role = normalizeProjectRole(inv.role);
        const safeRole = role === PROJECT_ROLE_OWNER ? PROJECT_ROLE_MEMBER : role;
        await conn.query(
          `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
           VALUES (?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             role = IF(role = '${PROJECT_ROLE_OWNER}', role, VALUES(role)),
             updated_at = NOW()`,
          [inv.project_id, userId, safeRole, inv.invited_by || null]
        );
        await conn.query(
          `UPDATE project_invitations
           SET status = 'accepted', accepted_by = ?, accepted_at = NOW(), updated_at = NOW()
           WHERE id = ? AND status = 'pending'`,
          [userId, inv.id]
        );
      }
    });
    return invitations.length;
  } catch (e) {
    console.warn('自动接受项目邀请失败，可能尚未执行协作迁移:', e.message);
    return 0;
  }
}

async function getProjectForUser(userId, projectId) {
  const id = await resolveProjectId(projectId);
  if (!id) return null;
  const rows = await query(
    'SELECT * FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function getSiteForProjectMove({ userId, docId, websiteId, isAdmin }) {
  const params = [];
  const where = [];
  if (docId) {
    where.push('id = ?');
    params.push(docId);
  } else if (websiteId) {
    where.push('website_id = ?');
    params.push(websiteId);
  } else {
    return null;
  }
  if (!isAdmin) {
    where.push('user_id = ?');
    params.push(userId);
  }
  const rows = await query(`SELECT * FROM websites WHERE ${where.join(' AND ')} LIMIT 1`, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 当前用户项目列表。调用时会先确保该用户至少有一个 default 项目。
 */
async function handleListProjects(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const includeArchived = !!body.includeArchived;
  const includeAll = !!body.includeAll;
  const isAdmin = includeAll ? await checkAdmin(userId) : false;
  if (includeAll && !isAdmin) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '仅管理员可访问' }) };
  }
  if (includeAll) markAdminAction(event, userId, 'admin_only');

  try {
    if (!includeAll) {
      await ensureDefaultProjectForUser(userId);
      await acceptPendingProjectInvitationsForUser(userId);
    }
    const grantRoles = includeAll ? new Map() : await getGrantedProjectRoles(userId);
    const grantedProjectIds = Array.from(grantRoles.keys());
    const params = [userId, userId];
    const where = [];
    if (!includeAll) {
      const grantSql = grantedProjectIds.length
        ? ` OR p.id IN (${grantedProjectIds.map(() => '?').join(', ')})`
        : '';
      where.push(`(p.user_id = ? OR pm.user_id = ?${grantSql})`);
      params.push(userId, userId);
      params.push(...grantedProjectIds);
    }
    if (!includeArchived) where.push('p.archived = 0');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM websites w WHERE w.project_id = p.id) AS websites_count,
              CASE
                WHEN p.user_id = ? THEN '${PROJECT_ROLE_OWNER}'
                WHEN pm.role IN ('${PROJECT_ROLE_ADMIN}', '${PROJECT_ROLE_MEMBER}') THEN pm.role
                ELSE NULL
              END AS project_role,
              owner.email AS owner_email,
              owner.nickname AS owner_nickname
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       LEFT JOIN users owner ON owner.id = p.user_id
       ${whereSql}
       ORDER BY p.archived ASC, p.updated_at DESC, p.id ASC`,
      params
    );
    const projects = rows.map((row) => formatProjectForClient({
      ...row,
      project_role: strongestProjectRole(row.project_role, grantRoles.get(String(row.id)))
    }));
    return ok({ success: true, projects, count: projects.length });
  } catch (e) {
    console.warn('协作项目列表查询失败，尝试 owner-only 降级:', e.message);
    try {
      const params = [];
      const where = [];
      if (!includeAll) {
        where.push('p.user_id = ?');
        params.push(userId);
      }
      if (!includeArchived) where.push('p.archived = 0');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = await query(
        `SELECT p.*,
                (SELECT COUNT(*) FROM websites w WHERE w.project_id = p.id) AS websites_count,
                '${PROJECT_ROLE_OWNER}' AS project_role,
                owner.email AS owner_email,
                owner.nickname AS owner_nickname
         FROM projects p
         LEFT JOIN users owner ON owner.id = p.user_id
         ${whereSql}
         ORDER BY p.archived ASC, p.updated_at DESC, p.id ASC`,
        params
      );
      return ok({ success: true, projects: rows.map(formatProjectForClient), count: rows.length, collaborationReady: false });
    } catch (fallbackError) {
      return ok({ success: false, message: '项目表未初始化', error: fallbackError.message });
    }
  }
}

async function handleCreateProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const name = String(body.name || '').trim();
  if (!name) return ok({ success: false, message: '项目名称不能为空' });
  if (name.length > 80) return ok({ success: false, message: '项目名称不能超过80个字符' });

  const baseSlug = normalizeProjectSlug(body.slug || name);
  const description = body.description ? String(body.description).trim().slice(0, 500) : null;
  const color = body.color ? String(body.color).trim().slice(0, 32) : null;
  const icon = body.icon ? String(body.icon).trim().slice(0, 64) : null;

  try {
    let slug = baseSlug;
    let suffix = 1;
    while (true) {
      try {
        const projectKey = await createUniqueProjectKey();
        const res = await query(
          `INSERT INTO projects (project_key, user_id, name, slug, description, color, icon)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [projectKey, userId, name, slug, description, color, icon]
        );
        const rows = await query('SELECT * FROM projects WHERE id = ? LIMIT 1', [res.insertId]);
        await ensureProjectOwnerMembershipBestEffort(res.insertId, userId);
        return ok({ success: true, project: formatProjectForClient({ ...rows[0], project_role: PROJECT_ROLE_OWNER }), message: '项目已创建' });
      } catch (e) {
        if (!/Duplicate entry/i.test(e.message || '') || suffix >= 20) throw e;
        suffix += 1;
        slug = `${baseSlug.slice(0, 58)}-${suffix}`;
      }
    }
  } catch (e) {
    return ok({ success: false, message: '创建项目失败：' + e.message });
  }
}

async function handleUpdateProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const id = await resolveProjectId(body.id || body.projectId);
  if (!id) return ok({ success: false, message: '缺少 projectId' });

  const sets = [];
  const params = [];
  const setField = (col, val) => { sets.push(`${col} = ?`); params.push(val); };
  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return ok({ success: false, message: '项目名称不能为空' });
    if (name.length > 80) return ok({ success: false, message: '项目名称不能超过80个字符' });
    setField('name', name);
  }
  if (body.description !== undefined) setField('description', body.description ? String(body.description).trim().slice(0, 500) : null);
  if (body.color !== undefined) setField('color', body.color ? String(body.color).trim().slice(0, 32) : null);
  if (body.icon !== undefined) setField('icon', body.icon ? String(body.icon).trim().slice(0, 64) : null);
  if (sets.length === 0) return ok({ success: false, message: '没有要更新的字段' });

  try {
    const project = await getProjectWithUserRole(userId, id);
    const isPlatformAdmin = await checkAdmin(userId);
    if (!project && !isPlatformAdmin) return ok({ success: false, message: '项目不存在或无权限' });
    if (project && !PROJECT_WRITE_ROLES.includes(project.project_role) && !isPlatformAdmin) {
      return ok({ success: false, message: '只有项目 owner/admin 可以更新项目' });
    }
    if (!project || !PROJECT_WRITE_ROLES.includes(project.project_role)) markAdminAction(event, userId, 'override');
    params.push(id);
    const res = await query(`UPDATE projects SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
    if (!res.affectedRows) return ok({ success: false, message: '项目不存在或无权限' });
    const rows = await query('SELECT * FROM projects WHERE id = ? LIMIT 1', [id]);
    return ok({ success: true, project: formatProjectForClient({ ...rows[0], project_role: project?.project_role || PROJECT_ROLE_OWNER }), message: '项目已更新' });
  } catch (e) {
    return ok({ success: false, message: '更新项目失败：' + e.message });
  }
}

async function handleArchiveProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const id = await resolveProjectId(body.id || body.projectId);
  if (!id) return ok({ success: false, message: '缺少 projectId' });
  const archived = body.archived === undefined ? 1 : (body.archived ? 1 : 0);

  try {
    const project = await getProjectWithUserRole(userId, id);
    const isPlatformAdmin = await checkAdmin(userId);
    if (!project && !isPlatformAdmin) return ok({ success: false, message: '项目不存在或无权限' });
    const rows = await query('SELECT slug FROM projects WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) return ok({ success: false, message: '项目不存在或无权限' });
    if (project && project.project_role !== PROJECT_ROLE_OWNER && !isPlatformAdmin) {
      return ok({ success: false, message: '只有项目 owner 可以归档项目' });
    }
    if (!project || project.project_role !== PROJECT_ROLE_OWNER) markAdminAction(event, userId, 'override');
    if (rows[0].slug === 'default' && archived) return ok({ success: false, message: 'default 项目不能归档' });
    await query('UPDATE projects SET archived = ?, updated_at = NOW() WHERE id = ?', [archived, id]);
    return ok({ success: true, archived: !!archived, message: archived ? '项目已归档' : '项目已恢复' });
  } catch (e) {
    return ok({ success: false, message: '归档项目失败：' + e.message });
  }
}

async function handleDeleteProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const id = await resolveProjectId(body.id || body.projectId);
  if (!id) return ok({ success: false, message: '缺少 projectId' });

  try {
    const isPlatformAdmin = await checkAdmin(userId);
    const result = await transaction(async (conn) => {
      const [rows] = await conn.query(
        'SELECT id, user_id, slug FROM projects WHERE id = ? LIMIT 1 FOR UPDATE',
        [id]
      );
      const project = rows[0];
      if (!project) {
        return { success: false, code: 'PROJECT_NOT_FOUND', message: '项目不存在或无权限' };
      }
      if (!isPlatformAdmin && String(project.user_id) !== String(userId)) {
        return { success: false, code: 'PROJECT_DELETE_FORBIDDEN', message: '只有项目 owner 可以删除项目' };
      }
      if (String(project.user_id) !== String(userId)) markAdminAction(event, userId, 'override');
      if (project.slug === 'default') {
        return { success: false, code: 'DEFAULT_PROJECT_DELETE_FORBIDDEN', message: 'default 项目不能删除' };
      }

      const [websites] = await conn.query(
        'SELECT id FROM websites WHERE project_id = ? LIMIT 1 FOR UPDATE',
        [id]
      );
      if (websites.length > 0) {
        return { success: false, code: 'PROJECT_NOT_EMPTY', message: '项目下仍有站点，请先移动或删除站点' };
      }

      await conn.query('DELETE FROM project_feishu_grants WHERE project_id = ?', [id]);
      try {
        await conn.query('DELETE FROM project_github_grants WHERE project_id = ?', [id]);
      } catch (e) {
        if (!/project_github_grants/i.test(e.message || '')) throw e;
      }
      await conn.query('DELETE FROM project_invitations WHERE project_id = ?', [id]);
      await conn.query('DELETE FROM project_members WHERE project_id = ?', [id]);
      const [deleted] = await conn.query(
        `DELETE p FROM projects p
         WHERE p.id = ? AND p.slug <> 'default'
           AND NOT EXISTS (SELECT 1 FROM websites w WHERE w.project_id = p.id)`,
        [id]
      );
      if (deleted.affectedRows !== 1) {
        const error = new Error('项目状态已变化，请刷新后重试');
        error.code = 'PROJECT_DELETE_CONFLICT';
        throw error;
      }
      return { success: true, deleted: true, id: String(body.id || body.projectId), message: '项目已删除' };
    });
    return ok(result);
  } catch (e) {
    if (e.code === 'PROJECT_DELETE_CONFLICT') {
      return ok({ success: false, code: e.code, message: e.message });
    }
    return ok({ success: false, message: '删除项目失败：' + e.message });
  }
}

async function handleSetWebsiteProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const docId = normalizePositiveId(body.docId || body.id);
  const websiteId = body.websiteId ? String(body.websiteId).trim() : '';
  let projectId = await resolveProjectId(body.projectId);

  if (!docId && !websiteId) return ok({ success: false, message: '缺少 docId 或 websiteId' });

  try {
    const site = await getWebsiteByIdentity({ docId, websiteId });
    if (!site) return ok({ success: false, message: '站点不存在或无权限' });
    const canManage = await canUserManageSite(userId, site);
    if (!canManage) return ok({ success: false, message: '站点不存在或无权限' });

    if (!projectId) {
      projectId = await ensureDefaultProjectForUser(site.user_id);
    }
    const isPlatformAdmin = await checkAdmin(userId);
    let project = await getProjectWithUserRole(userId, projectId, { includeArchived: false });
    if (!project && isPlatformAdmin) {
      const rows = await query('SELECT * FROM projects WHERE id = ? AND archived = 0 LIMIT 1', [projectId]);
      if (rows[0]) {
        project = { ...rows[0], project_role: PROJECT_ROLE_OWNER };
        markAdminAction(event, userId, 'override');
      }
    }
    if (!project) return ok({ success: false, message: '目标项目不存在或已归档' });
    if (!isPlatformAdmin && !PROJECT_WRITE_ROLES.includes(project.project_role)) {
      return ok({ success: false, message: '只有目标项目 owner/admin 可以移动站点' });
    }

    await updateWebsiteProjectWithLock(project.id, { docId: site.id });
    return ok({
      success: true,
      project: formatProjectForClient(project),
      websiteId: site.website_id,
      docId: String(site.id),
      message: '站点已移动到项目'
    });
  } catch (e) {
    return ok({ success: false, message: '移动站点失败：' + e.message });
  }
}

async function requireProjectMembershipManager(userId, projectId) {
  const isPlatformAdmin = await checkAdmin(userId);
  let project = await getProjectWithUserRole(userId, projectId);
  if (!project && isPlatformAdmin) {
    const rows = await query('SELECT * FROM projects WHERE id = ? LIMIT 1', [projectId]);
    if (rows[0]) {
      project = { ...rows[0], project_role: PROJECT_ROLE_OWNER };
      markAdminAction(null, userId, 'override');
    }
  } else if (project && isPlatformAdmin && !PROJECT_WRITE_ROLES.includes(project.project_role)) {
    markAdminAction(null, userId, 'override');
  }
  if (!project) {
    return { error: '项目不存在或无权限' };
  }
  if (!isPlatformAdmin && !PROJECT_WRITE_ROLES.includes(project.project_role)) {
    return { error: '只有项目 owner/admin 可以管理成员' };
  }
  return { project, role: project.project_role, isPlatformAdmin };
}

function formatCustomDomainRoute(rootHostname, row) {
  const label = String(row.label || '').trim().toLowerCase();
  const hostname = label ? `${label}.${rootHostname}` : rootHostname;
  const websitePublicId = row.website_public_id || row.websiteId || null;
  return {
    id: row.id == null ? null : String(row.id),
    label,
    hostname,
    url: hostname ? `https://${hostname}/` : '',
    isDefault: !label,
    websiteId: websitePublicId ? String(websitePublicId) : null,
    websiteName: row.website_name || websitePublicId || ''
  };
}

function formatCustomDomainForClient(row, routes = [], extra = {}) {
  const hostname = String(row.hostname || '').toLowerCase();
  const cnameHost = customDomainCnameHost(hostname);
  const formattedRoutes = routes.map((item) => formatCustomDomainRoute(hostname, item));
  const defaultRoute = formattedRoutes.find((item) => item.isDefault) || null;
  return {
    id: row.id == null ? null : String(row.id),
    hostname,
    status: row.status === CUSTOM_DOMAIN_STATUS_ACTIVE
      ? CUSTOM_DOMAIN_STATUS_ACTIVE
      : CUSTOM_DOMAIN_STATUS_PENDING,
    cnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
    cnameHost,
    wildcardHost: cnameHost && cnameHost !== '@' ? `*.${cnameHost}` : '*',
    url: hostname ? `https://${hostname}/` : '',
    defaultWebsiteId: defaultRoute?.websiteId || null,
    defaultWebsiteName: defaultRoute?.websiteName || '',
    routes: formattedRoutes,
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    ...extra
  };
}

async function loadCustomDomainRow(projectId, domainId, hostname) {
  const where = ['project_id = ?'];
  const params = [projectId];
  const id = normalizePositiveId(domainId);
  if (id) {
    where.push('id = ?');
    params.push(id);
  } else if (hostname) {
    where.push('hostname = ?');
    params.push(hostname);
  } else {
    return null;
  }
  const rows = await query(
    `SELECT * FROM custom_domains WHERE ${where.join(' AND ')} LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function loadCustomDomainRoutes(domainId) {
  return query(
    `SELECT r.id, r.label, r.website_id, r.created_at,
            w.website_id AS website_public_id, w.name AS website_name
     FROM custom_domain_routes r
     JOIN websites w ON w.id = r.website_id
     WHERE r.custom_domain_id = ?
     ORDER BY r.label = '' DESC, r.label ASC, r.id ASC`,
    [domainId]
  );
}

async function loadFormattedCustomDomain(projectId, domainId, hostname, extra = {}) {
  const row = await loadCustomDomainRow(projectId, domainId, hostname);
  if (!row) return null;
  const routes = await loadCustomDomainRoutes(row.id);
  return formatCustomDomainForClient(row, routes, extra);
}

async function refreshCustomDomainStatus(row, routes = []) {
  const [dns, instruction, icp] = await Promise.all([
    inspectCustomDomainDns(row.hostname),
    customDomainRecordInstruction(row.hostname),
    checkCustomDomainIcp(row.hostname)
  ]);
  // 未备案：新域名签不出证书（80 端口被拦），直接给结论。
  // 已经生效的域名（证书是以前签的）不降级，免得把正在用的站点标成不可用；只回传 icpStatus 供提醒续期风险。
  if (icp.status === 'unfiled' && row.status !== CUSTOM_DOMAIN_STATUS_ACTIVE) {
    return formatCustomDomainForClient(row, routes, {
      ...instruction,
      cnameChain: dns.chain,
      dnsReason: dns.reason,
      icpStatus: 'unfiled',
      icpSignal: icp.signal,
      liveOk: false,
      gatewayOk: false,
      checkStep: 'icp',
      checkedAt: new Date().toISOString(),
      pendingMessage: '这个域名还没备案，大陆服务器接不进来。请先完成 ICP 备案，备案通过后再点检测'
    });
  }
  let gateway = { ok: false, reason: 'unchecked' };
  let live = { ok: false, reason: 'unchecked' };
  if (dns.matched) {
    gateway = await assertCustomDomainGateway();
    if (gateway.ok) {
      await triggerCustomDomainProvision(row.hostname).catch(() => ({ ok: false }));
      live = await probeCustomDomainHttps(row.hostname);
    }
  }
  const nextStatus = dns.matched && gateway.ok && live.ok
    ? CUSTOM_DOMAIN_STATUS_ACTIVE
    : CUSTOM_DOMAIN_STATUS_PENDING;
  if (nextStatus !== row.status || (nextStatus === CUSTOM_DOMAIN_STATUS_ACTIVE && !row.verified_at) || (!dns.matched && row.verified_at)) {
    await query(
      `UPDATE custom_domains
       SET status = ?, verified_at = CASE WHEN ? = '${CUSTOM_DOMAIN_STATUS_ACTIVE}' THEN COALESCE(verified_at, NOW()) ELSE NULL END, updated_at = NOW()
       WHERE id = ?`,
      [nextStatus, nextStatus, row.id]
    );
    row.status = nextStatus;
    if (nextStatus === CUSTOM_DOMAIN_STATUS_ACTIVE && !row.verified_at) row.verified_at = new Date();
    if (nextStatus !== CUSTOM_DOMAIN_STATUS_ACTIVE) row.verified_at = null;
  }
  return formatCustomDomainForClient(row, routes, {
    ...instruction,
    cnameChain: dns.chain,
    dnsVia: dns.matched ? dns.via : null,
    dnsReason: dns.reason,
    liveOk: !!live.ok,
    gatewayOk: !!gateway.ok,
    checkStep: customDomainCheckStep({ dns, gateway, live }),
    icpStatus: icp.status,
    checkedAt: new Date().toISOString(),
    pendingMessage: nextStatus === CUSTOM_DOMAIN_STATUS_ACTIVE
      ? ''
      : customDomainPendingMessage({ dns, gateway, live, hostname: row.hostname, instruction })
  });
}

async function requireProjectSite(projectId, userId, { websiteId, docId }) {
  const site = await getWebsiteByIdentity({ docId, websiteId });
  if (!site) return { error: '站点不存在' };
  if (Number(site.project_id) !== Number(projectId)) {
    return { error: '只能指向当前项目里的站点' };
  }
  if (!(await canUserManageSite(userId, site))) {
    return { error: '无权操作该站点' };
  }
  return { site };
}

async function upsertCustomDomainRoute(domainId, label, websiteNumericId) {
  const existing = await query(
    'SELECT id FROM custom_domain_routes WHERE custom_domain_id = ? AND label = ? LIMIT 1',
    [domainId, label]
  );
  if (existing[0]) {
    await query(
      'UPDATE custom_domain_routes SET website_id = ?, updated_at = NOW() WHERE id = ?',
      [websiteNumericId, existing[0].id]
    );
    return existing[0].id;
  }
  const inserted = await query(
    'INSERT INTO custom_domain_routes (custom_domain_id, label, website_id) VALUES (?, ?, ?)',
    [domainId, label, websiteNumericId]
  );
  return inserted.insertId;
}

async function handleListProjectCustomDomains(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!(await canUserReadProject(userId, projectId))) {
    return ok({ success: false, message: '项目不存在或无权限' });
  }

  try {
    await ensureCustomDomainsTable();
    const rows = await query(
      `SELECT * FROM custom_domains WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    const domains = [];
    for (const row of rows) {
      const [routes, instruction] = await Promise.all([
        loadCustomDomainRoutes(row.id),
        customDomainRecordInstruction(row.hostname)
      ]);
      domains.push(formatCustomDomainForClient(row, routes, instruction));
    }
    return ok({
      success: true,
      cnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
      canManage: await canUserWriteProject(userId, projectId),
      domains,
      count: domains.length
    });
  } catch (error) {
    console.error('列出项目自定义域名失败:', error);
    return ok({ success: false, message: error.message || '列出自定义域名失败' });
  }
}

async function handleAddProjectCustomDomain(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  const access = await requireProjectMembershipManager(userId, projectId);
  if (access.error) return ok({ success: false, message: access.error });

  const hostname = normalizeCustomHostname(body.hostname || body.domain || body.host);
  const invalid = customDomainValidationError(hostname);
  if (invalid) return ok({ success: false, ...invalid });

  try {
    await ensureCustomDomainsTable();
    const conflicts = await query(
      `SELECT id, project_id, hostname FROM custom_domains
       WHERE hostname = ? OR hostname LIKE CONCAT('%.', ?) OR ? LIKE CONCAT('%.', hostname)
       LIMIT 8`,
      [hostname, hostname, hostname]
    );
    const owned = conflicts.find((row) => Number(row.project_id) === Number(projectId) && row.hostname === hostname);
    if (conflicts.length && !owned) {
      return ok({ success: false, code: 'DUPLICATE', message: '该域名或其上下级已被其他项目占用' });
    }
    if (owned) {
      const domain = await loadFormattedCustomDomain(projectId, owned.id, null, await customDomainRecordInstruction(owned.hostname));
      return ok({ success: true, domain, cnameTarget: CUSTOM_DOMAIN_CNAME_TARGET, message: '该域名已绑定到此项目' });
    }

    const websiteId = String(body.websiteId || body.siteId || '').trim();
    const docId = normalizePositiveId(body.docId);
    if (!websiteId && !docId) return ok({ success: false, message: '请选择要指向的站点' });
    const siteAccess = await requireProjectSite(projectId, userId, { websiteId, docId });
    if (siteAccess.error) return ok({ success: false, message: siteAccess.error });

    const lookup = await lookupCustomDomainCname(hostname);
    const insert = await query(
      `INSERT INTO custom_domains (project_id, hostname, status, created_by, verified_at)
       VALUES (?, ?, ?, ?, NULL)`,
      [projectId, hostname, CUSTOM_DOMAIN_STATUS_PENDING, String(userId)]
    );
    await upsertCustomDomainRoute(insert.insertId, '', siteAccess.site.id);
    const [instruction, icp] = await Promise.all([
      customDomainRecordInstruction(hostname),
      checkCustomDomainIcp(hostname)
    ]);
    const unfiled = icp.status === 'unfiled';
    const domain = await loadFormattedCustomDomain(projectId, insert.insertId, null, {
      ...instruction,
      cnameChain: lookup.chain,
      icpStatus: icp.status,
      checkStep: unfiled ? 'icp' : 'dns',
      ...(unfiled ? { checkedAt: new Date().toISOString(), pendingMessage: '这个域名还没备案，大陆服务器接不进来。请先完成 ICP 备案，备案通过后再点检测' } : {})
    });
    return ok({
      success: true,
      domain,
      cnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
      message: lookup.matched
        ? '域名已绑定到项目。请点检测，确认 HTTPS 可访问后再完成'
        : `域名已绑定到项目。请把 CNAME ${instruction.recordName} 指到 ${CUSTOM_DOMAIN_CNAME_TARGET}`
    });
  } catch (error) {
    if (error && (error.code === 'ER_DUP_ENTRY' || /duplicate/i.test(error.message || ''))) {
      return ok({ success: false, code: 'DUPLICATE', message: '该域名已被占用' });
    }
    console.error('添加项目自定义域名失败:', error);
    return ok({ success: false, message: error.message || '添加自定义域名失败' });
  }
}

async function handleSetProjectCustomDomainRoute(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  const access = await requireProjectMembershipManager(userId, projectId);
  if (access.error) return ok({ success: false, message: access.error });

  const label = normalizeLabel(body.label || body.subdomain || '');
  if (label && !isValidCustomRouteLabel(label)) {
    return ok({ success: false, reason: 'invalid_label', message: '子域名前缀仅限小写字母、数字和连字符' });
  }

  const websiteId = String(body.websiteId || body.siteId || '').trim();
  const docId = normalizePositiveId(body.docId);
  if (!websiteId && !docId) return ok({ success: false, message: '请选择要指向的站点' });

  try {
    await ensureCustomDomainsTable();
    const domainRow = await loadCustomDomainRow(
      projectId,
      body.domainId || body.customDomainId,
      normalizeCustomHostname(body.hostname || body.domain)
    );
    if (!domainRow) return ok({ success: false, message: '域名不存在' });
    if (label) {
      const routeHost = `${label}.${domainRow.hostname}`;
      const invalid = customDomainValidationError(routeHost);
      if (invalid && invalid.reason === 'official') {
        return ok({ success: false, message: '不能使用官方域名作为子域名' });
      }
    }
    const siteAccess = await requireProjectSite(projectId, userId, { websiteId, docId });
    if (siteAccess.error) return ok({ success: false, message: siteAccess.error });
    await upsertCustomDomainRoute(domainRow.id, label, siteAccess.site.id);
    const domain = await loadFormattedCustomDomain(projectId, domainRow.id);
    return ok({
      success: true,
      domain,
      route: domain?.routes?.find((item) => item.label === label) || null,
      message: label
        ? `已将 ${label}.${domainRow.hostname} 指向所选站点`
        : `已将 ${domainRow.hostname} 指向所选站点`
    });
  } catch (error) {
    if (error && (error.code === 'ER_DUP_ENTRY' || /duplicate/i.test(error.message || ''))) {
      return ok({ success: false, code: 'DUPLICATE', message: '该子域名已被占用' });
    }
    console.error('设置项目域名路由失败:', error);
    return ok({ success: false, message: error.message || '设置域名指向失败' });
  }
}

async function handleRemoveProjectCustomDomainRoute(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  const access = await requireProjectMembershipManager(userId, projectId);
  if (access.error) return ok({ success: false, message: access.error });

  try {
    await ensureCustomDomainsTable();
    const domainRow = await loadCustomDomainRow(
      projectId,
      body.domainId || body.customDomainId,
      normalizeCustomHostname(body.hostname || body.domain)
    );
    if (!domainRow) return ok({ success: false, message: '域名不存在' });
    const routeId = normalizePositiveId(body.routeId);
    const label = normalizeLabel(body.label || body.subdomain || '');
    if (routeId) {
      await query(
        'DELETE FROM custom_domain_routes WHERE id = ? AND custom_domain_id = ?',
        [routeId, domainRow.id]
      );
    } else {
      await query(
        'DELETE FROM custom_domain_routes WHERE custom_domain_id = ? AND label = ?',
        [domainRow.id, label]
      );
    }
    const domain = await loadFormattedCustomDomain(projectId, domainRow.id);
    return ok({ success: true, domain, message: '已取消该指向' });
  } catch (error) {
    console.error('删除项目域名路由失败:', error);
    return ok({ success: false, message: error.message || '取消域名指向失败' });
  }
}

async function handleRemoveProjectCustomDomain(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  const access = await requireProjectMembershipManager(userId, projectId);
  if (access.error) return ok({ success: false, message: access.error });

  const hostname = normalizeCustomHostname(body.hostname || body.domain || body.host);
  const domainId = body.domainId || body.customDomainId;
  try {
    await ensureCustomDomainsTable();
    const row = await loadCustomDomainRow(projectId, domainId, hostname);
    if (!row) return ok({ success: false, message: '域名不存在' });
    await query('DELETE FROM custom_domain_routes WHERE custom_domain_id = ?', [row.id]);
    await query('DELETE FROM custom_domains WHERE id = ? AND project_id = ?', [row.id, projectId]);
    return ok({ success: true, hostname: row.hostname, message: '已从项目解绑该域名' });
  } catch (error) {
    console.error('删除项目自定义域名失败:', error);
    return ok({ success: false, message: error.message || '删除自定义域名失败' });
  }
}

async function handleVerifyProjectCustomDomain(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  const access = await requireProjectMembershipManager(userId, projectId);
  if (access.error) return ok({ success: false, message: access.error });

  const hostname = normalizeCustomHostname(body.hostname || body.domain || body.host);
  const domainId = body.domainId || body.customDomainId;
  try {
    await ensureCustomDomainsTable();
    const row = await loadCustomDomainRow(projectId, domainId, hostname);
    if (!row) return ok({ success: false, message: '域名不存在' });
    const routes = await loadCustomDomainRoutes(row.id);
    const domain = await refreshCustomDomainStatus(row, routes);
    return ok({
      success: true,
      domain,
      cnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
      message: domain.status === CUSTOM_DOMAIN_STATUS_ACTIVE
        ? '自定义域名已可访问'
        : (domain.pendingMessage || '还没有解析到 customers.demox.site')
    });
  } catch (error) {
    console.error('校验项目自定义域名失败:', error);
    return ok({ success: false, message: error.message || '校验自定义域名失败' });
  }
}

async function handleListProjectMembers(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });

  try {
    const project = await getProjectWithUserRole(userId, projectId);
    const isPlatformAdmin = await checkAdmin(userId);
    if (!project && !isPlatformAdmin) return ok({ success: false, message: '项目不存在或无权限' });
    if (!project) markAdminAction(event, userId, 'override');
    if (project) await ensureProjectOwnerMembershipBestEffort(project.id, project.user_id);

    const members = await query(
      `SELECT pm.project_id, pm.user_id, pm.role, pm.joined_at, pm.updated_at,
              u.email, u.nickname
       FROM project_members pm
       LEFT JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY
         CASE pm.role
           WHEN '${PROJECT_ROLE_OWNER}' THEN 1
           WHEN '${PROJECT_ROLE_ADMIN}' THEN 2
           ELSE 3
         END,
         pm.joined_at ASC`,
      [projectId]
    );
    const feishuGrants = await query(
      `SELECT * FROM project_feishu_grants
       WHERE project_id = ? AND active = 1
       ORDER BY created_at DESC`,
      [projectId]
    );
    let githubGrants = [];
    try {
      await ensureGithubGrantsTable();
      githubGrants = await query(
        `SELECT * FROM project_github_grants
         WHERE project_id = ? AND active = 1
         ORDER BY created_at DESC`,
        [projectId]
      );
    } catch (e) {
      if (!/project_github_grants/i.test(e.message || '')) throw e;
    }
    const currentFeishuIdentity = await getFeishuIdentityForUser(userId);
    const currentGithubIdentity = await getGithubIdentityForUser(userId);
    const invitations = await query(
      `SELECT *
       FROM project_invitations
       WHERE project_id = ? AND status = 'pending'
       ORDER BY created_at DESC`,
      [projectId]
    );

    return ok({
      success: true,
      project: project ? formatProjectForClient(project) : null,
      role: project?.project_role || (isPlatformAdmin ? PROJECT_ROLE_OWNER : null),
      members: members.map(formatProjectMemberForClient),
      invitations: invitations.map(formatProjectInvitationForClient),
      feishuGrants: feishuGrants.map(formatFeishuProjectGrant),
      githubGrants: githubGrants.map(formatGithubProjectGrant),
      currentFeishuIdentity,
      currentGithubIdentity
    });
  } catch (e) {
    return ok({ success: false, message: '协作表未初始化', error: e.message });
  }
}

async function handleSearchProjectInviteUsers(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const keyword = String(body.query || body.keyword || '').trim().toLocaleLowerCase();
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!keyword) return ok({ success: true, users: [] });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    const users = await query(
      `SELECT u.id, u.email, u.nickname
       FROM users u
       WHERE u.id <> ?
         AND u.email IS NOT NULL AND u.email <> ''
         AND (INSTR(LOWER(COALESCE(u.email, '')), ?) > 0
              OR INSTR(LOWER(COALESCE(u.nickname, '')), ?) > 0)
         AND NOT EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = ? AND pm.user_id = u.id
         )
       ORDER BY
         CASE WHEN LOWER(COALESCE(u.email, '')) = ? THEN 0 ELSE 1 END,
         u.email ASC
       LIMIT 20`,
      [access.project.user_id, keyword, keyword, projectId, keyword]
    );
    return ok({
      success: true,
      users: users.map((user) => ({
        userId: String(user.id),
        email: user.email || '',
        nickname: user.nickname || ''
      }))
    });
  } catch (e) {
    return ok({ success: false, message: '搜索系统用户失败：' + e.message });
  }
}

function feishuDirectoryFailure(error) {
  if (error instanceof FeishuDirectoryError) {
    const permissionMissing = Number(error.code) === 99991672 || Number(error.code) === 40004;
    return {
      success: false,
      message: permissionMissing
        ? '飞书应用尚未开通通讯录读取权限或数据范围，请先完成应用权限配置'
        : error.message,
      errorCode: error.code || null,
      permissionMissing
    };
  }
  return { success: false, message: '飞书通讯录请求失败：' + error.message };
}

async function handleSearchFeishuProjectPrincipals(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const principalType = body.principalType === FEISHU_PRINCIPAL_DEPARTMENT
    ? FEISHU_PRINCIPAL_DEPARTMENT
    : FEISHU_PRINCIPAL_USER;
  const keyword = String(body.query || body.keyword || '').trim();
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!keyword) return ok({ success: true, principals: [] });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    const identity = await getFeishuIdentityForUser(userId);
    if (!identity?.tenantKey) {
      return ok({ success: false, message: '请先在账号设置中关联飞书，再搜索飞书用户或部门' });
    }

    if (principalType === FEISHU_PRINCIPAL_USER) {
      const normalizedKeyword = keyword.toLocaleLowerCase();
      const users = await feishuDirectory.listUsers();
      return ok({
        success: true,
        principals: users
          .filter((user) => [user.name, user.en_name, user.email, user.mobile]
            .some((value) => String(value || '').toLocaleLowerCase().includes(normalizedKeyword)))
          .slice(0, 20)
          .map((user) => ({
            principalType,
            keyType: 'open_id',
            principalKey: user.open_id,
            name: user.name || user.en_name || user.open_id,
            displayName: user.name || user.en_name || user.open_id,
            secondaryText: user.email || '',
            avatarUrl: user.avatar?.avatar_72 || user.avatar?.avatar_240 || null
          }))
      });
    }

    const normalizedKeyword = keyword.toLocaleLowerCase();
    const departments = await feishuDirectory.listDepartments();
    const principals = departments
      .filter((department) => {
        const name = String(department.name || department.i18n_name?.zh_cn || '').toLocaleLowerCase();
        return name.includes(normalizedKeyword) || String(department.open_department_id).includes(keyword);
      })
      .slice(0, 20)
      .map((department) => ({
        principalType,
        keyType: 'open_department_id',
        principalKey: department.open_department_id,
        name: department.name || department.i18n_name?.zh_cn || department.open_department_id,
        displayName: department.name || department.i18n_name?.zh_cn || department.open_department_id,
        secondaryText: `${Number(department.member_count || 0)} 人（含下级部门）`,
        memberCount: Number(department.member_count || 0)
      }));
    return ok({ success: true, principals });
  } catch (error) {
    return ok(feishuDirectoryFailure(error));
  }
}

async function handleGrantProjectToFeishu(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const role = normalizeProjectRole(body.role);
  const principal = normalizeFeishuGrantInput(body);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!principal.valid) {
    return ok({ success: false, message: '请先搜索并选择一个有效的飞书用户或部门' });
  }
  if (role === PROJECT_ROLE_OWNER) return ok({ success: false, message: 'owner 只能由项目创建者担任' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && role === PROJECT_ROLE_ADMIN) {
      return ok({ success: false, message: 'admin 只能授予 member' });
    }
    const identity = await getFeishuIdentityForUser(userId);
    if (!identity?.tenantKey) return ok({ success: false, message: '请先关联飞书账号再创建飞书授权' });

    let verifiedName;
    if (principal.principalType === FEISHU_PRINCIPAL_USER) {
      const target = await feishuDirectory.getUser(principal.principalKey);
      if (!target || target.status?.is_resigned) return ok({ success: false, message: '飞书用户不存在或已离职' });
      verifiedName = target.name || target.en_name || principal.principalKey;
    } else {
      const target = await feishuDirectory.getDepartment(principal.principalKey);
      if (!target || target.status?.is_deleted) return ok({ success: false, message: '飞书部门不存在或已删除' });
      verifiedName = target.name || target.i18n_name?.zh_cn || principal.principalKey;
    }
    await query(
      `INSERT INTO project_feishu_grants
       (project_id, principal_type, key_type, principal_key, tenant_key, display_name, role, created_by, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         tenant_key = VALUES(tenant_key), display_name = VALUES(display_name),
         role = VALUES(role), created_by = VALUES(created_by),
         active = 1, updated_at = NOW()`,
      [projectId, principal.principalType, principal.keyType, principal.principalKey, identity.tenantKey,
        verifiedName || null, role, userId]
    );
    const rows = await query(
      `SELECT * FROM project_feishu_grants
       WHERE project_id = ? AND principal_type = ? AND key_type = ? AND principal_key = ? LIMIT 1`,
      [projectId, principal.principalType, principal.keyType, principal.principalKey]
    );
    return ok({
      success: true,
      grant: rows[0] ? formatFeishuProjectGrant(rows[0]) : null,
      message: principal.principalType === FEISHU_PRINCIPAL_DEPARTMENT
        ? '已授权给飞书部门，该部门及下级部门用户使用飞书登录后即可访问'
        : '已授权给飞书用户，对方无需预先注册 Demox'
    });
  } catch (e) {
    return ok(feishuDirectoryFailure(e));
  }
}

async function handleRemoveProjectFeishuGrant(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const grantId = normalizePositiveId(body.grantId);
  if (!projectId || !grantId) return ok({ success: false, message: '缺少 projectId 或 grantId' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    const rows = await query(
      'SELECT role FROM project_feishu_grants WHERE id = ? AND project_id = ? AND active = 1 LIMIT 1',
      [grantId, projectId]
    );
    if (!rows[0]) return ok({ success: false, message: '飞书授权不存在' });
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && normalizeProjectRole(rows[0].role) !== PROJECT_ROLE_MEMBER) {
      return ok({ success: false, message: 'admin 只能移除 member 授权' });
    }
    await query(
      'UPDATE project_feishu_grants SET active = 0, updated_at = NOW() WHERE id = ? AND project_id = ?',
      [grantId, projectId]
    );
    return ok({ success: true, removedGrantId: String(grantId), message: '飞书授权已移除' });
  } catch (e) {
    return ok({ success: false, message: '移除飞书授权失败：' + e.message });
  }
}

function formatGithubSearchPrincipal(user, { alreadyOnDemox = false } = {}) {
  return {
    principalType: 'user',
    keyType: 'github_id',
    principalKey: String(user.id || user.principalKey || user.github_id),
    githubLogin: user.login || user.github_login || '',
    name: user.name || user.nickname || user.login || user.github_login || String(user.id || ''),
    displayName: user.name || user.nickname || user.login || user.github_login || String(user.id || ''),
    secondaryText: user.login || user.github_login
      ? `@${user.login || user.github_login}${alreadyOnDemox ? ' · Demox 用户' : ''}`
      : '',
    avatarUrl: user.avatarUrl || user.avatar_url || null,
    alreadyOnDemox
  };
}

async function handleSearchGithubProjectPrincipals(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const keyword = String(body.query || body.keyword || '').trim();
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!keyword) return ok({ success: true, principals: [] });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    const identity = await getGithubIdentityForUser(userId);
    if (!identity?.githubId) {
      return ok({ success: false, message: '请先在账号设置中关联 GitHub，再搜索 GitHub 用户' });
    }
    await ensureGithubGrantsTable();

    const normalizedKeyword = keyword.toLocaleLowerCase();
    const localUsers = await query(
      `SELECT u.id, u.email, u.nickname, u.github_id, u.github_login, u.avatar_url
       FROM users u
       WHERE u.github_id IS NOT NULL AND u.github_id <> ''
         AND (INSTR(LOWER(COALESCE(u.github_login, '')), ?) > 0
              OR INSTR(LOWER(COALESCE(u.nickname, '')), ?) > 0
              OR u.github_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = ? AND pm.user_id = u.id
         )
       ORDER BY
         CASE WHEN LOWER(COALESCE(u.github_login, '')) = ? THEN 0 ELSE 1 END,
         u.github_login ASC
       LIMIT 20`,
      [normalizedKeyword, normalizedKeyword, keyword, projectId, normalizedKeyword]
    );

    const principals = [];
    const seen = new Set();
    for (const user of localUsers) {
      const principal = formatGithubSearchPrincipal({
        id: user.github_id,
        login: user.github_login,
        name: user.nickname || user.github_login,
        avatar_url: user.avatar_url
      }, { alreadyOnDemox: true });
      seen.add(principal.principalKey);
      principals.push(principal);
    }

    const remoteUsers = await githubDirectory.searchUsers(keyword);
    for (const user of remoteUsers) {
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      principals.push(formatGithubSearchPrincipal(user));
    }

    return ok({ success: true, principals: principals.slice(0, 20) });
  } catch (error) {
    return ok(githubDirectoryFailure(error));
  }
}

async function handleGrantProjectToGithub(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const role = normalizeProjectRole(body.role);
  const principal = normalizeGithubGrantInput(body);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!principal.valid) {
    return ok({ success: false, message: '请先搜索并选择一个有效的 GitHub 用户' });
  }
  if (role === PROJECT_ROLE_OWNER) return ok({ success: false, message: 'owner 只能由项目创建者担任' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && role === PROJECT_ROLE_ADMIN) {
      return ok({ success: false, message: 'admin 只能授予 member' });
    }
    const identity = await getGithubIdentityForUser(userId);
    if (!identity?.githubId) {
      return ok({ success: false, message: '请先在账号设置中关联 GitHub，再授权 GitHub 用户' });
    }
    await ensureGithubGrantsTable();

    const target = await githubDirectory.getUserById(principal.principalKey);
    if (!target) return ok({ success: false, message: 'GitHub 用户不存在' });

    const existingUsers = await query(
      'SELECT id, email, nickname FROM users WHERE github_id = ? LIMIT 1',
      [target.id]
    );
    if (existingUsers[0]) {
      const targetUser = existingUsers[0];
      if (String(targetUser.id) === String(access.project.user_id)) {
        return ok({
          success: true,
          member: formatProjectMemberForClient({
            user_id: targetUser.id,
            email: targetUser.email,
            nickname: targetUser.nickname,
            role: PROJECT_ROLE_OWNER
          }),
          message: '该用户已经是项目 owner'
        });
      }
      const currentRows = await query(
        'SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
        [projectId, targetUser.id]
      );
      if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && currentRows.length > 0) {
        const currentRole = normalizeProjectRole(currentRows[0].role);
        if (currentRole !== PROJECT_ROLE_MEMBER) {
          return ok({ success: false, message: 'admin 只能管理 member' });
        }
      }
      await query(
        `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           role = IF(role = '${PROJECT_ROLE_OWNER}', role, VALUES(role)),
           invited_by = VALUES(invited_by),
           updated_at = NOW()`,
        [projectId, targetUser.id, role, userId]
      );
      return ok({
        success: true,
        member: formatProjectMemberForClient({
          user_id: targetUser.id,
          email: targetUser.email,
          nickname: targetUser.nickname,
          role
        }),
        message: '成员已加入项目'
      });
    }

    await query(
      `INSERT INTO project_github_grants
       (project_id, principal_type, key_type, principal_key, github_login, display_name, avatar_url, role, created_by, active)
       VALUES (?, 'user', 'github_id', ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         github_login = VALUES(github_login), display_name = VALUES(display_name),
         avatar_url = VALUES(avatar_url), role = VALUES(role), created_by = VALUES(created_by),
         active = 1, updated_at = NOW()`,
      [projectId, target.id, target.login, target.name || target.login, target.avatarUrl || null, role, userId]
    );
    const rows = await query(
      `SELECT * FROM project_github_grants
       WHERE project_id = ? AND principal_type = 'user' AND key_type = 'github_id' AND principal_key = ? LIMIT 1`,
      [projectId, target.id]
    );
    return ok({
      success: true,
      grant: rows[0] ? formatGithubProjectGrant(rows[0]) : null,
      message: '已授权给 GitHub 用户，对方使用 GitHub 登录后即可访问'
    });
  } catch (e) {
    return ok(githubDirectoryFailure(e));
  }
}

async function handleRemoveProjectGithubGrant(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const grantId = normalizePositiveId(body.grantId);
  if (!projectId || !grantId) return ok({ success: false, message: '缺少 projectId 或 grantId' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    await ensureGithubGrantsTable();
    const rows = await query(
      'SELECT role FROM project_github_grants WHERE id = ? AND project_id = ? AND active = 1 LIMIT 1',
      [grantId, projectId]
    );
    if (!rows[0]) return ok({ success: false, message: 'GitHub 授权不存在' });
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && normalizeProjectRole(rows[0].role) !== PROJECT_ROLE_MEMBER) {
      return ok({ success: false, message: 'admin 只能移除 member 授权' });
    }
    await query(
      'UPDATE project_github_grants SET active = 0, updated_at = NOW() WHERE id = ? AND project_id = ?',
      [grantId, projectId]
    );
    return ok({ success: true, removedGrantId: String(grantId), message: 'GitHub 授权已移除' });
  } catch (e) {
    return ok({ success: false, message: '移除 GitHub 授权失败：' + e.message });
  }
}

async function handleInviteProjectMember(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const email = normalizeEmail(body.email);
  const role = normalizeProjectRole(body.role);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!isValidEmail(email)) return ok({ success: false, message: '请输入有效邮箱' });
  if (role === PROJECT_ROLE_OWNER) return ok({ success: false, message: 'owner 只能由项目创建者担任' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && role === PROJECT_ROLE_ADMIN) {
      return ok({ success: false, message: 'admin 只能邀请 member' });
    }
    await ensureProjectOwnerMembershipBestEffort(projectId, access.project.user_id);

    const targetUser = await getUserByEmail(email);
    if (targetUser) {
      if (String(targetUser.id) === String(access.project.user_id)) {
        return ok({ success: true, member: formatProjectMemberForClient({
          user_id: targetUser.id,
          email: targetUser.email,
          nickname: targetUser.nickname,
          role: PROJECT_ROLE_OWNER
        }), message: '该用户已经是项目 owner' });
      }

      const currentRows = await query('SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, targetUser.id]);
      if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && currentRows.length > 0) {
        const currentRole = normalizeProjectRole(currentRows[0].role);
        if (currentRole !== PROJECT_ROLE_MEMBER) {
          return ok({ success: false, message: 'admin 只能管理 member' });
        }
      }

      await query(
        `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           role = IF(role = '${PROJECT_ROLE_OWNER}', role, VALUES(role)),
           invited_by = VALUES(invited_by),
           updated_at = NOW()`,
        [projectId, targetUser.id, role, userId]
      );
      await query(
        `UPDATE project_invitations
         SET status = 'accepted', accepted_by = ?, accepted_at = NOW(), updated_at = NOW()
         WHERE project_id = ? AND email = ? AND status = 'pending'`,
        [targetUser.id, projectId, email]
      );
      return ok({
        success: true,
        member: formatProjectMemberForClient({
          user_id: targetUser.id,
          email: targetUser.email,
          nickname: targetUser.nickname,
          role
        }),
        message: '成员已加入项目'
      });
    }

    const token = nodeCrypto.randomBytes(24).toString('hex');
    await query(
      `INSERT INTO project_invitations (project_id, email, role, token, invited_by, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 30 DAY))
       ON DUPLICATE KEY UPDATE role = VALUES(role), token = VALUES(token), invited_by = VALUES(invited_by),
         status = 'pending', expires_at = VALUES(expires_at), updated_at = NOW()`,
      [projectId, email, role, token, userId]
    );
    const rows = await query(
      `SELECT * FROM project_invitations WHERE project_id = ? AND email = ? AND status = 'pending' LIMIT 1`,
      [projectId, email]
    );
    return ok({
      success: true,
      invitation: rows[0] ? formatProjectInvitationForClient(rows[0]) : { email, role, status: 'pending' },
      message: '邀请已记录，对方注册或登录该邮箱后会自动加入项目'
    });
  } catch (e) {
    return ok({ success: false, message: '邀请失败：' + e.message });
  }
}

async function handleUpdateProjectMemberRole(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const targetUserId = String(body.userId || body.uid || '').trim();
  const role = normalizeProjectRole(body.role);
  if (!projectId || !targetUserId) return ok({ success: false, message: '缺少 projectId 或 userId' });
  if (role === PROJECT_ROLE_OWNER) return ok({ success: false, message: '不能把成员设置为 owner' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    if (String(targetUserId) === String(access.project.user_id)) {
      return ok({ success: false, message: '不能修改项目 owner 的角色' });
    }

    const currentRows = await query('SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, targetUserId]);
    if (currentRows.length === 0) return ok({ success: false, message: '成员不存在' });
    const currentRole = normalizeProjectRole(currentRows[0].role);
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN) {
      if (projectRoleRank(currentRole) >= projectRoleRank(PROJECT_ROLE_ADMIN) || role === PROJECT_ROLE_ADMIN) {
        return ok({ success: false, message: 'admin 只能管理 member' });
      }
    }

    await query(
      `UPDATE project_members SET role = ?, updated_at = NOW()
       WHERE project_id = ? AND user_id = ? AND role <> '${PROJECT_ROLE_OWNER}'`,
      [role, projectId, targetUserId]
    );
    const target = await getUserById(targetUserId);
    return ok({
      success: true,
      member: formatProjectMemberForClient({
        user_id: targetUserId,
        email: target?.email || '',
        nickname: target?.nickname || '',
        role
      }),
      message: '成员角色已更新'
    });
  } catch (e) {
    return ok({ success: false, message: '更新成员角色失败：' + e.message });
  }
}

async function handleRemoveProjectMember(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const targetUserId = String(body.userId || body.uid || '').trim();
  if (!projectId || !targetUserId) return ok({ success: false, message: '缺少 projectId 或 userId' });

  try {
    const projectRows = await query('SELECT * FROM projects WHERE id = ? LIMIT 1', [projectId]);
    const project = projectRows[0];
    if (!project) return ok({ success: false, message: '项目不存在' });
    if (String(targetUserId) === String(project.user_id)) {
      return ok({ success: false, message: '不能移除项目 owner' });
    }

    const currentRows = await query('SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, targetUserId]);
    if (currentRows.length === 0) return ok({ success: false, message: '成员不存在' });
    const targetRole = normalizeProjectRole(currentRows[0].role);
    const leavingSelf = String(targetUserId) === String(userId);
    let access = null;
    if (!leavingSelf) {
      access = await requireProjectMembershipManager(userId, projectId);
      if (access.error) return ok({ success: false, message: access.error });
      if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && targetRole !== PROJECT_ROLE_MEMBER) {
        return ok({ success: false, message: 'admin 只能移除 member' });
      }
    }

    await query('DELETE FROM project_members WHERE project_id = ? AND user_id = ? AND role <> ?', [projectId, targetUserId, PROJECT_ROLE_OWNER]);
    return ok({ success: true, removedUserId: targetUserId, message: leavingSelf ? '已退出项目' : '成员已移除' });
  } catch (e) {
    return ok({ success: false, message: '移除成员失败：' + e.message });
  }
}

/** 列出所有用户角色(user_roles 表),带账户昵称与第三方登录信息(LEFT JOIN users) */
async function handleListUserRoles(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  await ensureProExpiresColumn();
  await ensureUsageColumns();
  await backfillDeployedSizesOnce();
  // users 表主键是 id(形如 user_xxx);老站点的纯数字 user_id 不在 users 表中,email 为 null
  const rows = await query(
    `SELECT ur.user_id, ur.roles, ur.pro_expires_at, ur.updated_at, u.email, u.nickname, u.github_id, u.feishu_open_id,
            (SELECT COUNT(*) FROM websites w WHERE w.user_id = ur.user_id) AS sites_count,
            (SELECT COALESCE(SUM(COALESCE(w.deployed_size, w.storage_size)), 0) FROM websites w WHERE w.user_id = ur.user_id) AS storage_bytes
     FROM user_roles ur
     LEFT JOIN users u ON u.id = ur.user_id
     ORDER BY ur.updated_at DESC`
  );
  const list = rows.map((r) => {
    const membership = membershipSummary(r.roles, r.pro_expires_at);
    return {
      _id: r.user_id,
      email: r.email || '',
      nickname: r.nickname || '',
      authProviders: [
        ...(r.github_id ? ['github'] : []),
        ...(r.feishu_open_id ? ['feishu'] : [])
      ],
      role: membership.storedRoles,
      effectiveRole: membership.effectiveRoles,
      proExpiresAt: membership.proExpiresAt,
      proLifetime: membership.proLifetime,
      proExpired: membership.proExpired,
      remainingDays: membership.remainingDays,
      siteCount: Number(r.sites_count || 0),
      storageBytes: Number(r.storage_bytes || 0),
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined
    };
  });
  return ok({ success: true, data: list });
}

function toDayKey(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

/** 管理员查看某用户的项目、站点与访问看板 */
async function handleGetUserOverview(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  await ensureProExpiresColumn();
  await ensureUsageColumns();
  await backfillDeployedSizesOnce();
  const uid = String((event.body || event).uid || '').trim();
  if (!uid) return ok({ success: false, message: '缺少用户 UID' });

  const users = await query(
    `SELECT id, email, nickname, github_id, feishu_open_id, created_at
     FROM users WHERE id = ? LIMIT 1`,
    [uid]
  );
  const roleRows = await query(
    'SELECT roles, pro_expires_at FROM user_roles WHERE user_id = ? LIMIT 1',
    [uid]
  );
  if (users.length === 0 && roleRows.length === 0) {
    const ownedSites = await query('SELECT id FROM websites WHERE user_id = ? LIMIT 1', [uid]);
    if (ownedSites.length === 0) {
      return ok({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在' });
    }
  }

  const userRow = users[0] || {
    id: uid,
    email: '',
    nickname: '',
    github_id: null,
    feishu_open_id: null,
    created_at: null
  };
  const membership = membershipSummary(roleRows[0]?.roles || ['user'], roleRows[0]?.pro_expires_at);
  const limits = await getUserLimits(uid);

  let projectCounts = { projects: 0, archivedProjects: 0 };
  try {
    const rows = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END), 0) AS projects,
         COALESCE(SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END), 0) AS archivedProjects
       FROM projects WHERE user_id = ?`,
      [uid]
    );
    projectCounts = {
      projects: Number(rows[0]?.projects || 0),
      archivedProjects: Number(rows[0]?.archivedProjects || 0)
    };
  } catch (e) {
    console.warn('用户项目统计失败:', e.message);
  }

  const usageRows = await query(
    `SELECT COUNT(*) AS sites,
            COALESCE(SUM(file_count), 0) AS files,
            COALESCE(SUM(COALESCE(deployed_size, storage_size)), 0) AS storage
     FROM websites WHERE user_id = ?`,
    [uid]
  );
  const sitesCount = Number(usageRows[0]?.sites || 0);

  const rangeDays = 30;
  let viewsAll = 0;
  let daily = [];
  try {
    const all = await query(
      `SELECT COALESCE(SUM(s.views), 0) AS views
       FROM site_path_daily_stats s
       INNER JOIN websites w ON w.website_id = s.website_id
       WHERE w.user_id = ? AND ${scannerPathSqlPredicate('s.path')}`,
      [uid]
    );
    viewsAll = Number(all[0]?.views || 0);
    const dayRows = await query(
      `SELECT s.stat_date, SUM(s.views) AS views
       FROM site_path_daily_stats s
       INNER JOIN websites w ON w.website_id = s.website_id
       WHERE w.user_id = ? AND s.stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
         AND ${scannerPathSqlPredicate('s.path')}
       GROUP BY s.stat_date
       ORDER BY s.stat_date ASC`,
      [uid, rangeDays - 1]
    );
    daily = (dayRows || []).map((r) => ({
      date: toDayKey(r.stat_date),
      views: Number(r.views || 0)
    }));
  } catch (e) {
    console.warn('用户访问统计失败:', e.message);
  }

  const views30d = daily.reduce((sum, item) => sum + item.views, 0);
  const cutoff7Key = statTime.statDateKeyDaysAgo(6);
  const views7d = daily.filter((item) => item.date >= cutoff7Key).reduce((sum, item) => sum + item.views, 0);

  const formatOverviewSite = (row) => {
    const formatted = formatWebsiteForClient(row);
    return {
      websiteId: row.website_id,
      name: row.name || row.website_id,
      url: formatted.preferredUrl || formatted.url || '',
      projectId: row.project_key || (row.project_id != null ? String(row.project_id) : ''),
      projectName: row.project_name || '',
      views30d: Number(row.views30d || 0),
      storage: Number(row.storage || 0),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined
    };
  };

  let projectRows = [];
  try {
    projectRows = await query(
      `SELECT p.id, p.project_key, p.name, p.slug, p.archived, p.updated_at
       FROM projects p
       WHERE p.user_id = ?
       ORDER BY p.archived ASC, p.updated_at DESC, p.id ASC`,
      [uid]
    );
  } catch (e) {
    console.warn('用户项目列表失败:', e.message);
  }

  let siteRows = [];
  try {
    siteRows = await query(
      `SELECT w.website_id, w.name, w.subdomain, w.subdomain_domain, w.url, w.created_at, w.updated_at,
              w.project_id,
              p.project_key, p.name AS project_name,
              COALESCE(w.deployed_size, w.storage_size, 0) AS storage,
              COALESCE(v.views30d, 0) AS views30d
       FROM websites w
       LEFT JOIN projects p ON p.id = w.project_id
       LEFT JOIN (
         SELECT s.website_id, SUM(s.views) AS views30d
         FROM site_path_daily_stats s
         WHERE s.stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
           AND ${scannerPathSqlPredicate('s.path')}
         GROUP BY s.website_id
       ) v ON v.website_id = w.website_id
       WHERE w.user_id = ?
       ORDER BY views30d DESC, w.updated_at DESC`,
      [rangeDays - 1, uid]
    );
  } catch (e) {
    console.warn('用户站点列表失败:', e.message);
  }

  const sites = siteRows.map(formatOverviewSite);
  const sitesByProjectId = new Map();
  for (const row of siteRows) {
    const key = row.project_id != null && row.project_id !== '' ? String(row.project_id) : '';
    if (!sitesByProjectId.has(key)) sitesByProjectId.set(key, []);
    sitesByProjectId.get(key).push(formatOverviewSite(row));
  }

  const knownProjectIds = new Set(projectRows.map((row) => String(row.id)));
  const projects = projectRows.map((row) => {
    const nested = sitesByProjectId.get(String(row.id)) || [];
    return {
      id: String(row.project_key || row.id),
      name: row.name || 'default',
      slug: row.slug || 'default',
      archived: !!row.archived,
      websitesCount: nested.length,
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
      sites: nested
    };
  });

  const ungroupedSites = [
    ...(sitesByProjectId.get('') || []),
    ...[...sitesByProjectId.entries()]
      .filter(([projectId]) => projectId && !knownProjectIds.has(projectId))
      .flatMap(([, list]) => list)
  ];

  const storageBytes = Number(usageRows[0]?.storage || 0);

  return ok({
    success: true,
    user: {
      id: userRow.id || uid,
      email: userRow.email || '',
      nickname: userRow.nickname || '',
      createdAt: userRow.created_at ? new Date(userRow.created_at).getTime() : undefined,
      authProviders: [
        ...(userRow.github_id ? ['github'] : []),
        ...(userRow.feishu_open_id ? ['feishu'] : [])
      ],
      role: membership.storedRoles,
      effectiveRole: membership.effectiveRoles,
      proExpiresAt: membership.proExpiresAt,
      proLifetime: membership.proLifetime,
      proExpired: membership.proExpired,
      remainingDays: membership.remainingDays
    },
    counts: {
      projects: projectCounts.projects,
      archivedProjects: projectCounts.archivedProjects,
      sites: sitesCount
    },
    usage: {
      deployments: sitesCount,
      files: Number(usageRows[0]?.files || 0),
      storage: storageBytes,
      role: { name: limits.name, priority: limits.priority },
      limits: {
        deployment_limit: limits.deployment_limit ?? null,
        max_file_count: limits.max_file_count ?? null,
        max_file_size: limits.max_file_size ?? null
      }
    },
    traffic: {
      rangeDays,
      views7d,
      views30d,
      viewsAll,
      daily
    },
    projects,
    sites,
    ungroupedSites
  });
}

function countSafe(rows, key = 'c') {
  return Number((rows && rows[0] && rows[0][key]) || 0);
}

async function summarizeEnabledBucketUsage() {
  let cfgs = [];
  try {
    const rows = await query(
      `SELECT * FROM storage_buckets
       WHERE enabled = 1
         AND (
           is_default = 1
           OR id IN (SELECT DISTINCT bucket_id FROM websites WHERE bucket_id IS NOT NULL)
         )
       ORDER BY is_default DESC, id ASC`
    );
    cfgs = (rows || []).map(buckets.rowToConfig);
  } catch (e) {
    console.warn('读取 storage_buckets 失败，跳过桶体积扫描:', e.message);
    return { bytes: null, objects: null, perBucket: [] };
  }
  if (!cfgs.length) cfgs = [LEGACY_BUCKET];

  let bytes = 0;
  let objects = 0;
  const perBucket = [];
  for (const cfg of cfgs) {
    let bucketBytes = 0;
    let bucketObjects = 0;
    let error = null;
    try {
      const items = await providerFor(cfg).list('');
      for (const item of items) {
        bucketBytes += Number(item.size || 0);
        bucketObjects += 1;
      }
    } catch (e) {
      error = e.message;
      console.warn(`桶 ${cfg.name || cfg.bucket} 体积扫描失败:`, e.message);
    }
    bytes += bucketBytes;
    objects += bucketObjects;
    perBucket.push({
      name: cfg.name || cfg.bucket,
      bytes: bucketBytes,
      objects: bucketObjects,
      error
    });
  }
  return { bytes, objects, perBucket };
}

/** 管理员平台数据概览 */
async function handleGetPlatformOverview(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  await ensureProExpiresColumn();
  await ensureUsageColumns();
  await backfillDeployedSizesOnce();

  const rangeDays = 30;
  const counts = {
    users: 0,
    usersWithSites: 0,
    users7d: 0,
    sites: 0,
    sites7d: 0,
    projects: 0,
    archivedProjects: 0,
    storage: 0,
    bucketStorage: null,
    bucketObjects: null,
    admins: 0,
    proActive: 0,
    proExpired: 0,
    reportsOpen: 0
  };

  try {
    counts.users = countSafe(await query('SELECT COUNT(*) AS c FROM users'));
  } catch (e) {
    console.warn('概览用户数失败:', e.message);
  }
  try {
    counts.users7d = countSafe(await query(
      'SELECT COUNT(*) AS c FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
    ));
  } catch (e) {
    console.warn('概览新增用户失败:', e.message);
  }
  try {
    const usage = await query(
      `SELECT COUNT(*) AS sites,
              COUNT(DISTINCT user_id) AS usersWithSites,
              COALESCE(SUM(COALESCE(deployed_size, storage_size)), 0) AS storage
       FROM websites`
    );
    counts.sites = countSafe(usage, 'sites');
    counts.usersWithSites = countSafe(usage, 'usersWithSites');
    counts.storage = countSafe(usage, 'storage');
  } catch (e) {
    console.warn('概览站点统计失败:', e.message);
  }
  try {
    const bucketUsage = await summarizeEnabledBucketUsage();
    if (bucketUsage.bytes != null) {
      counts.bucketStorage = Number(bucketUsage.bytes);
      counts.bucketObjects = Number(bucketUsage.objects || 0);
    }
  } catch (e) {
    console.warn('概览桶体积失败:', e.message);
  }
  try {
    counts.sites7d = countSafe(await query(
      'SELECT COUNT(*) AS c FROM websites WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
    ));
  } catch (e) {
    console.warn('概览新增站点失败:', e.message);
  }
  try {
    const projectRows = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END), 0) AS projects,
         COALESCE(SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END), 0) AS archivedProjects
       FROM projects`
    );
    counts.projects = countSafe(projectRows, 'projects');
    counts.archivedProjects = countSafe(projectRows, 'archivedProjects');
  } catch (e) {
    console.warn('概览项目统计失败:', e.message);
  }

  try {
    const roleRows = await query('SELECT roles, pro_expires_at FROM user_roles');
    for (const row of roleRows) {
      const membership = membershipSummary(row.roles, row.pro_expires_at);
      if (membership.effectiveRoles.includes('admin')) counts.admins += 1;
      if (membership.hasPro) counts.proActive += 1;
      if (membership.proExpired) counts.proExpired += 1;
    }
  } catch (e) {
    console.warn('概览会员统计失败:', e.message);
  }
  try {
    await ensureSiteReportsTable();
    counts.reportsOpen = countSafe(await query(
      "SELECT COUNT(*) AS c FROM site_reports WHERE status = 'open'"
    ));
  } catch (e) {
    console.warn('概览举报数失败:', e.message);
  }

  let viewsAll = 0;
  let daily = [];
  try {
    const all = await query(
      `SELECT COALESCE(SUM(views), 0) AS views
       FROM site_path_daily_stats
       WHERE ${scannerPathSqlPredicate('path')}`
    );
    viewsAll = countSafe(all, 'views');
    const dayRows = await query(
      `SELECT stat_date, SUM(views) AS views
       FROM site_path_daily_stats
       WHERE stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
         AND ${scannerPathSqlPredicate('path')}
       GROUP BY stat_date
       ORDER BY stat_date ASC`,
      [rangeDays - 1]
    );
    daily = (dayRows || []).map((r) => ({
      date: toDayKey(r.stat_date),
      views: Number(r.views || 0)
    }));
  } catch (e) {
    console.warn('概览访问统计失败:', e.message);
  }

  const views30d = daily.reduce((sum, item) => sum + item.views, 0);
  const cutoff7Key = statTime.statDateKeyDaysAgo(6);
  const views7d = daily.filter((item) => item.date >= cutoff7Key).reduce((sum, item) => sum + item.views, 0);

  let topSites = [];
  try {
    const rows = await query(
      `SELECT w.website_id, w.name, w.subdomain, w.subdomain_domain, w.url, w.user_id,
              u.nickname, u.email,
              COALESCE(SUM(s.views), 0) AS views30d,
              MAX(COALESCE(w.deployed_size, w.storage_size, 0)) AS storage,
              MAX(w.updated_at) AS updated_at
       FROM websites w
       LEFT JOIN users u ON u.id = w.user_id
       LEFT JOIN site_path_daily_stats s
         ON s.website_id = w.website_id
        AND s.stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
        AND ${scannerPathSqlPredicate('s.path')}
       GROUP BY w.website_id, w.name, w.subdomain, w.subdomain_domain, w.url, w.user_id, u.nickname, u.email
       ORDER BY views30d DESC, updated_at DESC
       LIMIT 8`,
      [rangeDays - 1]
    );
    topSites = rows.map((row) => {
      const formatted = formatWebsiteForClient(row);
      return {
        websiteId: row.website_id,
        name: row.name || row.website_id,
        url: formatted.preferredUrl || formatted.url || '',
        owner: row.nickname || row.email || row.user_id || '',
        views30d: Number(row.views30d || 0),
        storage: Number(row.storage || 0)
      };
    });
  } catch (e) {
    console.warn('概览热门站点失败:', e.message);
  }

  return ok({
    success: true,
    counts,
    traffic: {
      rangeDays,
      views7d,
      views30d,
      viewsAll,
      daily
    },
    topSites
  });
}

/** 设置/新增某用户的角色 */
async function handleSetUserRole(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  await ensureProExpiresColumn();
  const body = event.body || event;
  const { uid, role, proDays, proLifetime } = body;
  const targetUid = String(uid || '').trim();
  if (!targetUid) return ok({ success: false, message: '缺少用户 UID' });
  if (!Array.isArray(role)) return ok({ success: false, message: '角色必须是数组' });

  const requestedRoles = [...new Set([
    'user',
    ...role.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
  ])];
  const enabledRoles = await query('SELECT id, priority FROM roles WHERE enabled = 1 ORDER BY priority ASC');
  const enabledRoleIds = new Set(enabledRoles.map((item) => String(item.id || '').trim().toLowerCase()).filter(Boolean));
  const invalidRoles = requestedRoles.filter((roleId) => !enabledRoleIds.has(roleId));
  if (invalidRoles.length > 0) {
    return ok({ success: false, code: 'INVALID_USER_ROLE', message: `角色不存在或已停用：${invalidRoles.join(', ')}` });
  }

  const rolesArr = enabledRoles
    .map((item) => String(item.id || '').trim().toLowerCase())
    .filter((roleId) => requestedRoles.includes(roleId));
  if (String(a.userId) === targetUid && !rolesArr.includes('admin')) {
    return ok({ success: false, code: 'SELF_ADMIN_ROLE_REQUIRED', message: '不能移除自己的管理员角色' });
  }

  const users = await query('SELECT id FROM users WHERE id = ? LIMIT 1', [targetUid]);
  if (users.length === 0) {
    // 兼容早期没有 users 记录、但已经存在角色配置的数字 UID。
    const existingRoles = await query('SELECT user_id FROM user_roles WHERE user_id = ? LIMIT 1', [targetUid]);
    if (existingRoles.length === 0) return ok({ success: false, code: 'USER_NOT_FOUND', message: '用户不存在，请检查 UID' });
  }

  const currentRows = await query('SELECT roles, pro_expires_at FROM user_roles WHERE user_id = ? LIMIT 1', [targetUid]);
  const current = currentRows[0] || {};
  const currentMembership = membershipSummary(current.roles, current.pro_expires_at);
  let proExpiresAt = null;
  if (rolesArr.includes('pro')) {
    proExpiresAt = resolveGrantExpiry({
      hasPro: currentMembership.hasPro,
      currentExpiresAt: current.pro_expires_at,
      proDays,
      proLifetime: proLifetime === true || proLifetime === 'true'
    });
  }

  await query(
    `INSERT INTO user_roles (user_id, roles, pro_expires_at, updated_at) VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE roles = VALUES(roles), pro_expires_at = VALUES(pro_expires_at), updated_at = NOW()`,
    [targetUid, JSON.stringify(rolesArr), proExpiresAt]
  );
  const membership = membershipSummary(rolesArr, proExpiresAt);
  return ok({
    success: true,
    uid: targetUid,
    role: rolesArr,
    effectiveRole: membership.effectiveRoles,
    proExpiresAt: membership.proExpiresAt,
    proLifetime: membership.proLifetime,
    remainingDays: membership.remainingDays
  });
}

/** 删除某用户的角色文档 */
async function handleDeleteUserRole(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const { uid } = event.body || event;
  const targetUid = String(uid || '').trim();
  if (!targetUid) return ok({ success: false, message: '缺少用户 UID' });
  if (String(a.userId) === targetUid) {
    return ok({ success: false, code: 'SELF_ADMIN_ROLE_REQUIRED', message: '不能重置自己的管理员角色' });
  }
  await query('DELETE FROM user_roles WHERE user_id = ?', [targetUid]);
  return ok({ success: true });
}

/** 列出角色限额定义(roles 表) */
async function handleListRoleLimits(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const rows = await query('SELECT * FROM roles ORDER BY priority DESC');
  const list = rows.map((r) => ({
    _id: r.id || r.name,
    name: r.name,
    priority: r.priority,
    max_file_size: r.max_file_size,
    deployment_limit: r.deployment_limit,
    max_file_count: r.max_file_count,
    allowed_extensions: typeof r.allowed_extensions === 'string'
      ? JSON.parse(r.allowed_extensions || 'null')
      : (r.allowed_extensions || null),
    enabled: r.enabled === null || r.enabled === undefined ? null : !!r.enabled,
    description: r.description || null
  }));
  return ok({ success: true, data: list });
}

/** 设置/新增角色限额(docId/id 用角色名或现有 id) */
async function handleSetRoleLimit(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const d = event.body || event;
  const id = String(d.id || d.name || '').trim();
  const name = String(d.name || d.id || '').trim();
  if (!name) return ok({ success: false, message: '缺少角色名' });

  const allowedExt = Array.isArray(d.allowed_extensions)
    ? JSON.stringify(d.allowed_extensions)
    : (d.allowed_extensions == null ? null : JSON.stringify(d.allowed_extensions));

  await query(
    `INSERT INTO roles (id, name, priority, enabled, max_file_count, allowed_extensions, deployment_limit, max_file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), priority = VALUES(priority), enabled = VALUES(enabled),
       max_file_count = VALUES(max_file_count), allowed_extensions = VALUES(allowed_extensions),
       deployment_limit = VALUES(deployment_limit), max_file_size = VALUES(max_file_size)`,
    [
      id || name,
      name,
      d.priority == null ? null : Number(d.priority),
      d.enabled == null ? 1 : (d.enabled ? 1 : 0),
      d.max_file_count == null ? null : Number(d.max_file_count),
      allowedExt,
      d.deployment_limit == null ? null : Number(d.deployment_limit),
      d.max_file_size == null ? null : Number(d.max_file_size)
    ]
  );
  return ok({ success: true });
}

async function listEnabledBucketConfigs() {
  try {
    const rows = await query('SELECT * FROM storage_buckets WHERE enabled = 1 ORDER BY is_default DESC, id ASC');
    const cfgs = (rows || []).map(buckets.rowToConfig);
    if (cfgs.length > 0) return cfgs;
  } catch (e) {
    console.warn('读取 storage_buckets 失败，回退旧默认桶统计:', e.message);
  }
  return [LEGACY_BUCKET];
}

let _deployedSizeBackfillStarted = false;
/** 只在历史行还没有 deployed_size 时扫一次桶，写回冗余字段。之后只在创建/更新站点时维护。 */
async function backfillDeployedSizesOnce() {
  if (_deployedSizeBackfillStarted) return;
  _deployedSizeBackfillStarted = true;
  try {
    const missing = await query('SELECT COUNT(*) AS c FROM websites WHERE deployed_size IS NULL');
    if (!Number(missing[0]?.c || 0)) return;
    const bySite = new Map();
    const cfgs = await listEnabledBucketConfigs();
    for (const cfg of cfgs) {
      const objs = await providerFor(cfg).list('sites/');
      for (const item of objs) {
        const websiteId = String(item.key || '').split('/')[2] || '';
        if (!websiteId) continue;
        bySite.set(websiteId, (bySite.get(websiteId) || 0) + Number(item.size || 0));
      }
    }
    const rows = await query('SELECT website_id FROM websites WHERE deployed_size IS NULL');
    for (const row of rows) {
      await query(
        'UPDATE websites SET deployed_size = ? WHERE website_id = ? AND deployed_size IS NULL',
        [bySite.get(row.website_id) || 0, row.website_id]
      );
    }
    console.log(`已回填 ${rows.length} 个站点的 deployed_size`);
  } catch (e) {
    console.warn('回填 deployed_size 跳过:', e.message);
  }
}

/**
 * 大盘统计：各存储桶 sites/ 用量/对象数 + 用户数/项目数(来自 DB)。
 * 多云后按桶聚合：遍历 storage_buckets，逐桶 provider.list('sites/') 求和，
 * 并返回每桶明细 perBucket[]。表未建/为空时回退旧默认桶。
 * 流量时序需云监控,SCF 默认无权限,best-effort:拿不到返回 null。
 */
async function handleBucketStats(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;

  // 1) 列出要统计的桶：注册表优先，空则回退 LEGACY_BUCKET
  let bucketCfgs = [];
  try {
    const rows = await query('SELECT * FROM storage_buckets WHERE enabled = 1 ORDER BY is_default DESC, id ASC');
    bucketCfgs = rows.map(buckets.rowToConfig);
  } catch (e) {
    console.warn('读取 storage_buckets 失败，回退旧默认桶统计:', e.message);
  }
  if (bucketCfgs.length === 0) bucketCfgs = [LEGACY_BUCKET];

  // 2) 逐桶统计 sites/ 前缀。单桶失败不影响其它桶（best-effort）。
  let sitesBytes = 0;
  let sitesCount = 0;
  const perBucket = [];
  for (const cfg of bucketCfgs) {
    let bytes = 0;
    let count = 0;
    let error = null;
    try {
      const objs = await providerFor(cfg).list('sites/');
      for (const o of objs) {
        bytes += o.size;
        count += 1;
      }
    } catch (e) {
      error = e.message;
      console.error(`桶 ${cfg.name || cfg.bucket} 统计失败:`, e.message);
    }
    sitesBytes += bytes;
    sitesCount += count;
    perBucket.push({
      id: cfg.id || null,
      name: cfg.name || cfg.bucket,
      provider: cfg.provider,
      bucket: cfg.bucket,
      bytes,
      count,
      error
    });
  }

  // 3) DB: 在用用户数(有站点的不同 user)、项目数(站点总数)
  let usersCount = 0;
  let projectsCount = 0;
  try {
    const u = await query('SELECT COUNT(DISTINCT user_id) AS c FROM websites');
    usersCount = u[0]?.c || 0;
    const p = await query('SELECT COUNT(*) AS c FROM websites');
    projectsCount = p[0]?.c || 0;
  } catch (e) {
    console.error('DB 统计失败:', e.message);
  }

  return ok({
    success: true,
    sitesBytes,
    sitesCount,
    perBucket,
    usersCount,
    projectsCount,
    traffic: { timestamps: [], inbound: null, outbound: null }
  });
}

/** 删除角色限额 */
async function handleDeleteRoleLimit(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const { id, name } = event.body || event;
  const key = String(id || name || '').trim();
  if (!key) return ok({ success: false, message: '缺少角色标识' });
  await query('DELETE FROM roles WHERE id = ? OR name = ?', [key, key]);
  return ok({ success: true });
}

/**
 * 按角色名列表返回限额(供 home.jsx 计算用户有效限额)。需登录,不需管理员。
 * 返回 { code: 0, data: [...] }(沿用旧 getRoleLimits 形态)。
 */
async function handleGetRoleLimits(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: [], message: '未登录' });
  const roles = Array.isArray(event.body?.roles) ? event.body.roles : (event.roles || []);
  const names = roles.map((r) => String(r).trim()).filter(Boolean);
  if (names.length === 0) return ok({ code: 0, data: [] });
  const placeholders = names.map(() => '?').join(',');
  // home.jsx 传的是角色 id(如 user/pro/admin);表里 name 是中文展示名,故按 id 或 name 都匹配
  const rows = await query(
    `SELECT * FROM roles WHERE enabled = 1 AND (id IN (${placeholders}) OR name IN (${placeholders})) ORDER BY priority DESC`,
    [...names, ...names]
  );
  const data = rows.map((r) => ({
    name: r.name,
    priority: r.priority,
    max_file_size: r.max_file_size,
    deployment_limit: r.deployment_limit,
    max_file_count: r.max_file_count,
    allowed_extensions: typeof r.allowed_extensions === 'string'
      ? JSON.parse(r.allowed_extensions || 'null')
      : (r.allowed_extensions || null),
    enabled: r.enabled === null ? null : !!r.enabled
  }));
  return ok({ code: 0, data });
}

/**
 * 获取当前用户的真实用量与套餐限额。
 * - deployments: 累计站点数（与 deployment_limit 累计上限对比，是真正的配额比）。
 * - files / storage: 各站点单次部署文件数与上传包体积之和；对应 max_file_count /
 *   max_file_size 是「单次上传」上限而非累计配额，故同时返回 maxSite 供前端展示
 *   「最大单站 vs 单次上限」这一真正受约束的比例。
 * - 历史站点未记录用量列时按 0 聚合。
 */
async function handleGetUsage(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: null, message: '未登录' });

  try {
    await ensureUsageColumns();
    await ensureProExpiresColumn();
    const limits = await getUserLimits(userId);
    const roleRow = await query('SELECT roles, pro_expires_at FROM user_roles WHERE user_id = ? LIMIT 1', [userId]);
    const membership = membershipSummary(roleRow[0]?.roles || ['user'], roleRow[0]?.pro_expires_at);

    // 仅统计用户归属站点（与 deployment_limit 的计数口径一致）。
    const rows = await query(
      `SELECT COUNT(*) AS deployments,
              COALESCE(SUM(file_count), 0) AS files,
              COALESCE(SUM(storage_size), 0) AS storage,
              COALESCE(MAX(file_count), 0) AS maxSiteFiles,
              COALESCE(MAX(storage_size), 0) AS maxSiteStorage
       FROM websites WHERE user_id = ?`,
      [userId]
    );
    const r = (rows && rows[0]) || {};
    const usage = {
      deployments: Number(r.deployments || 0),
      files: Number(r.files || 0),
      storage: Number(r.storage || 0)
    };
    const maxSite = {
      fileCount: Number(r.maxSiteFiles || 0),
      storageSize: Number(r.maxSiteStorage || 0)
    };

    return ok({
      code: 0,
      data: {
        role: { name: limits.name, priority: limits.priority },
        membership: {
          hasPro: membership.hasPro,
          proExpired: membership.proExpired,
          proLifetime: membership.proLifetime,
          proExpiresAt: membership.proExpiresAt,
          remainingDays: membership.remainingDays
        },
        usage,
        maxSite,
        limits: {
          deployment_limit: limits.deployment_limit ?? null,
          max_file_count: limits.max_file_count ?? null,
          max_file_size: limits.max_file_size ?? null
        }
      }
    });
  } catch (e) {
    console.error('获取用量失败:', e);
    return ok({ code: 500, data: null, message: e.message });
  }
}

// ── 个人访问令牌（PAT）─────────────────────────────────────────
// PAT = 带 jti 声明的长效 JWT，用 JWT_SECRET 签名。
// 现有 getUserId/authenticate 无需改动即可解析；吊销靠 jti 查表拦截（见 exports.main）。

const PAT_EXPIRES_IN = process.env.PAT_EXPIRES_IN || '730d'; // 默认 2 年

/**
 * 创建个人访问令牌。明文 token 仅此次返回，后续只存 prefix。
 */
async function handleCreateToken(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: null, message: '未登录' });

  const name = String(event.body?.name || '').trim();
  if (!name) return ok({ code: 1, data: null, message: '请填写令牌名称' });
  if (name.length > 120) return ok({ code: 1, data: null, message: '令牌名称过长' });

  await ensureAccessTokensTable();

  const jti = nodeCrypto.randomBytes(16).toString('hex');
  const token = sign({ userId, jti, type: 'pat' }, PAT_EXPIRES_IN);
  const prefix = token.slice(0, 12);

  // 解析 JWT 过期时间写入 expires_at（便于列表展示与过期判断）
  let expiresAt = null;
  try {
    const decoded = require('jsonwebtoken').decode(token);
    if (decoded && decoded.exp) expiresAt = new Date(decoded.exp * 1000);
  } catch (e) { /* ignore */ }

  const result = await query(
    `INSERT INTO access_tokens (user_id, name, jti, prefix, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, name, jti, prefix, expiresAt]
  );

  return ok({
    code: 0,
    data: {
      id: result.insertId,
      token, // 明文 token，仅此一次返回
      name,
      prefix,
      createdAt: Date.now()
    }
  });
}

/**
 * 列出当前用户的令牌（不含明文 token，仅 prefix）。
 */
async function handleListTokens(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: [], message: '未登录' });

  await ensureAccessTokensTable();
  const rows = await query(
    `SELECT id, name, prefix, created_at, last_used_at, expires_at, revoked_at
     FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );

  const data = rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).getTime() : null,
    expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null,
    revoked: !!r.revoked_at
  }));

  return ok({ code: 0, data });
}

/**
 * 吊销令牌（软删除：置 revoked_at）。
 */
async function handleRevokeToken(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: null, message: '未登录' });

  const tokenId = String(event.body?.id || '').trim();
  if (!tokenId) return ok({ code: 1, data: null, message: '缺少令牌 ID' });

  await ensureAccessTokensTable();
  const result = await query(
    `UPDATE access_tokens SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [tokenId, userId]
  );

  if (result.affectedRows === 0) {
    return ok({ code: 1, data: null, message: '令牌不存在或已吊销' });
  }
  return ok({ code: 0, data: { revoked: true } });
}

// ── 产品漏斗埋点 ────────────────────────────────────────────────
// 匿名埋点：无需登录，visitor_id 由前端 localStorage 生成。

// 前端可上报的事件白名单。新增前端埋点时必须同步加到这里（index.test.cjs 会扫描 src/ 里的 track("...") 校验）。
// deploy_success / deploy_fail 改为服务端记录（见 recordServerDeployEvent），不再接受前端上报，
// 这样旧版本前端缓存里发出的事件会被丢弃，不会和服务端事件重复计数。
const PRODUCT_EVENT_NAMES = new Set([
  'landing_view',
  'deploy_click',
  'intent_guide_click',
  'example_click',
  'feedback_copy',
  'usecase_click'
]);

// 只由服务端写入的事件；page 列固定为 `server:<source>`，BI 用这个前缀区分历史前端事件。
const SERVER_PRODUCT_EVENT_NAMES = new Set(['deploy_success', 'deploy_fail']);
const DEPLOY_SOURCES = new Set(['web', 'cli', 'mcp', 'github', 'token', 'api']);

function eventHeader(event, name) {
  const headers = (event && event.headers) || {};
  const want = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === want) return String(headers[key] || '');
  }
  return '';
}

/**
 * 判断部署来自哪条渠道（仅用于统计，不参与任何鉴权）。
 * 优先级：显式声明（body.deploySource / X-Demox-Client）> token 类型 > UA。
 * - web：官网控制台上传（前端显式带 deploySource: 'web'）
 * - mcp：经 mcp-api 代理转发（代理显式带 deploySource: 'mcp'）
 * - github：客户端声明 github / github-actions（CLI 1.1.6 还不会声明，见下条）
 * - token：个人访问令牌（PAT），目前主要是 GitHub Actions 的 DEMOX_TOKEN
 * - cli：OAuth 登录的 CLI（本地 demox deploy、stdio MCP 也走这里）
 * - api：其他（无法判断）
 */
function classifyDeploySource(event, authPayload) {
  const body = (event && event.body) || {};
  const explicit = String(body.deploySource || eventHeader(event, 'x-demox-client') || '').trim().toLowerCase();
  if (explicit === 'github-actions' || explicit === 'github_actions') return 'github';
  if (DEPLOY_SOURCES.has(explicit)) return explicit;
  if (authPayload && authPayload.type === 'pat') return 'token';
  if (authPayload && authPayload.scopes) return 'cli';
  if (/Mozilla\//.test(eventHeader(event, 'user-agent'))) return 'web';
  return 'api';
}

function deployResponsePayload(res) {
  if (!res) return {};
  if (typeof res.body === 'string') {
    try { return JSON.parse(res.body) || {}; } catch (e) { return {}; }
  }
  return res.body || {};
}

/**
 * 服务端记录一次部署结果（所有部署渠道都经过 upload_and_deploy 或 complete_deploy_upload）。
 * 只写 product_events，失败不影响部署。DEPLOY_IN_PROGRESS（并发锁冲突，部署没开始）不记。
 */
async function recordServerDeployEvent(event, { success, userId, websiteId, uploadId, sizeBytes, startedAt, errorCode }) {
  try {
    if (!success && errorCode === 'DEPLOY_IN_PROGRESS') return;
    const eventName = success ? 'deploy_success' : 'deploy_fail';
    if (!SERVER_PRODUCT_EVENT_NAMES.has(eventName)) return;
    const auth = authenticate(event);
    const source = classifyDeploySource(event, auth);
    const body = (event && event.body) || {};
    const clientVisitor = String(body.visitorId || '').trim();
    const visitorId = /^[A-Za-z0-9_-]{4,64}$/.test(clientVisitor)
      ? clientVisitor
      : `user:${String(userId || '')}`.slice(0, 64);
    const props = { server: true, source, userId: userId ? String(userId) : null };
    if (websiteId) props.websiteId = String(websiteId);
    if (uploadId) props.uploadId = String(uploadId);
    if (Number.isFinite(Number(sizeBytes))) props.sizeBytes = Number(sizeBytes);
    if (startedAt) props.durationMs = Math.max(0, Date.now() - startedAt);
    if (!success) props.errorCode = String(errorCode || 'DEPLOY_FAILED').slice(0, 64);
    await ensureProductEventsTable();
    await query(
      `INSERT INTO product_events (event_name, visitor_id, page, props) VALUES (?, ?, ?, ?)`,
      [eventName, visitorId, `server:${source}`, JSON.stringify(props)]
    );
  } catch (e) {
    console.warn('部署埋点写入失败（不阻塞）:', e && e.message);
  }
}

/**
 * 接收匿名产品事件（无需鉴权）。
 * body: { eventName, visitorId, page, props }
 */
async function handleTrackProductEvent(event) {
  const body = event.body || {};
  const eventName = String(body.eventName || '').trim();
  if (!PRODUCT_EVENT_NAMES.has(eventName)) {
    return ok({ code: 1, data: null, message: '未知事件名' });
  }
  const visitorId = String(body.visitorId || '').trim().slice(0, 64);
  const page = String(body.page || '').trim().slice(0, 128);
  let props = null;
  if (body.props && typeof body.props === 'object') {
    try { props = JSON.stringify(body.props); } catch (e) { /* ignore */ }
  }

  try {
    await ensureProductEventsTable();
    await query(
      `INSERT INTO product_events (event_name, visitor_id, page, props) VALUES (?, ?, ?, ?)`,
      [eventName, visitorId, page, props]
    );
  } catch (e) {
    console.warn('埋点写入失败（不阻塞）:', e.message);
  }
  // 永远返回成功——埋点失败不应影响用户流程
  return ok({ code: 0, data: { tracked: true } });
}

/**
 * 管理员：查询产品漏斗（最近 N 天的事件计数）。
 */
async function handleGetProductFunnel(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: null, message: '未登录' });
  const isAdmin = await checkAdmin(userId);
  if (!isAdmin) return ok({ code: 403, data: null, message: '无权限' });
  markAdminAction(event, userId, 'admin_only');

  const days = Math.min(90, Math.max(1, Number(event.body?.days) || 14));
  await ensureProductEventsTable();

  const rows = await query(
    `SELECT event_name, ${statTime.sqlStatDate('created_at')} AS d, COUNT(*) AS cnt
     FROM product_events
     WHERE created_at >= ?
     GROUP BY event_name, d
     ORDER BY d, event_name`,
    [statTime.statDayStartUtc(statTime.statDateKeyDaysAgo(days))]
  );

  // 汇总每个事件的总量
  const totals = {};
  for (const r of rows) {
    totals[r.event_name] = (totals[r.event_name] || 0) + Number(r.cnt);
  }

  return ok({
    code: 0,
    data: {
      days,
      totals,
      daily: rows.map((r) => ({ event: r.event_name, date: statTime.toDateKey(r.d), count: Number(r.cnt) }))
    }
  });
}

// ── 管理后台 BI（只读）────────────────────────────────────────
const adminBi = createAdminBiService({
  query,
  wwwWebsiteId: (process.env.WWW_WEBSITE_ID || 'EPX2UU43').trim().toUpperCase(),
  scannerPathPredicate: (col) => scannerPathSqlPredicate(col)
});

/**
 * 管理员：BI 汇总。纯 SELECT，不跑 ensure* / backfill；60 秒进程内缓存。
 * body: { range: 7 | 30 | 90 }
 */
/**
 * 部署按天的日志回填（迁移 022 + seeds/022，Chief 2026-10-09 批准）。
 * box 没有数据库凭证、安全组也不开，所以和 021（admin_audit_log）一样，由已发布的 website 函数自己建表：
 * 管理员第一次打开看板（get_admin_bi）时，每个实例跑一次：
 *   1. CREATE TABLE IF NOT EXISTS deploy_daily_backfill（与 migrations/022 一致）；
 *   2. INSERT IGNORE 这 8 行（与 migrations/seeds/022 一致，主键 stat_date+source，已有的行不覆盖）。
 * 只碰 deploy_daily_backfill 这一张表。失败只记错误码，看板照常（退回只用站点记录补算），下次再试。
 * 数据只有按天汇总（UTC+8 日期、成功次数），fail / channel 为 NULL（未知），不含任何日志原文或用户信息。
 */
const DEPLOY_LOG_BACKFILL_ROWS = [
  // [stat_date, total, partial, covered_from(UTC), covered_until(UTC)]
  ['2026-10-02', 0, 1, '2026-10-02 05:10:03', '2026-10-02 16:00:00'],
  ['2026-10-03', 0, 0, '2026-10-02 16:00:00', '2026-10-03 16:00:00'],
  ['2026-10-04', 24, 0, '2026-10-03 16:00:00', '2026-10-04 16:00:00'],
  ['2026-10-05', 18, 0, '2026-10-04 16:00:00', '2026-10-05 16:00:00'],
  ['2026-10-06', 22, 0, '2026-10-05 16:00:00', '2026-10-06 16:00:00'],
  ['2026-10-07', 136, 0, '2026-10-06 16:00:00', '2026-10-07 16:00:00'],
  ['2026-10-08', 124, 0, '2026-10-07 16:00:00', '2026-10-08 16:00:00'],
  ['2026-10-09', 26, 1, '2026-10-08 16:00:00', '2026-10-09 05:25:21']
];
const DEPLOY_LOG_BACKFILL_NOTE = 'CLS demox-user-nodejs, uploadedCount responses, dedup by RequestId';
let deployBackfillReady = null;
function ensureDeployDailyBackfill() {
  if (!deployBackfillReady) {
    deployBackfillReady = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS deploy_daily_backfill (
        stat_date     DATE NOT NULL COMMENT 'UTC+8 日期',
        source        VARCHAR(16) NOT NULL DEFAULT 'log_backfill' COMMENT '数据来源；目前只有 log_backfill',
        total         INT UNSIGNED NOT NULL COMMENT '当天成功部署次数（按请求去重）',
        fail          INT UNSIGNED DEFAULT NULL COMMENT '失败次数；日志里认不出，NULL = 未知',
        channel       VARCHAR(16) DEFAULT NULL COMMENT '渠道；日志里没有，NULL = 未知',
        partial       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = 这天只覆盖了一部分（日志开始那天 / 埋点开始那天）',
        covered_from  DATETIME DEFAULT NULL COMMENT '这一行覆盖的起点（UTC）',
        covered_until DATETIME DEFAULT NULL COMMENT '这一行覆盖的终点（UTC，不含）',
        note          VARCHAR(255) DEFAULT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (stat_date, source)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部署按天回填（埋点之前，只有总数）'`);
      const values = DEPLOY_LOG_BACKFILL_ROWS.map(() => "(?, 'log_backfill', ?, NULL, NULL, ?, ?, ?, ?)").join(', ');
      const params = DEPLOY_LOG_BACKFILL_ROWS.flatMap(([d, total, partial, from, until]) => [d, total, partial, from, until, DEPLOY_LOG_BACKFILL_NOTE]);
      await query(
        `INSERT IGNORE INTO deploy_daily_backfill
           (stat_date, source, total, fail, channel, partial, covered_from, covered_until, note)
         VALUES ${values}`,
        params
      );
    })().catch((error) => {
      deployBackfillReady = null;
      throw error;
    });
  }
  return deployBackfillReady;
}

async function handleGetAdminBi(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  try {
    await ensureDeployDailyBackfill();
  } catch (e) {
    console.warn('部署日志回填建表/写入失败:', (e && e.code) || 'ERROR');
  }
  try {
    const data = await adminBi.get(event.body && event.body.range);
    return ok({ success: true, data });
  } catch (e) {
    console.error('BI 汇总失败:', e && e.message);
    return ok({ success: false, message: 'BI 汇总失败' });
  }
}

/**
 * 解析用户 ID -> 邮箱(管理员站点列表用)。
 * 用户表未知时优雅降级:返回 userId 占位,不报错。
 */
async function handleResolveUserEmails(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const ids = Array.isArray(event.body?.userIds) ? event.body.userIds : [];
  const clean = ids.map((x) => String(x).trim()).filter(Boolean);
  if (clean.length === 0) return ok({ success: true, users: [] });

  // users 表主键是 id(形如 user_xxx);老站点的 user_id 是纯数字、不在 users 表中,查不到则空邮箱
  const placeholders = clean.map(() => '?').join(',');
  try {
    const rows = await query(
      `SELECT id, email FROM users WHERE id IN (${placeholders})`,
      clean
    );
    const map = {};
    for (const r of rows) map[r.id] = r.email;
    return ok({ success: true, users: clean.map((id) => ({ userId: id, email: map[id] || '' })) });
  } catch (e) {
    console.error('解析用户邮箱失败:', e.message);
    return ok({ success: true, users: clean.map((id) => ({ userId: id, email: '' })) });
  }
}

async function queryResolvedSiteByLabel(label, domain = defaultDomain, {
  withBucket = true,
  withVisibility = true,
  withSubdomainDomain = true,
  withWatermark = true
} = {}) {
  const visibilityExpr = withVisibility
    ? `COALESCE(NULLIF(w.visibility, ''), '${VISIBILITY_PUBLIC}')`
    : `'${VISIBILITY_PUBLIC}'`;
  const originExpr = withBucket ? 'b.origin_host' : 'NULL';
  const bucketJoin = withBucket ? 'LEFT JOIN storage_buckets b ON b.id = w.bucket_id' : '';
  const subdomainDomainExpr = withSubdomainDomain
    ? `COALESCE(NULLIF(w.subdomain_domain, ''), '${defaultDomain}')`
    : `'${defaultDomain}'`;
  const hideWatermarkExpr = withWatermark ? 'COALESCE(w.hide_watermark, 0)' : '0';
  const selectSql =
    `SELECT w.path AS path,
            w.user_id AS user_id,
            w.project_id AS project_id,
            w.website_id AS website_id,
            w.subdomain AS subdomain,
            w.name AS site_name,
            w.seo_title AS seo_title,
            w.seo_description AS seo_description,
            w.og_image AS og_image,
            ${subdomainDomainExpr} AS subdomain_domain,
            ${visibilityExpr} AS visibility,
            ${hideWatermarkExpr} AS hide_watermark,
            ${originExpr} AS origin_host
     FROM websites w ${bucketJoin}`;

  let rows = [];
  if (withSubdomainDomain) {
    rows = await query(
      `${selectSql} WHERE w.subdomain = ? AND ${subdomainDomainExpr} = ? LIMIT 1`,
      [label, domain]
    );
  } else if (domain === defaultDomain) {
    rows = await query(`${selectSql} WHERE w.subdomain = ? LIMIT 1`, [label]);
  }
  if (rows.length === 0 && domain === defaultDomain) {
    rows = await query(`${selectSql} WHERE LOWER(w.website_id) = ? LIMIT 1`, [label]);
  }
  return rows;
}

/**
 * 解析公开 label 到站点元数据。按能力降级：
 * 1) storage_buckets + visibility
 * 2) visibility
 * 3) 旧表结构(public)
 */
async function resolveSiteMetadataByLabel(label, domain = defaultDomain) {
  const baseModes = [
    { withBucket: true, withVisibility: true, withSubdomainDomain: true },
    { withBucket: false, withVisibility: true, withSubdomainDomain: true },
    { withBucket: false, withVisibility: false, withSubdomainDomain: true },
    { withBucket: false, withVisibility: false, withSubdomainDomain: false }
  ];
  const modes = [
    ...baseModes.map((mode) => ({ ...mode, withWatermark: true })),
    ...baseModes.map((mode) => ({ ...mode, withWatermark: false }))
  ];
  let lastErr = null;
  for (const mode of modes) {
    try {
      const rows = await queryResolvedSiteByLabel(label, domain, mode);
      return rows.length > 0 ? rows[0] : null;
    } catch (e) {
      lastErr = e;
      console.warn('解析站点元数据失败，尝试降级:', e.message);
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/**
 * 公开屏蔽词表。无需鉴权，供文档页、Agent Skill 和第三方查询。
 * GET/POST /website/content-scan/phrases 或 action=list_blocked_phrases
 */
async function handleListBlockedPhrases() {
  return {
    statusCode: 200,
    headers: {
      ...getCORSHeaders(),
      'Cache-Control': 'public, max-age=60'
    },
    body: JSON.stringify(listBlockedPhrasesCatalog())
  };
}

/**
 * 公开解析接口：label -> COS path。供 subdomain-router 边缘函数查表。
 * 无需鉴权：只返回站点路由必要信息，供边缘函数判断 public/private 与回源。
 */
function resolveSitePayload(site, host, suffix) {
  return {
    success: true,
    path: site.path,
    websiteId: site.website_id || null,
    origin: site.origin_host || null,
    domain: suffix || null,
    host,
    visibility: normalizeVisibility(site.visibility),
    hideWatermark: normalizeBooleanFlag(site.hide_watermark),
    seo: {
      title: site.seo_title || null,
      description: site.seo_description || null,
      ogImage: site.og_image || null
    }
  };
}

async function resolveSiteMetadataByCustomHost(hostname) {
  const host = normalizeCustomHostname(hostname);
  if (!host) return null;
  await ensureCustomDomainsTable();
  await ensureSeoColumns();
  await ensureWatermarkColumn();
  const selectSql =
    `SELECT w.path AS path,
            w.user_id AS user_id,
            w.project_id AS project_id,
            w.website_id AS website_id,
            w.subdomain AS subdomain,
            w.name AS site_name,
            w.seo_title AS seo_title,
            w.seo_description AS seo_description,
            w.og_image AS og_image,
            COALESCE(NULLIF(w.subdomain_domain, ''), ?) AS subdomain_domain,
            COALESCE(NULLIF(w.visibility, ''), ?) AS visibility,
            COALESCE(w.hide_watermark, 0) AS hide_watermark,
            b.origin_host AS origin_host
     FROM custom_domains cd
     JOIN custom_domain_routes r ON r.custom_domain_id = cd.id
     JOIN websites w ON w.id = r.website_id AND w.project_id = cd.project_id
     LEFT JOIN storage_buckets b ON b.id = w.bucket_id`;
  const exact = await query(
    `${selectSql} WHERE cd.hostname = ? AND r.label = '' LIMIT 1`,
    [defaultDomain, VISIBILITY_PUBLIC, host]
  );
  if (exact[0]) return exact[0];
  const suffix = await query(
    `${selectSql}
     WHERE r.label != '' AND ? = CONCAT(r.label, '.', cd.hostname)
     ORDER BY CHAR_LENGTH(cd.hostname) DESC
     LIMIT 1`,
    [defaultDomain, VISIBILITY_PUBLIC, host]
  );
  return suffix[0] || null;
}

async function handleResolveSubdomain(event) {
  const body = event.body || event;
  let { subdomain, domain } = body;
  const requestedHost = normalizeCustomHostname(body.host);
  if (requestedHost && !subdomain) {
    const parsed = parseOfficialHost(requestedHost);
    if (parsed) {
      subdomain = parsed.label;
      domain = parsed.domain;
    } else {
      try {
        const site = await resolveSiteMetadataByCustomHost(requestedHost);
        if (!site || !site.path) {
          return {
            statusCode: 200,
            headers: getCORSHeaders(),
            body: JSON.stringify({ success: false, message: 'not found' })
          };
        }
        return {
          statusCode: 200,
          headers: getCORSHeaders(),
          body: JSON.stringify(resolveSitePayload(site, requestedHost, null))
        };
      } catch (error) {
        console.error('解析自定义域名失败:', error);
        return {
          statusCode: 200,
          headers: getCORSHeaders(),
          body: JSON.stringify({ success: false, message: error.message })
        };
      }
    }
  }
  const label = String(subdomain || '').trim().toLowerCase();
  const suffix = normalizeOfficialDomain(domain);

  if (!label) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: 'Missing subdomain' })
    };
  }
  if (!suffix) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: 'unsupported official domain' })
    };
  }

  try {
    await ensureSeoColumns();
    await ensureWatermarkColumn();
    const site = await resolveSiteMetadataByLabel(label, suffix);
    if (!site || !site.path) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, message: 'not found' })
      };
    }
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify(resolveSitePayload(site, `${label}.${suffix}`, suffix))
    };
  } catch (error) {
    console.error('解析子域名失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: error.message })
    };
  }
}

/**
 * 边缘函数调用：检查当前 token 是否可访问 label 对应站点。
 * public 永远允许；private 仅站点 owner、平台 admin 或项目成员可访问。
 */
async function handleCheckSiteAccess(event) {
  const body = event.body || event;
  let label = String(body.label || body.subdomain || '').trim().toLowerCase();
  let domain = body.domain || body.subdomainDomain || body.subdomain_domain;
  if (body.host && !label) {
    const parsed = parseOfficialHost(body.host);
    if (parsed) {
      label = parsed.label;
      domain = parsed.domain;
    }
  }
  const suffix = normalizeOfficialDomain(domain);
  try {
    let site = null;
    if (label && suffix) {
      site = await resolveSiteMetadataByLabel(label, suffix);
    } else if (body.host && !parseOfficialHost(body.host)) {
      site = await resolveSiteMetadataByCustomHost(body.host);
    } else {
      if (!label) return ok({ success: false, allowed: false, message: 'Missing label' });
      return ok({ success: false, allowed: false, message: 'Unsupported official domain' });
    }
    if (!site || !site.path) {
      return ok({ success: true, allowed: false, reason: 'not_found' });
    }

    const visibility = normalizeVisibility(site.visibility);
    if (visibility === VISIBILITY_DISABLED) {
      return ok({ success: true, allowed: false, visibility, reason: 'disabled' });
    }
    if (visibility !== VISIBILITY_PRIVATE) {
      return ok({ success: true, allowed: true, visibility });
    }

    const user = authenticate(event);
    if (!user || !user.userId) {
      return ok({
        success: true,
        allowed: false,
        visibility,
        loginRequired: true,
        reason: 'login_required'
      });
    }

    if (String(user.userId) === String(site.user_id)) {
      return ok({ success: true, allowed: true, visibility, role: 'owner' });
    }

    const isAdmin = await checkAdmin(user.userId);
    if (isAdmin) {
      markAdminAction(event, user.userId, 'override');
      return ok({ success: true, allowed: true, visibility, role: 'platform_admin' });
    }

    if (site.project_id) {
      const role = await getProjectRoleForUser(user.userId, site.project_id);
      if (role) {
        return ok({ success: true, allowed: true, visibility, role });
      }
    }

    return ok({
      success: true,
      allowed: false,
      visibility,
      loginRequired: false,
      reason: 'forbidden'
    });
  } catch (error) {
    console.error('检查站点访问权限失败:', error);
    return ok({ success: false, allowed: false, message: error.message });
  }
}


function normalizeAnalyticsEventType(input) {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'badge_click') return 'badge_click';
  if (value === 'scanner_probe') return 'scanner_probe';
  return 'view';
}

function normalizeAnalyticsWebsiteId(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function normalizeAnalyticsPath(input) {
  const value = String(input || '/').trim() || '/';
  const pathOnly = value.split('#')[0].split('?')[0] || '/';
  return pathOnly.startsWith('/') ? pathOnly.slice(0, 512) : `/${pathOnly.slice(0, 511)}`;
}


function isScannerProbePath(input) {
  const value = normalizeAnalyticsPath(input).toLowerCase();
  return (
    value === '/xmlrpc' ||
    value === '/xmlrpc.php' ||
    value === '/wp-login' ||
    value === '/wp-login.php' ||
    value.startsWith('/wp-admin') ||
    value.startsWith('/wp-content') ||
    value.startsWith('/wp-includes') ||
    value === '/.env' ||
    value.startsWith('/.git') ||
    value.includes('/phpmyadmin') ||
    value.includes('/phpinfo') ||
    value.includes('/vendor/phpunit')
  );
}

function scannerPathSqlPredicate(columnName = 'path') {
  return `NOT (
    ${columnName} IN ('/xmlrpc', '/xmlrpc.php', '/wp-login', '/wp-login.php', '/.env') OR
    ${columnName} LIKE '/wp-admin%' OR
    ${columnName} LIKE '/wp-content%' OR
    ${columnName} LIKE '/wp-includes%' OR
    ${columnName} LIKE '/.git%' OR
    ${columnName} LIKE '%/phpmyadmin%' OR
    ${columnName} LIKE '%/phpinfo%' OR
    ${columnName} LIKE '%/vendor/phpunit%'
  )`;
}

function maskIpForDisplay(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.includes(':')) {
    const parts = value.split(':');
    return parts.slice(0, 3).join(':') + ':****';
  }
  const parts = value.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`;
  return '已留档';
}

function normalizeReferrerHost(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'direct';
  try {
    const u = new URL(raw);
    return (u.hostname || 'direct').toLowerCase().replace(/^www\./, '').slice(0, 255) || 'direct';
  } catch (e) {
    return raw.toLowerCase().replace(/^www\./, '').slice(0, 255) || 'direct';
  }
}

function normalizeCountry(input) {
  const value = String(input || '').trim().toUpperCase();
  if (!value || value === 'XX' || value === 'UNKNOWN') return 'UNKNOWN';
  return /^[A-Z]{2}$/.test(value) ? value : 'UNKNOWN';
}

function normalizeProvince(input) {
  const value = String(input || '').trim();
  if (!value || value.toUpperCase() === 'UNKNOWN') return 'UNKNOWN';
  return value.replace(/[\u0000-\u001f<>]/g, '').slice(0, 64) || 'UNKNOWN';
}

const CN_REGION_NAMES = {
  AH: 'Anhui',
  BJ: 'Beijing',
  CQ: 'Chongqing',
  FJ: 'Fujian',
  GD: 'Guangdong',
  GS: 'Gansu',
  GX: 'Guangxi',
  GZ: 'Guizhou',
  HA: 'Henan',
  HB: 'Hubei',
  HE: 'Hebei',
  HI: 'Hainan',
  HK: 'Hong Kong',
  HL: 'Heilongjiang',
  HN: 'Hunan',
  JL: 'Jilin',
  JS: 'Jiangsu',
  JX: 'Jiangxi',
  LN: 'Liaoning',
  MO: 'Macao',
  NM: 'Inner Mongolia',
  NX: 'Ningxia',
  QH: 'Qinghai',
  SC: 'Sichuan',
  SD: 'Shandong',
  SH: 'Shanghai',
  SN: 'Shaanxi',
  SX: 'Shanxi',
  TJ: 'Tianjin',
  TW: 'Taiwan',
  XJ: 'Xinjiang',
  XZ: 'Tibet',
  YN: 'Yunnan',
  ZJ: 'Zhejiang'
};

function isPrivateIp(input) {
  const ip = String(input || '').trim();
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127 ||
    parts[0] === 0
  );
}

function lookupGeoByIp(input) {
  const ip = String(input || '').split(',')[0].trim();
  if (!ip || isPrivateIp(ip)) return { country: 'UNKNOWN', province: 'UNKNOWN' };
  const geo = getGeoip();
  if (!geo) return { country: 'UNKNOWN', province: 'UNKNOWN' };
  try {
    const hit = geo.lookup(ip);
    if (!hit) return { country: 'UNKNOWN', province: 'UNKNOWN' };
    const country = normalizeCountry(hit.country);
    const region = String(hit.region || '').trim();
    const province = country === 'CN' && CN_REGION_NAMES[region]
      ? CN_REGION_NAMES[region]
      : (region || hit.city || 'UNKNOWN');
    return { country, province: normalizeProvince(province) };
  } catch (e) {
    return { country: 'UNKNOWN', province: 'UNKNOWN' };
  }
}

function hashAnalyticsValue(input) {
  const raw = String(input || '');
  if (!raw) return '';
  const salt = process.env.ANALYTICS_HASH_SALT || process.env.JWT_SECRET || 'demox-analytics';
  return nodeCrypto.createHash('sha256').update(`${salt}:${raw}`).digest('hex');
}

function getClientIp(event) {
  const headers = event.headers || {};
  const value = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || headers['x-real-ip'] || headers['X-Real-IP'] || event.requestContext?.sourceIp || '';
  return String(value).split(',')[0].trim();
}

function safeDecrypt(value) {
  try {
    return decrypt(value) || '';
  } catch (e) {
    return '';
  }
}

function safeEncrypt(value) {
  try {
    return encrypt(value);
  } catch (e) {
    console.warn('加密统计敏感字段失败:', e.message);
    return null;
  }
}

function analyticsTokenAllowed(event) {
  const expected = process.env.ANALYTICS_TRACK_TOKEN || '';
  if (!expected) return true;
  const body = event.body || event;
  // Badge clicks are emitted from the public hosted page, so they cannot carry a secret.
  if (normalizeAnalyticsEventType(body.type || body.eventType) === 'badge_click') return true;
  const headers = event.headers || {};
  const provided = body.analyticsToken || headers['x-demox-analytics-token'] || headers['X-Demox-Analytics-Token'] || '';
  return String(provided) === expected;
}

async function writeRawAnalyticsEvent(event) {
  if (process.env.ANALYTICS_RAW_ENABLED !== '1') return { skipped: true, reason: 'disabled' };
  const bucketId = normalizePositiveId(process.env.ANALYTICS_RAW_BUCKET_ID);
  if (!bucketId) {
    // Raw analytics can contain sensitive referrer/UA metadata, so require an explicit private bucket.
    return { skipped: true, reason: 'missing ANALYTICS_RAW_BUCKET_ID' };
  }
  try {
    const bucketCfg = await resolveBucketConfig(bucketId);
    const provider = createProvider(buckets.resolveCreds(bucketCfg));
    const d = new Date(event.ts || Date.now());
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const rand = nodeCrypto.randomBytes(6).toString('hex');
    const key = `analytics/raw/date=${yyyy}-${mm}-${dd}/hour=${hh}/${event.websiteId}-${event.ts}-${rand}.ndjson`;
    await provider.put(key, `${JSON.stringify(event)}\n`, {
      contentType: 'application/x-ndjson; charset=utf-8',
      cacheControl: 'private, max-age=0, no-store'
    });
    return { skipped: false, key };
  } catch (e) {
    console.warn('写入原始统计事件失败:', e.message);
    return { skipped: true, reason: e.message };
  }
}

async function handleTrackSiteEvent(event) {
  const body = event.body || event;
  if (!analyticsTokenAllowed(event)) return ok({ success: false, message: 'invalid analytics token' });

  const websiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  if (!websiteId) return ok({ success: false, message: 'missing websiteId' });

  const requestedType = normalizeAnalyticsEventType(body.type || body.eventType);
  const pathValue = normalizeAnalyticsPath(body.path || body.pathname || '/');
  const type = requestedType === 'view' && isScannerProbePath(pathValue) ? 'scanner_probe' : requestedType;
  const ua = String(body.userAgent || body.ua || '').slice(0, 512);
  const clientIp = String(body.ip || getClientIp(event) || '').trim().slice(0, 128);
  const geoFromIp = lookupGeoByIp(clientIp);
  const country = normalizeCountry(body.country || body.countryCode);
  const province = normalizeProvince(body.province || body.region || body.subdivision);
  const finalCountry = country === 'UNKNOWN' ? geoFromIp.country : country;
  const finalProvince = province === 'UNKNOWN' ? geoFromIp.province : province;
  const referrerHost = normalizeReferrerHost(body.referrer || body.referer || '');
  const ipHash = hashAnalyticsValue(clientIp);
  const visitorHash = hashAnalyticsValue(body.visitorId || `${ipHash}:${ua}`);
  const statDate = statTime.statDateKey(Date.now());

  try {
    const raw = await writeRawAnalyticsEvent({
      ts: Date.now(),
      websiteId,
      type,
      path: pathValue,
      referrer: String(body.referrer || body.referer || '').slice(0, 1024),
      referrerHost,
      country: finalCountry,
      province: finalProvince,
      userAgent: ua,
      ipEnc: safeEncrypt(clientIp),
      visitorHash,
      host: String(body.host || '').slice(0, 255)
    });

    return ok({ success: true, raw, delayed: true, delayMinutes: 5, statDate });
  } catch (error) {
    console.error('记录站点统计失败:', error);
    return ok({ success: false, message: error.message });
  }
}

const SITE_REPORT_REASONS = new Set(['porn', 'illegal', 'violence', 'spam', 'ip', 'other']);
let _siteReportsTableEnsured = false;

async function ensureSiteReportsTable() {
  if (_siteReportsTableEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS site_reports (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      website_id VARCHAR(32) NOT NULL,
      reason VARCHAR(16) NOT NULL,
      note VARCHAR(200) NOT NULL DEFAULT '',
      page_url VARCHAR(1024) NOT NULL DEFAULT '',
      host VARCHAR(255) NOT NULL DEFAULT '',
      ip_hash CHAR(64) NOT NULL DEFAULT '',
      user_agent VARCHAR(512) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_reports_site_time (website_id, created_at),
      INDEX idx_reports_ip_time (ip_hash, created_at),
      INDEX idx_reports_status_time (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  _siteReportsTableEnsured = true;
}

async function handleReportSite(event) {
  const body = event.body || event;
  const websiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  const reason = String(body.reason || '').trim().toLowerCase();
  if (!websiteId || !SITE_REPORT_REASONS.has(reason)) {
    return ok({ success: false, message: 'invalid report' });
  }

  const note = String(body.note || '').trim().slice(0, 200);
  const pageUrl = String(body.pageUrl || body.url || '').trim().slice(0, 1024);
  const host = String(body.host || '').trim().slice(0, 255);
  const ua = String(body.userAgent || body.ua || '').slice(0, 512);
  const ipHash = hashAnalyticsValue(getClientIp(event));

  try {
    await ensureSiteReportsTable();
    const site = await getWebsiteByIdentity({ websiteId });
    if (!site) return ok({ success: false, message: 'site not found' });

    const hourly = await query(
      'SELECT COUNT(*) AS n FROM site_reports WHERE ip_hash = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
      [ipHash]
    );
    if (Number(hourly[0] && hourly[0].n || 0) >= 8) {
      return ok({ success: false, message: 'too many reports' });
    }
    const dup = await query(
      `SELECT id FROM site_reports
       WHERE website_id = ? AND ip_hash = ? AND reason = ?
         AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
       LIMIT 1`,
      [websiteId, ipHash, reason]
    );
    if (dup.length) return ok({ success: true, duplicate: true });

    const inserted = await query(
      `INSERT INTO site_reports (website_id, reason, note, page_url, host, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [websiteId, reason, note, pageUrl, host, ipHash, ua]
    );
    notifySiteReport({
      id: inserted && inserted.insertId,
      websiteId,
      reason,
      note,
      pageUrl,
      host
    }).catch((e) => console.warn('举报通知失败:', e.message));
    return ok({ success: true });
  } catch (error) {
    console.error('记录站点举报失败:', error);
    return ok({ success: false, message: error.message });
  }
}

async function handleListSiteReports(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const body = event.body || event;
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 50, 1), 200);
  const status = String(body.status || 'open').trim().toLowerCase();
  try {
    await ensureSiteReportsTable();
    const rows = await query(
      `SELECT r.id, r.website_id, r.reason, r.note, r.page_url, r.host, r.status, r.created_at,
              w.name AS site_name, w.url AS site_url, w.subdomain, w.visibility
       FROM site_reports r
       LEFT JOIN websites w ON w.website_id = r.website_id
       WHERE (? = 'all' OR r.status = ?)
       ORDER BY r.id DESC
       LIMIT ?`,
      [status, status, limit]
    );
    return ok({ success: true, data: rows });
  } catch (error) {
    console.error('列出站点举报失败:', error);
    return ok({ success: false, message: error.message });
  }
}

async function handleUpdateSiteReport(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const body = event.body || event;
  const id = parseInt(body.id, 10);
  const status = String(body.status || '').trim().toLowerCase();
  if (!id || !['open', 'reviewed'].includes(status)) {
    return ok({ success: false, message: 'invalid report update' });
  }
  try {
    await ensureSiteReportsTable();
    await query('UPDATE site_reports SET status = ? WHERE id = ?', [status, id]);
    return ok({ success: true });
  } catch (error) {
    console.error('更新站点举报失败:', error);
    return ok({ success: false, message: error.message });
  }
}

async function notifySiteReport(row) {
  const hook = String(process.env.REPORT_NOTIFY_WEBHOOK || '').trim();
  if (!hook) return;
  const text = [
    `Demox 站点举报${row.id ? ' #' + row.id : ''}`,
    `${row.reason} · ${row.websiteId}`,
    row.pageUrl || row.host || '',
    row.note || ''
  ].filter(Boolean).join('\n');
  const payload = /feishu|larkoffice|lark\.cn/i.test(hook)
    ? { msg_type: 'text', content: { text } }
    : { text, ...row };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeStatsRange(input) {
  const n = Number.parseInt(String(input || '7'), 10);
  if (!Number.isFinite(n)) return 7;
  return Math.max(1, Math.min(n, 90));
}

async function handleGetSiteStats(event) {
  const userId = getUserId(event);
  if (!userId) return { statusCode: 401, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '未登录或token已过期' }) };

  const body = event.body || event;
  const websiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  const days = normalizeStatsRange(body.days || body.range);
  if (!websiteId) return ok({ success: false, message: 'missing websiteId' });

  const site = await getWebsiteByIdentity({ websiteId });
  if (!site || !(await canUserReadSite(userId, site))) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '无权限查看该站点统计' }) };
  }
  if (!(await hasProOrAboveRole(userId))) {
    return proFeatureDenied('ANALYTICS_ROLE_REQUIRED', '仅专业用户及以上可以查看网站分析');
  }

  try {
    const cleanDailyViews = await query(
      `SELECT stat_date, SUM(views) AS views
       FROM site_path_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
         AND ${scannerPathSqlPredicate('path')}
       GROUP BY stat_date
       ORDER BY stat_date ASC`,
      [websiteId, days - 1]
    );
    const dailyBadges = await query(
      `SELECT stat_date, badge_clicks
       FROM site_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
       ORDER BY stat_date ASC`,
      [websiteId, days - 1]
    );
    const cleanTotals = await query(
      `SELECT COALESCE(SUM(views), 0) AS views
       FROM site_path_daily_stats
       WHERE website_id = ? AND ${scannerPathSqlPredicate('path')}`,
      [websiteId]
    );
    const badgeTotals = await query(
      `SELECT COALESCE(SUM(badge_clicks), 0) AS badge_clicks
       FROM site_daily_stats
       WHERE website_id = ?`,
      [websiteId]
    );
    const referrers = await query(
      `SELECT referrer_host, SUM(views) AS views
       FROM site_referrer_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
       GROUP BY referrer_host
       ORDER BY views DESC
       LIMIT 10`,
      [websiteId, days - 1]
    );
    const paths = await query(
      `SELECT path, SUM(views) AS views
       FROM site_path_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
       GROUP BY path
       ORDER BY views DESC
       LIMIT 50`,
      [websiteId, days - 1]
    );
    const countries = await query(
      `SELECT country, SUM(views) AS views
       FROM site_country_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
         AND country <> 'UNKNOWN'
       GROUP BY country
       ORDER BY views DESC
       LIMIT 10`,
      [websiteId, days - 1]
    );
    const provinces = await query(
      `SELECT country, province, SUM(views) AS views
       FROM site_province_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(${STAT_TODAY_SQL}, INTERVAL ? DAY)
         AND country <> 'UNKNOWN' AND province <> 'UNKNOWN'
       GROUP BY country, province
       ORDER BY views DESC
       LIMIT 20`,
      [websiteId, days - 1]
    );

    return ok({
      success: true,
      websiteId,
      rangeDays: days,
      totals: {
        views: Number(cleanTotals[0]?.views || 0),
        badgeClicks: Number(badgeTotals[0]?.badge_clicks || 0)
      },
      daily: cleanDailyViews.map((r) => {
        const date = r.stat_date instanceof Date ? r.stat_date.toISOString().slice(0, 10) : String(r.stat_date).slice(0, 10);
        const badgeRow = dailyBadges.find((b) => (b.stat_date instanceof Date ? b.stat_date.toISOString().slice(0, 10) : String(b.stat_date).slice(0, 10)) === date);
        return { date, views: Number(r.views || 0), badgeClicks: Number(badgeRow?.badge_clicks || 0) };
      }),
      referrers: referrers.map((r) => ({ host: r.referrer_host || 'direct', views: Number(r.views || 0) })),
      paths: paths
        .map((r) => ({ path: r.path || '/', views: Number(r.views || 0) }))
        .filter((r) => !isScannerProbePath(r.path))
        .slice(0, 10),
      countries: countries.map((r) => ({ country: r.country || 'UNKNOWN', views: Number(r.views || 0) })),
      provinces: provinces.map((r) => ({ country: r.country || 'UNKNOWN', province: r.province || 'UNKNOWN', views: Number(r.views || 0) }))
    });
  } catch (error) {
    console.error('查询站点统计失败:', error);
    return ok({ success: false, message: error.message });
  }
}

function normalizeAccessLogLimit(input) {
  const n = Number.parseInt(String(input || '100'), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(n, 500));
}

function normalizeAccessLogPage(input) {
  const n = Number.parseInt(String(input || '1'), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, n);
}

function normalizeAccessLogPageSize(input) {
  const n = Number.parseInt(String(input || '10'), 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(n, 100));
}

async function ensureColumn(tableName, columnName, alterSql, steps = []) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  if (!Number(rows[0]?.c || 0)) {
    await query(alterSql);
    steps.push(`added ${tableName}.${columnName}`);
  }
}

function listUtcDateKeys(days) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function listUtcHourPrefixes(hours) {
  const out = new Set();
  const now = new Date();
  for (let i = 0; i < hours; i += 1) {
    const d = new Date(now);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() - i);
    const date = d.toISOString().slice(0, 10);
    const hour = String(d.getUTCHours()).padStart(2, '0');
    out.add(`analytics/raw/date=${date}/hour=${hour}/`);
  }
  return Array.from(out);
}

function parseRawAnalyticsLine(line) {
  try {
    const item = JSON.parse(line);
    if (!item || typeof item !== 'object') return null;
    return item;
  } catch (e) {
    return null;
  }
}

function normalizeRollupHours(input) {
  const n = Number.parseInt(String(input || '2'), 10);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(n, 48));
}

function normalizeRollupLimit(input) {
  const n = Number.parseInt(String(input || '2000'), 10);
  if (!Number.isFinite(n)) return 2000;
  return Math.max(1, Math.min(n, 10000));
}

function isAnalyticsRollupTimerEvent(event) {
  const triggerName = String(event.TriggerName || event.triggerName || '');
  const type = String(event.Type || event.type || '');
  return type.toLowerCase() === 'timer' && /analytics.*rollup|rollup.*analytics/i.test(triggerName);
}

function analyticsRollupAllowed(event) {
  if (isAnalyticsRollupTimerEvent(event)) return true;
  const body = getRollupRequestBody(event);
  const headers = event.headers || {};
  const expected = process.env.ANALYTICS_ROLLUP_KEY || '';
  const provided = body.rollupKey || headers['x-demox-rollup-key'] || headers['X-Demox-Rollup-Key'] || '';
  return !!expected && String(provided) === expected;
}

function getRollupRequestBody(event) {
  const base = event.body && typeof event.body === 'object' ? event.body : event;
  const rawCustom = event.CustomArgument || event.customArgument || event.Message || event.message || '';
  if (typeof rawCustom === 'string' && rawCustom.trim().startsWith('{')) {
    try {
      return { ...base, ...JSON.parse(rawCustom) };
    } catch (e) {
      return base;
    }
  }
  return base;
}

function addRollupCount(map, keyParts, field, amount) {
  const key = keyParts.join('\u0001');
  const current = map.get(key) || { keyParts, views: 0, badgeClicks: 0 };
  current[field] += amount;
  map.set(key, current);
}

function normalizeRawAnalyticsEvent(item) {
  const websiteId = normalizeAnalyticsWebsiteId(item.websiteId || item.website_id);
  if (!websiteId) return null;
  const rawIp = item.ipEnc ? safeDecrypt(item.ipEnc) : item.ip;
  const pathValue = normalizeAnalyticsPath(item.path || '/');
  const requestedType = normalizeAnalyticsEventType(item.type || item.eventType);
  const type = requestedType === 'view' && isScannerProbePath(pathValue) ? 'scanner_probe' : requestedType;
  const ts = Number(item.ts || 0) || Date.now();
  // UTC+8 切日（见 statTime）；历史 UTC 日期行不回写。
  const statDate = statTime.statDateKey(ts);
  const geoFromIp = lookupGeoByIp(rawIp);
  const country = normalizeCountry(item.country || item.countryCode);
  const province = normalizeProvince(item.province || item.region || item.subdivision);
  return {
    websiteId,
    type,
    statDate,
    path: pathValue,
    referrer: String(item.referrer || item.referer || '').slice(0, 1024),
    referrerHost: normalizeReferrerHost(item.referrerHost || item.referrer || ''),
    country: country === 'UNKNOWN' ? geoFromIp.country : country,
    province: province === 'UNKNOWN' ? geoFromIp.province : province,
    host: String(item.host || '').slice(0, 255),
    userAgent: String(item.userAgent || item.ua || '').slice(0, 512),
    ipArchived: !!item.ipEnc,
    ipMasked: maskIpForDisplay(rawIp),
    ts
  };
}

async function listRawAnalyticsObjects(provider, body) {
  const limit = normalizeRollupLimit(body.limit || body.maxObjects);
  const prefixes = body.days
    ? listUtcDateKeys(normalizeStatsRange(body.days)).map((date) => `analytics/raw/date=${date}/`)
    : listUtcHourPrefixes(normalizeRollupHours(body.hours));
  const objects = [];
  for (const prefix of prefixes) {
    const items = await provider.list(prefix);
    for (const item of items) {
      if (String(item.key || '').endsWith('.ndjson')) objects.push(item);
    }
  }
  objects.sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')));
  return objects.slice(0, limit);
}

async function upsertAnalyticsRollups(conn, rollups) {
  for (const item of rollups.daily.values()) {
    await conn.query(
      `INSERT INTO site_daily_stats (website_id, stat_date, views, badge_clicks, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         views = views + VALUES(views),
         badge_clicks = badge_clicks + VALUES(badge_clicks),
         updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.views, item.badgeClicks]
    );
  }
  for (const item of rollups.referrers.values()) {
    await conn.query(
      `INSERT INTO site_referrer_daily_stats (website_id, stat_date, referrer_host, views, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE views = views + VALUES(views), updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.keyParts[2], item.views]
    );
  }
  for (const item of rollups.paths.values()) {
    await conn.query(
      `INSERT INTO site_path_daily_stats (website_id, stat_date, path, views, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE views = views + VALUES(views), updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.keyParts[2], item.views]
    );
  }
  for (const item of rollups.countries.values()) {
    await conn.query(
      `INSERT INTO site_country_daily_stats (website_id, stat_date, country, views, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE views = views + VALUES(views), updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.keyParts[2], item.views]
    );
  }
  for (const item of rollups.provinces.values()) {
    await conn.query(
      `INSERT INTO site_province_daily_stats (website_id, stat_date, country, province, views, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE views = views + VALUES(views), updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.keyParts[2], item.keyParts[3], item.views]
    );
  }
  for (const item of rollups.accessLogs || []) {
    await conn.query(
      `INSERT IGNORE INTO site_access_logs
        (object_key, website_id, event_ts, event_type, host, path, referrer, referrer_host,
         country, province, ip_masked, ip_archived, user_agent, created_at)
       VALUES (?, ?, FROM_UNIXTIME(? / 1000), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        item.objectKey,
        item.websiteId,
        item.ts,
        item.type,
        item.host,
        item.path,
        item.referrer,
        item.referrerHost,
        item.country,
        item.province,
        item.ipMasked,
        item.ipArchived ? 1 : 0,
        item.userAgent
      ]
    );
  }
}

async function handleRollupSiteAnalytics(event) {
  if (!analyticsRollupAllowed(event)) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '无权限执行统计聚合' }) };
  }

  const bucketId = normalizePositiveId(process.env.ANALYTICS_RAW_BUCKET_ID);
  if (process.env.ANALYTICS_RAW_ENABLED !== '1' || !bucketId) {
    return ok({ success: false, message: '原始访问日志未启用，无法延迟聚合' });
  }

  const body = getRollupRequestBody(event);
  try {
    const bucketCfg = await resolveBucketConfig(bucketId);
    const provider = createProvider(buckets.resolveCreds(bucketCfg));
    const objects = await listRawAnalyticsObjects(provider, body);
    let candidates = [];
    for (const obj of objects) {
      if (Number(obj.size || 0) > 256 * 1024) continue;
      const text = await provider.get(obj.key);
      const lines = String(text || '').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const item = normalizeRawAnalyticsEvent(parseRawAnalyticsLine(line) || {});
        if (!item) continue;
        candidates.push({ key: obj.key, item });
      }
    }
    const websiteIds = Array.from(new Set(candidates.map((c) => c.item.websiteId)));
    if (websiteIds.length) {
      const validRows = await query(
        `SELECT website_id FROM websites WHERE website_id IN (${websiteIds.map(() => '?').join(',')})`,
        websiteIds
      );
      const validIds = new Set(validRows.map((r) => String(r.website_id || '')));
      candidates = candidates.filter((c) => validIds.has(c.item.websiteId));
    }

    const summary = await transaction(async (conn) => {
      const rollups = {
        daily: new Map(),
        referrers: new Map(),
        paths: new Map(),
        countries: new Map(),
        provinces: new Map(),
        accessLogs: []
      };
      let processed = 0;
      let skipped = 0;

      for (const candidate of candidates) {
        const { key, item } = candidate;
        const [insertResult] = await conn.query(
          `INSERT IGNORE INTO site_analytics_ingested_events (object_key, website_id, event_ts, created_at)
           VALUES (?, ?, FROM_UNIXTIME(? / 1000), NOW())`,
          [key, item.websiteId, item.ts]
        );
        if (!insertResult.affectedRows) {
          skipped += 1;
          continue;
        }
        processed += 1;
        if (item.type === 'badge_click') {
          addRollupCount(rollups.daily, [item.websiteId, item.statDate], 'badgeClicks', 1);
        } else if (item.type === 'view') {
          rollups.accessLogs.push({ objectKey: key, ...item });
          addRollupCount(rollups.daily, [item.websiteId, item.statDate], 'views', 1);
          addRollupCount(rollups.referrers, [item.websiteId, item.statDate, item.referrerHost], 'views', 1);
          addRollupCount(rollups.paths, [item.websiteId, item.statDate, item.path], 'views', 1);
          addRollupCount(rollups.countries, [item.websiteId, item.statDate, item.country], 'views', 1);
          addRollupCount(rollups.provinces, [item.websiteId, item.statDate, item.country, item.province], 'views', 1);
        }
      }

      await upsertAnalyticsRollups(conn, rollups);
      return {
        processed,
        skipped,
        rollups: {
          daily: rollups.daily.size,
          referrers: rollups.referrers.size,
          paths: rollups.paths.size,
          countries: rollups.countries.size,
          provinces: rollups.provinces.size,
          accessLogs: rollups.accessLogs.length
        }
      };
    });

    return ok({ success: true, delayed: true, delayMinutes: 5, scanned: objects.length, candidates: candidates.length, ...summary });
  } catch (error) {
    console.error('延迟聚合站点统计失败:', error);
    return ok({ success: false, message: error.message });
  }
}

async function handleBackfillSiteAnalyticsGeo(event) {
  if (!analyticsRollupAllowed(event)) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '无权限执行地区回填' }) };
  }

  const bucketId = normalizePositiveId(process.env.ANALYTICS_RAW_BUCKET_ID);
  if (process.env.ANALYTICS_RAW_ENABLED !== '1' || !bucketId) {
    return ok({ success: false, message: '原始访问日志未启用，无法回填地区' });
  }

  const body = getRollupRequestBody(event);
  const requestedWebsiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  try {
    const bucketCfg = await resolveBucketConfig(bucketId);
    const provider = createProvider(buckets.resolveCreds(bucketCfg));
    const objects = await listRawAnalyticsObjects(provider, body);
    let candidates = [];
    for (const obj of objects) {
      if (Number(obj.size || 0) > 256 * 1024) continue;
      const text = await provider.get(obj.key);
      const lines = String(text || '').split(/\r?\n/).filter(Boolean);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const item = normalizeRawAnalyticsEvent(parseRawAnalyticsLine(line) || {});
        if (!item || item.type !== 'view') continue;
        if (requestedWebsiteId && item.websiteId !== requestedWebsiteId) continue;
        candidates.push({ key: `${obj.key}#${lineIndex}`, item });
      }
    }

    const websiteIds = Array.from(new Set(candidates.map((candidate) => candidate.item.websiteId)));
    if (websiteIds.length) {
      const validRows = await query(
        `SELECT website_id FROM websites WHERE website_id IN (${websiteIds.map(() => '?').join(',')})`,
        websiteIds
      );
      const validIds = new Set(validRows.map((r) => String(r.website_id || '')));
      candidates = candidates.filter((candidate) => validIds.has(candidate.item.websiteId));
    }

    const affectedKeys = new Map();
    const rollups = {
      daily: new Map(),
      referrers: new Map(),
      paths: new Map(),
      countries: new Map(),
      provinces: new Map(),
      accessLogs: []
    };
    for (const candidate of candidates) {
      const { key, item } = candidate;
      affectedKeys.set(`${item.websiteId}\u0001${item.statDate}`, [item.websiteId, item.statDate]);
      rollups.accessLogs.push({
        objectKey: key,
        ...item
      });
      if (item.country !== 'UNKNOWN') {
        addRollupCount(rollups.countries, [item.websiteId, item.statDate, item.country], 'views', 1);
      }
      if (item.country !== 'UNKNOWN' && item.province !== 'UNKNOWN') {
        addRollupCount(rollups.provinces, [item.websiteId, item.statDate, item.country, item.province], 'views', 1);
      }
    }

    const summary = await transaction(async (conn) => {
      for (const [websiteId, statDate] of affectedKeys.values()) {
        await conn.query(
          `DELETE FROM site_country_daily_stats WHERE website_id = ? AND stat_date = ?`,
          [websiteId, statDate]
        );
        await conn.query(
          `DELETE FROM site_province_daily_stats WHERE website_id = ? AND stat_date = ?`,
          [websiteId, statDate]
        );
      }
      await upsertAnalyticsRollups(conn, rollups);
      return {
        dates: affectedKeys.size,
        countryRows: rollups.countries.size,
        provinceRows: rollups.provinces.size,
        accessLogRows: rollups.accessLogs.length
      };
    });

    return ok({
      success: true,
      scanned: objects.length,
      candidates: candidates.length,
      websiteId: requestedWebsiteId || null,
      ...summary
    });
  } catch (error) {
    console.error('回填站点地区统计失败:', error);
    return ok({ success: false, message: error.message });
  }
}

async function handleGetSiteAccessLogs(event) {
  const userId = getUserId(event);
  if (!userId) return { statusCode: 401, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '未登录或token已过期' }) };

  const body = event.body || event;
  const websiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  const days = normalizeStatsRange(body.days || body.range || 7);
  const page = normalizeAccessLogPage(body.page);
  const pageSize = normalizeAccessLogPageSize(body.pageSize || body.page_size || body.limit);
  const offset = (page - 1) * pageSize;
  if (!websiteId) return ok({ success: false, message: 'missing websiteId' });

  const site = await getWebsiteByIdentity({ websiteId });
  if (!site || !(await canUserReadSite(userId, site))) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '无权限查看该站点访问日志' }) };
  }
  if (!(await hasProOrAboveRole(userId))) {
    return proFeatureDenied('ANALYTICS_ROLE_REQUIRED', '仅专业用户及以上可以查看网站分析');
  }

  try {
    const totalRows = await query(
      `SELECT COUNT(*) AS total
       FROM site_access_logs
       WHERE website_id = ? AND event_ts >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [websiteId, days]
    );
    const rows = await query(
      `SELECT event_ts, event_type, host, path, referrer, referrer_host,
              country, province, ip_masked, ip_archived, user_agent
       FROM site_access_logs
       WHERE website_id = ? AND event_ts >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY event_ts DESC
       LIMIT ? OFFSET ?`,
      [websiteId, days, pageSize, offset]
    );
    const logs = rows.map((row) => ({
      ts: row.event_ts instanceof Date ? row.event_ts.getTime() : (row.event_ts ? new Date(row.event_ts).getTime() : null),
      type: row.event_type || 'view',
      host: row.host || '',
      path: row.path || '/',
      referrer: row.referrer || '',
      referrerHost: row.referrer_host || 'direct',
      country: row.country || 'UNKNOWN',
      province: row.province || 'UNKNOWN',
      ip: row.ip_masked || '',
      ipArchived: !!row.ip_archived,
      userAgent: row.user_agent || ''
    }));
    const total = Number(totalRows[0]?.total || 0);
    return ok({
      success: true,
      websiteId,
      rangeDays: days,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      logs
    });
  } catch (error) {
    console.error('查询站点访问日志失败:', error);
    return ok({ success: false, message: error.message });
  }
}

/**
 * 确保用户有 default 项目。项目表未迁移时静默降级，避免影响部署主流程。
 * @returns {Promise<number|null>} default project id
 */
async function ensureDefaultProjectForUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  try {
    const projectKey = await createUniqueProjectKey();
    await query(
      `INSERT INTO projects (project_key, user_id, name, slug)
       VALUES (?, ?, 'default', 'default')
       ON DUPLICATE KEY UPDATE slug = slug`,
      [projectKey, uid]
    );
    const rows = await query(
      `SELECT id, project_key FROM projects WHERE user_id = ? AND slug = 'default' LIMIT 1`,
      [uid]
    );
    if (rows.length > 0) {
      if (!rows[0].project_key) await ensureProjectKeyForId(rows[0].id);
      await ensureProjectOwnerMembershipBestEffort(rows[0].id, uid);
      return rows[0].id;
    }
    return null;
  } catch (e) {
    console.warn('确保 default 项目失败，跳过项目归属写入:', e.message);
    return null;
  }
}

/**
 * 给站点补默认项目；若站点已有 project_id，不覆盖。
 * 该步骤是 best-effort：项目迁移未执行时不影响上传/重部署。
 */
async function ensureWebsiteDefaultProject(userId, websiteId) {
  const projectId = await ensureDefaultProjectForUser(userId);
  if (!projectId) return null;
  try {
    await query(
      `UPDATE websites
       SET project_id = COALESCE(project_id, ?)
       WHERE user_id = ? AND website_id = ?`,
      [projectId, userId, websiteId]
    );
    return projectId;
  } catch (e) {
    console.warn('写入站点 default 项目失败，跳过项目归属写入:', e.message);
    return null;
  }
}

async function updateWebsiteProjectWithLock(projectId, { docId = null, websiteId = null } = {}) {
  const pid = normalizePositiveId(projectId);
  if (!pid || (!docId && !websiteId)) throw new Error('缺少站点或项目信息');

  return transaction(async (conn) => {
    const [projects] = await conn.query(
      'SELECT id FROM projects WHERE id = ? AND archived = 0 LIMIT 1 FOR UPDATE',
      [pid]
    );
    if (projects.length === 0) throw new Error('目标项目不存在或已删除');

    const sql = docId
      ? 'UPDATE websites SET project_id = ?, updated_at = NOW() WHERE id = ?'
      : 'UPDATE websites SET project_id = ?, updated_at = NOW() WHERE website_id = ?';
    const identity = docId || websiteId;
    const [updated] = await conn.query(sql, [pid, identity]);
    if (updated.affectedRows !== 1) throw new Error('站点不存在或项目绑定失败');
    try {
      const siteNumericId = docId
        ? docId
        : ((await conn.query('SELECT id FROM websites WHERE website_id = ? LIMIT 1', [websiteId]))[0][0] || {}).id;
      if (siteNumericId) {
        await conn.query('DELETE FROM custom_domain_routes WHERE website_id = ?', [siteNumericId]);
      }
    } catch (e) {
      // custom_domains may not exist yet
    }
    return pid;
  });
}

async function assignWebsiteProject(userId, websiteId, projectId) {
  const pid = await resolveProjectId(projectId);
  if (!pid) return await ensureWebsiteDefaultProject(userId, websiteId);
  try {
    let project = await getProjectWithUserRole(userId, pid, { includeArchived: false });
    const isPlatformAdmin = await checkAdmin(userId);
    if (!project && isPlatformAdmin) {
      const rows = await query('SELECT * FROM projects WHERE id = ? AND archived = 0 LIMIT 1', [pid]);
      if (rows[0]) {
        project = { ...rows[0], project_role: PROJECT_ROLE_OWNER };
        markAdminAction(null, userId, 'override');
      }
    }
    if (!project && !isPlatformAdmin) {
      throw new Error('目标项目不存在、已归档或无权限');
    }
    if (!project) {
      throw new Error('目标项目不存在或已归档');
    }
    if (project && !PROJECT_WRITE_ROLES.includes(project.project_role) && !isPlatformAdmin) {
      throw new Error('只有项目 owner/admin 可以写入站点');
    }
    await updateWebsiteProjectWithLock(pid, { websiteId });
    return pid;
  } catch (e) {
    console.warn('写入站点项目失败:', e.message);
    throw e;
  }
}

function isSafeZipEntry(entry) {
  if (!entry || entry.isDirectory) return false;
  const name = String(entry.entryName || '').replace(/\\/g, '/');
  if (!name || name.startsWith('/') || name.includes('..')) return false;
  if (name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
  return true;
}

function zipEntryDeployedBytes(entry) {
  const headerSize = Number(entry && entry.header && entry.header.size);
  if (Number.isFinite(headerSize) && headerSize >= 0) return headerSize;
  try {
    return entry.getData().length;
  } catch (e) {
    return 0;
  }
}

function sumZipDeployedBytes(zipEntries) {
  return getDeployEntryRecords(zipEntries).reduce((sum, rec) => sum + zipEntryDeployedBytes(rec.entry), 0);
}

function getDeployEntryRecords(zipEntries) {
  const validEntries = zipEntries.filter(isSafeZipEntry);
  let commonPrefix = '';
  if (validEntries.length > 0) {
    const parts = String(validEntries[0].entryName || '').replace(/\\/g, '/').split('/');
    if (parts.length > 1) {
      const potentialPrefix = parts[0] + '/';
      const allMatch = validEntries.every(e =>
        String(e.entryName || '').replace(/\\/g, '/').startsWith(potentialPrefix)
      );
      if (allMatch) commonPrefix = potentialPrefix;
    }
  }

  return validEntries.map((entry) => {
    let name = String(entry.entryName || '').replace(/\\/g, '/');
    if (commonPrefix && name.startsWith(commonPrefix)) {
      name = name.slice(commonPrefix.length);
    }
    return {
      entry,
      originalName: String(entry.entryName || '').replace(/\\/g, '/'),
      name,
      lowerName: name.toLowerCase()
    };
  }).filter(r => r.name && !r.name.endsWith('/'));
}

function readEntryText(entry, maxBytes = 1024 * 1024) {
  try {
    const buf = entry.getData();
    return buf.slice(0, maxBytes).toString('utf8');
  } catch (e) {
    return '';
  }
}

function stripUrlNoise(value) {
  try {
    return decodeURIComponent(String(value || '').split('#')[0].split('?')[0]);
  } catch (e) {
    return String(value || '').split('#')[0].split('?')[0];
  }
}

function isExternalOrSpecialUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('#')) return true;
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw) ||
    /^(?:data|mailto|tel|javascript|blob):/i.test(raw);
}

function normalizeHtmlRef(ref, htmlPath) {
  if (isExternalOrSpecialUrl(ref)) return '';
  const cleaned = stripUrlNoise(ref).trim();
  if (!cleaned || cleaned.startsWith('#')) return '';
  const withoutLeading = cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
  const baseDir = String(htmlPath || '').includes('/')
    ? String(htmlPath).split('/').slice(0, -1).join('/')
    : '';
  const combined = cleaned.startsWith('/')
    ? withoutLeading
    : (baseDir ? `${baseDir}/${withoutLeading}` : withoutLeading);
  const parts = [];
  for (const part of combined.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function extractHtmlAssetRefs(html) {
  const refs = [];
  const add = (kind, value) => {
    if (value) refs.push({ kind, value: String(value).trim() });
  };

  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi;
  let m;
  while ((m = scriptRe.exec(html))) add('script', m[2]);

  const linkRe = /<link\b[^>]*>/gi;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const href = /\bhref\s*=\s*(['"])(.*?)\1/i.exec(tag);
    if (!href) continue;
    const rel = (/\brel\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2] || '').toLowerCase();
    if (/(stylesheet|modulepreload|preload|icon)/.test(rel)) {
      add(rel || 'link', href[2]);
    }
  }

  return refs;
}

function collectSourcePackageSignals(records) {
  const names = new Set(records.map(r => r.lowerName));
  const rootPackage = records.find(r => r.lowerName === 'package.json');
  const configMarkers = records
    .filter(r => /^(vite|next|nuxt|astro|svelte|webpack|rollup|parcel|rsbuild|rspack|angular|vue|tailwind|postcss)\.config\.(js|cjs|mjs|ts|mts|cts)$/i.test(r.name))
    .map(r => r.name);
  const sourceDirs = ['src/', 'app/', 'pages/', 'components/'];
  const sourceDirHits = sourceDirs.filter(prefix => records.some(r => r.lowerName.startsWith(prefix)));
  const lockFiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']
    .filter(name => names.has(name));
  const nodeModules = records.some(r => r.lowerName.startsWith('node_modules/'));

  let packageLooksLikeFrontend = false;
  let packageHints = [];
  if (rootPackage) {
    try {
      const pkg = JSON.parse(readEntryText(rootPackage.entry, 256 * 1024) || '{}');
      const deps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {})
      };
      const depNames = Object.keys(deps);
      packageHints = depNames.filter(name =>
        /^(vite|next|nuxt|astro|svelte|react|react-dom|vue|@vitejs\/|@sveltejs\/|@astrojs\/|@angular\/|webpack|parcel|tailwindcss)$/i.test(name)
      );
      const scripts = pkg.scripts || {};
      packageLooksLikeFrontend = packageHints.length > 0 ||
        Boolean(scripts.build || scripts.dev || scripts.start);
    } catch (e) {
      packageLooksLikeFrontend = true;
    }
  }

  return {
    rootPackage: !!rootPackage,
    configMarkers,
    sourceDirHits,
    lockFiles,
    nodeModules,
    packageLooksLikeFrontend,
    packageHints
  };
}

function sourcePackageMessage(reasons = []) {
  const detail = reasons.length ? `\n检测到：${reasons.slice(0, 8).join('、')}` : '';
  return [
    '检测到你上传的是前端源码项目，而不是静态构建产物，已停止部署。',
    detail,
    'Demox 当前只托管可直接访问的静态文件。',
    '请在本地项目根目录执行：npm install && npm run build',
    '然后上传构建输出目录的压缩包：Vite/React/Vue/Astro 通常是 dist.zip，Next 静态导出通常是 out.zip。',
    '不要上传 package.json、src/、node_modules/ 或 vite.config.ts 所在的项目根目录。'
  ].filter(Boolean).join('\n');
}

function validateStaticSiteZip(zipEntries) {
  const records = getDeployEntryRecords(zipEntries);
  const names = new Set(records.map(r => r.lowerName));
  const sourceSignals = collectSourcePackageSignals(records);
  const sourceReasons = [];

  if (sourceSignals.nodeModules) {
    return {
      valid: false,
      code: 'NODE_MODULES_UPLOADED',
      message: [
        '检测到压缩包里包含 node_modules，已停止部署。',
        '请不要上传依赖目录。静态站点只需要上传构建后的 dist/build/out 目录。'
      ].join('\n')
    };
  }

  if (sourceSignals.rootPackage && sourceSignals.packageLooksLikeFrontend) sourceReasons.push('package.json');
  if (sourceSignals.configMarkers.length) sourceReasons.push(...sourceSignals.configMarkers.slice(0, 4));
  if (sourceSignals.sourceDirHits.length) sourceReasons.push(...sourceSignals.sourceDirHits.map(x => x.replace(/\/$/, '/ 目录')));
  if (sourceSignals.lockFiles.length) sourceReasons.push(...sourceSignals.lockFiles.slice(0, 3));
  if (sourceSignals.packageHints.length) sourceReasons.push(...sourceSignals.packageHints.slice(0, 4));

  const rootIndex = records.find(r => r.lowerName === 'index.html');
  if (!rootIndex) {
    if (sourceReasons.length || names.has('dist/index.html') || names.has('build/index.html') || names.has('out/index.html')) {
      return {
        valid: false,
        code: 'SOURCE_PACKAGE_NO_ROOT_INDEX',
        message: sourcePackageMessage(sourceReasons.length ? sourceReasons : ['未在压缩包根目录找到 index.html'])
      };
    }
    return {
      valid: false,
      code: 'MISSING_INDEX',
      message: [
        'ZIP 根目录必须包含 index.html，已停止部署。',
        '如果这是前端项目，请先运行 npm run build，然后只上传构建输出目录（例如 dist.zip / build.zip / out.zip）。'
      ].join('\n')
    };
  }

  const htmlRecords = records.filter(r => /\.html?$/i.test(r.name));
  const sourceRefs = [];
  const missingAssets = [];
  for (const htmlRecord of htmlRecords) {
    const html = readEntryText(htmlRecord.entry);
    const refs = extractHtmlAssetRefs(html);
    for (const ref of refs) {
      const normalized = normalizeHtmlRef(ref.value, htmlRecord.name);
      if (!normalized) continue;
      const lower = normalized.toLowerCase();
      if (
        lower.startsWith('src/') ||
        /\.(ts|tsx|jsx|vue|svelte|astro)$/i.test(lower) ||
        /(^|\/)(vite|webpack|next)\.config\./i.test(lower)
      ) {
        sourceRefs.push(`${htmlRecord.name} -> ${ref.value}`);
        continue;
      }

      if (ref.kind === 'script' || ref.kind === 'stylesheet' || ref.kind === 'modulepreload') {
        const ext = path.extname(lower);
        if (['.js', '.mjs', '.css'].includes(ext) && !names.has(lower)) {
          missingAssets.push(`${htmlRecord.name} -> ${ref.value}`);
        }
      }
    }
  }

  if (sourceRefs.length > 0) {
    return {
      valid: false,
      code: 'HTML_REFERENCES_SOURCE',
      message: sourcePackageMessage([...sourceReasons, ...sourceRefs.slice(0, 4)])
    };
  }

  if (sourceReasons.length > 0) {
    return {
      valid: false,
      code: 'SOURCE_PACKAGE',
      message: sourcePackageMessage(sourceReasons)
    };
  }

  const hasBundledAssets = records.some(r => /\.(?:js|mjs|css)$/i.test(r.lowerName));
  if (hasBundledAssets && missingAssets.length > 0) {
    return {
      valid: false,
      code: 'MISSING_STATIC_ASSETS',
      message: [
        '检测到 index.html 引用了不存在的 JS/CSS 文件，已停止部署。',
        `缺失资源：${missingAssets.slice(0, 6).join('、')}`,
        '请确认上传的是完整构建产物目录，而不是只上传了 index.html。'
      ].join('\n')
    };
  }

  return { valid: true };
}

// ===========================================================================
// 多云存储桶注册制：CRUD + 数据迁移
// ===========================================================================

/** 列出所有存储桶（管理员）。不返回任何密钥/密文。 */
async function handleListBuckets(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  try {
    const list = await buckets.listBuckets();
    return ok({ success: true, data: list });
  } catch (e) {
    // 表未建时给出明确提示，引导先跑迁移
    return ok({ success: false, message: 'storage_buckets 表不存在', error: e.message });
  }
}

/**
 * 注册新存储桶（管理员）。
 * body: { name, provider, bucket, region?, endpoint?, originHost?, forcePathStyle?,
 *         secretId?, secretKey?, isDefault?, enabled? }
 * 密钥(secretId/secretKey)用 AES-GCM 加密后入库；留空则该桶用 SCF env 凭证(仅适合旧默认桶)。
 * 设为默认桶时，事务内把其它桶 is_default 清零。
 */
async function handleRegisterBucket(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const b = event.body || event;
  const name = String(b.name || '').trim();
  const provider = String(b.provider || 'cos').trim().toLowerCase();
  const bucket = String(b.bucket || '').trim();
  if (!name || !bucket) return ok({ success: false, message: '缺少必要参数: name, bucket' });
  if (!['cos', 's3'].includes(provider)) return ok({ success: false, message: 'provider 只能是 cos 或 s3' });

  // 加密密钥（两者要么都给要么都不给）
  let secretIdEnc = null;
  let secretKeyEnc = null;
  try {
    if (b.secretId && b.secretKey) {
      secretIdEnc = encrypt(String(b.secretId));
      secretKeyEnc = encrypt(String(b.secretKey));
    } else if (b.secretId || b.secretKey) {
      return ok({ success: false, message: 'secretId 与 secretKey 必须同时提供' });
    }
  } catch (e) {
    return ok({ success: false, message: '密钥加密失败：' + e.message });
  }

  const region = b.region ? String(b.region).trim() : null;
  const endpoint = b.endpoint ? String(b.endpoint).trim() : null;
  const originHost = b.originHost ? String(b.originHost).trim() : null;
  const forcePathStyle = b.forcePathStyle === undefined || b.forcePathStyle === null
    ? null : (b.forcePathStyle ? 1 : 0);
  const isDefault = b.isDefault ? 1 : 0;
  const enabled = b.enabled === undefined ? 1 : (b.enabled ? 1 : 0);

  try {
    const insertId = await transaction(async (conn) => {
      if (isDefault) {
        await conn.query('UPDATE storage_buckets SET is_default = 0 WHERE is_default = 1');
      }
      const [res] = await conn.query(
        `INSERT INTO storage_buckets
         (name, provider, bucket, region, endpoint, origin_host, force_path_style,
          secret_id_enc, secret_key_enc, is_default, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, provider, bucket, region, endpoint, originHost, forcePathStyle,
         secretIdEnc, secretKeyEnc, isDefault, enabled]
      );
      return res.insertId;
    });
    return ok({ success: true, id: insertId, message: '存储桶已注册' });
  } catch (e) {
    return ok({ success: false, message: '注册失败：' + e.message });
  }
}

/**
 * 更新存储桶（管理员）。body.id 必填；其余字段按需更新。
 * 密钥：传 secretId+secretKey 则重新加密覆盖；传空字符串 '' 显式清空(改回用 env)；不传则保持原值。
 */
async function handleUpdateBucket(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const b = event.body || event;
  const id = b.id;
  if (!id && id !== 0) return ok({ success: false, message: '缺少 id' });

  const sets = [];
  const params = [];
  const setField = (col, val) => { sets.push(`${col} = ?`); params.push(val); };

  if (b.name !== undefined) setField('name', String(b.name).trim());
  if (b.provider !== undefined) {
    const p = String(b.provider).trim().toLowerCase();
    if (!['cos', 's3'].includes(p)) return ok({ success: false, message: 'provider 只能是 cos 或 s3' });
    setField('provider', p);
  }
  if (b.bucket !== undefined) setField('bucket', String(b.bucket).trim());
  if (b.region !== undefined) setField('region', b.region ? String(b.region).trim() : null);
  if (b.endpoint !== undefined) setField('endpoint', b.endpoint ? String(b.endpoint).trim() : null);
  if (b.originHost !== undefined) setField('origin_host', b.originHost ? String(b.originHost).trim() : null);
  if (b.forcePathStyle !== undefined) {
    setField('force_path_style', b.forcePathStyle === null ? null : (b.forcePathStyle ? 1 : 0));
  }
  if (b.enabled !== undefined) setField('enabled', b.enabled ? 1 : 0);

  // 密钥更新：同时传两个=重新加密；同时传两个空串=清空回 env；只传一个=报错
  const hasId = b.secretId !== undefined;
  const hasKey = b.secretKey !== undefined;
  if (hasId || hasKey) {
    if (!hasId || !hasKey) return ok({ success: false, message: 'secretId 与 secretKey 需同时提供或同时省略' });
    try {
      if (b.secretId === '' && b.secretKey === '') {
        setField('secret_id_enc', null);
        setField('secret_key_enc', null);
      } else {
        setField('secret_id_enc', encrypt(String(b.secretId)));
        setField('secret_key_enc', encrypt(String(b.secretKey)));
      }
    } catch (e) {
      return ok({ success: false, message: '密钥加密失败：' + e.message });
    }
  }

  if (sets.length === 0) return ok({ success: false, message: '没有要更新的字段' });

  try {
    // 改默认桶单独走 set_default_bucket（带清零逻辑），此处不处理 is_default
    params.push(id);
    await query(`UPDATE storage_buckets SET ${sets.join(', ')} WHERE id = ?`, params);
    return ok({ success: true, message: '已更新' });
  } catch (e) {
    return ok({ success: false, message: '更新失败：' + e.message });
  }
}

/**
 * 删除存储桶（管理员）。只删注册记录，不动桶里的对象（避免误删线上文件）。
 * 拦截条件：1) 默认桶不可删；2) 仍有 websites 关联时不可删（先迁移站点）。
 */
async function handleDeleteBucket(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const id = (event.body || event).id;
  if (!id && id !== 0) return ok({ success: false, message: '缺少 id' });

  try {
    const rows = await query('SELECT is_default FROM storage_buckets WHERE id = ?', [id]);
    if (rows.length === 0) return ok({ success: false, message: '桶不存在' });
    if (rows[0].is_default) return ok({ success: false, message: '默认桶不可删除，请先指定其它桶为默认' });

    const used = await query('SELECT COUNT(*) AS c FROM websites WHERE bucket_id = ?', [id]);
    if ((used[0]?.c || 0) > 0) {
      return ok({ success: false, message: `仍有 ${used[0].c} 个站点关联此桶，无法删除` });
    }
    await query('DELETE FROM storage_buckets WHERE id = ?', [id]);
    return ok({ success: true, message: '已删除' });
  } catch (e) {
    return ok({ success: false, message: '删除失败：' + e.message });
  }
}

/** 设为默认桶（管理员）。事务内把其它桶清零，保证全局唯一默认。 */
async function handleSetDefaultBucket(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const id = (event.body || event).id;
  if (!id && id !== 0) return ok({ success: false, message: '缺少 id' });

  try {
    await transaction(async (conn) => {
      const [rows] = await conn.query('SELECT enabled FROM storage_buckets WHERE id = ?', [id]);
      if (rows.length === 0) throw new Error('桶不存在');
      if (!rows[0].enabled) throw new Error('已禁用的桶不能设为默认');
      await conn.query('UPDATE storage_buckets SET is_default = 0 WHERE is_default = 1');
      await conn.query('UPDATE storage_buckets SET is_default = 1 WHERE id = ?', [id]);
    });
    return ok({ success: true, message: '已设为默认桶' });
  } catch (e) {
    return ok({ success: false, message: e.message });
  }
}



let _deployUploadSessionsEnsured = false;

async function ensureDeployUploadSessionsTable() {
  if (_deployUploadSessionsEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS deploy_upload_sessions (
      upload_id     CHAR(36) NOT NULL,
      user_id       VARCHAR(64) NOT NULL,
      website_id    VARCHAR(32) NOT NULL,
      file_name     VARCHAR(255) NOT NULL,
      project_id    VARCHAR(64) DEFAULT NULL,
      bucket_id     INT DEFAULT NULL,
      total_size    BIGINT UNSIGNED NOT NULL,
      chunk_size    INT UNSIGNED NOT NULL,
      total_chunks  INT UNSIGNED NOT NULL,
      sha256        CHAR(64) NOT NULL,
      status        VARCHAR(16) NOT NULL DEFAULT 'UPLOADING',
      result_json   LONGTEXT DEFAULT NULL,
      error_message VARCHAR(500) DEFAULT NULL,
      expires_at    DATETIME NOT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (upload_id),
      INDEX idx_deploy_upload_user_status (user_id, status, updated_at),
      INDEX idx_deploy_upload_expires (expires_at, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='部署分块上传会话'`
  );
  const expiryColumns = await query(
    `SELECT DATA_TYPE, EXTRA FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deploy_upload_sessions'
       AND COLUMN_NAME = 'expires_at' LIMIT 1`
  );
  if (needsDeployUploadExpiryMigration(expiryColumns[0])) {
    await query('ALTER TABLE deploy_upload_sessions MODIFY COLUMN expires_at DATETIME NOT NULL');
  }
  _deployUploadSessionsEnsured = true;
}

function deployUploadError(statusCode, code, message, extra = {}) {
  return {
    statusCode,
    headers: getCORSHeaders(),
    body: JSON.stringify({ success: false, code, message, ...extra })
  };
}

async function getDeployUploadSession(uploadId, userId) {
  const rows = await query(
    `SELECT *, expires_at <= NOW() AS is_expired
     FROM deploy_upload_sessions WHERE upload_id = ? AND user_id = ? LIMIT 1`,
    [String(uploadId || ''), String(userId || '')]
  );
  return rows[0] || null;
}

async function cleanupDeployUploadChunks(session) {
  if (!session) return;
  try {
    const bucketCfg = await resolveBucketConfig(session.bucket_id || null);
    const provider = providerFor(bucketCfg);
    const objects = await provider.list(uploadObjectPrefix(session.user_id, session.upload_id));
    await Promise.all(objects.map((object) => provider.delete(object.key)));
  } catch (error) {
    console.warn(`清理上传会话 ${session.upload_id} 的暂存分块失败:`, error.message);
  }
}

async function cleanupExpiredDeployUploads() {
  try {
    const rows = await query(
      `SELECT * FROM deploy_upload_sessions
       WHERE expires_at < NOW() AND status <> 'COMPLETED'
       ORDER BY expires_at ASC LIMIT 10`
    );
    for (const session of rows) {
      const result = await query(
        `UPDATE deploy_upload_sessions SET status = 'EXPIRED', error_message = '上传会话已过期'
         WHERE upload_id = ? AND status <> 'COMPLETED'`,
        [session.upload_id]
      );
      if (result.affectedRows) await cleanupDeployUploadChunks(session);
    }
    await query(
      `DELETE FROM deploy_upload_sessions
       WHERE expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND status IN ('COMPLETED', 'FAILED', 'ABORTED', 'EXPIRED')`
    );
  } catch (error) {
    console.warn('清理过期部署上传会话失败:', error.message);
  }
}

async function markDeployUploadFailed(session, code, message) {
  await query(
    `UPDATE deploy_upload_sessions
     SET status = 'FAILED', error_message = ?, updated_at = NOW()
     WHERE upload_id = ? AND user_id = ?`,
    [String(message || code).slice(0, 500), session.upload_id, session.user_id]
  );
  await cleanupDeployUploadChunks(session);
}

async function handleInitDeployUpload(event) {
  const userId = getUserId(event);
  if (!userId) return deployUploadError(401, 'UNAUTHORIZED', '未登录或token已过期');

  try {
    await ensureDeployUploadSessionsTable();
    await cleanupExpiredDeployUploads();

    const body = event.body || event;
    const fileName = String(body.fileName || '').trim();
    const totalSize = Number(body.totalSize);
    const fileSha256 = normalizeSha256(body.sha256);
    if (!fileName || fileName.length > 255) {
      return deployUploadError(400, 'INVALID_FILE_NAME', 'fileName 必须为 1-255 个字符');
    }
    if (!Number.isSafeInteger(totalSize) || totalSize <= 0) {
      return deployUploadError(400, 'INVALID_TOTAL_SIZE', 'totalSize 必须为正整数');
    }
    if (!fileSha256) {
      return deployUploadError(400, 'INVALID_SHA256', 'sha256 必须为 64 位十六进制摘要');
    }

    const requestId = String(body.requestId || '').trim().toLowerCase();
    const uploadId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)
      ? requestId
      : nodeCrypto.randomUUID();
    const prior = await getDeployUploadSession(uploadId, userId);
    if (prior) {
      const sameRequest = Number(prior.total_size) === totalSize &&
        prior.sha256 === fileSha256 && prior.file_name === fileName &&
        (body.websiteId == null || prior.website_id === normalizeWebsiteId(body.websiteId)) &&
        (body.projectId == null ? prior.project_id == null : String(prior.project_id || '') === String(body.projectId));
      if (!sameRequest) {
        return deployUploadError(409, 'UPLOAD_REQUEST_CONFLICT', 'requestId 已用于另一份部署文件');
      }
      if (isDeployUploadExpired(prior) || ['FAILED', 'ABORTED', 'EXPIRED'].includes(prior.status)) {
        return deployUploadError(409, 'UPLOAD_NOT_WRITABLE', `上传会话当前状态为 ${prior.status}`);
      }
      return ok({
        success: true,
        uploadId: prior.upload_id,
        websiteId: prior.website_id,
        chunkSize: Number(prior.chunk_size),
        totalChunks: Number(prior.total_chunks),
        expiresInSeconds: DEPLOY_UPLOAD_TTL_SECONDS,
        resumed: true
      });
    }

    const roleConfig = await getUserLimits(userId);
    if (roleConfig.max_file_size && totalSize > Number(roleConfig.max_file_size)) {
      return ok({
        success: false,
        code: 'FILE_SIZE_LIMIT_EXCEEDED',
        message: `文件大小超出限制！当前文件大小 ${Math.round(totalSize / 1024 / 1024)}MB，您的角色限制为 ${Math.round(roleConfig.max_file_size / 1024 / 1024)}MB。`
      });
    }

    const inputWebsiteId = body.websiteId;
    const websiteId = inputWebsiteId ? normalizeWebsiteId(inputWebsiteId) : generateWebsiteId();
    const existing = inputWebsiteId
      ? await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId])
      : [];
    if (existing.length > 0 && !(await canUserManageSite(userId, existing[0]))) {
      return deployUploadError(403, 'SITE_FORBIDDEN', '无权限重新部署该站点');
    }

    const bucketCfg = await resolveBucketConfig(existing.length > 0 ? existing[0].bucket_id : null);
    const totalChunks = Math.ceil(totalSize / DEPLOY_UPLOAD_CHUNK_SIZE);
    await query(
      `INSERT INTO deploy_upload_sessions
       (upload_id, user_id, website_id, file_name, project_id, bucket_id,
        total_size, chunk_size, total_chunks, sha256, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADING',
               DATE_ADD(NOW(), INTERVAL ${DEPLOY_UPLOAD_TTL_SECONDS} SECOND))`,
      [
        uploadId,
        userId,
        websiteId,
        fileName,
        body.projectId == null ? null : String(body.projectId),
        bucketCfg.id || null,
        totalSize,
        DEPLOY_UPLOAD_CHUNK_SIZE,
        totalChunks,
        fileSha256
      ]
    );

    return ok({
      success: true,
      uploadId,
      websiteId,
      chunkSize: DEPLOY_UPLOAD_CHUNK_SIZE,
      totalChunks,
      expiresInSeconds: DEPLOY_UPLOAD_TTL_SECONDS
    });
  } catch (error) {
    console.error('初始化分块上传失败:', error);
    return deployUploadError(500, 'UPLOAD_INIT_FAILED', error.message || '初始化分块上传失败');
  }
}

async function handleUploadDeployChunk(event) {
  const userId = getUserId(event);
  if (!userId) return deployUploadError(401, 'UNAUTHORIZED', '未登录或token已过期');

  try {
    await ensureDeployUploadSessionsTable();
    const body = event.body || event;
    const session = await getDeployUploadSession(body.uploadId, userId);
    if (!session) return deployUploadError(404, 'UPLOAD_NOT_FOUND', '上传会话不存在');
    if (isDeployUploadExpired(session) || session.status === 'EXPIRED') {
      return deployUploadError(410, 'UPLOAD_EXPIRED', '上传会话已过期');
    }
    if (session.status !== 'UPLOADING') {
      return deployUploadError(409, 'UPLOAD_NOT_WRITABLE', `上传会话当前状态为 ${session.status}`);
    }

    const chunkIndex = Number(body.chunkIndex);
    const wantedSize = expectedChunkSize(session, chunkIndex);
    if (wantedSize === null) {
      return deployUploadError(400, 'INVALID_CHUNK_INDEX', 'chunkIndex 超出上传会话范围');
    }
    const chunk = decodeBase64Chunk(body.chunkBase64);
    if (chunk.length !== wantedSize) {
      return deployUploadError(400, 'INVALID_CHUNK_SIZE', `分块大小不正确，应为 ${wantedSize} 字节`);
    }
    const chunkSha256 = normalizeSha256(body.chunkSha256);
    if (!chunkSha256 || sha256Hex(chunk) !== chunkSha256) {
      return deployUploadError(400, 'CHUNK_HASH_MISMATCH', '分块 SHA-256 校验失败');
    }

    const bucketCfg = await resolveBucketConfig(session.bucket_id || null);
    const provider = providerFor(bucketCfg);
    const objectKey = uploadObjectKey(userId, session.upload_id, chunkIndex);
    await provider.put(objectKey, chunk, {
      contentType: 'application/octet-stream',
      cacheControl: 'no-store'
    });
    const updated = await query(
      `UPDATE deploy_upload_sessions SET updated_at = NOW(), error_message = NULL
       WHERE upload_id = ? AND user_id = ? AND status = 'UPLOADING'`,
      [session.upload_id, userId]
    );
    if (!updated.affectedRows) {
      await provider.delete(objectKey).catch(() => {});
      return deployUploadError(409, 'UPLOAD_NOT_WRITABLE', '上传会话状态已变化，请重新开始');
    }
    return ok({ success: true, uploadId: session.upload_id, chunkIndex });
  } catch (error) {
    console.error('上传部署分块失败:', error);
    return deployUploadError(500, 'CHUNK_UPLOAD_FAILED', error.message || '上传部署分块失败', { retryable: true });
  }
}

async function handleCompleteDeployUpload(event) {
  const userId = getUserId(event);
  if (!userId) return deployUploadError(401, 'UNAUTHORIZED', '未登录或token已过期');

  let session;
  try {
    await ensureDeployUploadSessionsTable();
    const body = event.body || event;
    session = await getDeployUploadSession(body.uploadId, userId);
    if (!session) return deployUploadError(404, 'UPLOAD_NOT_FOUND', '上传会话不存在');
    if (session.status === 'COMPLETED') {
      const result = parseResultJson(session.result_json);
      return result ? ok(result) : deployUploadError(500, 'UPLOAD_RESULT_MISSING', '部署已完成但结果记录缺失');
    }
    if (isDeployUploadExpired(session) || session.status === 'EXPIRED') {
      return deployUploadError(410, 'UPLOAD_EXPIRED', '上传会话已过期');
    }
    if (!['UPLOADING', 'COMPLETING'].includes(session.status)) {
      return deployUploadError(409, 'UPLOAD_NOT_COMPLETABLE', `上传会话当前状态为 ${session.status}`);
    }

    const claimed = await query(
      `UPDATE deploy_upload_sessions
       SET status = 'COMPLETING', error_message = NULL, updated_at = NOW()
       WHERE upload_id = ? AND user_id = ?
         AND (status = 'UPLOADING'
              OR (status = 'COMPLETING' AND updated_at < DATE_SUB(NOW(), INTERVAL ${COMPLETING_STALE_SECONDS} SECOND)))`,
      [session.upload_id, userId]
    );
    if (!claimed.affectedRows) {
      const current = await getDeployUploadSession(session.upload_id, userId);
      if (current && current.status === 'COMPLETED') {
        const result = parseResultJson(current.result_json);
        return result ? ok(result) : deployUploadError(500, 'UPLOAD_RESULT_MISSING', '部署已完成但结果记录缺失');
      }
      return ok({
        success: false,
        code: 'UPLOAD_COMPLETING',
        message: '部署正在完成，请稍后重试',
        retryable: true,
        retryAfterMs: 1500
      });
    }

    session.status = 'COMPLETING';
    const startedAt = Date.now();
    const bucketCfg = await resolveBucketConfig(session.bucket_id || null);
    const provider = providerFor(bucketCfg);
    const chunks = [];
    const hasher = nodeCrypto.createHash('sha256');
    for (let index = 0; index < Number(session.total_chunks); index++) {
      const chunk = await provider.getBuffer(uploadObjectKey(userId, session.upload_id, index));
      const wantedSize = expectedChunkSize(session, index);
      if (chunk.length !== wantedSize) {
        throw Object.assign(new Error(`分块 ${index} 大小不正确，应为 ${wantedSize} 字节`), { code: 'UPLOAD_INCOMPLETE' });
      }
      hasher.update(chunk);
      chunks.push(chunk);
    }
    const digest = hasher.digest('hex');
    if (digest !== session.sha256) {
      await markDeployUploadFailed(session, 'UPLOAD_HASH_MISMATCH', '完整 ZIP 的 SHA-256 校验失败');
      await recordServerDeployEvent(event, {
        success: false, userId, websiteId: session.website_id, uploadId: session.upload_id,
        sizeBytes: Number(session.total_size), startedAt, errorCode: 'UPLOAD_HASH_MISMATCH'
      });
      return deployUploadError(400, 'UPLOAD_HASH_MISMATCH', '完整 ZIP 的 SHA-256 校验失败');
    }

    const buffer = Buffer.concat(chunks, Number(session.total_size));
    const deployResponse = await deployZipBuffer({
      userId,
      buffer,
      inputWebsiteId: session.website_id,
      fileName: session.file_name,
      inputProjectId: session.project_id
    });
    const payload = parseResultJson(deployResponse.body) || { success: false, message: '部署响应无效' };
    await recordServerDeployEvent(event, {
      success: !!payload.success,
      userId,
      websiteId: payload.websiteId || session.website_id,
      uploadId: session.upload_id,
      sizeBytes: Number(session.total_size),
      startedAt,
      errorCode: payload.code || (deployResponse.statusCode !== 200 ? `HTTP_${deployResponse.statusCode}` : 'DEPLOY_FAILED')
    });
    if (!payload.success) {
      const terminal = payload.code === 'INVALID_STATIC_SITE' || payload.code === 'CONTENT_BLOCKED';
      if (terminal) {
        await markDeployUploadFailed(session, payload.code, payload.message);
      } else {
        await query(
          `UPDATE deploy_upload_sessions SET status = 'UPLOADING', error_message = ?, updated_at = NOW()
           WHERE upload_id = ? AND user_id = ? AND status = 'COMPLETING'`,
          [String(payload.message || '部署失败').slice(0, 500), session.upload_id, userId]
        );
      }
      return deployResponse;
    }

    await query(
      `UPDATE deploy_upload_sessions
       SET status = 'COMPLETED', result_json = ?, error_message = NULL,
           expires_at = DATE_ADD(NOW(), INTERVAL ${DEPLOY_UPLOAD_TTL_SECONDS} SECOND), updated_at = NOW()
       WHERE upload_id = ? AND user_id = ? AND status = 'COMPLETING'`,
      [JSON.stringify(payload), session.upload_id, userId]
    );
    await cleanupDeployUploadChunks(session);
    return deployResponse;
  } catch (error) {
    console.error('完成分块部署失败:', error);
    if (session && session.status === 'COMPLETING') {
      await recordServerDeployEvent(event, {
        success: false, userId, websiteId: session.website_id, uploadId: session.upload_id,
        sizeBytes: Number(session.total_size), errorCode: error.code || 'UPLOAD_COMPLETE_FAILED'
      });
    }
    if (session) {
      await query(
        `UPDATE deploy_upload_sessions SET status = 'UPLOADING', error_message = ?, updated_at = NOW()
         WHERE upload_id = ? AND user_id = ? AND status = 'COMPLETING'`,
        [String(error.message || '完成部署失败').slice(0, 500), session.upload_id, userId]
      ).catch(() => {});
    }
    return deployUploadError(500, error.code || 'UPLOAD_COMPLETE_FAILED', error.message || '完成分块部署失败', { retryable: true });
  }
}

async function handleAbortDeployUpload(event) {
  const userId = getUserId(event);
  if (!userId) return deployUploadError(401, 'UNAUTHORIZED', '未登录或token已过期');

  try {
    await ensureDeployUploadSessionsTable();
    const body = event.body || event;
    const session = await getDeployUploadSession(body.uploadId, userId);
    if (!session) return ok({ success: true, aborted: false });
    if (session.status === 'COMPLETED') return ok({ success: true, aborted: false, completed: true });
    if (session.status === 'COMPLETING') {
      return ok({ success: false, code: 'UPLOAD_COMPLETING', message: '部署正在完成，不能中止' });
    }
    await query(
      `UPDATE deploy_upload_sessions SET status = 'ABORTED', error_message = '客户端中止上传', updated_at = NOW()
       WHERE upload_id = ? AND user_id = ? AND status <> 'COMPLETED'`,
      [session.upload_id, userId]
    );
    await cleanupDeployUploadChunks(session);
    return ok({ success: true, aborted: true });
  } catch (error) {
    console.error('中止分块上传失败:', error);
    return deployUploadError(500, 'UPLOAD_ABORT_FAILED', error.message || '中止分块上传失败');
  }
}

/**
 * 处理上传并部署
 */
async function handleUploadAndDeploy(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { fileContentBase64, websiteId: inputWebsiteId, fileName, projectId: inputProjectId } = event.body || event;

  if (!fileContentBase64 || !fileName) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: fileContentBase64, fileName' })
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(String(fileContentBase64), 'base64');
  } catch (error) {
    return ok({ success: false, message: '上传内容不是有效的 Base64' });
  }

  const startedAt = Date.now();
  const deployResponse = await deployZipBuffer({
    userId,
    buffer,
    inputWebsiteId,
    fileName,
    inputProjectId
  });
  const payload = deployResponsePayload(deployResponse);
  await recordServerDeployEvent(event, {
    success: !!payload.success,
    userId,
    websiteId: payload.websiteId || inputWebsiteId,
    sizeBytes: buffer.length,
    startedAt,
    errorCode: payload.code || (deployResponse && deployResponse.statusCode !== 200 ? `HTTP_${deployResponse.statusCode}` : 'DEPLOY_FAILED')
  });
  return deployResponse;
}

// 默认 3 分钟：长于单次部署（函数超时 120s），又不会让崩溃实例把站点锁太久。
const DEPLOY_LOCK_TTL_SECONDS = Math.max(60, parseInt(process.env.DEPLOY_LOCK_TTL_SECONDS || '180', 10) || 180);
let _deployLocksEnsured = false;

async function ensureWebsiteDeployLocksTable() {
  if (_deployLocksEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS website_deploy_locks (
      website_id  VARCHAR(32) NOT NULL,
      lock_token  CHAR(36) NOT NULL,
      owner_id    VARCHAR(64) DEFAULT NULL,
      expires_at  DATETIME NOT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (website_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点部署互斥锁（带 TTL）'`
  );
  _deployLocksEnsured = true;
}

class DeployInProgressError extends Error {
  constructor(websiteId) {
    super('该站点正在部署中，请等待上一次部署完成后再试');
    this.code = 'DEPLOY_IN_PROGRESS';
    this.websiteId = websiteId;
  }
}

/**
 * 获取站点级部署锁：INSERT IGNORE 建行，再条件 UPDATE 抢占（行不存在/已过期/本 token 持有）。
 * affectedRows=1 才算拿到锁；锁行由 MySQL 主键保证跨 SCF 实例互斥，TTL 兜底崩溃实例。
 */
async function acquireWebsiteDeployLock(websiteId, ownerId) {
  await ensureWebsiteDeployLocksTable();
  const token = nodeCrypto.randomUUID();
  await query(
    `INSERT IGNORE INTO website_deploy_locks (website_id, lock_token, owner_id, expires_at)
     VALUES (?, '', NULL, '1970-01-02 00:00:00')`,
    [websiteId]
  );
  const res = await query(
    `UPDATE website_deploy_locks
        SET lock_token = ?, owner_id = ?, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)
      WHERE website_id = ? AND expires_at < UTC_TIMESTAMP()`,
    [token, ownerId || null, DEPLOY_LOCK_TTL_SECONDS, websiteId]
  );
  if (!res || res.affectedRows !== 1) throw new DeployInProgressError(websiteId);
  return { websiteId, token };
}

async function releaseWebsiteDeployLock(lock) {
  if (!lock) return;
  try {
    await query(
      `UPDATE website_deploy_locks SET lock_token = '', expires_at = '1970-01-02 00:00:00'
        WHERE website_id = ? AND lock_token = ?`,
      [lock.websiteId, lock.token]
    );
  } catch (e) {
    // 释放失败最多让该站点在 TTL 内不可再部署，不影响本次结果
    console.warn('释放部署锁失败:', e.message);
  }
}

async function deployZipBuffer({ userId, buffer, inputWebsiteId, fileName, inputProjectId }) {
  let deployLock = null;
  try {
    // 获取用户角色配置（从数据库读取）
    const roleConfig = await getUserLimits(userId);
    console.log(`用户 ${userId} 的角色配置:`, roleConfig);

    // 解析 ZIP
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    // 检查文件数量限制
    const validEntries = zipEntries.filter(isSafeZipEntry);

    const staticValidation = validateStaticSiteZip(zipEntries);
    if (!staticValidation.valid) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          code: staticValidation.code || 'INVALID_STATIC_SITE',
          message: staticValidation.message || '上传包不是可直接访问的静态站点'
        })
      };
    }

    if (roleConfig.max_file_count && validEntries.length > roleConfig.max_file_count) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          message: `文件数量超出限制！当前上传包含 ${validEntries.length} 个文件，您的角色限制为 ${roleConfig.max_file_count} 个文件。`
        })
      };
    }

    // 检查文件大小限制
    const totalSize = buffer.length;
    if (roleConfig.max_file_size && totalSize > roleConfig.max_file_size) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          message: `文件大小超出限制！当前文件大小 ${Math.round(totalSize / 1024 / 1024)}MB，您的角色限制为 ${Math.round(roleConfig.max_file_size / 1024 / 1024)}MB。`
        })
      };
    }

    // 生成或使用现有的 websiteId；重部署允许项目 owner/admin 操作协作项目中的站点。
    const websiteId = inputWebsiteId ? normalizeWebsiteId(inputWebsiteId) : generateWebsiteId();
    const existing = inputWebsiteId
      ? await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId])
      : [];
    if (existing.length > 0 && !(await canUserManageSite(userId, existing[0]))) {
      return {
        statusCode: 403,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, message: '无权限重新部署该站点' })
      };
    }

    const requestedProjectId = await resolveProjectId(inputProjectId);
    if (inputProjectId && !requestedProjectId) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, message: '目标项目不合法' })
      };
    }
    if (requestedProjectId) {
      const canWriteTarget = await canUserWriteProject(userId, requestedProjectId);
      if (!canWriteTarget) {
        return {
          statusCode: 200,
          headers: getCORSHeaders(),
          body: JSON.stringify({ success: false, message: '目标项目不存在、已归档或无写入权限' })
        };
      }
    }

    // 检查部署数量限制。重部署已有站点不计入新部署数量。
    if (roleConfig.deployment_limit) {
      const countRes = await query('SELECT COUNT(*) as count FROM websites WHERE user_id = ?', [userId]);
      if (existing.length === 0 && countRes[0].count >= roleConfig.deployment_limit) {
        return {
          statusCode: 200,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            success: false,
            message: `已达到部署上限！您的角色限制为 ${roleConfig.deployment_limit} 个网站。`
          })
        };
      }
    }

    const fileNameNoExt = normalizeFileNameNoExt(fileName);
    const deploymentOwnerId = existing.length > 0 ? existing[0].user_id : userId;
    const targetPrefix = `sites/${deploymentOwnerId}/${websiteId}/${fileNameNoExt}`;

    // 选桶：重部署沿用站点已绑定的桶（避免文件分裂在两个桶）；新部署落默认桶。
    const existingBucketId = existing.length > 0 ? existing[0].bucket_id : null;
    const bucketCfg = await resolveBucketConfig(existingBucketId);
    // bucketCfg.id 可能不存在（迁移前回退 LEGACY_BUCKET）；此时 bucket_id 写 NULL（= 默认桶语义）
    const bucketIdToStore = bucketCfg.id || null;

    const contentScan = await scanZipEntries(validEntries, {
      moderateImage: createImsModerator(callTencentCloudApi)
    });
    if (contentScan.blocked) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          code: contentScan.code || 'CONTENT_BLOCKED',
          message: contentScan.message || '上传内容未通过安全审核',
          fileName: contentScan.fileName || '',
          phrase: contentScan.phrase || '',
          via: contentScan.via || ''
        })
      };
    }
    if (contentScan.images) {
      console.log(`内容审核通过：本地 ${contentScan.scanned} 个文件，IMS ${contentScan.images} 张图`);
    }

    // 站点级互斥：上传 + prune + 写库 + purge 期间持锁，避免并发部署互相 prune 掉对方文件。
    deployLock = await acquireWebsiteDeployLock(websiteId, deploymentOwnerId);

    // 部署到目标桶（COS 或 S3 兼容，由 provider 决定）
    const uploadedCount = await deployZipToBucket(bucketCfg, zipEntries, targetPrefix, {
      ownerId: deploymentOwnerId,
      websiteId
    });
    const deployedSize = sumZipDeployedBytes(zipEntries);
    console.log(`部署完成，上传了 ${uploadedCount} 个文件 / ${deployedSize} 字节 → 桶 ${bucketCfg.name || bucketCfg.bucket}`);

    // 默认访问域名 = <websiteId 小写>.demox.site(由边缘函数 resolve 路由到桶 path)
    // 缓存刷新由部署流程主动提交 EdgeOne 清理任务，不再通过 ?v=timestamp 绕过。
    const finalUrl = buildDefaultSiteUrl(websiteId);

    // 默认名称:优先用 index.html 的 <title>,其次文件名
    const extractedTitle = extractTitleFromZip(zipEntries);
    const defaultName = extractedTitle || fileName;

    // 确保用量列存在（幂等），再写入 file_count/storage_size
    await ensureUsageColumns();

    // 保存到数据库
    if (existing.length > 0) {
      // 重部署:仅当用户从未自定义过名称(name 为空或等于旧 file_name)时,才用新默认名覆盖
      const prev = existing[0];
      const prevName = (prev.name || '').trim();
      const userCustomized = prevName && prevName !== (prev.file_name || '').trim();
      const nextName = userCustomized ? prevName : defaultName;
      await query(
        `UPDATE websites SET file_name = ?, name = ?, path = ?, url = ?, bucket_id = ?, file_count = ?, storage_size = ?, deployed_size = ?, updated_at = NOW() WHERE id = ?`,
        [fileName, nextName, targetPrefix, finalUrl, bucketIdToStore, validEntries.length, totalSize, deployedSize, prev.id]
      );
      // 自定义前缀路由实时读 websites.path 列，重部署后 path 已更新，无需额外操作
      // （边缘缓存最长 60s 后自然刷新）
    } else {
      await query(
        `INSERT INTO websites (user_id, website_id, file_name, name, path, url, tags, bucket_id, file_count, storage_size, deployed_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, websiteId, fileName, defaultName, targetPrefix, finalUrl, JSON.stringify([]), bucketIdToStore, validEntries.length, totalSize, deployedSize]
      );
    }

    const projectId = requestedProjectId
      ? await assignWebsiteProject(userId, websiteId, requestedProjectId)
      : (existing.length > 0
          ? (existing[0].project_id || await ensureWebsiteDefaultProject(existing[0].user_id, websiteId))
          : await ensureWebsiteDefaultProject(userId, websiteId));
    const projectKey = projectId ? await ensureProjectKeyForId(projectId) : null;
    const existingBinding = existing.length > 0 ? getSupportedOfficialBinding(existing[0]) : { subdomain: null, subdomainDomain: null };
    const cachePurge = await purgeSiteCache({
      websiteId,
      subdomain: existingBinding.subdomain,
      subdomainDomain: existingBinding.subdomainDomain,
      originHost: bucketCfg.originHost || LEGACY_BUCKET.originHost,
      originPath: targetPrefix,
      ownerId: deploymentOwnerId
    });
    const existingSubdomainDomain = existingBinding.subdomainDomain || defaultDomain;
    const customUrl = existing.length > 0
      ? buildCustomSiteUrl(existingBinding.subdomain, existingSubdomainDomain)
      : '';
    const preferredUrl = customUrl || finalUrl;

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        url: preferredUrl,
        defaultUrl: finalUrl,
        customUrl: customUrl || null,
        subdomainDomain: existing.length > 0 ? existingSubdomainDomain : null,
        preferredUrl,
        message: '部署成功',
        websiteId: websiteId,
        projectId: projectKey || projectId,
        projectInternalId: projectId,
        path: targetPrefix,
        uploadedCount,
        cachePurge,
        ...(cachePurgeWarning(cachePurge) ? { warning: cachePurgeWarning(cachePurge) } : {})
      })
    };
  } catch (error) {
    if (error && error.code === 'DEPLOY_IN_PROGRESS') {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, code: error.code, websiteId: error.websiteId, message: error.message })
      };
    }
    console.error('部署失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        message: error.message || '部署失败'
      })
    };
  } finally {
    await releaseWebsiteDeployLock(deployLock);
  }
}

function websiteStoragePrefix(ownerId, websiteId) {
  const owner = String(ownerId || '').trim();
  const id = String(websiteId || '').trim();
  if (!owner || !id) return '';
  if (/[\\/]/.test(owner) || /[\\/]/.test(id) || owner.includes('..') || id.includes('..')) return '';
  return `sites/${owner}/${id}/`;
}

function websitePrefixFromTarget(targetPrefix) {
  const parts = String(targetPrefix || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'sites') return '';
  return websiteStoragePrefix(parts[1], parts[2]);
}

function isWebsiteStoragePrefix(prefix) {
  const value = String(prefix || '');
  if (!value.startsWith('sites/') || !value.endsWith('/')) return false;
  const parts = value.slice(0, -1).split('/');
  if (parts.length !== 3 || parts[0] !== 'sites' || !parts[1] || !parts[2]) return false;
  if (parts[1].includes('..') || parts[2].includes('..')) return false;
  return true;
}

function staleObjectKeys(existingKeys, keepKeys, websitePrefix) {
  if (!isWebsiteStoragePrefix(websitePrefix)) return [];
  const keep = new Set(keepKeys);
  return (existingKeys || []).filter((key) => {
    const value = String(key || '');
    return value.startsWith(websitePrefix) && !keep.has(value);
  });
}

async function pruneWebsiteStorage(provider, websitePrefix, keepKeys) {
  if (!isWebsiteStoragePrefix(websitePrefix) || !keepKeys || keepKeys.length === 0) return 0;
  const existing = await provider.list(websitePrefix);
  const stale = staleObjectKeys(existing.map((item) => item.key), keepKeys, websitePrefix);
  const chunkSize = 50;
  for (let i = 0; i < stale.length; i += chunkSize) {
    await Promise.all(stale.slice(i, i + chunkSize).map((key) => provider.delete(key)));
  }
  return stale.length;
}

/**
 * 部署 ZIP 到指定桶（COS / S3 兼容，由 provider 抽象屏蔽差异）。
 * getCacheHeaders 返回的 Cache-Control 透传给 provider，由各适配器映射到自家字段。
 * 上传成功后清理同一站点前缀下不在本次 key 集合中的旧对象，避免 hashed 资源和改名目录残留。
 */
async function deployZipToBucket(bucketCfg, zipEntries, targetPrefix, opts = {}) {
  const provider = opts.provider || providerFor(bucketCfg);
  const records = getDeployEntryRecords(zipEntries);
  const normalizedPrefix = String(targetPrefix || '').replace(/\/+$/, '');
  const keys = records.map((rec) => `${normalizedPrefix}/${rec.name}`);

  await Promise.all(records.map((rec, index) => {
    const key = keys[index];
    const cacheHeaders = getCacheHeaders(key);
    return provider.put(key, rec.entry.getData(), {
      contentType: getContentType(key),
      cacheControl: cacheHeaders && cacheHeaders['Cache-Control']
    });
  }));

  const websitePrefix = websiteStoragePrefix(opts.ownerId, opts.websiteId) || websitePrefixFromTarget(targetPrefix);
  if (websitePrefix) {
    try {
      const removed = await pruneWebsiteStorage(provider, websitePrefix, keys);
      if (removed) console.log(`已清理 ${removed} 个旧部署文件 @ ${websitePrefix}`);
    } catch (e) {
      console.warn('清理旧部署文件失败:', e.message);
    }
  }

  return keys.length;
}

/**
 * 生成 8 位网站 ID
 */
function generateWebsiteId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * 从 zip 里提取入口 index.html 的 <title> 作为默认站点名称。
 * 优先取根目录 index.html，其次任意层级最浅的 index.html。提取不到返回 ''。
 */
function extractTitleFromZip(zipEntries) {
  try {
    const indexEntries = zipEntries.filter((e) => {
      if (e.isDirectory) return false;
      const name = e.entryName;
      if (name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
      return /(^|\/)index\.html$/i.test(name);
    });
    if (indexEntries.length === 0) return '';
    // 路径层级最浅的优先(最接近根)
    indexEntries.sort(
      (a, b) => a.entryName.split('/').length - b.entryName.split('/').length
    );
    const html = indexEntries[0].getData().toString('utf8');
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return '';
    // 去标签、压空白、解最常见的 HTML 实体
    let title = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    title = title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return title.slice(0, 255);
  } catch (e) {
    return '';
  }
}

/**
 * 规范化网站 ID
 */
function normalizeWebsiteId(id) {
  if (typeof id === 'string' && /^[A-Z0-9]{8}$/.test(id)) {
    return id;
  }
  return generateWebsiteId();
}

function normalizePositiveId(id) {
  if (id === null || id === undefined || id === '') return null;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function normalizeVisibility(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === VISIBILITY_PRIVATE) return VISIBILITY_PRIVATE;
  if (v === VISIBILITY_DISABLED) return VISIBILITY_DISABLED;
  return VISIBILITY_PUBLIC;
}

function isProtectedOfficialSite(site) {
  const id = String(site && site.website_id || '').trim().toUpperCase();
  const sub = String(site && site.subdomain || '').trim().toLowerCase();
  return id === 'EPX2UU43' || sub === 'www';
}

/**
 * 规范化文件名
 */
function normalizeFileNameNoExt(name) {
  try {
    const base = String(name || '').replace(/\.[^/.]+$/, '').toLowerCase();
    return /^[a-z0-9]+$/.test(base) ? base : 'dist';
  } catch {
    return 'dist';
  }
}

/**
 * 获取 Content-Type
 */
function getContentType(key) {
  const ext = (path.extname(key) || '').toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.txt': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf'
  };
  return types[ext];
}

/**
 * 获取缓存头
 */
function getCacheHeaders(key) {
  const ext = (path.extname(key) || '').toLowerCase();
  if (ext === '.html') {
    // Public HTML is purged on deploy. no-store forced every overseas
    // request through Chengdu COS (multi-second TTFB). Private sites
    // stay no-store in the edge function.
    return { 'Cache-Control': 'public, max-age=60' };
  }
  return { 'Cache-Control': 'public, max-age=31536000, immutable' };
}

/**
 * 获取 CORS 头
 */
function getCORSHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

exports.setCustomDomainRuntime = setCustomDomainRuntime;
exports.buildOriginPurgeTargets = buildOriginPurgeTargets;
exports.websiteStoragePrefix = websiteStoragePrefix;
exports.websitePrefixFromTarget = websitePrefixFromTarget;
exports.staleObjectKeys = staleObjectKeys;
exports.setPurgeRuntime = setPurgeRuntime;
exports.purgeSiteCache = purgeSiteCache;
exports.cachePurgeWarning = cachePurgeWarning;
exports.DEPLOY_LOCK_TTL_SECONDS = DEPLOY_LOCK_TTL_SECONDS;
exports.lookupGeoByIp = lookupGeoByIp;
exports._getGeoipForTest = getGeoip;
exports.acquireWebsiteDeployLock = acquireWebsiteDeployLock;
exports.releaseWebsiteDeployLock = releaseWebsiteDeployLock;
exports.deployZipToBucket = deployZipToBucket;
exports.PRODUCT_EVENT_NAMES = PRODUCT_EVENT_NAMES;
exports.classifyDeploySource = classifyDeploySource;
exports._adminBiForTest = adminBi;
exports._statTimeForTest = statTime;
exports._adminBiLibForTest = adminBiLib;
exports._deployBackfillForTest = { rows: DEPLOY_LOG_BACKFILL_ROWS, reset: () => { deployBackfillReady = null; } };
exports._logRedactForTest = { redactLogText, redactLogValue, installLogRedaction };
exports.checkCustomDomainIcp = checkCustomDomainIcp;
