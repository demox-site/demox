'use strict';

/**
 * Renew the Demox wildcard certificate with Let's Encrypt DNS-01, upload it
 * to Tencent SSL, and bind it to EdgeOne plus the SCF custom domain
 * api.demox.site. The timer exits without writes when the current certificate
 * is outside the configured renewal window, except to sync SCF if it still
 * points at a stale certificate.
 *
 * Attempt order is dns-01, then dns-01-retry (longer DNS wait, same DNSPod
 * CreateRecord / DeleteRecord). http-01 and tls-alpn-01 cannot issue a
 * wildcard and are rejected. Failures throw CERT_RENEW_FAILED so the timer
 * invocation fails; they are not returned as success:false.
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
  scfCustomDomain: process.env.SCF_CUSTOM_DOMAIN || 'api.demox.site',
  dnsPropagationMs: parseInteger(process.env.DNS_PROPAGATION_MS, 25_000),
  dnsRetryPropagationMs: parseInteger(process.env.DNS_RETRY_PROPAGATION_MS, 60_000)
};

// 通配符只能走 dns-01。这两个挑战不能签发 *.demox.site，不放进备用顺序。
const WILDCARD_REJECTED_CHALLENGES = ['http-01', 'tls-alpn-01'];

function buildAttemptOrder(config) {
  return [
    { id: 'dns-01', propagationMs: config.dnsPropagationMs },
    { id: 'dns-01-retry', propagationMs: config.dnsRetryPropagationMs ?? config.dnsPropagationMs }
  ];
}

function isRetryableIssuanceError(error) {
  return error?.retryable !== false;
}

function rejectUnsupportedChallenge(challenge, config) {
  if (challenge?.type === 'dns-01') return;
  const type = challenge?.type || '未知挑战';
  const names = [config.domain, ...(config.san || [])].filter(Boolean);
  const wildcard = names.some((name) => String(name).startsWith('*.'));
  const error = new Error(
    WILDCARD_REJECTED_CHALLENGES.includes(type)
      ? (wildcard
        ? `证书含通配符（${names.join(', ')}），${type} 不能签发，不会当作 dns-01 的备用`
        : `${type} 不在本任务的挑战顺序里，只使用 dns-01`)
      : `仅接受 dns-01，收到 ${type}`
  );
  error.retryable = false;
  error.code = 'CERT_CHALLENGE_UNSUPPORTED';
  throw error;
}

function markDnsFailure(error) {
  const wrapped = new Error(`DNSPod 写入 TXT 失败: ${error.message}`);
  wrapped.retryable = false;
  wrapped.code = 'CERT_DNS_FAILED';
  wrapped.cause = error;
  return wrapped;
}

function annotateRenewError(error, step, days) {
  if (!error.step) error.step = step;
  if (typeof days === 'number') error.remainingDays = days;
  return error;
}

function formatRenewalAlert(error) {
  const parts = ['ALERT cert-renew failed'];
  if (error?.step) parts.push(`step=${error.step}`);
  if (Array.isArray(error?.attempts) && error.attempts.length) {
    parts.push(`attempts=${error.attempts.map((item) => item.id).join('→')}`);
  }
  if (typeof error?.remainingDays === 'number') parts.push(`remainingDays=${error.remainingDays}`);
  parts.push(error?.message || '未知错误');
  return parts.join(' ');
}

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
    }),
    scf: (action, payload) => callApi({
      service: 'scf', host: 'scf.tencentcloudapi.com', version: '2018-04-16', action, payload
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
    try {
      const response = await apis.dnspod('CreateRecord', {
        Domain: config.dnspodDomain,
        SubDomain: subDomain,
        RecordType: 'TXT',
        RecordLine: '默认',
        Value: value,
        TTL: 600
      });
      return response.RecordId;
    } catch (error) {
      throw markDnsFailure(error);
    }
  }

  async function removeTxtRecord(recordId) {
    if (!recordId) return;
    try {
      await apis.dnspod('DeleteRecord', { Domain: config.dnspodDomain, RecordId: Number(recordId) });
    } catch (error) {
      logger.warn?.('清理 TXT 记录失败(忽略):', error.message);
    }
  }

  async function issueOnce(attempt, key, csr) {
    let recordId = null;
    const accountKey = await acmeClient.crypto.createPrivateKey();
    const client = new acmeClient.Client({ directoryUrl: config.acmeDirectory, accountKey });
    try {
      const cert = await client.auto({
        csr,
        email: config.acmeEmail,
        termsOfServiceAgreed: true,
        challengePriority: ['dns-01'],
        skipChallengeVerification: true,
        challengeCreateFn: async (authorization, challenge, keyAuthorization) => {
          rejectUnsupportedChallenge(challenge, config);
          const dnsRecord = `_acme-challenge.${authorization.identifier.value}`;
          const id = await addTxtRecord(dnsRecord, keyAuthorization);
          challenge._dnspodRecordId = id;
          recordId = id;
          logger.log?.(`已写入 TXT ${dnsRecord}（${attempt.id}），等待传播 ${attempt.propagationMs}ms`);
          await wait(attempt.propagationMs);
        },
        challengeRemoveFn: async (_authorization, challenge) => {
          const id = challenge._dnspodRecordId || recordId;
          recordId = null;
          await removeTxtRecord(id);
        }
      });
      return { cert, key: key.toString(), attempt: attempt.id };
    } catch (error) {
      if (recordId) await removeTxtRecord(recordId);
      throw error;
    }
  }

  async function issueCertificate() {
    const altNames = [config.domain, ...config.san];
    const [key, csr] = await acmeClient.crypto.createCsr({ commonName: config.domain, altNames });
    const attempts = buildAttemptOrder(config);
    const failures = [];
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      try {
        return await issueOnce(attempt, key, csr);
      } catch (error) {
        failures.push({ id: attempt.id, message: error.message });
        const retry = isRetryableIssuanceError(error) && index < attempts.length - 1;
        logger.warn?.(`cert-renew ${attempt.id} 失败${retry ? '，进入下一次' : ''}：${error.message}`);
        if (!retry) {
          const failure = new Error(
            `证书签发失败，顺序 ${failures.map((item) => item.id).join(' → ')}：${failures.map((item) => `${item.id}: ${item.message}`).join('；')}`
          );
          failure.attempts = failures;
          failure.retryable = false;
          failure.step = 'issue';
          failure.code = error.code || 'CERT_ISSUE_FAILED';
          throw failure;
        }
      }
    }
    throw new Error('证书签发失败');
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
    const hosts = [...new Set([config.domain, ...config.san].filter(Boolean))];
    await apis.teo('ModifyHostsCertificate', {
      ZoneId: config.zoneId,
      Hosts: hosts,
      Mode: 'sslcert',
      ServerCertInfo: [{ CertId: certId }]
    });
  }

  function mapScfEndpoints(domain) {
    return (domain.EndpointsConfig || []).map((item) => ({
      Namespace: item.Namespace,
      FunctionName: item.FunctionName,
      Qualifier: item.Qualifier,
      PathMatch: item.PathMatch,
      ...(item.PathRewrite ? { PathRewrite: item.PathRewrite } : {})
    }));
  }

  async function bindToScf(certId, { required = false } = {}) {
    const domainName = config.scfCustomDomain;
    if (!domainName) {
      if (!required) return { updated: false, reason: 'no_domain' };
      const error = new Error('未配置 SCF_CUSTOM_DOMAIN，拒绝在未绑定 SCF 自定义域名的情况下结束续期');
      error.retryable = false;
      error.code = 'CERT_SCF_DOMAIN_MISSING';
      error.step = 'bind-scf';
      throw error;
    }
    const domain = await apis.scf('GetCustomDomain', { Domain: domainName });
    const current = domain.CertConfig?.CertificateId || null;
    if (current === certId) return { updated: false, reason: 'already_bound', certId };
    const endpoints = mapScfEndpoints(domain);
    if (!endpoints.length) {
      throw new Error(`SCF 自定义域名 ${domainName} 没有路由，拒绝更新证书`);
    }
    const payload = {
      Domain: domainName,
      Protocol: domain.Protocol || 'HTTPS',
      CertConfig: { CertificateId: certId },
      EndpointsConfig: endpoints
    };
    if (domain.WafConfig) payload.WafConfig = domain.WafConfig;
    await apis.scf('UpdateCustomDomain', payload);
    return { updated: true, previousCertId: current, certId };
  }

  async function renew({ force = false } = {}) {
    let days = null;
    let certId;
    try {
      ({ days, certId } = await getCurrentCertExpiry());
    } catch (error) {
      throw annotateRenewError(error, 'read-expiry', null);
    }
    logger.log?.(`当前证书 certId=${certId || '(无)'} 剩余天数=${days === null ? '未知' : days}`);
    if (!force && days !== null && days > config.thresholdDays) {
      if (certId) {
        const scfBind = await bindToScf(certId);
        if (scfBind.updated) {
          return {
            renewed: false,
            reason: 'scf_cert_synced',
            remainingDays: days,
            oldScfCertId: scfBind.previousCertId,
            newCertId: certId
          };
        }
      }
      return { renewed: false, reason: 'not_due', remainingDays: days, threshold: config.thresholdDays };
    }
    let issued;
    try {
      issued = await issueCertificate();
    } catch (error) {
      throw annotateRenewError(error, 'issue', days);
    }
    let newCertId;
    try {
      newCertId = await uploadToSsl(issued.cert, issued.key);
    } catch (error) {
      throw annotateRenewError(error, 'upload-ssl', days);
    }
    try {
      await bindToEdgeOne(newCertId);
    } catch (error) {
      throw annotateRenewError(error, 'bind-edgeone', days);
    }
    try {
      await bindToScf(newCertId, { required: true });
    } catch (error) {
      throw annotateRenewError(error, 'bind-scf', days);
    }
    return {
      renewed: true,
      oldCertId: certId,
      newCertId,
      previousRemainingDays: days,
      attempt: issued.attempt
    };
  }

  return { renew, getCurrentCertExpiry, addTxtRecord, removeTxtRecord, issueCertificate, uploadToSsl, bindToEdgeOne, bindToScf };
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

async function runRenewal(event = {}, deps = {}) {
  const logger = deps.logger || console;
  try {
    const result = await createRenewService({ ...deps, logger }).renew({ force: parseForce(event) });
    logger.log?.('续期结果:', JSON.stringify(result));
    return { success: true, ...result };
  } catch (error) {
    const alert = formatRenewalAlert(error);
    logger.error?.(alert);
    const wrapped = new Error(alert);
    wrapped.code = 'CERT_RENEW_FAILED';
    wrapped.cause = error;
    throw wrapped;
  }
}

exports.main = (event = {}) => runRenewal(event);

exports.__private = {
  CONFIG,
  WILDCARD_REJECTED_CHALLENGES,
  parseInteger,
  parseForce,
  createApis,
  createRenewService,
  callTencentCloudApi,
  buildAttemptOrder,
  isRetryableIssuanceError,
  formatRenewalAlert,
  runRenewal
};

if (require.main === module) {
  exports.main({ force: process.argv.includes('--force') })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error(error?.message || error);
      process.exit(1);
    });
}
