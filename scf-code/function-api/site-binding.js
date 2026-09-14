'use strict';

const { loadSystemManifest } = require('./system-router.js');
const { badRequest } = require('./errors.js');

const PLATFORM_HOSTS = new Set(
  String(process.env.DEMOX_PLATFORM_HOSTS || 'www.demox.site,demox.site')
    .split(',')
    .map((item) => normalizeHost(item))
    .filter(Boolean)
);
function platformWebsiteId(env = process.env) {
  return String(env.DEMOX_PLATFORM_WEBSITE_ID || env.DEMOX_SITE_WEBSITE_ID || 'EPX2UU43').trim();
}

const PLATFORM_WEBSITE_ID = platformWebsiteId();

function normalizeHost(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname.replace(/\.$/, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0].replace(/\.$/, '');
  }
}

function requireWebsiteId(value) {
  const websiteId = String(value == null ? '' : value).trim();
  if (!websiteId) throw badRequest('缺少 websiteId', 'MISSING_WEBSITE_ID');
  if (websiteId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(websiteId)) {
    throw badRequest('websiteId 非法', 'INVALID_WEBSITE_ID');
  }
  return websiteId;
}

function readQuery(event = {}) {
  const raw = event.queryStringParameters || event.queryString || event.query || {};
  if (typeof raw === 'string') {
    return Object.fromEntries(new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw));
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  return {};
}

function readWebsiteScope(event = {}, body = {}) {
  const query = readQuery(event);
  return {
    websiteId: body.websiteId || body.website_id || query.websiteId || query.website_id || '',
    env: body.env || query.env || process.env.FUNCTION_ENV || 'production',
    host: body.host || query.host || '',
    kind: String(body.kind || query.kind || '').trim().toLowerCase()
  };
}

function isPlatformSite({ websiteId, host } = {}) {
  const platformId = platformWebsiteId();
  if (platformId && String(websiteId || '') === platformId) return true;
  const hosts = String(host || '')
    .split(',')
    .map((item) => normalizeHost(item))
    .filter(Boolean);
  return hosts.some((item) => PLATFORM_HOSTS.has(item));
}

function siteFunctionUrl(publicBaseUrl, websiteId, envName, route) {
  if (!route) return null;
  const base = String(publicBaseUrl || 'https://api.demox.site').replace(/\/+$/, '');
  const siteId = String(websiteId || platformWebsiteId()).trim();
  const env = String(envName || process.env.FUNCTION_ENV || 'production').trim();
  return `${base}/${siteId}/${env}${route}`;
}

function publicSystemFunctions(publicBaseUrl, websiteId, envName) {
  return loadSystemManifest().map((entry) => {
    const route = (entry.routePrefixes || [])[0] || '';
    const siteId = websiteId || platformWebsiteId();
    return {
      functionId: entry.slug,
      kind: 'site',
      name: entry.displayName || entry.name,
      slug: entry.slug,
      websiteId: siteId,
      env: envName || process.env.FUNCTION_ENV || 'production',
      status: 'active',
      runtime: 'nodejs',
      publishedVersion: 1,
      routes: [...(entry.routePrefixes || [])],
      triggers: [...(entry.triggers || [])],
      invokeUrl: siteFunctionUrl(publicBaseUrl, siteId, envName, route),
      editable: false
    };
  });
}

module.exports = {
  normalizeHost,
  requireWebsiteId,
  readQuery,
  readWebsiteScope,
  isPlatformSite,
  publicSystemFunctions,
  siteFunctionUrl,
  platformWebsiteId,
  PLATFORM_HOSTS
};
