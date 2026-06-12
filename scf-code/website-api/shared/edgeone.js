/**
 * EdgeOne KV 操作封装
 * ---------------------------------------------------------------------------
 * 自定义子域名前缀功能：把 label -> { userId, websiteId, path } 写入 KV，
 * 供边缘函数 subdomain-router 查表路由。
 *
 * EdgeOne KV 没有对外 REST 写接口，所以写入统一通过 kv-admin 边缘函数
 * （共享密钥保护）完成。
 *
 * 依赖环境变量（website-api SCF 配置）：
 *   KV_ADMIN_URL     kv-admin 函数访问地址，如 https://kv-admin.demox.site
 *   KV_ADMIN_SECRET  与 kv-admin 函数里一致的共享密钥
 */

const https = require('https');

const KV_ADMIN_URL = process.env.KV_ADMIN_URL || '';
const KV_ADMIN_SECRET = process.env.KV_ADMIN_SECRET || '';

function httpsRequest(urlString, { method = 'POST', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(urlString);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${urlString}`));
    }
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method,
      headers
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}

async function kvCall(action, key, value) {
  if (!KV_ADMIN_URL || !KV_ADMIN_SECRET) {
    throw new Error('KV_ADMIN_URL / KV_ADMIN_SECRET 未配置');
  }
  const payload = { action, key };
  if (value !== undefined) payload.value = value;
  const body = JSON.stringify(payload);
  const res = await httpsRequest(KV_ADMIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KV-Admin-Secret': KV_ADMIN_SECRET,
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });
  const parsed = safeJson(res.body);
  if (res.statusCode !== 200 || !parsed.success) {
    throw new Error(`KV ${action} 失败: ${res.statusCode} ${res.body}`);
  }
  return parsed;
}

async function kvPut(key, value) {
  await kvCall('put', key, value);
  return true;
}

async function kvDelete(key) {
  await kvCall('delete', key);
  return true;
}

async function kvGet(key) {
  const parsed = await kvCall('get', key);
  return parsed.value || null;
}

module.exports = { kvPut, kvDelete, kvGet };
