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
 * Assumer：demox-function-api 网关自己的运行角色，只用来调 STS。
 * 签给谁：只给进程内 /auth/send-code。临时密钥放进 AsyncLocalStorage，不写 process.env。
 * website、mcp、用户函数、demox-user-nodejs 和 demox-runtime-role 的业务会话都拿不到。
 * Role：磷 demox-platform-ses。
 * ARN：qcs::cam::uin/100021031865:roleName/demox-platform-ses
 * 云帆已把该值写入易点和磷 demox-function-api 的 develop 与 production：PLATFORM_SES_ROLE_ARN。
 * 代码仍只读这个环境变量，缺省时不回落到 demox-runtime-role 或 TENCENTCLOUD_*。
 * 信任（CAM，云帆已配）：易点/磷的 demox-runtime-role（网关）和 demox-platform-runtime-role（平台池）。
 * 用户池不能 Assume。本 PR 的代码路径只有进程内 auth 发信。
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

module.exports = {
  PLATFORM_SES_ROLE_ENV,
  PLATFORM_SES_ROLE_NAME,
  PLATFORM_SES_ACCOUNT_UIN,
  PLATFORM_SES_SESSION_POLICY,
  readPlatformSesRoleArn,
  createPlatformSesCredentialProvider
};
