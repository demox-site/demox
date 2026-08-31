'use strict';

/**
 * Renew the Demox wildcard certificate with Let's Encrypt DNS-01, upload it
 * to Tencent SSL, and bind it to EdgeOne. The timer exits without writes when
 * the current certificate is outside the configured renewal window.
 */

const nodeCrypto = require('crypto');
const https = require('https');
const acme = require('acme-client');

const CONFIG = {
  domain: process.env.CERT_DOMAIN || '*.demox.site',
  san: (process.env.CERT_SAN || 'demox.site').split(',').map((value) => value.trim()).filter(Boolean),
  thresholdDays: parseInteger(process.env.RENEW_THRESHOLD_DAYS, 30),
  acmeDirectory: process.env.ACME_DIRECTORY || acme.directory.letsencrypt.production,
  acmeEmail: process.env.ACME_EMAIL || 'admin@demox.site',
  dnspodDomain: process.env.DNSPOD_DOMAIN || 'demox.site',
  zoneId: process.env.EDGEONE_ZONE_ID || process.env.TEO_ZONE_ID || 'zone-3kplfkbflnd6',
  region: process.env.SCF_REGION || 'ap-guangzhou',
  dnsPropagationMs: parseInteger(process.env.DNS_PROPAGATION_MS, 25_000)
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCreds() {
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TENCENT_SECRET_ID || process.env.COS_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENT_SECRET_KEY || process.env.COS_SECRET_KEY;
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN || '';
  if (!secretId || !secretKey) throw new Error('缺少腾讯云 API 密钥');
  return { secretId, secretKey, token };
}

async function callTencentCloudApi(options) {
  const { secretId, secretKey, token } = getCreds();
  const body = JSON.stringify(options.payload || {});
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${options.host}`,
    `x-tc-action:${options.action.toLowerCase()}`
  ].join('\n') + '\n';
  const hashedPayload = nodeCrypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const credentialScope = `${date}/${options.service}/tc3_request`;
  const hashedCanonicalRequest = nodeCrypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, hashedCanonicalRequest].join('\n');
  const sign = (key, message, encoding) => nodeCrypto.createHmac('sha256', key).update(message).digest(encoding);
  const secretDate = sign(`TC3${secretKey}`, date);
  const secretService = sign(secretDate, options.service);
  const secretSigning = sign(secretService, 'tc3_request');
  const signature = sign(secretSigning, stringToSign, 'hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers = {
    Authorization: authorization,
    'Content-Type': contentType,
    Host: options.host,
    'X-TC-Action': options.action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': options.version,
    'X-TC-Region': options.region || CONFIG.region
  };
  if (token) headers['X-TC-Token'] = token;

  const raw = await new Promise((resolve, reject) => {
    const request = https.request(
      { method: 'POST', host: options.host, path: '/', headers, timeout: 20_000 },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`腾讯云 API HTTP ${response.statusCode}`));
            return;
          }
          resolve(data);
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('腾讯云 API 请求超时')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });

  const parsed = JSON.parse(raw);
  if (parsed.Response?.Error) {
    const error = parsed.Response.Error;
    throw new Error(`${error.Code || 'TencentCloudError'}: ${error.Message || '请求失败'}`);
  }
  return parsed.Response || parsed;
}

function createApis(callApi = callTencentCloudApi) {
  return {
    dnspod: (action, payload) => callApi({
      service: 'dnspod', host: 'dnspod.tencentcloudapi.com', version: '2021-03-23', action, payload
    }),
    ssl: (action, payload) => callApi({
      service: 'ssl', host: 'ssl.tencentcloudapi.com', version: '2019-12-05', action, payload
    }),
    teo: (action, payload) => callApi({
      service: 'teo', host: 'teo.tencentcloudapi.com', version: '2022-09-01', action, payload
    })
  };
}

function createRenewService({ config = CONFIG, apis = createApis(), acmeClient = acme, wait = sleep, logger = console } = {}) {
  async function getCurrentCertExpiry() {
    const response = await apis.teo('DescribeAccelerationDomains', { ZoneId: config.zoneId, Limit: 50 });
    const domain = (response.AccelerationDomains || []).find((item) => item.DomainName === config.domain);
    const certificates = domain?.Certificate?.List || [];
    const certificate = certificates.find((item) => item.Type === 'upload') || certificates[0];
    if (!certificate?.ExpireTime) return { days: null, certId: certificate?.CertId };
    const days = Math.floor((new Date(certificate.ExpireTime).getTime() - Date.now()) / 86_400_000);
    return { days, certId: certificate.CertId };
  }

  async function addTxtRecord(dnsRecord, value) {
    const suffix = `.${config.dnspodDomain}`;
    let subDomain = dnsRecord.endsWith(suffix)
      ? dnsRecord.slice(0, -suffix.length)
      : (dnsRecord === config.dnspodDomain ? '@' : dnsRecord);
    if (!subDomain) subDomain = '@';
    const response = await apis.dnspod('CreateRecord', {
      Domain: config.dnspodDomain,
      SubDomain: subDomain,
      RecordType: 'TXT',
      RecordLine: '默认',
      Value: value,
      TTL: 600
    });
    return response.RecordId;
  }

  async function removeTxtRecord(recordId) {
    if (!recordId) return;
    try {
      await apis.dnspod('DeleteRecord', { Domain: config.dnspodDomain, RecordId: Number(recordId) });
    } catch (error) {
      logger.warn?.('清理 TXT 记录失败(忽略):', error.message);
    }
  }

  async function issueCertificate() {
    const accountKey = await acmeClient.crypto.createPrivateKey();
    const client = new acmeClient.Client({ directoryUrl: config.acmeDirectory, accountKey });
    const altNames = [config.domain, ...config.san];
    const [key, csr] = await acmeClient.crypto.createCsr({ commonName: config.domain, altNames });
    const cert = await client.auto({
      csr,
      email: config.acmeEmail,
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      skipChallengeVerification: true,
      challengeCreateFn: async (authorization, challenge, keyAuthorization) => {
        if (challenge.type !== 'dns-01') throw new Error('仅支持 dns-01');
        const dnsRecord = `_acme-challenge.${authorization.identifier.value}`;
        challenge._dnspodRecordId = await addTxtRecord(dnsRecord, keyAuthorization);
        logger.log?.(`已写入 TXT ${dnsRecord}，等待传播 ${config.dnsPropagationMs}ms`);
        await wait(config.dnsPropagationMs);
      },
      challengeRemoveFn: async (_authorization, challenge) => removeTxtRecord(challenge._dnspodRecordId)
    });
    return { cert, key: key.toString() };
  }

  async function uploadToSsl(cert, key) {
    const response = await apis.ssl('UploadCertificate', {
      CertificatePublicKey: cert,
      CertificatePrivateKey: key,
      CertificateType: 'SVR',
      Alias: `wildcard-demox.site-LE-${new Date().toISOString().slice(0, 10)}`,
      Repeatable: true
    });
    return response.CertificateId;
  }

  async function bindToEdgeOne(certId) {
    await apis.teo('ModifyHostsCertificate', {
      ZoneId: config.zoneId,
      Hosts: [config.domain],
      Mode: 'sslcert',
      ServerCertInfo: [{ CertId: certId }]
    });
  }

  async function renew({ force = false } = {}) {
    const { days, certId } = await getCurrentCertExpiry();
    logger.log?.(`当前证书 certId=${certId || '(无)'} 剩余天数=${days === null ? '未知' : days}`);
    if (!force && days !== null && days > config.thresholdDays) {
      return { renewed: false, reason: 'not_due', remainingDays: days, threshold: config.thresholdDays };
    }
    const { cert, key } = await issueCertificate();
    const newCertId = await uploadToSsl(cert, key);
    await bindToEdgeOne(newCertId);
    return { renewed: true, oldCertId: certId, newCertId, previousRemainingDays: days };
  }

  return { renew, getCurrentCertExpiry, addTxtRecord, removeTxtRecord, issueCertificate, uploadToSsl, bindToEdgeOne };
}

function parseForce(event = {}) {
  if (event.force === true) return true;
  if (!event.Message || typeof event.Message !== 'string') return false;
  try {
    return JSON.parse(event.Message)?.force === true;
  } catch {
    return false;
  }
}

exports.main = async (event = {}) => {
  try {
    const result = await createRenewService().renew({ force: parseForce(event) });
    console.log('续期结果:', JSON.stringify(result));
    return { success: true, ...result };
  } catch (error) {
    console.error('续期失败:', error?.stack || error);
    return { success: false, error: error.message };
  }
};

exports.__private = { CONFIG, parseInteger, parseForce, createApis, createRenewService, callTencentCloudApi };

if (require.main === module) {
  exports.main({ force: process.argv.includes('--force') })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    });
}
