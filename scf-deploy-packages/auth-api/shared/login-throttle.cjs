'use strict';
/**
 * 密码登录失败限速（按账号，不按 IP）。
 *
 * 规则：
 * - 同一邮箱（规范化后取 sha256，表里不存明文）失败到第 5 次时，要等 1 分钟；之后每多失败一次等待翻倍
 *   （2、4、8 分钟），最多 15 分钟。不会永久锁号。
 * - 等待期间连正确密码也拒绝，返回同样的 429。
 * - 登录成功清零；或者从最后一次失败（及等待结束）起 15 分钟内没有新的失败，也清零。
 * - 邮箱存不存在走同一条路：同样计数、同样的提示、同样跑一次 bcrypt（不存在时比对一个假哈希）。
 *
 * 并发：每次尝试先用一条带条件的 UPDATE「占一次名额」（WHERE locked_until <= now），
 * 达到阈值的那次在占名额时就写上 locked_until，所以并发请求不能在等待开始前多试几次。
 * 时间都用毫秒整数（BIGINT），不受数据库时区影响。
 *
 * fail-open：限速表出错时放行，并在旁表 login_throttle_fail_open 记一条（op / code / 时间），
 * 不依赖日志（function-api 日志可能停写）。定时巡检看这张表有没有新行即可报警。
 */
const crypto = require('crypto');

