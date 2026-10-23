/**
 * 存储桶注册表：storage_buckets 表的读取与凭证解析。
 *
 * 一行 = 一个可部署目标。关键字段：
 *   id, name, provider('cos'|'s3'), bucket, region, endpoint,
 *   origin_host(边缘回源域，如 sites.demox.site), force_path_style,
 *   secret_id_enc / secret_key_enc(AES-GCM 密文；NULL = 用 env),
 *   is_default(0/1), enabled(0/1)
 *
 * 凭证解析规则(getCreds)：
 *   - *_enc 非空 → 解密得到该桶专属密钥(自助注册的新桶)。
 *   - *_enc 为 NULL → 用当次请求的业务会话。没有会话、ARN 非法、或显式 session
 *     却没配 ARN 时抛错。只有没配 BUSINESS_ROLE_ARN，或 BUSINESS_CREDENTIALS_MODE=execution-role，
 *     才读环境变量。旧默认桶密钥永不入库。
 */

const { query } = require('./db.js');
const { decrypt } = require('./crypto.js');

let businessCredentialReader = null;

// 与 business-credentials.js 的白名单和 inProcessBusinessCredentialMode 保持一致。
// 统一包里两份文件都在（scf-code/function-api 与 scf-code/website-api）。
// 池里的临时副本解析不到相对路径时，只有 legacy 才读环境变量。
const PINNED_BUSINESS_ROLE_ARN = 'qcs::cam::uin/100021031865:roleName/demox-runtime-role';

function localCredentialMode(env = process.env) {
  const source = env || {};
  const mode = String(source.BUSINESS_CREDENTIALS_MODE || '').trim().toLowerCase();
  if (mode === 'execution-role') return 'legacy';
  const arn = String(source.BUSINESS_ROLE_ARN || '').trim();
  if (!arn) return mode === 'session' ? 'missing' : 'legacy';
  if (arn !== PINNED_BUSINESS_ROLE_ARN) return 'invalid';
  return 'session';
}

function readEnvCredentials(env = process.env) {
  const source = env || {};
  return {
    secretId: source.TENCENTCLOUD_SECRETID || source.TENCENT_SECRET_ID || source.COS_SECRET_ID || '',
    secretKey: source.TENCENTCLOUD_SECRETKEY || source.TENCENT_SECRET_KEY || source.COS_SECRET_KEY || '',
    token: source.TENCENTCLOUD_SESSIONTOKEN || ''
  };
}

function throwCredentialMode(mode) {
  const error = new Error('业务云凭证不可用');
  if (mode === 'invalid') error.code = 'BUSINESS_ROLE_ARN_INVALID';
  else if (mode === 'missing') error.code = 'BUSINESS_ROLE_ARN_MISSING';
  else error.code = 'BUSINESS_CREDENTIALS_UNAVAILABLE';
  throw error;
}

/**
 * 网关进程内读请求级会话。统一包能加载到 business-credentials.js。
 * 加载失败时：legacy（没配 ARN，或 execution-role）读环境变量；
 * session / 非法 ARN / 缺 ARN 抛错，不读 TENCENTCLOUD_*。
 */
function tencentClientCredentials(env = process.env) {
  if (!businessCredentialReader) {
    let loaded = null;
    try {
      loaded = require('../../function-api/business-credentials.js');
    } catch {
      loaded = null;
    }
    if (loaded && typeof loaded.tencentClientCredentials === 'function') {
      businessCredentialReader = loaded.tencentClientCredentials;
    } else {
      const mode = localCredentialMode(env);
      if (mode === 'legacy') return readEnvCredentials(env);
      throwCredentialMode(mode);
    }
  }
  return businessCredentialReader(env);
}

function rowToConfig(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider || 'cos',
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint || null,
    originHost: row.origin_host || null,
    forcePathStyle: row.force_path_style === null || row.force_path_style === undefined
      ? undefined
      : !!row.force_path_style,
    hasOwnCreds: !!(row.secret_id_enc && row.secret_key_enc),
    secretIdEnc: row.secret_id_enc || null,
    secretKeyEnc: row.secret_key_enc || null,
    isDefault: !!row.is_default,
    enabled: row.enabled === null || row.enabled === undefined ? true : !!row.enabled
  };
}

/** 默认桶（is_default=1 且 enabled）。新部署落这里。 */
async function getDefaultBucket() {
  const rows = await query(
    'SELECT * FROM storage_buckets WHERE is_default = 1 AND enabled = 1 ORDER BY id ASC LIMIT 1'
  );
  return rowToConfig(rows[0]);
}

async function getBucketById(id) {
  if (!id && id !== 0) return null;
  const rows = await query('SELECT * FROM storage_buckets WHERE id = ? LIMIT 1', [id]);
  return rowToConfig(rows[0]);
}

/** 列出所有桶（管理端用，不含密钥明文/密文）。 */
async function listBuckets() {
  const rows = await query('SELECT * FROM storage_buckets ORDER BY is_default DESC, id ASC');
  return rows.map(rowToConfig).map((b) => ({
    id: b.id,
    name: b.name,
    provider: b.provider,
    bucket: b.bucket,
    region: b.region,
    endpoint: b.endpoint,
    originHost: b.originHost,
    forcePathStyle: b.forcePathStyle,
    hasOwnCreds: b.hasOwnCreds,
    isDefault: b.isDefault,
    enabled: b.enabled
  }));
}

/**
 * 把一个桶配置解析成可直接喂给 storage.createProvider 的对象（含明文凭证）。
 * 凭证来源：自带密文则解密；否则用当次请求的业务会话。
 * legacy 才读环境变量。session 没有会话、ARN 非法、显式 session 缺 ARN，
 * 以及这些模式下模块加载失败，都抛错，不读 TENCENTCLOUD_*。
 * 返回对象只在内存里用，绝不外传。
 */
function resolveCreds(cfg) {
  let secretId;
  let secretKey;
  let securityToken;

  if (cfg.hasOwnCreds) {
    secretId = decrypt(cfg.secretIdEnc);
    secretKey = decrypt(cfg.secretKeyEnc);
  } else {
    const creds = tencentClientCredentials();
    secretId = creds.secretId;
    secretKey = creds.secretKey;
    securityToken = creds.token || undefined;
  }

  return {
    provider: cfg.provider,
    bucket: cfg.bucket,
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    secretId,
    secretKey,
    securityToken
  };
}

module.exports = {
  getDefaultBucket,
  getBucketById,
  listBuckets,
  resolveCreds,
  rowToConfig,
  tencentClientCredentials
};
