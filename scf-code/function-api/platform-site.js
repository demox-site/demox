'use strict';

const fs = require('fs');
const path = require('path');
const { platformWebsiteId } = require('./site-binding.js');
const { loadSystemManifest } = require('./system-router.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const PLATFORM_ENV_KEYS = [
  'ACME_EMAIL',
  'ANALYTICS_HASH_SALT',
  'ANALYTICS_RAW_BUCKET_ID',
  'ANALYTICS_RAW_ENABLED',
  'AUTH_API_URL',
  'CERT_DOMAIN',
  'CERT_SAN',
  'DNSPOD_DOMAIN',
  'EDGEONE_ZONE_ID',
  'ENCRYPTION_KEY',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_REDIRECT_URI',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_SECRET',
  'MYSQL_DATABASE',
  'MYSQL_HOST',
  'MYSQL_PASSWORD',
  'MYSQL_PORT',
  'MYSQL_USER',
  'RENEW_THRESHOLD_DAYS',
  'WEBSITE_API_URL'
];

const LIVE_CREDENTIAL_KEYS = [
  'TENCENTCLOUD_SECRETID',
  'TENCENTCLOUD_SECRETKEY',
  'TENCENTCLOUD_SESSIONTOKEN'
];

const MODULE_BY_SYSTEM_NAME = {
  'demox-system-auth': 'demox-auth',
  'demox-system-website': 'demox-website',
  'demox-system-mcp': 'demox-mcp',
  'demox-system-cert-renew': 'demox-cert-renew'
};

const MODULE_BY_SLUG = {
  auth: 'demox-auth',
  website: 'demox-website',
  mcp: 'demox-mcp',
  'cert-renew': 'demox-cert-renew'
};

function systemFunctionSlug(entry) {
  return String(entry.slug || '').replace(/^system-/, '') || entry.slug;
}

function packageNameFor(functionRecord, env = process.env) {
  if (!functionRecord || String(functionRecord.websiteId || '') !== platformWebsiteId(env)) return '';
  return MODULE_BY_SLUG[String(functionRecord.slug || '')] || '';
}

function readPlatformSource(entry) {
  const file = path.resolve(REPO_ROOT, entry.sourceDir, entry.entrypoint);
  if (!file.startsWith(`${REPO_ROOT}${path.sep}`)) {
    throw new Error(`系统函数路径越界: ${entry.name}`);
  }
  return fs.readFileSync(file, 'utf8');
}

