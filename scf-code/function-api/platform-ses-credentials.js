'use strict';

const {
  BUSINESS_ROLE_ARN,
  BUSINESS_ROLE_SESSION_SECONDS,
  BUSINESS_ROLE_REFRESH_SKEW_MS,
  assumeBusinessRole,
  cloudEnvFromCredentials,
  roleCredentialEnv,
  sessionPolicyAllowsSsl
} = require('./business-credentials.js');

/**
 * 平台验证码邮件的专用角色。和用户函数的 demox-runtime-role 分开。
 *
 * Assumer：进程内是网关自己的运行角色；平台池是 demox-platform-nodejs 的
 * demox-platform-runtime-role。都只用来调 STS。业务会话的 TENCENTCLOUD_* 不能当源。
 * 签给谁：进程内和平台池的 /auth/send-code，以及 website 停用通知。
 * 临时密钥放进 AsyncLocalStorage，不写 process.env，不盖掉 TENCENTCLOUD_*。
 * mcp、用户函数、demox-user-nodejs 和 demox-runtime-role 的业务会话都拿不到。
 * Role：磷 demox-platform-ses。
 * ARN：qcs::cam::uin/100021031865:roleName/demox-platform-ses
 * 网关读自己的 PLATFORM_SES_ROLE_ARN。平台池 demox-platform-nodejs 也要有这份环境变量，
 * 并且 demox-platform-ses 必须信任 demox-platform-runtime-role（云帆，合并前）。
 * 缺省时不回落到 demox-runtime-role 或 TENCENTCLOUD_*，发信直接失败。
 * 用户池不能 Assume。
 * 角色策略与下面的会话策略相同：ses:SendEmail、ses:GetEmailIdentity、ses:GetEmailTemplate，资源 *。
 * 没有 COS / EO / DNS。
 */
const PLATFORM_SES_ROLE_ENV = 'PLATFORM_SES_ROLE_ARN';
const PLATFORM_SES_ROLE_NAME = 'demox-platform-ses';
const PLATFORM_SES_ACCOUNT_UIN = '100021031865';
const ROLE_ARN_PATTERN = /^qcs::cam::uin\/\d+:roleName\/[A-Za-z0-9+=,.@_-]{1,64}$/;

/** AssumeRole 必须带上的会话策略。有效权限 = 角色策略 ∩ 这份策略。只有这三项 SES，资源 *。 */
const PLATFORM_SES_SESSION_POLICY = deepFreeze({
  version: '2.0',
  statement: [
    {
      effect: 'allow',
      action: ['ses:SendEmail', 'ses:GetEmailIdentity', 'ses:GetEmailTemplate'],
      resource: ['*']
    }
  ]
});

