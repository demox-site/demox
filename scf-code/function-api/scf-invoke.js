'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const keepAliveAgents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, scheduling: 'lifo' }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 8, scheduling: 'lifo' })
};

function getRoleCredentials() {
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENT_SECRET_KEY;
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN || '';
  if (!secretId || !secretKey) {
    const error = new Error('路由函数缺少调用运行时的临时密钥');
    error.code = 'RUNTIME_INVOKE_NOT_CONFIGURED';
    throw error;
  }
  return { secretId, secretKey, token };
}

function sign(key, message, encoding) {
  return crypto.createHmac('sha256', key).update(message).digest(encoding);
}

async function invokeScfFunction({
  functionName,
  namespace = 'demox',
  qualifier = '$LATEST',
  payload,
  region = process.env.SCF_REGION || process.env.TENCENTCLOUD_REGION || 'ap-guangzhou',
  timeoutMs = 30_000
} = {}) {
  const body = JSON.stringify({
    FunctionName: functionName,
    Namespace: namespace,
    Qualifier: qualifier,
    InvocationType: 'RequestResponse',
    ClientContext: JSON.stringify(payload)
  });
  const raw = await callScfApi({ action: 'Invoke', body, region, timeoutMs: Math.min(Math.max(timeoutMs, 1000) + 8_000, 300_000) });
  const parsed = JSON.parse(raw);
  if (parsed.Response?.Error) {
    const error = new Error(`${parsed.Response.Error.Code || 'TencentCloudError'}: ${parsed.Response.Error.Message || 'Invoke 失败'}`);
    error.code = 'RUNTIME_INVOKE_FAILED';
    throw error;
  }
  const result = parsed.Response?.Result || {};
  if (result.FunctionError) {
    const error = new Error(result.RetMsg || '运行时函数执行失败');
    error.code = 'FUNCTION_EXECUTION_ERROR';
    throw error;
  }
  const message = result.RetMsg || '{}';
  try {
    return JSON.parse(message);
  } catch {
    const error = new Error('运行时返回值无法解析');
    error.code = 'FUNCTION_EXECUTION_ERROR';
    throw error;
  }
}

function callScfApi({ action, body, region, timeoutMs }) {
  const { secretId, secretKey, token } = getRoleCredentials();
  const host = 'scf.tencentcloudapi.com';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const hashedPayload = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const credentialScope = `${date}/scf/tc3_request`;
  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, hashedCanonicalRequest].join('\n');
  const secretDate = sign(`TC3${secretKey}`, date);
  const secretService = sign(secretDate, 'scf');
  const secretSigning = sign(secretService, 'tc3_request');
  const signature = sign(secretSigning, stringToSign, 'hex');
  const headers = {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': '2018-04-16',
    'X-TC-Region': region
  };
  if (token) headers['X-TC-Token'] = token;

  return new Promise((resolve, reject) => {
    const request = https.request({ method: 'POST', host, path: '/', headers, timeout: timeoutMs }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(Object.assign(new Error(`SCF Invoke HTTP ${response.statusCode}`), { code: 'RUNTIME_INVOKE_FAILED' }));
          return;
        }
        resolve(data);
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('调用运行时超时'), { code: 'FUNCTION_TIMEOUT' })));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function invokeRuntimeHttp({
  url,
  secret,
  payload,
  timeoutMs = 30_000
} = {}) {
  if (!url) {
    const error = new Error('缺少运行时内网地址');
    error.code = 'RUNTIME_INVOKE_NOT_CONFIGURED';
    throw error;
  }
  const target = new URL(url);
  const body = JSON.stringify(payload);
  const transport = target.protocol === 'http:' ? http : https;
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-demox-runtime-token': secret || '',
    connection: 'keep-alive'
  };
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: `${target.pathname || '/'}${target.search || ''}` || '/',
      method: 'POST',
      headers,
      agent: keepAliveAgents[target.protocol] || keepAliveAgents['https:'],
      timeout: Math.min(Math.max(timeoutMs, 1000) + 8_000, 300_000)
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = JSON.parse(raw || '{}');
        } catch {
          reject(Object.assign(new Error('运行时返回值无法解析'), { code: 'FUNCTION_EXECUTION_ERROR' }));
          return;
        }
        if (response.statusCode === 401) {
          reject(Object.assign(new Error(parsed.error?.message || '运行时调用未授权'), { code: 'RUNTIME_INVOKE_FAILED' }));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(Object.assign(new Error(parsed.error?.message || `运行时 HTTP ${response.statusCode}`), {
            code: parsed.error?.code || 'RUNTIME_INVOKE_FAILED'
          }));
          return;
        }
        resolve(parsed);
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('调用运行时超时'), { code: 'FUNCTION_TIMEOUT' })));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

module.exports = { invokeScfFunction, invokeRuntimeHttp, getRoleCredentials };
