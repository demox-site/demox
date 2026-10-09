'use strict';

/**
 * 运行时返回值加密（AES-256-GCM）。
 *
 * 腾讯云 SCF 会把每次调用的返回值原样写进日志（`Response RequestId:… RetMsg:…`），
 * 平台没有开关可以关掉。demox-user-nodejs 的返回值就是 auth / website / mcp
 * 的完整响应，里面有登录 JWT、OAuth refresh token 和用户邮箱。
 *
 * 路由（demox-function-api）每次调用生成一把一次性密钥，放在调用 payload 里
 * （SCF 不记录事件内容，只记录返回值）；运行时用这把密钥加密返回值，路由解密。
 * 日志里只剩密文。没有密钥的旧路由 / 旧运行时互相调用时按明文工作，可以分开发布。
 */

const crypto = require('crypto');

const SEAL_VERSION = 1;
const SEAL_ALG = 'A256GCM';

function createResponseSeal() {
  const key = crypto.randomBytes(32);
  return {
    key,
    descriptor: { v: SEAL_VERSION, alg: SEAL_ALG, key: key.toString('base64') }
  };
}

function sealKeyFromDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return null;
  if (descriptor.v !== SEAL_VERSION || descriptor.alg !== SEAL_ALG) return null;
  const key = Buffer.from(String(descriptor.key || ''), 'base64');
  return key.length === 32 ? key : null;
}

function sealPayload(payload, descriptor) {
  const key = sealKeyFromDescriptor(descriptor);
  if (!key) return payload;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    sealed: {
      v: SEAL_VERSION,
      alg: SEAL_ALG,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64')
    }
  };
}

function isSealed(response) {
  return Boolean(response && typeof response === 'object' && response.sealed && typeof response.sealed === 'object');
}

function openSealedPayload(response, seal) {
  if (!isSealed(response)) return response;
  const key = seal && Buffer.isBuffer(seal.key) ? seal.key : sealKeyFromDescriptor(seal && seal.descriptor);
  const box = response.sealed;
  if (!key || box.v !== SEAL_VERSION || box.alg !== SEAL_ALG) {
    throw Object.assign(new Error('运行时返回值无法解密'), { code: 'FUNCTION_EXECUTION_ERROR' });
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(box.iv || ''), 'base64'));
    decipher.setAuthTag(Buffer.from(String(box.tag || ''), 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(String(box.data || ''), 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw Object.assign(new Error('运行时返回值无法解密'), { code: 'FUNCTION_EXECUTION_ERROR' });
  }
}

module.exports = { createResponseSeal, sealPayload, openSealedPayload, isSealed, sealKeyFromDescriptor };
