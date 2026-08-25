/**
 * 专业会员时效。充值开通时只复用 grantProMembership / computeProExpiry。
 *
 * - roles JSON 里仍存 'pro'
 * - pro_expires_at NULL = 永久（存量管理员开通保持不变）
 * - 到期后 effective roles 去掉 pro，配额和功能回到普通用户
 */

const MS_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PRO_DAYS = 30;

function parseRoleIds(raw) {
  let userRoles = raw;
  if (typeof userRoles === 'string') {
    try { userRoles = JSON.parse(userRoles || '[]'); } catch (e) { userRoles = []; }
  }
  if (!Array.isArray(userRoles)) userRoles = [];
  return userRoles.map((role) => String(role).trim().toLowerCase()).filter(Boolean);
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isProMembershipActive(expiresAt, now = new Date()) {
  const end = toDate(expiresAt);
  if (!end) return true;
  return end.getTime() > now.getTime();
}

function effectiveRoleIds(roleIds, proExpiresAt, now = new Date()) {
  const ids = parseRoleIds(roleIds);
  if (ids.includes('pro') && !isProMembershipActive(proExpiresAt, now)) {
    return ids.filter((id) => id !== 'pro');
  }
  return ids;
}

function remainingProDays(expiresAt, now = new Date()) {
  const end = toDate(expiresAt);
  if (!end) return null;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / MS_DAY));
}

function membershipSummary(roleIds, proExpiresAt, now = new Date()) {
  const stored = parseRoleIds(roleIds);
  const effective = effectiveRoleIds(stored, proExpiresAt, now);
  const hasStoredPro = stored.includes('pro');
  const active = hasStoredPro && isProMembershipActive(proExpiresAt, now);
  const expires = toDate(proExpiresAt);
  return {
    storedRoles: stored,
    effectiveRoles: effective,
    hasPro: active,
    proExpired: hasStoredPro && !active,
    proLifetime: hasStoredPro && !expires,
    proExpiresAt: expires ? expires.toISOString() : null,
    remainingDays: active && expires ? remainingProDays(expires, now) : (active ? null : 0)
  };
}

/**
 * 计算新的到期时间。未过期则从当前到期日续，已过期或新开通从现在起算。
 */
function computeProExpiry({ currentExpiresAt = null, days, lifetime = false, now = new Date() } = {}) {
  if (lifetime) return null;
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) {
    return toDate(currentExpiresAt);
  }
  const current = toDate(currentExpiresAt);
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + Math.round(n) * MS_DAY);
}

function resolveGrantExpiry({ hasPro, currentExpiresAt, proDays, proLifetime, now = new Date() } = {}) {
  if (proLifetime) return null;
  if (proDays != null && proDays !== '') return computeProExpiry({ currentExpiresAt, days: proDays, now });
  if (hasPro) return toDate(currentExpiresAt);
  return computeProExpiry({ days: DEFAULT_PRO_DAYS, now });
}

module.exports = {
  DEFAULT_PRO_DAYS,
  parseRoleIds,
  toDate,
  isProMembershipActive,
  effectiveRoleIds,
  remainingProDays,
  membershipSummary,
  computeProExpiry,
  resolveGrantExpiry
};
