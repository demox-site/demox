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
 *   - *_enc 为 NULL → 回退 SCF 运行角色临时密钥(TENCENTCLOUD_*)。
 *     兼容本地/旧环境里的 COS_SECRET_ID/KEY。旧默认桶密钥永不入库。
 */

const { query } = require('./db.js');
const { decrypt } = require('./crypto.js');

// <biz-cloud-creds> —— 本块在 website-api/index.js、website-api/shared/buckets.js、
// cert-renew/index.js、auth-api/index.cjs 中逐字相同（`demox functions push` 只上传入口文件，
// 不能新增 shared 模块），由 scripts/biz-cloud-creds.test.mjs 校验。
// K2 基座/业务拆分：业务函数用自身受限密钥 DEMOX_BIZ_TC_SECRET_ID/KEY[/SESSION_TOKEN]
// （PLATFORM_SECRETS 密文存 EPX2UU43 env，平台池解密注入）访问 COS/EO/DNS/SES/CLS/SSL；
// 基座不持有、不代签业务凭证。DEMOX_BIZ_CREDS_STRICT=1 时绝不回落旧 TENCENTCLOUD_*
// （平台池发布必须开）；未开时保持现网行为（磷 v19 / 易点 v3 进程内执行）。K7 删回落。
const BIZ_CREDS_LEGACY_KEYS = [
  ['TENCENTCLOUD_SECRETID', 'TENCENTCLOUD_SECRETKEY', 'TENCENTCLOUD_SESSIONTOKEN'],
  ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', null],
  ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_SESSION_TOKEN']
];
function bizCredsStrict(env = process.env) {
  return String(env.DEMOX_BIZ_CREDS_STRICT || '') === '1';
}
function readBizCloudCreds(env = process.env) {
  const id = env.DEMOX_BIZ_TC_SECRET_ID;
  const key = env.DEMOX_BIZ_TC_SECRET_KEY;
  if (id && key) {
    return { secretId: String(id), secretKey: String(key), token: String(env.DEMOX_BIZ_TC_SESSION_TOKEN || ''), source: 'biz' };
  }
  if (id || key) throw new Error('DEMOX_BIZ_TC_SECRET_ID 与 DEMOX_BIZ_TC_SECRET_KEY 必须同时配置');
  if (bizCredsStrict(env)) return null;
  for (const [idKey, secretKey, tokenKey] of BIZ_CREDS_LEGACY_KEYS) {
    if (env[idKey] && env[secretKey]) {
      return { secretId: String(env[idKey]), secretKey: String(env[secretKey]), token: tokenKey ? String(env[tokenKey] || '') : '', source: 'legacy' };
    }
  }
  return null;
}
function requireBizCloudCreds(env = process.env) {
  const creds = readBizCloudCreds(env);
  if (!creds) {
    throw new Error(bizCredsStrict(env)
      ? '缺少业务云凭证 DEMOX_BIZ_TC_SECRET_ID/KEY（STRICT 模式不回落基座凭证）'
      : '缺少腾讯云 API 密钥');
  }
  return creds;
}
// </biz-cloud-creds>


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
    // 业务函数自身受限密钥（DEMOX_BIZ_TC_*）；STRICT 未开时兼容旧 TENCENTCLOUD_*/COS_SECRET_*。
    const creds = readBizCloudCreds();
    secretId = creds ? creds.secretId : undefined;
    secretKey = creds ? creds.secretKey : undefined;
    securityToken = creds && creds.token ? creds.token : undefined;
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
