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
 *   - *_enc 为 NULL → 回退 SCF 环境变量(旧默认桶：COS_SECRET_ID/KEY，
 *     或临时密钥 TENCENTCLOUD_*)。这样旧桶密钥永不入库，沿用既有约定。
 */

const { query } = require('./db.js');
const { decrypt } = require('./crypto.js');

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
 * 凭证来源：自带密文则解密；否则回退 env。返回对象**只在内存里用**，绝不外传。
 */
function resolveCreds(cfg) {
  let secretId;
  let secretKey;
  let securityToken;

  if (cfg.hasOwnCreds) {
    secretId = decrypt(cfg.secretIdEnc);
    secretKey = decrypt(cfg.secretKeyEnc);
  } else {
    // 旧默认桶：用 SCF 环境变量。兼容永久密钥与 CAM 角色临时密钥。
    secretId = process.env.COS_SECRET_ID || process.env.TENCENTCLOUD_SECRETID;
    secretKey = process.env.COS_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY;
    securityToken = process.env.COS_SECRET_KEY ? undefined : process.env.TENCENTCLOUD_SESSIONTOKEN;
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

module.exports = { getDefaultBucket, getBucketById, listBuckets, resolveCreds, rowToConfig };
