/**
 * 存储抽象层：把"把文件写进某个云存储桶 / 列出某前缀对象"这件事，
 * 从具体厂商（腾讯云 COS / S3 兼容）里抽出来。
 *
 * 设计：
 *   - StorageProvider 是统一接口：put(key, body, opts) + list(prefix)。
 *   - createProvider(bucket) 按 bucket.provider 造对应适配器。bucket 形如：
 *       { provider, bucket, region, endpoint, secretId, secretKey }
 *     （secretId/secretKey 已由 buckets.js 解密/回退 env 处理好，这里只管用。）
 *   - COS 适配器用现有 cos-nodejs-sdk-v5。
 *   - S3 适配器用 @aws-sdk/client-s3，覆盖 R2/阿里云 OSS/Backblaze B2/MinIO
 *     （都讲 S3 协议，靠 endpoint 区分）。该依赖按需 require：只用 COS 时无需安装，
 *     注册 S3 兼容桶前需在 website-api 里 `npm i @aws-sdk/client-s3`。
 *
 * 注意：每次 put 都新建 client 成本低（COS/S3 client 是轻对象），且天然按桶隔离凭证，
 * 不做全局单例缓存，避免多桶凭证串号。
 */

const COS = require('cos-nodejs-sdk-v5');

/** COS 适配器 */
class CosProvider {
  constructor(cfg) {
    this.bucket = cfg.bucket;
    this.region = cfg.region;
    this.cos = new COS({
      SecretId: cfg.secretId,
      SecretKey: cfg.secretKey,
      // 仅当用 env 临时密钥(CAM 角色)且未显式传 key 时才带 session token
      SecurityToken: cfg.securityToken,
      UserAgent: 'Demox-Website-API'
    });
  }

  put(key, body, opts = {}) {
    const params = {
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Body: body
    };
    if (opts.contentType) params.ContentType = opts.contentType;
    if (opts.cacheControl) params.Headers = { 'Cache-Control': opts.cacheControl };
    return new Promise((resolve, reject) => {
      this.cos.putObject(params, (err, data) => (err ? reject(err) : resolve(data)));
    });
  }

  /** 列出 prefix 下全部对象，返回 [{ key, size }]。自动翻页。 */
  async list(prefix) {
    const out = [];
    let marker = '';
    let truncated = true;
    while (truncated) {
      const page = await new Promise((resolve, reject) => {
        this.cos.getBucket(
          { Bucket: this.bucket, Region: this.region, Prefix: prefix, Marker: marker, MaxKeys: 1000 },
          (err, data) => (err ? reject(err) : resolve(data))
        );
      });
      const contents = page.Contents || [];
      for (const o of contents) out.push({ key: o.Key, size: Number(o.Size || 0) });
      truncated = page.IsTruncated === 'true' || page.IsTruncated === true;
      marker = page.NextMarker || (contents.length ? contents[contents.length - 1].Key : '');
      if (!marker) break;
    }
    return out;
  }
}

/** S3 兼容适配器（R2/OSS/B2/MinIO）。@aws-sdk/client-s3 按需加载。 */
class S3Provider {
  constructor(cfg) {
    let mod;
    try {
      mod = require('@aws-sdk/client-s3');
    } catch (e) {
      throw new Error('注册 S3 兼容存储桶需先安装依赖：在 website-api 下执行 npm i @aws-sdk/client-s3');
    }
    this._S3 = mod;
    this.bucket = cfg.bucket;
    this.client = new mod.S3Client({
      region: cfg.region || 'auto',
      // R2/OSS/B2/MinIO 必须显式 endpoint；缺省走 AWS S3
      endpoint: cfg.endpoint || undefined,
      // 多数 S3 兼容服务需要 path-style（MinIO/部分 OSS 配置）
      forcePathStyle: cfg.forcePathStyle === undefined ? true : !!cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.secretId, secretAccessKey: cfg.secretKey }
    });
  }

  async put(key, body, opts = {}) {
    const params = { Bucket: this.bucket, Key: key, Body: body };
    if (opts.contentType) params.ContentType = opts.contentType;
    if (opts.cacheControl) params.CacheControl = opts.cacheControl;
    return this.client.send(new this._S3.PutObjectCommand(params));
  }

  async list(prefix) {
    const out = [];
    let token = undefined;
    do {
      const resp = await this.client.send(
        new this._S3.ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000
        })
      );
      for (const o of resp.Contents || []) out.push({ key: o.Key, size: Number(o.Size || 0) });
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}

/**
 * 按桶配置造一个 StorageProvider。
 * cfg.provider: 'cos' | 's3'（默认 cos，兼容旧调用）。
 */
function createProvider(cfg) {
  const provider = (cfg.provider || 'cos').toLowerCase();
  if (provider === 'cos') return new CosProvider(cfg);
  if (provider === 's3') return new S3Provider(cfg);
  throw new Error(`不支持的存储类型: ${cfg.provider}`);
}

module.exports = { createProvider, CosProvider, S3Provider };
