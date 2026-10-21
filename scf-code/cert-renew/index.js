'use strict';

/**
 * Renew the Demox wildcard certificate with Let's Encrypt DNS-01, upload it
 * to Tencent SSL, and bind it only to targets inside the renewal window.
 *
 * Each target is read separately: EdgeOne apex (demox.site), www, and the
 * wildcard that serves user sites, plus the certificate actually bound on
 * the SCF custom domain api.demox.site. Writes only replace Type=upload
 * certs on [CERT_DOMAIN, ...CERT_SAN]. www and any managed cert are logged
 * and left untouched. A not-due target keeps its cert.
 * When a due target can be covered by a cert that is already serving another
 * writable target, or by an SSL cert issued in the last few days for the
 * same name set with more than 60 days left, that CertificateId is reused
 * and issue plus upload are skipped. Bind skips a target that already has
 * that cert. The runtime role may lack ssl:DescribeCertificate and
 * ssl:DescribeCertificates: a failed api expiry read is treated as due, and
 * an authorization failure on the certificate list falls through to issue.
 *
 * The previous reader used only the EdgeOne acceleration domain named by
 * CERT_DOMAIN (default *.demox.site), preferring Certificate.List Type=upload
 * ExpireTime. It never read demox.site, www.demox.site, or the expiry of the
 * cert bound on api.demox.site.
 *
 * Attempt order is dns-01, then dns-01-retry (longer DNS wait, same DNSPod
 * CreateRecord / DeleteRecord). http-01 and tls-alpn-01 cannot issue a
 * wildcard and are rejected. Failures throw CERT_RENEW_FAILED so the timer
 * invocation fails; they are not returned as success:false. A failed api
 * bind uses status "api not updated" and is never treated as success.
 */

const nodeCrypto = require('crypto');
const https = require('https');
const acme = require('acme-client');

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
  dnsRetryPropagationMs: parseInteger(process.env.DNS_RETRY_PROPAGATION_MS, 60_000),
  reuseWithinDays: parseInteger(process.env.CERT_REUSE_WITHIN_DAYS, 7),
  reuseMinRemainingDays: parseInteger(process.env.CERT_REUSE_MIN_REMAINING_DAYS, 60)
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

function redactSecrets(text) {
  return String(text ?? '')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[redacted-private-key]')
    .replace(/\b(Authorization|X-TC-Token|SessionToken|TENCENTCLOUD_SESSIONTOKEN)\b\s*[:=][^\n]*/gi, '$1=[redacted]');
}

function formatRenewalAlert(error) {
  const parts = ['ALERT cert-renew failed'];
  if (error?.step) parts.push(`step=${error.step}`);
  if (error?.status) parts.push(`status=${error.status}`);
  if (error?.newCertId) parts.push(`newCertId=${error.newCertId}`);
  if (error?.path) parts.push(`path=${error.path}`);
  if (Array.isArray(error?.attempts) && error.attempts.length) {
    parts.push(`attempts=${error.attempts.map((item) => item.id).join('→')}`);
  }
  if (typeof error?.remainingDays === 'number') parts.push(`remainingDays=${error.remainingDays}`);
  parts.push(redactSecrets(error?.message || '未知错误'));
  return parts.join(' ');
}

function isSslReadDenied(error) {
  const message = String(error?.message || '');
  return message.includes('AuthFailure') || message.includes('UnauthorizedOperation');
}

function stampRenewError(error, fields = {}) {
  if (fields.newCertId) error.newCertId = fields.newCertId;
  if (fields.path) error.path = fields.path;
  return error;
}

