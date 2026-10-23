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
 *   - *_enc 为 NULL → 用当次请求的业务会话。session 模式下没有会话就抛错。
 *     未设 BUSINESS_ROLE_ARN 或回滚到 execution-role 时，才读环境变量。
 *     旧默认桶密钥永不入库。
 */

const { query } = require('./db.js');
const { decrypt } = require('./crypto.js');

let businessCredentialReader = null;

function credentialModuleUnavailable() {
  const error = new Error('业务云凭证不可用');
  error.code = 'BUSINESS_CREDENTIALS_UNAVAILABLE';
  return error;
}

/**
 * 网关进程内读请求级会话。加载业务凭证模块失败时抛错，不退回 TENCENTCLOUD_*。
 * session 模式下没有会话由该模块抛错，同样不读执行角色密钥。
 */
function tencentClientCredentials(env = process.env) {
  if (!businessCredentialReader) {
    let loaded;
    try {
      loaded = require('../../function-api/business-credentials.js');
    } catch {
      throw credentialModuleUnavailable();
    }
    if (typeof loaded.tencentClientCredentials !== 'function') throw credentialModuleUnavailable();
    businessCredentialReader = loaded.tencentClientCredentials;
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
 * session 模式下没有会话，或业务凭证模块加载失败，都抛错，不读 TENCENTCLOUD_*。
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
