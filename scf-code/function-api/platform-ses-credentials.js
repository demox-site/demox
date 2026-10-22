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
 * 谁签发：demox-function-api 网关（易点或磷上该函数自己的运行角色，只用来调 STS）。
 * 签给谁：只给进程内 /auth/send-code。临时密钥放进 AsyncLocalStorage，不写 process.env，
 * 不交给 website、mcp、用户函数、demox-user-nodejs，也不交给 demox-runtime-role 那条业务会话。
 * 角色：磷上的 demox-platform-ses。完整 ARN 由云帆写进网关环境变量 PLATFORM_SES_ROLE_ARN。
 * 代码不写死 ARN，也不在缺省时回落到 demox-runtime-role 或 TENCENTCLOUD_*。
 * CAM（信任策略、角色策略）由云帆维护：易点和磷的 demox-function-api 运行角色可以 AssumeRole，
 * 角色策略只有 SES（发信 + 读模板），没有 COS / EO / DNS。
 */
const PLATFORM_SES_ROLE_ENV = 'PLATFORM_SES_ROLE_ARN';
const PLATFORM_SES_ROLE_NAME = 'demox-platform-ses';
const PLATFORM_SES_ACCOUNT_UIN = '100021031865';
const ROLE_ARN_PATTERN = /^qcs::cam::uin\/\d+:roleName\/[A-Za-z0-9+=,.@_-]{1,64}$/;

/** 会话策略再收一层：只有香港 SES 的发信和读模板。有效权限 = 角色策略 ∩ 这份策略。 */
const PLATFORM_SES_SESSION_POLICY = deepFreeze({
  version: '2.0',
  statement: [
    {
      effect: 'allow',
      action: ['ses:SendEmail', 'ses:GetEmailTemplate'],
      resource: [`qcs::ses:ap-hongkong:uin/${PLATFORM_SES_ACCOUNT_UIN}:*`]
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
