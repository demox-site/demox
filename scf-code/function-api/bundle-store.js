'use strict';

const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');

function bundleKey(functionId, version) {
  const id = String(functionId || '');
  const number = Number(version);
  if (!/^fn_[A-Za-z0-9_-]{8,32}$/.test(id) || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error('非法函数版本标识');
  }
  return `functions/${id}/${number}/bundle.mjs`;
}

class InMemoryBundleStore {
  constructor() {
    this.objects = new Map();
  }

  async put(key, body) {
    const buffer = Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(String(body));
    this.objects.set(key, buffer);
    return { key, sizeBytes: buffer.length };
  }

  async getBuffer(key) {
    const value = this.objects.get(key);
    if (!value) {
      const error = new Error('函数代码不存在');
      error.code = 'NO_SUCH_KEY';
      throw error;
    }
    return Buffer.from(value);
  }

  async delete(key) {
    this.objects.delete(key);
  }
}

class CosBundleStore {
  constructor(config, client = null) {
    if (!config?.bucket || !config?.region) throw new Error('COS 函数代码桶缺少 bucket 或 region');
    this.bucket = config.bucket;
    this.region = config.region;
    this.cos = client || new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
      SecurityToken: config.securityToken,
      UserAgent: 'Demox-Function-API'
    });
  }

  put(key, body) {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    return new Promise((resolve, reject) => {
      this.cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Body: buffer,
          ContentType: 'application/javascript; charset=utf-8',
          Headers: { 'Cache-Control': 'private, no-store' }
        },
        (error, data) => (error ? reject(error) : resolve({ ...data, key, sizeBytes: buffer.length }))
      );
    });
  }

  getBuffer(key) {
    return new Promise((resolve, reject) => {
      this.cos.getObject(
        { Bucket: this.bucket, Region: this.region, Key: key },
        (error, data) => {
          if (error) return reject(error);
          const body = data?.Body;
          return resolve(Buffer.isBuffer(body) ? body : Buffer.from(body || ''));
        }
      );
    });
  }

  delete(key) {
    return new Promise((resolve, reject) => {
      this.cos.deleteObject(
        { Bucket: this.bucket, Region: this.region, Key: key },
        (error, data) => (error ? reject(error) : resolve(data))
      );
    });
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { bundleKey, InMemoryBundleStore, CosBundleStore, sha256 };
