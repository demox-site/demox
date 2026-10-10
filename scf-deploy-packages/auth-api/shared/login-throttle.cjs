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
 */
const crypto = require('crypto');

const THRESHOLD = 5;
const BASE_DELAY_MS = 60 * 1000;
const MAX_DELAY_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS login_throttle (
  email_hash CHAR(64) NOT NULL PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0,
  last_failed_at BIGINT NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

function createLoginThrottle({ query, now = () => Date.now(), log = console } = {}) {
  let ready = null;
  function ensureTable() {
    if (!ready) ready = query(CREATE_TABLE_SQL).catch((error) => { ready = null; throw error; });
    return ready;
  }

  /**
   * 占一次尝试名额。返回 { allowed: true, failures, lockedUntil } 或 { allowed: false, retryAfterMs }。
   * 数据库出错时放行（fail open）并记一条日志，避免限速表的问题把所有人都挡在门外。
   */
  async function reserve(normalizedEmail) {
    const key = emailKey(normalizedEmail);
    const t = now();
    try {
      await ensureTable();
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
      log.error('登录限速表不可用，本次放行:', error && error.code ? error.code : error);
      return { allowed: true, failures: 0, lockedUntil: 0, at: t, degraded: true };
    }
  }

  /** 登录成功：清零。 */
  async function clear(normalizedEmail) {
    try {
      await query('DELETE FROM login_throttle WHERE email_hash = ?', [emailKey(normalizedEmail)]);
    } catch (error) {
      log.error('清除登录限速记录失败:', error && error.code ? error.code : error);
    }
  }

  return { reserve, clear, ensureTable };
}

module.exports = {
  createLoginThrottle,
  emailKey,
  delayForFailures,
  throttledMessage,
  waitText,
  THRESHOLD,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  WINDOW_MS,
  CREATE_TABLE_SQL
};