const PLATFORM_SES_SESSION_POLICY_TEXT = JSON.stringify(PLATFORM_SES_SESSION_POLICY);
if (Buffer.byteLength(PLATFORM_SES_SESSION_POLICY_TEXT) > 2048) {
  throw new Error('平台发信会话策略超过 2048 字节');
}
if (sessionPolicyAllowsSsl(PLATFORM_SES_SESSION_POLICY) || sessionPolicyLeavesSes(PLATFORM_SES_SESSION_POLICY)) {
  throw new Error('平台发信会话策略只能包含 SES');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sessionPolicyLeavesSes(policy) {
  const statements = Array.isArray(policy?.statement) ? policy.statement : [];
  for (const statement of statements) {
    const actions = Array.isArray(statement?.action) ? statement.action : [statement?.action];
    if (actions.some((action) => !/^ses:/i.test(String(action || '')))) return true;
  }
  return statements.length === 0;
}

function readPlatformSesRoleArn(env = process.env) {
  const value = String(env?.[PLATFORM_SES_ROLE_ENV] || '').trim();
  if (!ROLE_ARN_PATTERN.test(value)) return '';
  const roleName = value.split(':roleName/')[1] || '';
  if (roleName === 'demox-runtime-role' || value === BUSINESS_ROLE_ARN) return '';
  return value;
}

function createPlatformSesCredentialProvider({
  clock = () => Date.now(),
  logger = console,
  env = process.env,
  assume = assumeBusinessRole,
  ttlMs = BUSINESS_ROLE_SESSION_SECONDS * 1000,
  refreshSkewMs = BUSINESS_ROLE_REFRESH_SKEW_MS
} = {}) {
  const cache = new Map();
  const inflight = new Map();

  async function assumeFor(roleArn, source) {
    let assumed;
    try {
      assumed = await assume({
        secretId: source.TENCENTCLOUD_SECRETID,
        secretKey: source.TENCENTCLOUD_SECRETKEY,
        token: source.TENCENTCLOUD_SESSIONTOKEN || '',
        roleArn,
        roleSessionName: 'plat-ses',
        durationSeconds: BUSINESS_ROLE_SESSION_SECONDS,
        policy: PLATFORM_SES_SESSION_POLICY
      });
    } catch (error) {
      const code = /^[A-Za-z0-9._:-]{1,64}$/.test(String(error?.code || ''))
        ? String(error.code)
        : 'AssumeRoleFailed';
      logger?.warn?.(`[platform-ses] BUSINESS_ROLE_ASSUME_FAILED ${code}`);
      const wrapped = new Error('平台发信凭证签发失败');
      wrapped.code = 'BUSINESS_ROLE_ASSUME_FAILED';
      throw wrapped;
    }
    const issuedAt = clock();
    let expiresAt = issuedAt + ttlMs;
    const parsed = Date.parse(assumed.expiration || '');
    if (Number.isFinite(parsed)) expiresAt = Math.min(expiresAt, parsed);
    if (!(expiresAt > issuedAt)) {
      const error = new Error('平台发信凭证签发失败');
      error.code = 'BUSINESS_ROLE_ASSUME_FAILED';
      throw error;
    }
    return {
      expiresAt,
      env: cloudEnvFromCredentials({
        TENCENTCLOUD_SECRETID: assumed.secretId,
        TENCENTCLOUD_SECRETKEY: assumed.secretKey,
        TENCENTCLOUD_SESSIONTOKEN: assumed.token
      }, 'business')
    };
  }

  return {
    async credentialsFor() {
      const sourceEnv = env || process.env;
      const roleArn = readPlatformSesRoleArn(sourceEnv);
      if (!roleArn) {
        const error = new Error('平台发信角色未配置');
        error.code = 'PLATFORM_SES_ROLE_MISSING';
        throw error;
      }
      const source = roleCredentialEnv(sourceEnv);
      if (!source.TENCENTCLOUD_SECRETID || !source.TENCENTCLOUD_SECRETKEY || !source.TENCENTCLOUD_SESSIONTOKEN) {
        const error = new Error('网关不能签发平台发信凭证');
        error.code = 'BUSINESS_ROLE_ASSUME_FAILED';
        throw error;
      }
      const now = clock();
      const hit = cache.get(roleArn);
      if (hit && hit.expiresAt - now > refreshSkewMs) return { ...hit.env };
      if (inflight.has(roleArn)) return inflight.get(roleArn);
      const pending = assumeFor(roleArn, source).then((entry) => {
        cache.set(roleArn, entry);
        return { ...entry.env };
      });
      inflight.set(roleArn, pending);
      try {
        return await pending;
      } finally {
        inflight.delete(roleArn);
      }
    }
  };
}

function parseMailBody(value) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeMailPath(path) {
  const value = String(path || '/').split('?')[0].replace(/\/+/g, '/');
  if (value.length > 1 && value.endsWith('/')) return value.slice(0, -1);
  return value || '/';
}

function isAuthSendCodeRequest(request = {}) {
  const method = String(request.method || request.httpMethod || 'POST').toUpperCase();
  if (method !== 'POST') return false;
  const body = parseMailBody(request.body);
  const path = normalizeMailPath(request.path || request.rawPath || body.path || '/');
  return path === '/auth/send-code' || body.action === 'send_code';
}

function isWebsiteDisableNoticeRequest(request = {}) {
  const body = parseMailBody(request.body);
  const path = normalizeMailPath(request.path || request.rawPath || body.path || '/');
  const action = String(body.action || '');
  const visibility = String(body.visibility || '').trim().toLowerCase();
  const targetsVisibility = action === 'update_visibility' || path.endsWith('/update-visibility');
  return targetsVisibility && visibility === 'disabled';
}

function requestNeedsPlatformSes(payload = {}) {
  const packageName = String(payload.packageName || '');
  const request = payload.request || {};
  if (packageName === 'demox-auth') return isAuthSendCodeRequest(request);
  if (packageName === 'demox-website') return isWebsiteDisableNoticeRequest(request);
  return false;
}

/**
 * 平台池进程用自己的执行角色（process.env，不是调用环境里的业务会话）
 * AssumeRole demox-platform-ses。返回值只给当次 AsyncLocalStorage。
 * 不需要发信的调用返回 null。角色没配或签发失败直接抛，不回落。
 */
async function sesCredentialsForPoolMail(payload, {
  env = process.env,
  assume,
  logger = console,
  provider = null
} = {}) {
  if (!requestNeedsPlatformSes(payload)) return null;
  const resolved = provider || createPlatformSesCredentialProvider({ env, assume, logger });
  const cloud = await resolved.credentialsFor();
  return {
    secretId: cloud.TENCENTCLOUD_SECRETID,
    secretKey: cloud.TENCENTCLOUD_SECRETKEY,
    token: cloud.TENCENTCLOUD_SESSIONTOKEN || ''
  };
}

module.exports = {
  PLATFORM_SES_ROLE_ENV,
  PLATFORM_SES_ROLE_NAME,
  PLATFORM_SES_ACCOUNT_UIN,
  PLATFORM_SES_SESSION_POLICY,
  readPlatformSesRoleArn,
  createPlatformSesCredentialProvider,
  isAuthSendCodeRequest,
  isWebsiteDisableNoticeRequest,
  requestNeedsPlatformSes,
  sesCredentialsForPoolMail
};