const THRESHOLD = 5;
const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
/** reserve 时约 1% 概率顺手清掉窗口外的旧行，避免随机邮箱把表撑大。 */
const CLEANUP_PROBABILITY = 0.01;

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS login_throttle (
  email_hash CHAR(64) NOT NULL PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0,
  last_failed_at BIGINT NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const CREATE_FAIL_OPEN_TABLE_SQL = `CREATE TABLE IF NOT EXISTS login_throttle_fail_open (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  op VARCHAR(16) NOT NULL,
  code VARCHAR(64) NOT NULL,
  created_at_ms BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created_at_ms (created_at_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function emailKey(normalizedEmail) {
  return crypto.createHash('sha256').update(String(normalizedEmail || ''), 'utf8').digest('hex');
}

/** 第 n 次失败之后要等多久（毫秒）；n < 5 不用等。 */
function delayForFailures(n) {
  if (n < THRESHOLD) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (n - THRESHOLD), MAX_DELAY_MS);
}

/** 给人看的等待时长：不足 1 分钟按 1 分钟。 */
function waitText(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return `${minutes} 分钟`;
}

function throttledMessage(ms) {
  return `登录尝试次数过多，请 ${waitText(ms)}后再试。`;
}

/** 限速表出错时放行（fail-open），但每次都记一行告警：只有标记、操作和错误码，不含邮箱、hash、SQL 或 token。 */
function failOpenCode(error) {
  const code = error && (error.code || error.name);
  return /^[A-Za-z0-9_.-]{1,64}$/.test(String(code || '')) ? String(code) : 'UNKNOWN';
}

function warnFailOpen(log, op, error) {
  const line = `[login-throttle] FAIL_OPEN op=${op} code=${failOpenCode(error)}`;
  if (log && typeof log.warn === 'function') log.warn(line);
  else if (log && typeof log.error === 'function') log.error(line);
}

function createLoginThrottle({ query, now = () => Date.now(), log = console, random = Math.random } = {}) {
  let ready = null;
  function ensureTable() {
    if (!ready) {
      ready = Promise.all([
        query(CREATE_TABLE_SQL),
        query(CREATE_FAIL_OPEN_TABLE_SQL)
      ]).then(() => undefined).catch((error) => { ready = null; throw error; });
    }
    return ready;
  }

  /** 旁表计数：不依赖日志。计数本身失败时只吞掉，不再递归 fail-open。 */
  async function recordFailOpen(op, error) {
    const code = failOpenCode(error);
    warnFailOpen(log, op, error);
    try {
      await ensureTable();
      await query(
        'INSERT INTO login_throttle_fail_open (op, code, created_at_ms) VALUES (?, ?, ?)',
        [op, code, now()]
      );
    } catch (_) {
      // 旁表也挂了就只靠上面的 warn；不再抛，避免盖住主路径的放行。
    }
  }

  /** 清掉窗口外旧行。列是毫秒 BIGINT，用参数比较，不用 NOW()-INTERVAL（会和 BIGINT 对不上）。 */
  async function maybeCleanup(t) {
    if (random() >= CLEANUP_PROBABILITY) return;
    try {
      await query(
        'DELETE FROM login_throttle WHERE GREATEST(last_failed_at, locked_until) < ?',
        [t - WINDOW_MS]
      );
    } catch (_) {
      // 清理失败不影响登录路径
    }
  }

  /**
   * 占一次尝试名额。返回 { allowed: true, failures, lockedUntil } 或 { allowed: false, retryAfterMs }。
   * 数据库出错时放行（fail open）并记一条旁表计数，避免限速表的问题把所有人都挡在门外。
   */
  async function reserve(normalizedEmail) {
    const key = emailKey(normalizedEmail);
    const t = now();
    try {
      await ensureTable();
      await maybeCleanup(t);
      await query('INSERT IGNORE INTO login_throttle (email_hash, failures, last_failed_at, locked_until) VALUES (?, 0, 0, 0)', [key]);
      // 注意 MySQL 单表 UPDATE 从左到右赋值、后面的表达式看到前面已改过的值：先算 locked_until（用旧的 failures），再改 failures。
      // f0 = 窗口过期（最后一次失败和等待结束都已过去 15 分钟）就当 0，否则沿用。
      const f0 = 'IF(GREATEST(last_failed_at, locked_until) + ? <= ?, 0, failures)';
      const result = await query(
        `UPDATE login_throttle
            SET locked_until = IF(${f0} + 1 >= ?, ? + LEAST(? * POW(2, ${f0} + 1 - ?), ?), locked_until),
                failures = ${f0} + 1,
                last_failed_at = ?
          WHERE email_hash = ? AND locked_until <= ?`,
        [WINDOW_MS, t, THRESHOLD, t, BASE_DELAY_MS, WINDOW_MS, t, THRESHOLD, MAX_DELAY_MS, WINDOW_MS, t, t, key, t]
      );
      if (!result || Number(result.affectedRows) === 0) {
        const rows = await query('SELECT locked_until FROM login_throttle WHERE email_hash = ?', [key]);
        const lockedUntil = Number(rows?.[0]?.locked_until || 0);
        return { allowed: false, retryAfterMs: Math.max(1000, lockedUntil - t) };
      }
      const rows = await query('SELECT failures, locked_until FROM login_throttle WHERE email_hash = ?', [key]);
      return { allowed: true, failures: Number(rows?.[0]?.failures || 0), lockedUntil: Number(rows?.[0]?.locked_until || 0), at: t };
    } catch (error) {
      await recordFailOpen('reserve', error);
      return { allowed: true, failures: 0, lockedUntil: 0, at: t, degraded: true };
    }
  }

  /** 登录成功：清零。 */
  async function clear(normalizedEmail) {
    try {
      await query('DELETE FROM login_throttle WHERE email_hash = ?', [emailKey(normalizedEmail)]);
    } catch (error) {
      await recordFailOpen('clear', error);
    }
  }

  return { reserve, clear, ensureTable, maybeCleanup, recordFailOpen };
}

module.exports = {
  createLoginThrottle,
  emailKey,
  delayForFailures,
  throttledMessage,
  waitText,
  failOpenCode,
  THRESHOLD,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  WINDOW_MS,
  CLEANUP_PROBABILITY,
  CREATE_TABLE_SQL,
  CREATE_FAIL_OPEN_TABLE_SQL
};