function parseCloudTime(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}+08:00` : text;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysUntil(value, now) {
  const expires = typeof value === 'number' ? value : parseCloudTime(value);
  if (expires == null) return null;
  return Math.floor((expires - now) / 86_400_000);
}

function asNames(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,;\s]+/);
  return list.map((item) => String(item).trim()).filter(Boolean);
}

function publicCertView(raw) {
  if (!raw || typeof raw !== 'object') {
    return { certificateId: null, domain: null, altNames: [], beginTime: null, endTime: null, insertTime: null, status: null };
  }
  return {
    certificateId: raw.CertificateId || raw.CertId || null,
    domain: raw.Domain || raw.DomainName || null,
    altNames: asNames(raw.SubjectAltName || raw.AltNames || raw.SAN),
    beginTime: raw.CertBeginTime || null,
    endTime: raw.CertEndTime || raw.ExpireTime || null,
    insertTime: raw.InsertTime || null,
    status: raw.Status == null ? null : raw.Status
  };
}

function certNames(view) {
  return [...new Set([view?.domain, ...(view?.altNames || [])].filter(Boolean))];
}

function certCoversHost(names, host) {
  const set = new Set((names || []).map((name) => String(name).toLowerCase()));
  const target = String(host || '').toLowerCase();
  if (!target || !set.size) return false;
  if (set.has(target)) return true;
  const labels = target.split('.');
  return labels.length >= 2 && set.has(`*.${labels.slice(1).join('.')}`);
}

function sameDomainSet(names, config) {
  const expected = new Set([config.domain, ...(config.san || [])].map((name) => String(name).toLowerCase()).filter(Boolean));
  const actual = new Set((names || []).map((name) => String(name).toLowerCase()).filter(Boolean));
  if (expected.size !== actual.size) return false;
  for (const name of expected) if (!actual.has(name)) return false;
  return true;
}

function issuedAt(view) {
  return parseCloudTime(view?.beginTime) ?? parseCloudTime(view?.insertTime);
}

function selectReusableCertificate(certs, config, now) {
  const matches = (certs || []).filter((cert) => {
    if (!cert.certificateId) return false;
    if (cert.status == null || cert.status === '' || Number(cert.status) !== 1) return false;
    if (!sameDomainSet(certNames(cert), config)) return false;
    const remaining = daysUntil(cert.endTime, now);
    if (remaining == null || remaining <= config.reuseMinRemainingDays) return false;
    const issued = issuedAt(cert);
    if (issued == null) return false;
    const ageDays = (now - issued) / 86_400_000;
    return ageDays >= 0 && ageDays <= config.reuseWithinDays;
  });
  matches.sort((left, right) => (issuedAt(right) || 0) - (issuedAt(left) || 0));
  return matches[0] || null;
}

const FORCE_UNKNOWN_ISSUE_MIN_DAYS = 83;

function writableHosts(config) {
  return [...new Set([config.domain, ...(config.san || [])].filter(Boolean))];
}

function edgeTargetsFor(config) {
  const apex = config.dnspodDomain;
  const sites = String(config.domain || '').startsWith('*.') ? config.domain : `*.${apex}`;
  const writable = new Set(writableHosts(config).map((host) => String(host).toLowerCase()));
  return [
    { role: 'apex', host: apex },
    { role: 'www', host: `www.${apex}` },
    { role: 'sites', host: sites }
  ].map((spec) => ({ ...spec, writable: writable.has(String(spec.host).toLowerCase()) }));
}

function summarizeTarget(target) {
  return {
    kind: target.kind,
    role: target.role,
    host: target.host,
    present: target.present,
    writable: Boolean(target.writable),
    upload: Boolean(target.upload),
    certId: target.certId || null,
    days: target.days,
    due: target.due
  };
}

function apiNotUpdated(message) {
  const text = String(message || '绑定失败');
  const error = new Error(text.includes('api not updated') ? text : `api not updated: ${text}`);
  error.status = 'api not updated';
  error.step = 'bind-scf';
  error.retryable = false;
  error.code = 'CERT_API_NOT_UPDATED';
  return error;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCreds() {
  // 业务函数自身受限密钥（DEMOX_BIZ_TC_*），不借基座运行角色。
  const { secretId, secretKey, token } = requireBizCloudCreds();
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

function createRenewService({ config: configInput = CONFIG, apis = createApis(), acmeClient = acme, wait = sleep, logger = console, clock = Date.now } = {}) {
  const config = { ...CONFIG, ...configInput };
  const described = new Map();

  function targetIsDue(days, force) {
    if (force) return true;
    if (days === null) return true;
    return days <= config.thresholdDays;
  }

  async function listAccelerationDomains() {
    const domains = [];
    const limit = 100;
    for (let offset = 0; offset < 1000; offset += limit) {
      const response = await apis.teo('DescribeAccelerationDomains', {
        ZoneId: config.zoneId,
        Offset: offset,
        Limit: limit
      });
      const batch = response.AccelerationDomains || [];
      domains.push(...batch);
      const total = Number(response.TotalCount);
      if (batch.length < limit) break;
      if (Number.isFinite(total) && domains.length >= total) break;
    }
    return domains;
  }

  function edgeCertificate(domain) {
    const certificates = domain?.Certificate?.List || [];
    return certificates.find((item) => item.Type === 'upload') || null;
  }

  async function readEdgeTargets(now, { force = false } = {}) {
    const domains = await listAccelerationDomains();
    return edgeTargetsFor(config).map((spec) => {
      const domain = domains.find((item) => item.DomainName === spec.host);
      if (!domain) {
        return {
          kind: 'edgeone',
          role: spec.role,
          host: spec.host,
          present: false,
          writable: spec.writable,
          upload: false,
          days: null,
          certId: null,
          due: false
        };
      }
      const certificate = edgeCertificate(domain);
      const upload = Boolean(certificate);
      const days = certificate?.ExpireTime ? daysUntil(certificate.ExpireTime, now) : null;
      const certId = certificate?.CertId || null;
      return {
        kind: 'edgeone',
        role: spec.role,
        host: spec.host,
        present: true,
        writable: spec.writable,
        upload,
        days,
        certId,
        due: Boolean(spec.writable && upload && targetIsDue(days, force))
      };
    });
  }

  async function describeCert(certId) {
    if (described.has(certId)) return described.get(certId);
    const view = publicCertView(await apis.ssl('DescribeCertificate', { CertificateId: certId }));
    described.set(certId, view);
    return view;
  }

  async function readApiTarget(now, { force = false } = {}) {
    if (!config.scfCustomDomain) return null;
    const domain = await apis.scf('GetCustomDomain', { Domain: config.scfCustomDomain });
    const certId = domain.CertConfig?.CertificateId || null;
    let days = null;
    if (certId) {
      try {
        const view = await describeCert(certId);
        days = daysUntil(view.endTime, now);
      } catch (error) {
        logger.warn?.(redactSecrets(`cert-renew 读取 api 证书到期失败，按已到期继续：${error.message}`));
        days = null;
      }
    }
    return {
      kind: 'scf',
      role: 'api',
      host: config.scfCustomDomain,
      present: true,
      writable: true,
      upload: Boolean(certId),
      days,
      certId,
      domain,
      due: targetIsDue(days, force)
    };
  }

  async function readTargets(now, { force = false } = {}) {
    const edge = await readEdgeTargets(now, { force });
    const api = await readApiTarget(now, { force });
    return api ? [...edge, api] : edge;
  }

  async function getCurrentCertExpiry() {
    const sites = (await readEdgeTargets(clock(), { force: false })).find((target) => target.role === 'sites');
    return { days: sites?.days ?? null, certId: sites?.certId };
  }

  function logTargets(targets) {
    const line = targets.map((target) => (
      `${target.role}:${target.host} present=${target.present} write=${target.writable ? 'yes' : 'no'} upload=${target.upload ? 'yes' : 'no'} certId=${target.certId || '-'} days=${target.days === null ? 'unknown' : target.days} due=${target.due}`
    )).join(' | ');
    logger.log?.(`cert-renew targets ${line}`);
  }

  function logPath(path, extra = {}) {
    const fields = [`cert-renew decision path=${path}`];
    if (extra.certificateId) fields.push(`certificateId=${extra.certificateId}`);
    if (extra.due) fields.push(`due=${extra.due}`);
    if (extra.reason) fields.push(`reason=${extra.reason}`);
    logger.log?.(fields.join(' '));
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
        logger.warn?.(redactSecrets(`cert-renew ${attempt.id} 失败${retry ? '，进入下一次' : ''}：${error.message}`));
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
      Alias: `wildcard-demox.site-LE-${new Date(clock()).toISOString().slice(0, 10)}`,
      Repeatable: true
    });
    return response.CertificateId;
  }

  async function bindToEdgeOne(certId, hosts) {
    const list = [...new Set((hosts || [config.domain, ...config.san]).filter(Boolean))];
    if (!list.length) return { updated: false, reason: 'no_hosts', hosts: [] };
    await apis.teo('ModifyHostsCertificate', {
      ZoneId: config.zoneId,
      Hosts: list,
      Mode: 'sslcert',
      ServerCertInfo: [{ CertId: certId }]
    });
    return { updated: true, hosts: list };
  }

  async function findBoundReuse(targets, dueTargets, { force = false, now = clock() } = {}) {
    const groups = new Map();
    for (const target of targets) {
      if (!target.present || !target.certId || target.days == null) continue;
      if (!target.writable) continue;
      const normal = !target.due && target.days > config.thresholdDays;
      const forced = Boolean(force) && target.days > config.reuseMinRemainingDays;
      if (!normal && !forced) continue;
      const group = groups.get(target.certId) || {
        certId: target.certId,
        hosts: [],
        days: target.days,
        forcedOnly: true
      };
      group.hosts.push(target.host);
      group.days = Math.max(group.days, target.days);
      if (normal) group.forcedOnly = false;
      groups.set(target.certId, group);
    }
    let best = null;
    for (const group of groups.values()) {
      let names = [];
      let issued = null;
      try {
        const view = await describeCert(group.certId);
        names = certNames(view);
        issued = issuedAt(view);
      } catch (error) {
        logger.warn?.(redactSecrets(`cert-renew 读取已绑定证书的域名失败，改用主机名判断覆盖：${error.message}`));
      }
      if (group.forcedOnly) {
        if (issued == null) {
          if (group.days < FORCE_UNKNOWN_ISSUE_MIN_DAYS) continue;
        } else {
          const ageDays = (now - issued) / 86_400_000;
          if (ageDays < 0 || ageDays > config.reuseWithinDays) continue;
        }
      }
      const pool = [...names, ...group.hosts];
      if (!dueTargets.every((target) => certCoversHost(pool, target.host))) continue;
      if (!best || group.days > best.remainingDays) {
        best = { certificateId: group.certId, path: 'reuse-bound', remainingDays: group.days };
      }
    }
    return best;
  }

  async function listSslCertificates() {
    const certificates = [];
    const limit = 100;
    for (let offset = 0; offset < 500; offset += limit) {
      const response = await apis.ssl('DescribeCertificates', {
        Offset: offset,
        Limit: limit,
        SearchKey: config.dnspodDomain,
        CertificateType: 'SVR',
        CertificateStatus: [1]
      });
      const batch = response.Certificates || [];
      for (const item of batch) certificates.push(publicCertView(item));
      const total = Number(response.TotalCount);
      if (batch.length < limit) break;
      if (Number.isFinite(total) && certificates.length >= total) break;
    }
    return certificates;
  }

  async function findUploadedReuse(now) {
    const selected = selectReusableCertificate(await listSslCertificates(), config, now);
    if (!selected) return null;
    return {
      certificateId: selected.certificateId,
      path: 'reuse-ssl',
      remainingDays: daysUntil(selected.endTime, now)
    };
  }

  async function bindDueEdge(certId, dueTargets) {
    const order = writableHosts(config);
    const dueHosts = dueTargets.filter((target) => (
      target.kind === 'edgeone' && target.writable && order.includes(target.host)
    ));
    const skipped = dueHosts.filter((target) => target.certId === certId);
    const pending = new Set(dueHosts.filter((target) => target.certId !== certId).map((target) => target.host));
    const hosts = order.filter((host) => pending.has(host));
    if (skipped.length) {
      logPath('bind-edgeone', {
        certificateId: certId,
        reason: `skip=already_bound hosts=${skipped.map((target) => target.host).join(',')}`
      });
    }
    if (!hosts.length) return { updated: false, reason: skipped.length ? 'already_bound' : 'not_due', hosts: [] };
    return bindToEdgeOne(certId, hosts);
  }

  async function bindDueApi(certId) {
    if (!config.scfCustomDomain) {
      throw apiNotUpdated('未配置 SCF_CUSTOM_DOMAIN，拒绝在未绑定 SCF 自定义域名的情况下结束续期');
    }
    try {
      const scfBind = await bindToScf(certId, { required: true });
      if (scfBind.reason === 'already_bound') {
        logPath('bind-scf', { certificateId: certId, reason: 'skip=already_bound' });
      }
      if (!scfBind.updated && scfBind.reason !== 'already_bound') {
        throw apiNotUpdated(scfBind.reason || '未写入');
      }
      return scfBind;
    } catch (error) {
      if (error.status === 'api not updated') throw error;
      throw apiNotUpdated(error.message);
    }
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
    const now = clock();
    let targets;
    try {
      targets = await readTargets(now, { force });
    } catch (error) {
      throw annotateRenewError(error, 'read-expiry', null);
    }
    logTargets(targets);
    const due = targets.filter((target) => target.due);
    const sites = targets.find((target) => target.role === 'sites');
    const apiTarget = targets.find((target) => target.role === 'api');
    const days = sites?.present ? sites.days : (apiTarget?.days ?? null);
    const dueLabel = due.map((target) => `${target.role}:${target.host}`).join(',') || '-';
    if (!due.length && !force) {
      logPath('not-due', { reason: `threshold=${config.thresholdDays}` });
      return {
        renewed: false,
        reused: false,
        path: 'not-due',
        reason: 'not_due',
        remainingDays: days,
        threshold: config.thresholdDays,
        targets: targets.map(summarizeTarget)
      };
    }
    if (!config.scfCustomDomain && (force || due.length)) {
      throw annotateRenewError(
        apiNotUpdated('未配置 SCF_CUSTOM_DOMAIN，拒绝在未绑定 SCF 自定义域名的情况下结束续期'),
        'bind-scf',
        days
      );
    }

    let reused = null;
    try {
      reused = await findBoundReuse(targets, due, { force, now });
    } catch (error) {
      throw annotateRenewError(error, 'list-ssl', days);
    }
    if (!reused) {
      try {
        reused = await findUploadedReuse(now);
      } catch (error) {
        if (isSslReadDenied(error)) {
          logger.warn?.(redactSecrets(`cert-renew DescribeCertificates 无权限，改为签发：${error.message}`));
        } else {
          throw annotateRenewError(error, 'list-ssl', days);
        }
      }
    }

    let newCertId;
    let attempt = null;
    let path;
    if (reused) {
      path = reused.path;
      newCertId = reused.certificateId;
      logPath(path, { certificateId: newCertId, due: dueLabel });
    } else {
      path = 'issue';
      logPath(path, { due: dueLabel });
      let issued;
      try {
        issued = await issueCertificate();
      } catch (error) {
        throw annotateRenewError(error, 'issue', days);
      }
      attempt = issued.attempt;
      try {
        newCertId = await uploadToSsl(issued.cert, issued.key);
      } catch (error) {
        throw annotateRenewError(error, 'upload-ssl', days);
      }
    }

    let edgeBind;
    try {
      edgeBind = await bindDueEdge(newCertId, due);
    } catch (error) {
      throw annotateRenewError(stampRenewError(error, { newCertId, path }), 'bind-edgeone', days);
    }
    let scfBind = { updated: false, reason: 'not_due' };
    if (apiTarget?.due) {
      try {
        scfBind = await bindDueApi(newCertId);
      } catch (error) {
        throw annotateRenewError(stampRenewError(error, { newCertId, path }), 'bind-scf', apiTarget.days);
      }
    }
    return {
      renewed: path === 'issue',
      reused: path !== 'issue',
      path,
      reason: path === 'issue' ? 'issued' : 'reused_existing',
      oldCertId: sites?.certId,
      newCertId,
      previousRemainingDays: sites?.days ?? null,
      apiRemainingDays: apiTarget?.days ?? null,
      attempt,
      edgeone: edgeBind,
      scf: scfBind,
      targets: targets.map(summarizeTarget)
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
    logger.error?.(redactSecrets(alert));
    const wrapped = new Error(alert);
    wrapped.code = 'CERT_RENEW_FAILED';
    wrapped.status = error.status;
    wrapped.step = error.step;
    wrapped.newCertId = error.newCertId;
    wrapped.path = error.path;
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
  redactSecrets,
  parseCloudTime,
  daysUntil,
  publicCertView,
  certCoversHost,
  sameDomainSet,
  selectReusableCertificate,
  edgeTargetsFor,
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
