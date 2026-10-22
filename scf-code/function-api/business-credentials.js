'use strict';

const crypto = require('crypto');
const https = require('https');

/**
 * 业务函数（auth / website / mcp）的云资源凭证。
 *
 * 网关用自己的 demox-runtime-role 凭证（SCF 注入，不带会话策略）去 AssumeRole
 * 同一个角色，带上只含 COS / EO / DNS / SES / CLS 的会话策略，把临时密钥放进
 * 当次平台池调用的环境变量。不落库，不写 DEMOX_BIZ_*，不改网关进程的环境变量。
 *
 * 证书 SSL 不走这条临时凭证：带会话策略的 token 调 SSL 会 invalid token。
 * cert-renew 和网关进程内的证书调用继续用角色凭证本身。
 *
 * 前缀开关默认空时，平台池不会派发。进程内的 /auth/send-code 仍进这里：
 * 用同一份角色、同一份会话策略、同一套缓存签发临时密钥，再交给 auth 发信。
 * 其它进程内路径不签发。
 * 回滚：清空 FUNCTIONS_PLATFORM_RUNTIME_PREFIXES，流量回到进程内；
 * 已发布的函数版本用 deploy-function-api 的 rollback（磷 version=19，易点 version_ek=3）。
 */

const BUSINESS_ROLE_ARN = 'qcs::cam::uin/100021031865:roleName/demox-runtime-role';
const BUSINESS_ROLE_SESSION_SECONDS = 900;
const BUSINESS_ROLE_REFRESH_SKEW_MS = 180_000;
const STS_HOST = 'sts.tencentcloudapi.com';
const ROLE_CREDENTIAL_ENV_KEYS = Object.freeze([
  'TENCENTCLOUD_SECRETID',
  'TENCENTCLOUD_SECRETKEY',
  'TENCENTCLOUD_SESSIONTOKEN'
]);
const BUSINESS_SLUGS = new Set(['auth', 'website', 'mcp']);
const CERTIFICATE_SLUGS = new Set(['cert-renew']);

/** 磷 demox-runtime-role 的会话策略。有效权限 = 角色策略 ∩ 这份策略。不含 ssl。 */
const BUSINESS_SESSION_POLICY = deepFreeze({
  version: '2.0',
  statement: [
    {
      effect: 'allow',
      action: [
        'name/cos:GetObject',
        'name/cos:PutObject',
        'name/cos:DeleteObject',
        'name/cos:GetBucket',
        'name/cos:HeadBucket'
      ],
      resource: [
        'qcs::cos:ap-chengdu:uid/1307257815:resource-game-1307257815',
        'qcs::cos:ap-chengdu:uid/1307257815:resource-game-1307257815/*'
      ]
    },
    {
      effect: 'allow',
      action: [
        'name/cos:GetObject',
        'name/cos:GetBucket',
        'name/cos:HeadBucket'
      ],
      resource: [
        'qcs::cos:ap-chengdu:uid/1307257815:demox-analytics-raw-1307257815',
        'qcs::cos:ap-chengdu:uid/1307257815:demox-analytics-raw-1307257815/*'
      ]
    },
    {
      effect: 'allow',
      action: [
        'teo:CreatePurgeTask',
        'teo:DescribeAccelerationDomains',
        'teo:ModifyHostsCertificate'
      ],
      resource: ['qcs::teo::uin/100021031865:zone/zone-3kplfkbflnd6']
    },
    {
      effect: 'allow',
      action: [
        'dnspod:DescribeRecordList',
        'dnspod:CreateRecord',
        'dnspod:DeleteRecord'
      ],
      resource: ['qcs::dnspod::uin/100021031865:domain/98754074']
    },
    {
      effect: 'allow',
      action: ['ses:SendEmail'],
      resource: ['qcs::ses:ap-hongkong:uin/100021031865:*']
    },
    {
      effect: 'allow',
      action: ['cls:pushLog', 'cls:UploadLog'],
      resource: ['qcs::cls:ap-guangzhou:uin/100021031865:topic/37a3159b-881c-4491-9592-59c1fa3e24b7']
    }
  ]
});

