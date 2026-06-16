/**
 * 存储桶密钥的对称加解密（AES-256-GCM）。
 *
 * 用途：自助注册的存储桶，其 SecretId/SecretKey 以密文形式落库（storage_buckets
 * 表的 *_enc 列）。主密钥来自 SCF 环境变量 ENCRYPTION_KEY，代码与 DB 都不含明文密钥。
 *
 * 安全权衡（已与用户确认）：DB 里存的是密文，主密钥泄露 = 全部桶密钥失守。
 * 因此 ENCRYPTION_KEY 必须只配在 SCF 环境变量，不得进代码/仓库/迁移脚本。
 *
 * 兼容：旧的默认桶不走加密——它的密钥仍只在 SCF 环境变量(COS_SECRET_ID/KEY)，
 * 入库时 *_enc 列为 NULL，buckets.js 读到 NULL 时回退 env(见 getCreds)。
 *
 * 密文格式：base64( salt(16) | iv(12) | authTag(16) | ciphertext )
 *   - 每条密文独立随机 salt，用 scrypt 从主密钥派生 32 字节 key，避免直接用主密钥。
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function getMasterKey() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || k.length < 16) {
    // 不静默降级：缺主密钥时调用方应能感知（注册新桶会失败，而非把明文落库）
    throw new Error('缺少环境变量 ENCRYPTION_KEY（或长度不足 16），无法加解密存储桶密钥');
  }
  return k;
}

function deriveKey(masterKey, salt) {
  return crypto.scryptSync(masterKey, salt, KEY_LEN);
}

/**
 * 加密明文字符串，返回 base64 密文。空值（''/null/undefined）返回 null，
 * 调用方据此把对应 *_enc 列写 NULL（= 使用 env 凭证）。
 */
function encrypt(plain) {
  if (plain === undefined || plain === null || plain === '') return null;
  const masterKey = getMasterKey();
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(masterKey, salt);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ct]).toString('base64');
}

/**
 * 解密 base64 密文。NULL/空 返回 null（= 该字段使用 env 凭证）。
 * 密文损坏或主密钥不匹配会抛错（GCM 认证失败），不静默返回错误明文。
 */
function decrypt(enc) {
  if (enc === undefined || enc === null || enc === '') return null;
  const masterKey = getMasterKey();
  const raw = Buffer.from(String(enc), 'base64');
  const salt = raw.subarray(0, SALT_LEN);
  const iv = raw.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = raw.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ct = raw.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = deriveKey(masterKey, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