function isFakeWrapperSource(source) {
  return /require\(["']demox-(?:auth|website|mcp|cert-renew)["']\)/.test(String(source || ''));
}

function limitsFor(entry) {
  if (entry.slug === 'system-cert-renew' || (entry.timerTriggers || []).includes('monthly-renew')) {
    return { timeoutMs: 300_000, maxBodyBytes: 6 * 1024 * 1024, maxResponseBytes: 6 * 1024 * 1024, maxCodeBytes: 1024 * 1024 };
  }
  if (entry.slug === 'system-auth') {
    return { timeoutMs: 15_000, maxBodyBytes: 1024 * 1024, maxResponseBytes: 1024 * 1024, maxCodeBytes: 256 * 1024 };
  }
  return { timeoutMs: 120_000, maxBodyBytes: 6 * 1024 * 1024, maxResponseBytes: 6 * 1024 * 1024, maxCodeBytes: 1024 * 1024 };
}

function platformFunctionSpecs(entries = loadSystemManifest()) {
  return entries.map((entry) => {
    const moduleName = MODULE_BY_SYSTEM_NAME[entry.name];
    const slug = systemFunctionSlug(entry);
    const timerName = (entry.timerTriggers || [])[0] || null;
    const triggers = [...new Set([...(entry.triggers || []), ...(timerName ? ['timer'] : [])])];
    return {
      name: entry.displayName || entry.name,
      slug,
      runtime: 'nodejs',
      entrypoint: entry.entrypoint || 'index.js',
      routes: [...(entry.routePrefixes || [])],
      triggers: triggers.length ? triggers : ['http'],
      timerName,
      source: moduleName ? readPlatformSource(entry) : '',
      packageName: moduleName || '',
      limits: limitsFor(entry),
      systemName: entry.name
    };
  }).filter((item) => item.source);
}

function platformSiteEnvFromProcess(env = process.env) {
  const output = {};
  for (const key of PLATFORM_ENV_KEYS) {
    if (typeof env[key] === 'string' && env[key]) output[key] = env[key];
  }
  return output;
}

function mergeLiveCredentials(env = {}, websiteId, processEnv = process.env) {
  if (String(websiteId || '') !== platformWebsiteId(processEnv)) return env;
  const output = { ...env };
  for (const key of LIVE_CREDENTIAL_KEYS) {
    if (output[key] == null && typeof processEnv[key] === 'string' && processEnv[key]) {
      output[key] = processEnv[key];
    }
  }
  return output;
}

async function seedPlatformSiteFunctions({ service, ownerId, websiteId, logger = console } = {}) {
  if (!service) return [];
  const siteId = websiteId || platformWebsiteId();
  let owner = ownerId;
  if (!owner && typeof service.repository.getWebsiteOwner === 'function') {
    owner = await service.repository.getWebsiteOwner(siteId);
  }
  if (!owner) {
    logger.warn?.('跳过平台站点函数种子: 没有站点 owner');
    return [];
  }
  const currentEnv = await service.getWebsiteEnv(siteId);
  const mergedEnv = { ...platformSiteEnvFromProcess(), ...currentEnv };
  await service.putWebsiteEnv(siteId, mergedEnv);
  const seeded = [];
  for (const spec of platformFunctionSpecs()) {
    let record = typeof service.repository.getFunctionByWebsiteSlug === 'function'
      ? await service.repository.getFunctionByWebsiteSlug(siteId, spec.slug)
      : null;
    if (!record) {
      record = await service.createFunction({
        ownerId: owner,
        websiteId: siteId,
        name: spec.name,
        slug: spec.slug,
        runtime: spec.runtime,
        routes: spec.routes,
        triggers: spec.triggers,
        timerName: spec.timerName,
        limits: spec.limits
      });
    } else if (typeof service.repository.updateFunctionSpec === 'function') {
      record = await service.repository.updateFunctionSpec(record.functionId, {
        name: spec.name,
        routes: spec.routes,
        triggers: spec.triggers,
        timerName: spec.timerName,
        limits: spec.limits
      }) || record;
    }
    let currentSource = '';
    if (record.publishedVersion) {
      try {
        currentSource = (await service.getSource({
          ownerId: owner,
          functionId: record.functionId,
          version: record.publishedVersion
        })).source || '';
      } catch {
        currentSource = '';
      }
    }
    if (!record.publishedVersion || isFakeWrapperSource(currentSource)) {
      const version = await service.createVersion({
        ownerId: owner,
        functionId: record.functionId,
        source: spec.source,
        entrypoint: spec.entrypoint || 'index.js'
      });
      await service.publishVersion({ ownerId: owner, functionId: record.functionId, version: version.version });
      record = (await service.repository.getFunction(record.functionId)) || record;
    }
    if (typeof service.putFunctionEnv === 'function') {
      const currentFnEnv = await service.getFunctionEnv({ ownerId: owner, functionId: record.functionId });
      await service.putFunctionEnv({
        ownerId: owner,
        functionId: record.functionId,
        env: { ...currentFnEnv, ...mergedEnv }
      });
    }
    seeded.push(record);
  }
  return seeded;
}

module.exports = {
  PLATFORM_ENV_KEYS,
  LIVE_CREDENTIAL_KEYS,
  MODULE_BY_SLUG,
  systemFunctionSlug,
  packageNameFor,
  readPlatformSource,
  isFakeWrapperSource,
  platformFunctionSpecs,
  platformSiteEnvFromProcess,
  mergeLiveCredentials,
  seedPlatformSiteFunctions
};