const BUSINESS_SESSION_POLICY_TEXT = JSON.stringify(BUSINESS_SESSION_POLICY);
if (Buffer.byteLength(BUSINESS_SESSION_POLICY_TEXT) > 2048) {
  throw new Error('业务会话策略超过 2048 字节');
}
if (sessionPolicyAllowsSsl(BUSINESS_SESSION_POLICY)) {
  throw new Error('业务会话策略不能包含 SSL');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sessionPolicyAllowsSsl(policy = BUSINESS_SESSION_POLICY) {
  const statements = Array.isArray(policy?.statement) ? policy.statement : [];
  for (const statement of statements) {
    const actions = Array.isArray(statement?.action) ? statement.action : [statement?.action];
    if (actions.some((action) => /ssl/i.test(String(action || '')))) return true;
  }
  return false;
}

function credentialKind(slug) {
  const name = String(slug || '');
  if (BUSINESS_SLUGS.has(name)) return 'business';
  if (CERTIFICATE_SLUGS.has(name)) return 'certificate';
  return '';
}

function roleSessionName(websiteId, functionId) {
  const cleaned = `plat-${String(websiteId || 'site')}-${String(functionId || 'fn')}`
    .replace(/[^A-Za-z0-9+=,.@_-]/g, '')
    .slice(0, 64);
  return cleaned.length >= 2 ? cleaned : 'plat-business';
}

/** 网关 / cert-renew 用的角色凭证。不调用 AssumeRole，不附加会话策略。 */
function roleCredentialEnv(env = process.env) {
  const output = {};
  for (const key of ROLE_CREDENTIAL_ENV_KEYS) {
    if (typeof env?.[key] === 'string' && env[key]) output[key] = env[key];
  }
  return output;
}

function stripLongLivedBizKeys(env) {
  if (!env || typeof env !== 'object') return env;
  for (const key of Object.keys(env)) {
    if (key.startsWith('DEMOX_BIZ_')) delete env[key];
  }
  return env;
}

function cloudEnvFromCredentials(credentials, kind) {
  const output = {};
  for (const key of ROLE_CREDENTIAL_ENV_KEYS) {
    if (typeof credentials?.[key] === 'string' && credentials[key]) output[key] = credentials[key];
  }
  if (!output.TENCENTCLOUD_SECRETID || !output.TENCENTCLOUD_SECRETKEY || !output.TENCENTCLOUD_SESSIONTOKEN) {
    const error = new Error('业务云凭证不可用');
    error.code = kind === 'certificate' ? 'CERT_ROLE_CREDENTIALS_MISSING' : 'BUSINESS_ROLE_ASSUME_FAILED';
    throw error;
  }
  return output;
}

function sign(key, message, encoding) {
  return crypto.createHmac('sha256', key).update(message).digest(encoding);
}

function buildAssumeRoleRequest({
  secretId,
  secretKey,
  token = '',
  roleArn = BUSINESS_ROLE_ARN,
  roleSessionName: sessionName,
  durationSeconds = BUSINESS_ROLE_SESSION_SECONDS,
  policy = BUSINESS_SESSION_POLICY,
  region = 'ap-guangzhou',
  timestamp = Math.floor(Date.now() / 1000)
} = {}) {
  if (sessionPolicyAllowsSsl(policy)) {
    const error = new Error('业务会话策略不能包含 SSL');
    error.code = 'BUSINESS_ROLE_POLICY_REJECTED';
    throw error;
  }
  const body = JSON.stringify({
    RoleArn: roleArn,
    RoleSessionName: sessionName,
    DurationSeconds: durationSeconds,
    Policy: JSON.stringify(policy)
  });
  const host = STS_HOST;
  const action = 'AssumeRole';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const hashedPayload = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const credentialScope = `${date}/sts/tc3_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, hashedCanonicalRequest].join('\n');
  const secretDate = sign(`TC3${secretKey}`, date);
  const secretService = sign(secretDate, 'sts');
  const secretSigning = sign(secretService, 'tc3_request');
  const signature = sign(secretSigning, stringToSign, 'hex');
  const headers = {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': '2018-08-13',
    'X-TC-Region': region
  };
  if (token) headers['X-TC-Token'] = token;
  return { host, headers, body };
}

function postSts({ host, headers, body, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      method: 'POST',
      host,
      path: '/',
      headers,
      timeout: timeoutMs
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(Object.assign(new Error(`STS HTTP ${response.statusCode}`), { code: 'AssumeRoleHttp' }));
          return;
        }
        resolve(data);
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('STS 超时'), { code: 'AssumeRoleTimeout' })));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function assumeBusinessRole({
  secretId,
  secretKey,
  token = '',
  roleArn = BUSINESS_ROLE_ARN,
  roleSessionName: sessionName,
  durationSeconds = BUSINESS_ROLE_SESSION_SECONDS,
  policy = BUSINESS_SESSION_POLICY,
  region = 'ap-guangzhou',
  timestamp = Math.floor(Date.now() / 1000),
  post = postSts
} = {}) {
  const request = buildAssumeRoleRequest({
    secretId,
    secretKey,
    token,
    roleArn,
    roleSessionName: sessionName,
    durationSeconds,
    policy,
    region,
    timestamp
  });
  const raw = await post(request);
  let parsed;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    const error = new Error('AssumeRole 响应无法解析');
    error.code = 'AssumeRoleInvalid';
    throw error;
  }
  if (parsed.Response?.Error) {
    const error = new Error('AssumeRole 被拒绝');
    error.code = String(parsed.Response.Error.Code || 'AssumeRoleFailed');
    throw error;
  }
  const credentials = parsed.Response?.Credentials || {};
  if (!credentials.TmpSecretId || !credentials.TmpSecretKey || !credentials.Token) {
    const error = new Error('AssumeRole 没有返回临时密钥');
    error.code = 'AssumeRoleIncomplete';
    throw error;
  }
  return {
    secretId: credentials.TmpSecretId,
    secretKey: credentials.TmpSecretKey,
    token: credentials.Token,
    expiration: parsed.Response.Expiration || ''
  };
}

function createBusinessCredentialProvider({
  clock = () => Date.now(),
  logger = console,
  env = process.env,
  assume = assumeBusinessRole,
  ttlMs = BUSINESS_ROLE_SESSION_SECONDS * 1000,
  refreshSkewMs = BUSINESS_ROLE_REFRESH_SKEW_MS
} = {}) {
  const cache = new Map();
  const inflight = new Map();

  async function assumeFor(request, source) {
    let assumed;
    try {
      assumed = await assume({
        secretId: source.TENCENTCLOUD_SECRETID,
        secretKey: source.TENCENTCLOUD_SECRETKEY,
        token: source.TENCENTCLOUD_SESSIONTOKEN || '',
        roleArn: BUSINESS_ROLE_ARN,
        roleSessionName: roleSessionName(request.websiteId, request.functionId),
        durationSeconds: BUSINESS_ROLE_SESSION_SECONDS,
        policy: BUSINESS_SESSION_POLICY
      });
    } catch (error) {
      logger?.warn?.(`[business-credentials] BUSINESS_ROLE_ASSUME_FAILED ${error.code || 'AssumeRoleFailed'}`);
      const wrapped = new Error('业务函数临时凭证签发失败');
      wrapped.code = error.code === 'BUSINESS_ROLE_POLICY_REJECTED'
        ? 'BUSINESS_ROLE_POLICY_REJECTED'
        : 'BUSINESS_ROLE_ASSUME_FAILED';
      throw wrapped;
    }
    const issuedAt = clock();
    let expiresAt = issuedAt + ttlMs;
    const parsed = Date.parse(assumed.expiration || '');
    if (Number.isFinite(parsed)) expiresAt = Math.min(expiresAt, parsed);
    if (!(expiresAt > issuedAt)) {
      const error = new Error('业务函数临时凭证签发失败');
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
    async credentialsFor(request = {}) {
      const sourceEnv = request.sourceEnv || env;
      if (request.kind === 'certificate') {
        return cloudEnvFromCredentials(roleCredentialEnv(sourceEnv), 'certificate');
      }
      if (request.kind !== 'business') return {};
      const source = roleCredentialEnv(sourceEnv);
      if (!source.TENCENTCLOUD_SECRETID || !source.TENCENTCLOUD_SECRETKEY || !source.TENCENTCLOUD_SESSIONTOKEN) {
        const error = new Error('网关缺少 demox-runtime-role 凭证，不能给业务函数签发临时密钥');
        error.code = 'BUSINESS_ROLE_SOURCE_MISSING';
        throw error;
      }
      const key = String(request.functionId || request.slug || 'business');
      const now = clock();
      const hit = cache.get(key);
      if (hit && hit.expiresAt - now > refreshSkewMs) return { ...hit.env };
      if (inflight.has(key)) return inflight.get(key);
      const pending = assumeFor(request, source).then((entry) => {
        cache.set(key, entry);
        return { ...entry.env };
      });
      inflight.set(key, pending);
      try {
        return await pending;
      } finally {
        inflight.delete(key);
      }
    }
  };
}

module.exports = {
  BUSINESS_ROLE_ARN,
  BUSINESS_ROLE_SESSION_SECONDS,
  BUSINESS_ROLE_REFRESH_SKEW_MS,
  BUSINESS_SESSION_POLICY,
  BUSINESS_SLUGS,
  CERTIFICATE_SLUGS,
  ROLE_CREDENTIAL_ENV_KEYS,
  sessionPolicyAllowsSsl,
  credentialKind,
  roleSessionName,
  roleCredentialEnv,
  stripLongLivedBizKeys,
  cloudEnvFromCredentials,
  buildAssumeRoleRequest,
  assumeBusinessRole,
  createBusinessCredentialProvider
};
