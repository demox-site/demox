/**
 * Demox Website API - SCF 云函数
 * 网站管理服务
 */

const AdmZip = require('adm-zip');
const nodeCrypto = require('crypto');
const https = require('https');
const path = require('path');
let geoip = null;
try {
  geoip = require('geoip-lite');
} catch (e) {
  geoip = null;
}
const { query, transaction } = require('./shared/db.js');
const { getUserId, authenticate, sign } = require('./shared/jwt.js');
const { createProvider } = require('./shared/storage.js');
const buckets = require('./shared/buckets.js');
const { encrypt, decrypt } = require('./shared/crypto.js');
const { createFeishuDirectoryClient, FeishuDirectoryError } = require('./shared/feishu-directory.js');

const defaultDomain = 'demox.site';
const builtinOfficialDomains = ['demox.site', 'vibeme.cn'];
const officialDomains = Array.from(new Set([
  defaultDomain,
  ...builtinOfficialDomains,
  ...(process.env.OFFICIAL_SITE_DOMAINS || '').split(',')
])).map(normalizeDomainValue).filter(Boolean);
const officialDomainSet = new Set(officialDomains);
const VISIBILITY_PUBLIC = 'public';
const VISIBILITY_PRIVATE = 'private';
const PROJECT_ROLE_OWNER = 'owner';
const PROJECT_ROLE_ADMIN = 'admin';
const PROJECT_ROLE_MEMBER = 'member';
const PROJECT_ROLES = [PROJECT_ROLE_OWNER, PROJECT_ROLE_ADMIN, PROJECT_ROLE_MEMBER];
const PROJECT_WRITE_ROLES = [PROJECT_ROLE_OWNER, PROJECT_ROLE_ADMIN];
const FEISHU_PRINCIPAL_USER = 'user';
const FEISHU_PRINCIPAL_DEPARTMENT = 'department';
const FEISHU_DIRECTORY_TTL_MS = 15 * 60 * 1000;
const feishuDirectory = createFeishuDirectoryClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET
});

function normalizeDomainValue(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/^\.+|\.+$/g, '');
}

function normalizeOfficialDomain(input) {
  const domain = normalizeDomainValue(input) || defaultDomain;
  return officialDomainSet.has(domain) ? domain : null;
}

function parseOfficialHost(host) {
  const normalized = normalizeDomainValue(host);
  for (const domain of officialDomains) {
    const suffix = `.${domain}`;
    if (!normalized.endsWith(suffix)) continue;
    const label = normalized.slice(0, -suffix.length);
    if (label && !label.includes('.')) {
      return { label, domain };
    }
  }
  return null;
}

function getRowSubdomainDomain(row) {
  return normalizeOfficialDomain(row.subdomain_domain || row.subdomainDomain) || defaultDomain;
}

function buildDefaultSiteUrl(websiteId) {
  const label = String(websiteId || '').trim().toLowerCase();
  return label ? `https://${label}.${defaultDomain}/` : '';
}

function buildCustomSiteUrl(subdomain, domain) {
  const label = String(subdomain || '').trim().toLowerCase();
  const suffix = normalizeOfficialDomain(domain) || defaultDomain;
  return label ? `https://${label}.${suffix}/` : '';
}

function formatWebsiteForClient(row) {
  const defaultUrl = buildDefaultSiteUrl(row.website_id || row.websiteId);
  const subdomainDomain = getRowSubdomainDomain(row);
  const customUrl = buildCustomSiteUrl(row.subdomain, subdomainDomain);
  const preferredUrl = customUrl || defaultUrl || row.url || '';
  const visibility = normalizeVisibility(row.visibility);
  const userNickname = String(row.user_nickname || row.userNickname || '').trim();
  const projectPublicId = row.project_key || row.projectKey || row.project_public_id || row.projectPublicId || row.project_id || row.projectId || null;

  return {
    ...row,
    visibility,
    project_id: projectPublicId == null ? null : String(projectPublicId),
    projectId: projectPublicId == null ? null : String(projectPublicId),
    projectInternalId: row.project_id == null ? null : String(row.project_id),
    project_key: row.project_key || row.projectKey || null,
    projectKey: row.project_key || row.projectKey || null,
    projectRole: row.project_role || row.projectRole || null,
    user_nickname: userNickname,
    userNickname,
    url: preferredUrl,
    subdomain_domain: subdomainDomain,
    subdomainDomain,
    default_url: defaultUrl,
    custom_url: customUrl || null,
    preferred_url: preferredUrl,
    defaultUrl,
    customUrl: customUrl || null,
    preferredUrl
  };
}

// 旧默认桶的兜底配置（storage_buckets 表未建/未注册时仍能部署，保证迁移期不中断）。
// 迁移完成后这只是 fallback：正常流程一律走 storage_buckets 注册表。
const LEGACY_BUCKET = {
  provider: 'cos',
  bucket: 'resource-game-1307257815',
  region: 'ap-chengdu',
  endpoint: null,
  originHost: 'sites.demox.site',
  hasOwnCreds: false // 用 SCF 环境变量凭证
};

/**
 * 解析"该用哪个桶"。优先 storage_buckets 注册表；表不存在或为空时回退 LEGACY_BUCKET。
 * @param {number|null} bucketId 指定桶 id；为空则取默认桶。
 * @returns {Promise<object>} buckets.rowToConfig 形态的配置
 */
async function resolveBucketConfig(bucketId) {
  try {
    let cfg = bucketId ? await buckets.getBucketById(bucketId) : await buckets.getDefaultBucket();
    if (!cfg && bucketId) cfg = await buckets.getDefaultBucket();
    if (cfg) return cfg;
  } catch (e) {
    // storage_buckets 表还没建（迁移前），回退旧桶
    console.warn('读取 storage_buckets 失败，回退旧默认桶:', e.message);
  }
  return LEGACY_BUCKET;
}

/** 按桶配置造 provider（解析凭证 → createProvider）。 */
function providerFor(cfg) {
  return createProvider(buckets.resolveCreds(cfg));
}

/**
 * 腾讯云 TC3-HMAC-SHA256 请求。这里不用引入完整 SDK，避免拉大 SCF 包体积。
 * @param {{ service:string, host:string, version:string, action:string, payload:object, region?:string }} opts
 */
async function callTencentCloudApi(opts) {
  const secretId =
    process.env.TENCENTCLOUD_SECRETID ||
    process.env.TENCENT_SECRET_ID ||
    process.env.COS_SECRET_ID;
  const secretKey =
    process.env.TENCENTCLOUD_SECRETKEY ||
    process.env.TENCENT_SECRET_KEY ||
    process.env.COS_SECRET_KEY;
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN || '';

  if (!secretId || !secretKey) {
    throw new Error('缺少腾讯云 API 密钥，无法提交缓存清除任务');
  }

  const body = JSON.stringify(opts.payload || {});
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${opts.host}`,
    `x-tc-action:${opts.action.toLowerCase()}`
  ].join('\n') + '\n';
  const hashedPayload = nodeCrypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n');

  const credentialScope = `${date}/${opts.service}/tc3_request`;
  const hashedCanonicalRequest = nodeCrypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    hashedCanonicalRequest
  ].join('\n');

  const sign = (key, msg, enc) => nodeCrypto.createHmac('sha256', key).update(msg).digest(enc);
  const secretDate = sign(`TC3${secretKey}`, date);
  const secretService = sign(secretDate, opts.service);
  const secretSigning = sign(secretService, 'tc3_request');
  const signature = sign(secretSigning, stringToSign, 'hex');
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    Authorization: authorization,
    'Content-Type': contentType,
    Host: opts.host,
    'X-TC-Action': opts.action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': opts.version,
    'X-TC-Region': opts.region || process.env.SCF_REGION || 'ap-guangzhou'
  };
  if (token) headers['X-TC-Token'] = token;

  const raw = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        host: opts.host,
        path: '/',
        headers,
        timeout: 10000
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`腾讯云 API HTTP ${res.statusCode}: ${data}`));
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('腾讯云 API 请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const parsed = JSON.parse(raw);
  if (parsed.Response && parsed.Response.Error) {
    const err = parsed.Response.Error;
    throw new Error(`${err.Code || 'TencentCloudError'}: ${err.Message || '请求失败'}`);
  }
  return parsed.Response || parsed;
}

async function createEdgeOnePurgeTask({ type, targets, method }) {
  const zoneId = process.env.EDGEONE_ZONE_ID || process.env.TEO_ZONE_ID || 'zone-3kplfkbflnd6';
  const payload = { ZoneId: zoneId, Type: type, Targets: targets };
  if (method) payload.Method = method;
  const resp = await callTencentCloudApi({
    service: 'teo',
    host: 'teo.tencentcloudapi.com',
    version: '2022-09-01',
    action: 'CreatePurgeTask',
    region: process.env.EDGEONE_REGION || process.env.TEO_REGION || process.env.SCF_REGION || 'ap-guangzhou',
    payload
  });
  return {
    type,
    targets,
    jobId: resp.JobId || null,
    requestId: resp.RequestId || null,
    failedList: resp.FailedList || []
  };
}

/**
 * 部署完成后主动清理 EdgeOne 缓存，替代 URL 上拼 ?v=timestamp 的缓存绕过方案。
 * - purge_prefix: 清理默认域名和自定义前缀域名下的页面/资源缓存。
 * - purge_url: 清理边缘函数 resolveSite 使用的 label->path 解析缓存 key（best effort）。
 *
 * 缓存清理失败不阻断部署，但会写入日志并返回给调用方，便于 CI 里排查。
 */
async function purgeSiteCache({ websiteId, subdomain, subdomainDomain }) {
  const hosts = new Set();
  const resolveKeys = new Set();
  const defaultLabel = String(websiteId || '').trim().toLowerCase();
  const customLabel = String(subdomain || '').trim().toLowerCase();
  const customDomain = normalizeOfficialDomain(subdomainDomain) || defaultDomain;
  if (defaultLabel) {
    hosts.add(`${defaultLabel}.${defaultDomain}`);
    resolveKeys.add(`${defaultDomain}|${defaultLabel}`);
  }
  if (customLabel) {
    hosts.add(`${customLabel}.${customDomain}`);
    resolveKeys.add(`${customDomain}|${customLabel}`);
  }

  const safeHosts = Array.from(hosts).filter(host => /^[a-z0-9-]{1,63}\.[a-z0-9.-]+$/.test(host));
  if (safeHosts.length === 0) {
    return { success: true, skipped: true, reason: 'no_valid_hosts' };
  }

  const publicTargets = safeHosts.map(host => `https://${host}/`);
  const resolveTargets = Array.from(resolveKeys).map(key => {
    const [domain, label] = key.split('|');
    return `https://resolve.${defaultDomain}/host/${encodeURIComponent(domain)}/${encodeURIComponent(label)}`;
  });
  const tasks = [];

  for (const task of [
    { type: 'purge_prefix', method: 'delete', targets: publicTargets },
    { type: 'purge_url', targets: resolveTargets }
  ]) {
    try {
      const result = await createEdgeOnePurgeTask(task);
      tasks.push({ ...result, success: true });
    } catch (e) {
      console.warn(`EdgeOne ${task.type} 缓存清理失败:`, e.message);
      tasks.push({ type: task.type, targets: task.targets, success: false, message: e.message });
    }
  }

  return {
    success: tasks.every(t => t.success),
    skipped: false,
    hosts: safeHosts,
    tasks
  };
}

/**
 * SCF 云函数入口
 */
exports.main = async (event, context) => {
  try {
    // 解析 body
    let body = event.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }
    event.body = body;

    const pathUrl = event.path || body?.path || event.queryString?.path || '/';
    const method = event.httpMethod || 'POST';

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers: getCORSHeaders(), body: '' };
    }

    // PAT（个人访问令牌）吊销拦截：PAT 是带 jti 声明的长效 JWT，
    // 现有 authenticate 可正常解析；此处仅查表确认未吊销。
    // 会话 JWT 无 jti 声明，直接跳过，零影响。
    const _authPayload = authenticate(event);
    if (_authPayload && _authPayload.jti) {
      try {
        await ensureAccessTokensTable();
        const _patRows = await query(
          'SELECT revoked_at, expires_at FROM access_tokens WHERE jti = ? LIMIT 1',
          [_authPayload.jti]
        );
        const _revoked = !_patRows.length || _patRows[0].revoked_at;
        const _expired = _patRows[0] && _patRows[0].expires_at && new Date(_patRows[0].expires_at) < new Date();
        if (_revoked || _expired) {
          return {
            statusCode: 401,
            headers: getCORSHeaders(),
            body: JSON.stringify({ success: false, error: 'Token已吊销或过期' })
          };
        }
        // fire-and-forget 更新最近使用时间，不阻塞请求
        query('UPDATE access_tokens SET last_used_at = NOW() WHERE jti = ?', [_authPayload.jti]).catch(() => {});
      } catch (e) {
        console.warn('PAT 吊销检查失败，放行:', e.message);
      }
    }

    // 路由分发
    // 优先按 body.action 精确分发(前端总是带 action);
    // path 含义模糊(如 /list 会匹配 /list-user-roles),仅作无 action 时的回退。
    const action = body?.action;
    const actionMap = {
      upload_and_deploy: handleUploadAndDeploy,
      list: handleListWebsites,
      delete: handleDeleteWebsite,
      list_all: handleListAllWebsites,
      update_name: handleUpdateWebsiteName,
      update_tags: handleUpdateWebsiteTags,
      set_subdomain: handleSetSubdomain,
      check_subdomain: handleCheckSubdomain,
      clear_subdomain: handleClearSubdomain,
      update_visibility: handleUpdateWebsiteVisibility,
      update_seo: handleUpdateSeo,
      resolve_subdomain: handleResolveSubdomain,
      check_site_access: handleCheckSiteAccess,
      track_site_event: handleTrackSiteEvent,
      get_site_stats: handleGetSiteStats,
      get_site_access_logs: handleGetSiteAccessLogs,
      rollup_site_analytics: handleRollupSiteAnalytics,
      backfill_site_analytics_geo: handleBackfillSiteAnalyticsGeo,
      list_projects: handleListProjects,
      create_project: handleCreateProject,
      update_project: handleUpdateProject,
      archive_project: handleArchiveProject,
      set_website_project: handleSetWebsiteProject,
      list_project_members: handleListProjectMembers,
      invite_project_member: handleInviteProjectMember,
      search_feishu_project_principals: handleSearchFeishuProjectPrincipals,
      grant_project_to_feishu: handleGrantProjectToFeishu,
      remove_project_feishu_grant: handleRemoveProjectFeishuGrant,
      update_project_member_role: handleUpdateProjectMemberRole,
      remove_project_member: handleRemoveProjectMember,
      migrate_subdomain: handleMigrateSubdomain,
      migrate_default_projects: handleMigrateDefaultProjects,
      migrate_site_visibility: handleMigrateSiteVisibility,
      migrate_project_collaboration: handleMigrateProjectCollaboration,
      migrate_site_analytics: handleMigrateSiteAnalytics,
      bucket_stats: handleBucketStats,
      list_user_roles: handleListUserRoles,
      set_user_role: handleSetUserRole,
      delete_user_role: handleDeleteUserRole,
      list_role_limits: handleListRoleLimits,
      set_role_limit: handleSetRoleLimit,
      delete_role_limit: handleDeleteRoleLimit,
      resolve_user_emails: handleResolveUserEmails,
      get_role_limits: handleGetRoleLimits,
      get_usage: handleGetUsage,
      migrate_website_usage: handleMigrateWebsiteUsage,
      create_token: handleCreateToken,
      list_tokens: handleListTokens,
      revoke_token: handleRevokeToken,
      migrate_access_tokens: handleMigrateAccessTokens,
      track_product_event: handleTrackProductEvent,
      get_product_funnel: handleGetProductFunnel,
      migrate_product_events: handleMigrateProductEvents,
      // 多云存储桶注册制
      list_buckets: handleListBuckets,
      register_bucket: handleRegisterBucket,
      update_bucket: handleUpdateBucket,
      delete_bucket: handleDeleteBucket,
      set_default_bucket: handleSetDefaultBucket,
      migrate_buckets: handleMigrateBuckets
    };

    if (action && actionMap[action]) {
      return await actionMap[action](event);
    }

    if (isAnalyticsRollupTimerEvent(event)) {
      return await handleRollupSiteAnalytics(event);
    }

    // 无 action 时按 path 回退(兼容旧调用)。注意顺序:更长/更具体的放前面。
    if (pathUrl.includes('/upload')) {
      return await handleUploadAndDeploy(event);
    } else if (pathUrl.includes('/list-user-roles')) {
      return await handleListUserRoles(event);
    } else if (pathUrl.includes('/list-role-limits')) {
      return await handleListRoleLimits(event);
    } else if (pathUrl.includes('/get-usage')) {
      return await handleGetUsage(event);
    } else if (pathUrl.includes('/create-token')) {
      return await handleCreateToken(event);
    } else if (pathUrl.includes('/list-tokens')) {
      return await handleListTokens(event);
    } else if (pathUrl.includes('/revoke-token')) {
      return await handleRevokeToken(event);
    } else if (pathUrl.includes('/track-product-event')) {
      return await handleTrackProductEvent(event);
    } else if (pathUrl.includes('/get-product-funnel')) {
      return await handleGetProductFunnel(event);
    } else if (pathUrl.includes('/list-projects')) {
      return await handleListProjects(event);
    } else if (pathUrl.includes('/create-project')) {
      return await handleCreateProject(event);
    } else if (pathUrl.includes('/update-project')) {
      return await handleUpdateProject(event);
    } else if (pathUrl.includes('/archive-project')) {
      return await handleArchiveProject(event);
    } else if (pathUrl.includes('/set-website-project')) {
      return await handleSetWebsiteProject(event);
    } else if (pathUrl.includes('/list-project-members')) {
      return await handleListProjectMembers(event);
    } else if (pathUrl.includes('/invite-project-member')) {
      return await handleInviteProjectMember(event);
    } else if (pathUrl.includes('/update-project-member-role')) {
      return await handleUpdateProjectMemberRole(event);
    } else if (pathUrl.includes('/remove-project-member')) {
      return await handleRemoveProjectMember(event);
    } else if (pathUrl.includes('/list-all')) {
      return await handleListAllWebsites(event);
    } else if (pathUrl.includes('/list')) {
      return await handleListWebsites(event);
    } else if (pathUrl.includes('/delete')) {
      return await handleDeleteWebsite(event);
    } else if (pathUrl.includes('/update-name')) {
      return await handleUpdateWebsiteName(event);
    } else if (pathUrl.includes('/update-tags')) {
      return await handleUpdateWebsiteTags(event);
    } else if (pathUrl.includes('/set-subdomain')) {
      return await handleSetSubdomain(event);
    } else if (pathUrl.includes('/check-subdomain')) {
      return await handleCheckSubdomain(event);
    } else if (pathUrl.includes('/clear-subdomain')) {
      return await handleClearSubdomain(event);
    } else if (pathUrl.includes('/update-visibility')) {
      return await handleUpdateWebsiteVisibility(event);
    } else if (pathUrl.includes('/update-seo')) {
      return await handleUpdateSeo(event);
    } else if (pathUrl.includes('/resolve-subdomain')) {
      return await handleResolveSubdomain(event);
    } else if (pathUrl.includes('/check-site-access')) {
      return await handleCheckSiteAccess(event);
    } else if (pathUrl.includes('/track-site-event') || pathUrl.includes('/analytics/track')) {
      return await handleTrackSiteEvent(event);
    } else if (pathUrl.includes('/site-stats') || pathUrl.includes('/analytics/stats')) {
      return await handleGetSiteStats(event);
    } else if (pathUrl.includes('/site-access-logs') || pathUrl.includes('/analytics/access-logs')) {
      return await handleGetSiteAccessLogs(event);
    } else if (pathUrl.includes('/analytics/rollup')) {
      return await handleRollupSiteAnalytics(event);
    } else if (pathUrl.includes('/analytics/backfill-geo')) {
      return await handleBackfillSiteAnalyticsGeo(event);
    } else if (pathUrl.includes('/migrate-subdomain')) {
      return await handleMigrateSubdomain(event);
    } else if (pathUrl.includes('/migrate-default-projects')) {
      return await handleMigrateDefaultProjects(event);
    } else if (pathUrl.includes('/migrate-site-visibility')) {
      return await handleMigrateSiteVisibility(event);
    } else if (pathUrl.includes('/migrate-project-collaboration')) {
      return await handleMigrateProjectCollaboration(event);
    } else if (pathUrl.includes('/migrate-site-analytics')) {
      return await handleMigrateSiteAnalytics(event);
    } else if (pathUrl.includes('/migrate-website-usage')) {
      return await handleMigrateWebsiteUsage(event);
    } else if (pathUrl.includes('/migrate-access-tokens')) {
      return await handleMigrateAccessTokens(event);
    } else if (pathUrl.includes('/migrate-product-events')) {
      return await handleMigrateProductEvents(event);
    } else {
      return {
        statusCode: 404,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: 'Not Found', message: '接口不存在' })
      };
    }
  } catch (error) {
    console.error('处理请求失败:', error);
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: 'Internal Server Error', message: error.message })
    };
  }
};

/**
 * 从数据库获取用户角色配置
 */
async function getUserLimits(userId) {
  try {
    // 1. 获取用户的角色
    const userRolesResult = await query('SELECT roles FROM user_roles WHERE user_id = ?', [userId]);

    if (userRolesResult.length === 0) {
      // 没有角色配置，返回默认普通用户配置
      return {
        name: 'user',
        priority: 10,
        deployment_limit: 10,
        max_file_size: 50 * 1024 * 1024,
        max_file_count: 100
      };
    }

    // 处理 roles 字段（可能是字符串或已解析的对象）
    let userRoles = userRolesResult[0].roles;
    if (typeof userRoles === 'string') {
      userRoles = JSON.parse(userRoles || '[]');
    } else if (!Array.isArray(userRoles)) {
      userRoles = [];
    }

    // 2. 获取所有角色配置
    const rolesConfig = await query('SELECT * FROM roles WHERE enabled = 1 ORDER BY priority DESC');

    // 3. 找到用户拥有的最高优先级角色
    let highestRole = null;
    for (const role of rolesConfig) {
      if (userRoles.includes(role.id)) {
        if (!highestRole || role.priority > highestRole.priority) {
          highestRole = role;
        }
      }
    }

    if (!highestRole) {
      // 没有匹配的角色，返回默认配置
      return {
        name: 'user',
        priority: 10,
        deployment_limit: 10,
        max_file_size: 50 * 1024 * 1024,
        max_file_count: 100
      };
    }

    return {
      name: highestRole.name,
      priority: highestRole.priority,
      deployment_limit: highestRole.deployment_limit,
      max_file_size: highestRole.max_file_size || 50 * 1024 * 1024,
      max_file_count: highestRole.max_file_count
    };
  } catch (e) {
    console.error('获取用户角色配置失败:', e);
    // 返回默认配置
    return {
      name: 'user',
      priority: 10,
      deployment_limit: 10,
      max_file_size: 50 * 1024 * 1024,
      max_file_count: 100
    };
  }
}

/**
 * 幂等确保 websites 表存在 file_count / storage_size 列（用量统计用）。
 * 冷启动后只检查一次；列已存在时仅一次轻量 information_schema 查询。
 * 未执行 008 迁移的历史库也能自动补列，避免部署写入失败。
 */
let _usageColumnsEnsured = false;
async function ensureUsageColumns() {
  if (_usageColumnsEnsured) return;
  try {
    const cols = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites'
         AND COLUMN_NAME IN ('file_count','storage_size')`
    );
    const have = new Set((cols || []).map((r) => r.COLUMN_NAME));
    if (!have.has('file_count')) {
      await query(`ALTER TABLE websites ADD COLUMN file_count INT DEFAULT NULL COMMENT '本次部署的文件数量（单次上传包）'`);
    }
    if (!have.has('storage_size')) {
      await query(`ALTER TABLE websites ADD COLUMN storage_size BIGINT DEFAULT NULL COMMENT '本次部署的上传包体积(字节)'`);
    }
  } catch (e) {
    // 列可能已存在（并发）或库不可用；写入时若仍缺列会再兜底。
    console.warn('ensureUsageColumns 跳过:', e.message);
  }
  _usageColumnsEnsured = true;
}

/**
 * 幂等确保 websites 表存在 seo_title / seo_description / og_image 列。
 * 冷启动后只检查一次；用于边缘函数在回源时向 <head> 注入 SEO meta。
 */
let _seoColumnsEnsured = false;
async function ensureSeoColumns() {
  if (_seoColumnsEnsured) return;
  try {
    const cols = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites'
         AND COLUMN_NAME IN ('seo_title','seo_description','og_image')`
    );
    const have = new Set((cols || []).map((r) => r.COLUMN_NAME));
    if (!have.has('seo_title')) {
      await query(`ALTER TABLE websites ADD COLUMN seo_title VARCHAR(255) NULL COMMENT 'SEO 标题，为空回退 name'`);
    }
    if (!have.has('seo_description')) {
      await query(`ALTER TABLE websites ADD COLUMN seo_description VARCHAR(500) NULL COMMENT 'SEO 描述（meta description）'`);
    }
    if (!have.has('og_image')) {
      await query(`ALTER TABLE websites ADD COLUMN og_image VARCHAR(500) NULL COMMENT 'OG 图片外链 URL'`);
    }
  } catch (e) {
    console.warn('ensureSeoColumns 跳过:', e.message);
  }
  _seoColumnsEnsured = true;
}

/**
 * 幂等确保 access_tokens 表存在（个人访问令牌）。
 */
let _accessTokensTableEnsured = false;
async function ensureAccessTokensTable() {
  if (_accessTokensTableEnsured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS access_tokens (
        id           BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id      VARCHAR(64) NOT NULL COMMENT '所属用户ID',
        name         VARCHAR(255) NOT NULL COMMENT '令牌名称（用户自取）',
        jti          VARCHAR(64) NOT NULL COMMENT 'JWT ID，用于吊销查表',
        prefix       VARCHAR(32) NOT NULL COMMENT '令牌前缀（展示用，不可还原）',
        expires_at   TIMESTAMP NULL DEFAULT NULL COMMENT '过期时间',
        last_used_at TIMESTAMP NULL DEFAULT NULL COMMENT '最近使用时间',
        revoked_at   TIMESTAMP NULL DEFAULT NULL COMMENT '吊销时间',
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_access_tokens_jti (jti),
        INDEX idx_access_tokens_user (user_id),
        INDEX idx_access_tokens_prefix (prefix)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='个人访问令牌'`
    );
  } catch (e) {
    console.warn('ensureAccessTokensTable 跳过:', e.message);
  }
  _accessTokensTableEnsured = true;
}

/**
 * 幂等确保 product_events 表存在（产品漏斗埋点）。
 */
let _productEventsTableEnsured = false;
async function ensureProductEventsTable() {
  if (_productEventsTableEnsured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS product_events (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        event_name  VARCHAR(64) NOT NULL COMMENT '事件名',
        visitor_id  VARCHAR(64) NOT NULL DEFAULT '' COMMENT '匿名访客ID',
        page        VARCHAR(128) NOT NULL DEFAULT '' COMMENT '触发页面路径',
        props       JSON NULL COMMENT '附加属性（JSON）',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_events_name_time (event_name, created_at),
        INDEX idx_product_events_visitor (visitor_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品漏斗埋点'`
    );
  } catch (e) {
    console.warn('ensureProductEventsTable 跳过:', e.message);
  }
  _productEventsTableEnsured = true;
}

/**
 * 检查管理员权限
 */
async function checkAdmin(userId) {
  const roles = await query('SELECT roles FROM user_roles WHERE user_id = ?', [userId]);
  if (roles.length === 0) {
    return false;
  }
  // mysql2 对 JSON 列会自动解析为数组;字符串时才需 JSON.parse
  let userRoles = roles[0].roles;
  if (typeof userRoles === 'string') {
    try { userRoles = JSON.parse(userRoles || '[]'); } catch (e) { userRoles = []; }
  }
  if (!Array.isArray(userRoles)) userRoles = [];
  return userRoles.includes('admin');
}

/**
 * 查询站点列表并附带项目展示字段。项目表未迁移时自动降级为只查 websites。
 */
async function queryWebsitesWithProjects({ userId = null, includeAll = false, projectId = null } = {}) {
  const normalizedProjectId = await resolveProjectId(projectId);

  try {
    const grantRoles = includeAll ? new Map() : await getFeishuGrantedProjectRoles(userId);
    const grantedProjectIds = Array.from(grantRoles.keys());
    const params = [];
    const where = [];
    let roleSelect = 'NULL AS project_role';
    let memberJoin = '';

    if (!includeAll) {
      roleSelect =
        `CASE
           WHEN p.user_id = ? THEN '${PROJECT_ROLE_OWNER}'
           WHEN pm.role IN ('${PROJECT_ROLE_ADMIN}', '${PROJECT_ROLE_MEMBER}') THEN pm.role
           ELSE NULL
         END AS project_role`;
      params.push(userId);
      memberJoin = 'LEFT JOIN project_members pm ON pm.project_id = w.project_id AND pm.user_id = ?';
      params.push(userId);
      const grantSql = grantedProjectIds.length
        ? ` OR w.project_id IN (${grantedProjectIds.map(() => '?').join(', ')})`
        : '';
      where.push(`(w.user_id = ? OR p.user_id = ? OR pm.user_id = ?${grantSql})`);
      params.push(userId, userId, userId);
      params.push(...grantedProjectIds);
    }
    if (normalizedProjectId) {
      where.push('w.project_id = ?');
      params.push(normalizedProjectId);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await query(
      `SELECT w.*,
              p.name AS project_name,
              p.project_key AS project_key,
              p.slug AS project_slug,
              p.archived AS project_archived,
              ${roleSelect},
              u.nickname AS user_nickname
       FROM websites w
       LEFT JOIN projects p ON p.id = w.project_id
       ${memberJoin}
       LEFT JOIN users u ON u.id = w.user_id
       ${whereSql}
       ORDER BY w.created_at DESC`,
      params
    );
    return rows.map((row) => ({
      ...row,
      project_role: strongestProjectRole(row.project_role, grantRoles.get(String(row.project_id)))
    }));
  } catch (e) {
    console.warn('查询站点项目/协作字段失败，降级只查归属站点:', e.message);
    const fallbackWhere = [];
    const fallbackParams = [];
    if (!includeAll) {
      fallbackWhere.push('user_id = ?');
      fallbackParams.push(userId);
    }
    if (normalizedProjectId) {
      fallbackWhere.push('project_id = ?');
      fallbackParams.push(normalizedProjectId);
    }
    const fallbackWhereSql = fallbackWhere.length ? `WHERE ${fallbackWhere.join(' AND ')}` : '';
    return await query(
      `SELECT * FROM websites ${fallbackWhereSql} ORDER BY created_at DESC`,
      fallbackParams
    );
  }
}

/**
 * 获取用户网站列表
 */
async function handleListWebsites(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const projectId = (event.body || event).projectId;
  const websites = await queryWebsitesWithProjects({ userId, projectId });

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      websites: websites.map(formatWebsiteForClient),
      count: websites.length
    })
  };
}

/**
 * 管理员查看所有网站
 */
async function handleListAllWebsites(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const isAdmin = await checkAdmin(userId);
  if (!isAdmin) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '仅管理员可访问' })
    };
  }

  const projectId = (event.body || event).projectId;
  const websites = await queryWebsitesWithProjects({ includeAll: true, projectId });

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      websites: websites.map(formatWebsiteForClient),
      count: websites.length
    })
  };
}

/**
 * 删除网站
 */
async function handleDeleteWebsite(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { id, websiteId, key } = event.body || event;

  if (!id && !websiteId && !key) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: id 或 websiteId 或 key' })
    };
  }

  const where = [];
  const params = [];

  if (id) {
    where.push('id = ?');
    params.push(id);
  } else if (websiteId) {
    where.push('website_id = ?');
    params.push(websiteId);
  } else if (key) {
    where.push('path = ?');
    params.push(key);
  }

  const rows = await query(`SELECT * FROM websites WHERE ${where.join(' AND ')} LIMIT 1`, params);
  const site = rows[0];
  if (!site || !(await canUserManageSite(userId, site))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限删除该记录' })
    };
  }

  // 路由表在 websites.subdomain 列里，删除行即清理；边缘缓存 60s 内自然失效。
  const result = await query('DELETE FROM websites WHERE id = ?', [site.id]);

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '删除成功',
      deletedCount: result.affectedRows
    })
  };
}

/**
 * 更新网站名称
 */
async function handleUpdateWebsiteName(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, name } = event.body || event;

  if (!docId || !name) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: docId, name' })
    };
  }

  const websites = await query('SELECT * FROM websites WHERE id = ?', [docId]);
  if (websites.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '记录不存在' })
    };
  }

  if (!(await canUserManageSite(userId, websites[0]))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限更新该记录' })
    };
  }

  await query(
    'UPDATE websites SET name = ?, updated_at = NOW() WHERE id = ?',
    [name, docId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '名称已更新',
      name
    })
  };
}

/**
 * 更新网站标签
 */
async function handleUpdateWebsiteTags(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, tags } = event.body || event;

  if (!docId || !Array.isArray(tags)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: docId, tags' })
    };
  }

  const cleanTags = tags
    .map(t => String(t || '').trim())
    .filter(t => t.length > 0 && t.length <= 32);

  if (cleanTags.length > 20) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '标签数量不能超过20个' })
    };
  }

  const websites = await query('SELECT * FROM websites WHERE id = ?', [docId]);
  if (websites.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '记录不存在' })
    };
  }

  if (!(await canUserManageSite(userId, websites[0]))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限更新该记录' })
    };
  }

  await query(
    'UPDATE websites SET tags = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(cleanTags), docId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '标签已更新',
      tags: cleanTags
    })
  };
}


/**
 * 校验自定义子域名前缀(label)：只允许小写字母、数字、连字符，
 * 不以连字符开头/结尾，长度 5-63；并排除会与旧格式/平台冲突的前缀。
 */
const SUBDOMAIN_MIN_LENGTH = 5;
const SUBDOMAIN_MAX_LENGTH = 63;
const SUBDOMAIN_RULE_MESSAGE = `仅限小写字母、数字、连字符，${SUBDOMAIN_MIN_LENGTH}-${SUBDOMAIN_MAX_LENGTH} 位，且不能用保留词`;
const RESERVED_LABELS = new Set([
  'www', 'sites', 'kv-admin', 'api', 'app', 'admin', 'mail', 'ftp',
  'cdn', 'static', 'assets', 'blog', 'demox'
]);

function normalizeLabel(input) {
  return String(input || '').trim().toLowerCase();
}

function isValidLabel(label) {
  if (typeof label !== 'string') return false;
  if (label.length < SUBDOMAIN_MIN_LENGTH || label.length > SUBDOMAIN_MAX_LENGTH) return false;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
  // 旧格式以 sites- 开头，避免与向后兼容正则冲突
  if (label.startsWith('sites-')) return false;
  if (RESERVED_LABELS.has(label)) return false;
  return true;
}

/**
 * 设置/修改站点的自定义子域名前缀。
 * 流程：校验归属 + 前缀合法/未占用 → 写 KV(label->{path}) → 删旧 label 的 KV → 落库。
 * 访问地址：https://{label}.{officialDomain}
 */
/**
 * 实时检测前缀是否可用(供前端输入时防抖调用)。
 * 返回 { success, available, reason }。无需写库,只读。
 */
async function handleCheckSubdomain(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, websiteId, subdomain } = event.body || event;
  const body = event.body || event;
  const label = normalizeLabel(subdomain);
  const domain = normalizeOfficialDomain(body.domain || body.subdomainDomain || body.subdomain_domain);

  if (!isValidLabel(label)) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        available: false,
        reason: 'invalid',
        message: SUBDOMAIN_RULE_MESSAGE
      })
    };
  }
  if (!domain) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        available: false,
        reason: 'invalid_domain',
        message: `不支持的官方域名，可选：${officialDomains.join(', ')}`
      })
    };
  }

  // 找出当前站点(用于判断"前缀已属于自己"算可用)
  let selfId = null;
  try {
    if (docId) {
      const rows = await query('SELECT * FROM websites WHERE id = ?', [docId]);
      if (rows[0] && (await canUserManageSite(userId, rows[0]))) selfId = String(rows[0].id);
    } else if (websiteId) {
      const rows = await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId]);
      if (rows[0] && (await canUserManageSite(userId, rows[0]))) selfId = String(rows[0].id);
    }
  } catch (e) {}

  // 占用判断:① 被别的站点用作同一官方域名下的自定义前缀 ② 撞到默认域名 websiteId(仅 demox.site)
  const occupied = await query(
    'SELECT id FROM websites WHERE subdomain = ? AND COALESCE(NULLIF(subdomain_domain, \'\'), ?) = ? LIMIT 1',
    [label, defaultDomain, domain]
  );
  const takenByOther = occupied.length > 0 && String(occupied[0].id) !== selfId;

  // 自己站点的 websiteId(小写)允许作为 demox.site 前缀(等于默认域名,无意义但不算冲突);别人的 websiteId 则冲突
  let widConflict = false;
  if (domain === defaultDomain) {
    const widHit = await query('SELECT id FROM websites WHERE LOWER(website_id) = ? LIMIT 1', [label]);
    widConflict = widHit.length > 0 && String(widHit[0].id) !== selfId;
  }

  const blocked = takenByOther || widConflict;
  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      available: !blocked,
      domain,
      reason: blocked ? 'taken' : 'ok',
      message: blocked ? '该前缀已被占用' : '可用'
    })
  };
}

async function handleSetSubdomain(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, websiteId, subdomain } = event.body || event;
  const body = event.body || event;
  const label = normalizeLabel(subdomain);
  const domain = normalizeOfficialDomain(body.domain || body.subdomainDomain || body.subdomain_domain);

  if (!isValidLabel(label)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        reason: 'invalid',
        message: `前缀不合法：${SUBDOMAIN_RULE_MESSAGE}`
      })
    };
  }
  if (!domain) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        reason: 'invalid_domain',
        message: `不支持的官方域名，可选：${officialDomains.join(', ')}`
      })
    };
  }

  // 定位站点并校验归属
  let site;
  if (docId) {
    const rows = await query('SELECT * FROM websites WHERE id = ?', [docId]);
    site = rows[0];
  } else if (websiteId) {
    const rows = await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId]);
    site = rows[0];
  }

  if (!site) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '站点不存在' })
    };
  }
  if (!(await canUserManageSite(userId, site))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '无权操作该站点' })
    };
  }

  // 并发安全：不做"先查后写"（有 TOCTOU 竞争），直接靠 subdomain 列的唯一索引兜底。
  // 用条件 UPDATE：仅当目标前缀未被别人占用(不存在 / 或就是本站点)时才写入。
  try {
    // 前缀不能撞 demox.site 下别的站点 websiteId(那是它的默认域名,保留)
    if (domain === defaultDomain) {
      const widHit = await query('SELECT id FROM websites WHERE LOWER(website_id) = ? LIMIT 1', [label]);
      if (widHit.length > 0 && String(widHit[0].id) !== String(site.id)) {
        return {
          statusCode: 409,
          headers: getCORSHeaders(),
          body: JSON.stringify({ success: false, code: 'DUPLICATE', message: '该前缀已被占用，请换一个' })
        };
      }
    }

    // 先确认该前缀当前是否已属于本站点（幂等：重复设置同一个前缀直接成功）
    const currentDomain = normalizeOfficialDomain(site.subdomain_domain) || defaultDomain;
    if (site.subdomain === label && currentDomain === domain) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: true,
          subdomain: label,
          subdomainDomain: domain,
          subdomain_domain: domain,
          url: buildCustomSiteUrl(label, domain),
          message: '该前缀已是当前站点'
        })
      };
    }

    // 条件写入：唯一索引保证并发下只有一个请求能成功；重复会抛 ER_DUP_ENTRY
    await query(
      'UPDATE websites SET subdomain = ?, subdomain_domain = ?, updated_at = NOW() WHERE id = ?',
      [label, domain, site.id]
    );

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        subdomain: label,
        subdomainDomain: domain,
        subdomain_domain: domain,
        url: buildCustomSiteUrl(label, domain),
        message: '设置成功，访问可能有最长 60 秒的边缘缓存同步延迟'
      })
    };
  } catch (error) {
    // 唯一索引冲突 = 并发下被别的站点抢先占用
    if (error && (error.code === 'ER_DUP_ENTRY' || /duplicate/i.test(error.message || ''))) {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, code: 'DUPLICATE', message: '该前缀已被占用，请换一个' })
      };
    }
    console.error('设置子域名失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: error.message || '设置失败' })
    };
  }
}

/**
 * 清除站点的自定义子域名前缀（删 KV + 清库），站点仍可用原始长地址访问。
 */
async function handleClearSubdomain(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, websiteId } = event.body || event;

  let site;
  if (docId) {
    const rows = await query('SELECT * FROM websites WHERE id = ?', [docId]);
    site = rows[0];
  } else if (websiteId) {
    const rows = await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId]);
    site = rows[0];
  }

  if (!site) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '站点不存在' })
    };
  }
  if (!(await canUserManageSite(userId, site))) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '无权操作该站点' })
    };
  }

  if (!site.subdomain) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: true, message: '该站点未设置自定义前缀' })
    };
  }

  try {
    await query(
      'UPDATE websites SET subdomain = NULL, subdomain_domain = ?, updated_at = NOW() WHERE id = ?',
      [defaultDomain, site.id]
    );
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: true, message: '已清除自定义前缀' })
    };
  } catch (error) {
    console.error('清除子域名失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: error.message || '清除失败' })
    };
  }
}

/**
 * 设置站点访问级别。public 可匿名访问；private 仅 owner/admin 可访问。
 */
async function handleUpdateWebsiteVisibility(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, error: '未登录或token已过期' })
    };
  }

  const body = event.body || event;
  const docId = normalizePositiveId(body.docId || body.id);
  const websiteId = body.websiteId ? String(body.websiteId).trim() : '';
  const rawVisibility = String(body.visibility || '').trim().toLowerCase();
  if (![VISIBILITY_PUBLIC, VISIBILITY_PRIVATE].includes(rawVisibility)) {
    return ok({ success: false, message: 'visibility 只能是 public 或 private' });
  }
  if (!docId && !websiteId) {
    return ok({ success: false, message: '缺少 docId 或 websiteId' });
  }

  try {
    const site = await getWebsiteByIdentity({ docId, websiteId });
    if (!site || !(await canUserManageSite(userId, site))) {
      return ok({ success: false, message: '站点不存在或无权限' });
    }

    await query('UPDATE websites SET visibility = ?, updated_at = NOW() WHERE id = ?', [rawVisibility, site.id]);
    const cachePurge = await purgeSiteCache({
      websiteId: site.website_id,
      subdomain: site.subdomain,
      subdomainDomain: site.subdomain_domain
    });
    return ok({
      success: true,
      visibility: rawVisibility,
      websiteId: site.website_id,
      cachePurge,
      message: rawVisibility === VISIBILITY_PRIVATE ? '站点已设为私有' : '站点已公开'
    });
  } catch (error) {
    console.error('更新站点访问级别失败:', error);
    return ok({ success: false, message: error.message || '更新访问级别失败' });
  }
}

/**
 * 更新站点 SEO 元信息（title / description / og_image）。
 * 边缘函数在回源时读取这些字段，向 <head> 注入 meta 标签。
 * 修改后清边缘缓存，约 60s 内生效。
 */
async function handleUpdateSeo(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, error: '未登录或token已过期' })
    };
  }

  const body = event.body || event;
  const docId = normalizePositiveId(body.docId || body.id);
  const websiteId = body.websiteId ? String(body.websiteId).trim() : '';
  if (!docId && !websiteId) {
    return ok({ success: false, message: '缺少 docId 或 websiteId' });
  }

  const seoTitle = String(body.seoTitle || '').trim().slice(0, 255);
  const seoDescription = String(body.seoDescription || '').trim().slice(0, 500);
  const ogImage = String(body.ogImage || '').trim().slice(0, 500);

  try {
    await ensureSeoColumns();
    const site = await getWebsiteByIdentity({ docId, websiteId });
    if (!site || !(await canUserManageSite(userId, site))) {
      return ok({ success: false, message: '站点不存在或无权限' });
    }

    await query(
      'UPDATE websites SET seo_title = ?, seo_description = ?, og_image = ?, updated_at = NOW() WHERE id = ?',
      [seoTitle || null, seoDescription || null, ogImage || null, site.id]
    );
    const cachePurge = await purgeSiteCache({
      websiteId: site.website_id,
      subdomain: site.subdomain,
      subdomainDomain: site.subdomain_domain
    });
    return ok({
      success: true,
      seo: {
        title: seoTitle || null,
        description: seoDescription || null,
        ogImage: ogImage || null
      },
      websiteId: site.website_id,
      cachePurge,
      message: 'SEO 设置已更新'
    });
  } catch (error) {
    console.error('更新 SEO 失败:', error);
    return ok({ success: false, message: error.message || '更新 SEO 失败' });
  }
}

/**
 * 管理员鉴权辅助：返回 { userId } 或 错误响应对象。
 */
async function requireAdmin(event) {
  const userId = getUserId(event);
  if (!userId) {
    return { err: { statusCode: 401, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '未登录或token已过期' }) } };
  }
  const ok = await checkAdmin(userId);
  if (!ok) {
    return { err: { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '仅管理员可访问' }) } };
  }
  return { userId };
}

function ok(obj) {
  return { statusCode: 200, headers: getCORSHeaders(), body: JSON.stringify(obj) };
}

function normalizeProjectKey(input) {
  const value = String(input || '').trim().toUpperCase();
  if (!value || /^\d+$/.test(value)) return '';
  return /^[A-Z0-9]{6,20}$/.test(value) ? value : '';
}

function generateProjectKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'P';
  while (out.length < 10) {
    out += chars[nodeCrypto.randomInt(0, chars.length)];
  }
  return out;
}

async function createUniqueProjectKey() {
  for (let i = 0; i < 20; i += 1) {
    const key = generateProjectKey();
    try {
      const rows = await query('SELECT id FROM projects WHERE project_key = ? LIMIT 1', [key]);
      if (rows.length === 0) return key;
    } catch (e) {
      return key;
    }
  }
  throw new Error('生成项目 ID 失败，请重试');
}

async function resolveProjectId(input) {
  const numeric = normalizePositiveId(input);
  if (numeric) return numeric;
  const key = normalizeProjectKey(input);
  if (!key) return null;
  try {
    const rows = await query('SELECT id FROM projects WHERE project_key = ? LIMIT 1', [key]);
    return rows[0]?.id || null;
  } catch (e) {
    return null;
  }
}

async function ensureProjectKeyForId(projectId) {
  const id = normalizePositiveId(projectId);
  if (!id) return null;
  try {
    const rows = await query('SELECT project_key FROM projects WHERE id = ? LIMIT 1', [id]);
    if (rows[0]?.project_key) return rows[0].project_key;
    for (let i = 0; i < 20; i += 1) {
      const key = await createUniqueProjectKey();
      const res = await query('UPDATE projects SET project_key = ? WHERE id = ? AND (project_key IS NULL OR project_key = \'\')', [key, id]);
      if (res.affectedRows) return key;
    }
  } catch (e) {
    console.warn('补齐项目随机 ID 失败:', e.message);
  }
  return null;
}

function formatProjectForClient(row) {
  const publicId = row.project_key || row.projectKey || row.id;
  return {
    id: publicId == null ? null : String(publicId),
    _id: publicId == null ? null : String(publicId),
    numericId: row.id == null ? null : String(row.id),
    projectKey: row.project_key || row.projectKey || null,
    userId: row.user_id,
    name: row.name || 'default',
    slug: row.slug || 'default',
    description: row.description || '',
    color: row.color || null,
    icon: row.icon || null,
    role: row.project_role || row.role || null,
    ownerUserId: row.user_id || null,
    ownerEmail: row.owner_email || row.ownerEmail || '',
    ownerNickname: row.owner_nickname || row.ownerNickname || '',
    archived: !!row.archived,
    websitesCount: Number(row.websites_count || row.websitesCount || 0),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined
  };
}

function normalizeProjectSlug(input) {
  const slug = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'project';
}

function normalizeProjectRole(input) {
  const role = String(input || PROJECT_ROLE_MEMBER).trim().toLowerCase();
  return PROJECT_ROLES.includes(role) ? role : PROJECT_ROLE_MEMBER;
}

function projectRoleRank(role) {
  if (role === PROJECT_ROLE_OWNER) return 3;
  if (role === PROJECT_ROLE_ADMIN) return 2;
  if (role === PROJECT_ROLE_MEMBER) return 1;
  return 0;
}

function strongestProjectRole(...roles) {
  return roles
    .filter((role) => PROJECT_ROLES.includes(role))
    .sort((a, b) => projectRoleRank(b) - projectRoleRank(a))[0] || null;
}

function normalizeFeishuGrantInput(body) {
  const principalType = body.principalType === FEISHU_PRINCIPAL_DEPARTMENT
    ? FEISHU_PRINCIPAL_DEPARTMENT
    : FEISHU_PRINCIPAL_USER;
  const keyType = principalType === FEISHU_PRINCIPAL_DEPARTMENT ? 'open_department_id' : 'open_id';
  const principalKey = String(body.principalKey || body.identifier || '').trim();
  const validKey = principalType === FEISHU_PRINCIPAL_DEPARTMENT
    ? /^od-[A-Za-z0-9_-]+$/.test(principalKey)
    : /^ou_[A-Za-z0-9_-]+$/.test(principalKey);
  return {
    principalType,
    keyType,
    principalKey,
    displayName: String(body.displayName || '').trim().slice(0, 120),
    valid: validKey && principalKey.length <= 255
  };
}

function formatFeishuProjectGrant(row) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    principalType: row.principal_type,
    keyType: row.key_type,
    principalKey: row.principal_key,
    tenantKey: row.tenant_key || null,
    displayName: row.display_name || '',
    role: normalizeProjectRole(row.role),
    createdBy: row.created_by || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined
  };
}

function mergeGrantedRole(roles, row) {
  const key = String(row.project_id);
  roles.set(key, roles.has(key) ? strongestProjectRole(roles.get(key), row.role) : normalizeProjectRole(row.role));
}

function parseDepartmentIds(value) {
  if (Array.isArray(value)) return value.filter((id) => typeof id === 'string' && id.startsWith('od-'));
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id.startsWith('od-')) : [];
  } catch (e) {
    return [];
  }
}

function isDirectoryIdentityFresh(identity) {
  if (!identity?.directorySyncedAt) return false;
  return Date.now() - new Date(identity.directorySyncedAt).getTime() <= FEISHU_DIRECTORY_TTL_MS;
}

async function refreshFeishuDirectoryIdentity(userId, identity) {
  if (!identity?.openId) return { ...identity, directoryFresh: false };
  if (isDirectoryIdentityFresh(identity)) return { ...identity, directoryFresh: true };
  try {
    const directory = await feishuDirectory.getUserDepartmentClosure(identity.openId);
    await query(
      `UPDATE users
       SET feishu_department_ids = ?, feishu_directory_synced_at = NOW(), updated_at = NOW()
       WHERE id = ? AND feishu_open_id = ?`,
      [JSON.stringify(directory.departmentIds), userId, identity.openId]
    );
    return {
      ...identity,
      departmentIds: directory.departmentIds,
      directorySyncedAt: new Date(),
      directoryFresh: true
    };
  } catch (error) {
    console.warn('刷新飞书部门身份失败:', JSON.stringify({ code: error.code || null, message: error.message }));
    return { ...identity, departmentIds: [], directoryFresh: false };
  }
}

async function getFeishuGrantedProjectRoles(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return new Map();
  const roles = new Map();
  try {
    const identityRows = await query(
      `SELECT feishu_open_id, feishu_union_id, feishu_tenant_key,
              feishu_department_ids, feishu_directory_synced_at
       FROM users WHERE id = ? LIMIT 1`,
      [uid]
    );
    const row = identityRows[0];
    if (!row?.feishu_open_id) return roles;
    let identity = {
      openId: row.feishu_open_id,
      unionId: row.feishu_union_id || null,
      tenantKey: row.feishu_tenant_key || null,
      departmentIds: parseDepartmentIds(row.feishu_department_ids),
      directorySyncedAt: row.feishu_directory_synced_at || null
    };

    const directRows = await query(
      `SELECT project_id, role
       FROM project_feishu_grants
       WHERE active = 1 AND principal_type = '${FEISHU_PRINCIPAL_USER}'
         AND key_type = 'open_id' AND principal_key = ?
         AND tenant_key = ?`,
      [identity.openId, identity.tenantKey]
    );
    directRows.forEach((grant) => mergeGrantedRole(roles, grant));

    if (!identity.tenantKey) return roles;
    const departmentGrantCount = await query(
      `SELECT COUNT(*) AS c FROM project_feishu_grants
       WHERE active = 1 AND principal_type = '${FEISHU_PRINCIPAL_DEPARTMENT}'
         AND key_type = 'open_department_id' AND tenant_key = ?`,
      [identity.tenantKey]
    );
    if (Number(departmentGrantCount[0]?.c || 0) === 0) return roles;

    identity = await refreshFeishuDirectoryIdentity(uid, identity);
    if (!identity.directoryFresh || identity.departmentIds.length === 0) return roles;
    const placeholders = identity.departmentIds.map(() => '?').join(', ');
    const departmentRows = await query(
      `SELECT project_id, role
       FROM project_feishu_grants
       WHERE active = 1 AND principal_type = '${FEISHU_PRINCIPAL_DEPARTMENT}'
         AND key_type = 'open_department_id' AND tenant_key = ?
         AND principal_key IN (${placeholders})`,
      [identity.tenantKey, ...identity.departmentIds]
    );
    departmentRows.forEach((grant) => mergeGrantedRole(roles, grant));
  } catch (e) {
    if (!/project_feishu_grants|feishu_tenant_key|feishu_department_ids|feishu_directory_synced_at/i.test(e.message || '')) {
      console.warn('读取飞书项目授权失败:', e.message);
    }
  }
  return roles;
}

function formatProjectMemberForClient(row) {
  const role = normalizeProjectRole(row.role);
  const email = String(row.email || '').trim();
  const nickname = String(row.nickname || '').trim();
  return {
    userId: row.user_id || row.userId,
    email,
    nickname,
    role,
    isOwner: role === PROJECT_ROLE_OWNER,
    joinedAt: row.joined_at ? new Date(row.joined_at).getTime() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined
  };
}

function formatProjectInvitationForClient(row) {
  return {
    id: row.id == null ? null : String(row.id),
    projectId: row.project_id == null ? null : String(row.project_id),
    email: row.email || '',
    role: normalizeProjectRole(row.role),
    status: row.status || 'pending',
    invitedBy: row.invited_by || null,
    acceptedBy: row.accepted_by || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : undefined
  };
}

function normalizeEmail(input) {
  return String(input || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

async function getUserById(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  try {
    const rows = await query('SELECT id, email, nickname FROM users WHERE id = ? LIMIT 1', [uid]);
    return rows[0] || null;
  } catch (e) {
    return null;
  }
}

async function getUserByEmail(email) {
  const clean = normalizeEmail(email);
  if (!clean) return null;
  const rows = await query('SELECT id, email, nickname FROM users WHERE email = ? LIMIT 1', [clean]);
  return rows[0] || null;
}

async function getFeishuIdentityForUser(userId) {
  try {
    const rows = await query(
      `SELECT feishu_open_id, feishu_union_id, feishu_tenant_key, feishu_email, feishu_name,
              feishu_department_ids, feishu_directory_synced_at
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row?.feishu_open_id) return null;
    return {
      openId: row.feishu_open_id,
      unionId: row.feishu_union_id || null,
      tenantKey: row.feishu_tenant_key || null,
      email: row.feishu_email || null,
      name: row.feishu_name || null,
      departmentIds: parseDepartmentIds(row.feishu_department_ids),
      directorySyncedAt: row.feishu_directory_synced_at || null
    };
  } catch (e) {
    return null;
  }
}

async function ensureProjectOwnerMembership(projectId, ownerId) {
  const pid = normalizePositiveId(projectId);
  const uid = String(ownerId || '').trim();
  if (!pid || !uid) return;
  await query(
    `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
     VALUES (?, ?, '${PROJECT_ROLE_OWNER}', ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE role = '${PROJECT_ROLE_OWNER}', updated_at = NOW()`,
    [pid, uid, uid]
  );
}

async function ensureProjectOwnerMembershipBestEffort(projectId, ownerId) {
  try {
    await ensureProjectOwnerMembership(projectId, ownerId);
  } catch (e) {
    // Collaboration migration may not be applied yet. Keep legacy project flows working.
    console.warn('确保项目 owner 成员关系失败，跳过:', e.message);
  }
}

async function getProjectWithUserRole(userId, projectId, { includeArchived = true } = {}) {
  const pid = await resolveProjectId(projectId);
  const uid = String(userId || '').trim();
  if (!pid || !uid) return null;

  const archivedSql = includeArchived ? '' : 'AND p.archived = 0';
  try {
    const grantRoles = await getFeishuGrantedProjectRoles(uid);
    const grantRole = grantRoles.get(String(pid)) || null;
    const rows = await query(
      `SELECT p.*,
              CASE
                WHEN p.user_id = ? THEN '${PROJECT_ROLE_OWNER}'
                WHEN pm.role IN ('${PROJECT_ROLE_ADMIN}', '${PROJECT_ROLE_MEMBER}') THEN pm.role
                ELSE NULL
              END AS project_role
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE p.id = ? ${archivedSql}
         AND (p.user_id = ? OR pm.user_id = ? OR ? IS NOT NULL)
       LIMIT 1`,
      [uid, uid, pid, uid, uid, grantRole]
    );
    if (!rows[0]) return null;
    return { ...rows[0], project_role: strongestProjectRole(rows[0].project_role, grantRole) };
  } catch (e) {
    const rows = await query(
      `SELECT *, '${PROJECT_ROLE_OWNER}' AS project_role
       FROM projects
       WHERE id = ? AND user_id = ? ${includeArchived ? '' : 'AND archived = 0'}
       LIMIT 1`,
      [pid, uid]
    );
    if (!rows[0]) return null;
    return { ...rows[0], project_role: PROJECT_ROLE_OWNER };
  }
}

async function getProjectRoleForUser(userId, projectId) {
  const project = await getProjectWithUserRole(userId, projectId);
  return project ? project.project_role : null;
}

async function canUserReadProject(userId, projectId) {
  if (!userId || !projectId) return false;
  if (await checkAdmin(userId)) return true;
  return !!(await getProjectWithUserRole(userId, projectId));
}

async function canUserWriteProject(userId, projectId) {
  if (!userId || !projectId) return false;
  const pid = await resolveProjectId(projectId);
  if (!pid) return false;
  if (await checkAdmin(userId)) {
    const rows = await query('SELECT id FROM projects WHERE id = ? AND archived = 0 LIMIT 1', [pid]);
    return rows.length > 0;
  }
  const project = await getProjectWithUserRole(userId, pid, { includeArchived: false });
  return !!(project && PROJECT_WRITE_ROLES.includes(project.project_role));
}

async function getWebsiteByIdentity({ docId, websiteId }) {
  const params = [];
  const where = [];
  const id = normalizePositiveId(docId);
  if (id) {
    where.push('id = ?');
    params.push(id);
  } else if (websiteId) {
    where.push('website_id = ?');
    params.push(String(websiteId).trim());
  } else {
    return null;
  }
  const rows = await query(`SELECT * FROM websites WHERE ${where.join(' AND ')} LIMIT 1`, params);
  return rows[0] || null;
}

async function canUserManageSite(userId, site) {
  if (!userId || !site) return false;
  if (String(site.user_id || '') === String(userId)) return true;
  if (await checkAdmin(userId)) return true;
  if (!site.project_id) return false;
  return await canUserWriteProject(userId, site.project_id);
}

async function canUserReadSite(userId, site) {
  if (!userId || !site) return false;
  if (String(site.user_id || '') === String(userId)) return true;
  if (await checkAdmin(userId)) return true;
  if (!site.project_id) return false;
  return await canUserReadProject(userId, site.project_id);
}

async function acceptPendingProjectInvitationsForUser(userId) {
  const user = await getUserById(userId);
  const email = normalizeEmail(user?.email);
  if (!email) return 0;

  try {
    const invitations = await query(
      `SELECT pi.*
       FROM project_invitations pi
       JOIN projects p ON p.id = pi.project_id
       WHERE pi.email = ?
         AND pi.status = 'pending'
         AND (pi.expires_at IS NULL OR pi.expires_at > NOW())
         AND p.archived = 0`,
      [email]
    );
    if (invitations.length === 0) return 0;

    await transaction(async (conn) => {
      for (const inv of invitations) {
        const role = normalizeProjectRole(inv.role);
        const safeRole = role === PROJECT_ROLE_OWNER ? PROJECT_ROLE_MEMBER : role;
        await conn.query(
          `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
           VALUES (?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             role = IF(role = '${PROJECT_ROLE_OWNER}', role, VALUES(role)),
             updated_at = NOW()`,
          [inv.project_id, userId, safeRole, inv.invited_by || null]
        );
        await conn.query(
          `UPDATE project_invitations
           SET status = 'accepted', accepted_by = ?, accepted_at = NOW(), updated_at = NOW()
           WHERE id = ? AND status = 'pending'`,
          [userId, inv.id]
        );
      }
    });
    return invitations.length;
  } catch (e) {
    console.warn('自动接受项目邀请失败，可能尚未执行协作迁移:', e.message);
    return 0;
  }
}

async function getProjectForUser(userId, projectId) {
  const id = await resolveProjectId(projectId);
  if (!id) return null;
  const rows = await query(
    'SELECT * FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function getSiteForProjectMove({ userId, docId, websiteId, isAdmin }) {
  const params = [];
  const where = [];
  if (docId) {
    where.push('id = ?');
    params.push(docId);
  } else if (websiteId) {
    where.push('website_id = ?');
    params.push(websiteId);
  } else {
    return null;
  }
  if (!isAdmin) {
    where.push('user_id = ?');
    params.push(userId);
  }
  const rows = await query(`SELECT * FROM websites WHERE ${where.join(' AND ')} LIMIT 1`, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 当前用户项目列表。调用时会先确保该用户至少有一个 default 项目。
 */
async function handleListProjects(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const includeArchived = !!body.includeArchived;
  const includeAll = !!body.includeAll;
  const isAdmin = includeAll ? await checkAdmin(userId) : false;
  if (includeAll && !isAdmin) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '仅管理员可访问' }) };
  }

  try {
    if (!includeAll) {
      await ensureDefaultProjectForUser(userId);
      await acceptPendingProjectInvitationsForUser(userId);
    }
    const grantRoles = includeAll ? new Map() : await getFeishuGrantedProjectRoles(userId);
    const grantedProjectIds = Array.from(grantRoles.keys());
    const params = [userId, userId];
    const where = [];
    if (!includeAll) {
      const grantSql = grantedProjectIds.length
        ? ` OR p.id IN (${grantedProjectIds.map(() => '?').join(', ')})`
        : '';
      where.push(`(p.user_id = ? OR pm.user_id = ?${grantSql})`);
      params.push(userId, userId);
      params.push(...grantedProjectIds);
    }
    if (!includeArchived) where.push('p.archived = 0');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM websites w WHERE w.project_id = p.id) AS websites_count,
              CASE
                WHEN p.user_id = ? THEN '${PROJECT_ROLE_OWNER}'
                WHEN pm.role IN ('${PROJECT_ROLE_ADMIN}', '${PROJECT_ROLE_MEMBER}') THEN pm.role
                ELSE NULL
              END AS project_role,
              owner.email AS owner_email,
              owner.nickname AS owner_nickname
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
       LEFT JOIN users owner ON owner.id = p.user_id
       ${whereSql}
       ORDER BY p.archived ASC, p.updated_at DESC, p.id ASC`,
      params
    );
    const projects = rows.map((row) => formatProjectForClient({
      ...row,
      project_role: strongestProjectRole(row.project_role, grantRoles.get(String(row.id)))
    }));
    return ok({ success: true, projects, count: projects.length });
  } catch (e) {
    console.warn('协作项目列表查询失败，尝试 owner-only 降级:', e.message);
    try {
      const params = [];
      const where = [];
      if (!includeAll) {
        where.push('p.user_id = ?');
        params.push(userId);
      }
      if (!includeArchived) where.push('p.archived = 0');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = await query(
        `SELECT p.*,
                (SELECT COUNT(*) FROM websites w WHERE w.project_id = p.id) AS websites_count,
                '${PROJECT_ROLE_OWNER}' AS project_role,
                owner.email AS owner_email,
                owner.nickname AS owner_nickname
         FROM projects p
         LEFT JOIN users owner ON owner.id = p.user_id
         ${whereSql}
         ORDER BY p.archived ASC, p.updated_at DESC, p.id ASC`,
        params
      );
      return ok({ success: true, projects: rows.map(formatProjectForClient), count: rows.length, collaborationReady: false });
    } catch (fallbackError) {
      return ok({ success: false, message: '项目表未初始化，请先执行 migrate_default_projects', error: fallbackError.message });
    }
  }
}

async function handleCreateProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const name = String(body.name || '').trim();
  if (!name) return ok({ success: false, message: '项目名称不能为空' });
  if (name.length > 80) return ok({ success: false, message: '项目名称不能超过80个字符' });

  const baseSlug = normalizeProjectSlug(body.slug || name);
  const description = body.description ? String(body.description).trim().slice(0, 500) : null;
  const color = body.color ? String(body.color).trim().slice(0, 32) : null;
  const icon = body.icon ? String(body.icon).trim().slice(0, 64) : null;

  try {
    let slug = baseSlug;
    let suffix = 1;
    while (true) {
      try {
        const projectKey = await createUniqueProjectKey();
        const res = await query(
          `INSERT INTO projects (project_key, user_id, name, slug, description, color, icon)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [projectKey, userId, name, slug, description, color, icon]
        );
        const rows = await query('SELECT * FROM projects WHERE id = ? LIMIT 1', [res.insertId]);
        await ensureProjectOwnerMembershipBestEffort(res.insertId, userId);
        return ok({ success: true, project: formatProjectForClient({ ...rows[0], project_role: PROJECT_ROLE_OWNER }), message: '项目已创建' });
      } catch (e) {
        if (!/Duplicate entry/i.test(e.message || '') || suffix >= 20) throw e;
        suffix += 1;
        slug = `${baseSlug.slice(0, 58)}-${suffix}`;
      }
    }
  } catch (e) {
    return ok({ success: false, message: '创建项目失败：' + e.message });
  }
}

async function handleUpdateProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const id = await resolveProjectId(body.id || body.projectId);
  if (!id) return ok({ success: false, message: '缺少 projectId' });

  const sets = [];
  const params = [];
  const setField = (col, val) => { sets.push(`${col} = ?`); params.push(val); };
  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return ok({ success: false, message: '项目名称不能为空' });
    if (name.length > 80) return ok({ success: false, message: '项目名称不能超过80个字符' });
    setField('name', name);
  }
  if (body.description !== undefined) setField('description', body.description ? String(body.description).trim().slice(0, 500) : null);
  if (body.color !== undefined) setField('color', body.color ? String(body.color).trim().slice(0, 32) : null);
  if (body.icon !== undefined) setField('icon', body.icon ? String(body.icon).trim().slice(0, 64) : null);
  if (sets.length === 0) return ok({ success: false, message: '没有要更新的字段' });

  try {
    const project = await getProjectWithUserRole(userId, id);
    const isPlatformAdmin = await checkAdmin(userId);
    if (!project && !isPlatformAdmin) return ok({ success: false, message: '项目不存在或无权限' });
    if (project && !PROJECT_WRITE_ROLES.includes(project.project_role) && !isPlatformAdmin) {
      return ok({ success: false, message: '只有项目 owner/admin 可以更新项目' });
    }
    params.push(id);
    const res = await query(`UPDATE projects SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params);
    if (!res.affectedRows) return ok({ success: false, message: '项目不存在或无权限' });
    const rows = await query('SELECT * FROM projects WHERE id = ? LIMIT 1', [id]);
    return ok({ success: true, project: formatProjectForClient({ ...rows[0], project_role: project?.project_role || PROJECT_ROLE_OWNER }), message: '项目已更新' });
  } catch (e) {
    return ok({ success: false, message: '更新项目失败：' + e.message });
  }
}

async function handleArchiveProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const id = await resolveProjectId(body.id || body.projectId);
  if (!id) return ok({ success: false, message: '缺少 projectId' });
  const archived = body.archived === undefined ? 1 : (body.archived ? 1 : 0);

  try {
    const project = await getProjectWithUserRole(userId, id);
    const isPlatformAdmin = await checkAdmin(userId);
    if (!project && !isPlatformAdmin) return ok({ success: false, message: '项目不存在或无权限' });
    const rows = await query('SELECT slug FROM projects WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) return ok({ success: false, message: '项目不存在或无权限' });
    if (project && project.project_role !== PROJECT_ROLE_OWNER && !isPlatformAdmin) {
      return ok({ success: false, message: '只有项目 owner 可以归档项目' });
    }
    if (rows[0].slug === 'default' && archived) return ok({ success: false, message: 'default 项目不能归档' });
    await query('UPDATE projects SET archived = ?, updated_at = NOW() WHERE id = ?', [archived, id]);
    return ok({ success: true, archived: !!archived, message: archived ? '项目已归档' : '项目已恢复' });
  } catch (e) {
    return ok({ success: false, message: '归档项目失败：' + e.message });
  }
}

async function handleSetWebsiteProject(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const docId = normalizePositiveId(body.docId || body.id);
  const websiteId = body.websiteId ? String(body.websiteId).trim() : '';
  let projectId = await resolveProjectId(body.projectId);

  if (!docId && !websiteId) return ok({ success: false, message: '缺少 docId 或 websiteId' });

  try {
    const site = await getWebsiteByIdentity({ docId, websiteId });
    if (!site) return ok({ success: false, message: '站点不存在或无权限' });
    const canManage = await canUserManageSite(userId, site);
    if (!canManage) return ok({ success: false, message: '站点不存在或无权限' });

    if (!projectId) {
      projectId = await ensureDefaultProjectForUser(site.user_id);
    }
    const isPlatformAdmin = await checkAdmin(userId);
    let project = await getProjectWithUserRole(userId, projectId, { includeArchived: false });
    if (!project && isPlatformAdmin) {
      const rows = await query('SELECT * FROM projects WHERE id = ? AND archived = 0 LIMIT 1', [projectId]);
      if (rows[0]) project = { ...rows[0], project_role: PROJECT_ROLE_OWNER };
    }
    if (!project) return ok({ success: false, message: '目标项目不存在或已归档' });
    if (!isPlatformAdmin && !PROJECT_WRITE_ROLES.includes(project.project_role)) {
      return ok({ success: false, message: '只有目标项目 owner/admin 可以移动站点' });
    }

    await query('UPDATE websites SET project_id = ?, updated_at = NOW() WHERE id = ?', [project.id, site.id]);
    return ok({
      success: true,
      project: formatProjectForClient(project),
      websiteId: site.website_id,
      docId: String(site.id),
      message: '站点已移动到项目'
    });
  } catch (e) {
    return ok({ success: false, message: '移动站点失败：' + e.message });
  }
}

async function requireProjectMembershipManager(userId, projectId) {
  const isPlatformAdmin = await checkAdmin(userId);
  let project = await getProjectWithUserRole(userId, projectId);
  if (!project && isPlatformAdmin) {
    const rows = await query('SELECT * FROM projects WHERE id = ? LIMIT 1', [projectId]);
    if (rows[0]) project = { ...rows[0], project_role: PROJECT_ROLE_OWNER };
  }
  if (!project) {
    return { error: '项目不存在或无权限' };
  }
  if (!isPlatformAdmin && !PROJECT_WRITE_ROLES.includes(project.project_role)) {
    return { error: '只有项目 owner/admin 可以管理成员' };
  }
  return { project, role: project.project_role, isPlatformAdmin };
}

async function handleListProjectMembers(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });

  try {
    const project = await getProjectWithUserRole(userId, projectId);
    const isPlatformAdmin = await checkAdmin(userId);
    if (!project && !isPlatformAdmin) return ok({ success: false, message: '项目不存在或无权限' });
    if (project) await ensureProjectOwnerMembershipBestEffort(project.id, project.user_id);

    const members = await query(
      `SELECT pm.project_id, pm.user_id, pm.role, pm.joined_at, pm.updated_at,
              u.email, u.nickname
       FROM project_members pm
       LEFT JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?
       ORDER BY
         CASE pm.role
           WHEN '${PROJECT_ROLE_OWNER}' THEN 1
           WHEN '${PROJECT_ROLE_ADMIN}' THEN 2
           ELSE 3
         END,
         pm.joined_at ASC`,
      [projectId]
    );
    const feishuGrants = await query(
      `SELECT * FROM project_feishu_grants
       WHERE project_id = ? AND active = 1
       ORDER BY created_at DESC`,
      [projectId]
    );
    const currentFeishuIdentity = await getFeishuIdentityForUser(userId);
    const invitations = await query(
      `SELECT *
       FROM project_invitations
       WHERE project_id = ? AND status = 'pending'
       ORDER BY created_at DESC`,
      [projectId]
    );

    return ok({
      success: true,
      project: project ? formatProjectForClient(project) : null,
      role: project?.project_role || (isPlatformAdmin ? PROJECT_ROLE_OWNER : null),
      members: members.map(formatProjectMemberForClient),
      invitations: invitations.map(formatProjectInvitationForClient),
      feishuGrants: feishuGrants.map(formatFeishuProjectGrant),
      currentFeishuIdentity
    });
  } catch (e) {
    return ok({ success: false, message: '协作表未初始化，请先执行 migrate_project_collaboration', error: e.message });
  }
}

function feishuDirectoryFailure(error) {
  if (error instanceof FeishuDirectoryError) {
    const permissionMissing = Number(error.code) === 99991672 || Number(error.code) === 40004;
    return {
      success: false,
      message: permissionMissing
        ? '飞书应用尚未开通通讯录读取权限或数据范围，请先完成应用权限配置'
        : error.message,
      errorCode: error.code || null,
      permissionMissing
    };
  }
  return { success: false, message: '飞书通讯录请求失败：' + error.message };
}

async function handleSearchFeishuProjectPrincipals(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const principalType = body.principalType === FEISHU_PRINCIPAL_DEPARTMENT
    ? FEISHU_PRINCIPAL_DEPARTMENT
    : FEISHU_PRINCIPAL_USER;
  const keyword = String(body.query || body.keyword || '').trim();
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!keyword) return ok({ success: false, message: principalType === FEISHU_PRINCIPAL_USER ? '请输入飞书登录邮箱' : '请输入部门名称' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    const identity = await getFeishuIdentityForUser(userId);
    if (!identity?.tenantKey) {
      return ok({ success: false, message: '请先在账号设置中关联飞书，再搜索飞书用户或部门' });
    }

    if (principalType === FEISHU_PRINCIPAL_USER) {
      const user = await feishuDirectory.resolveUserByEmail(keyword);
      return ok({
        success: true,
        principals: [{
          principalType,
          keyType: 'open_id',
          principalKey: user.openId,
          displayName: user.name,
          secondaryText: user.email,
          avatarUrl: user.avatarUrl || null
        }]
      });
    }

    const normalizedKeyword = keyword.toLocaleLowerCase();
    const departments = await feishuDirectory.listDepartments();
    const principals = departments
      .filter((department) => {
        const name = String(department.name || department.i18n_name?.zh_cn || '').toLocaleLowerCase();
        return name.includes(normalizedKeyword) || String(department.open_department_id).includes(keyword);
      })
      .slice(0, 20)
      .map((department) => ({
        principalType,
        keyType: 'open_department_id',
        principalKey: department.open_department_id,
        displayName: department.name || department.i18n_name?.zh_cn || department.open_department_id,
        secondaryText: `${Number(department.member_count || 0)} 人（含下级部门）`,
        memberCount: Number(department.member_count || 0)
      }));
    return ok({ success: true, principals });
  } catch (error) {
    return ok(feishuDirectoryFailure(error));
  }
}

async function handleGrantProjectToFeishu(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const role = normalizeProjectRole(body.role);
  const principal = normalizeFeishuGrantInput(body);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!principal.valid) {
    return ok({ success: false, message: '请先搜索并选择一个有效的飞书用户或部门' });
  }
  if (role === PROJECT_ROLE_OWNER) return ok({ success: false, message: 'owner 只能由项目创建者担任' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && role === PROJECT_ROLE_ADMIN) {
      return ok({ success: false, message: 'admin 只能授予 member' });
    }
    const identity = await getFeishuIdentityForUser(userId);
    if (!identity?.tenantKey) return ok({ success: false, message: '请先关联飞书账号再创建飞书授权' });

    let verifiedName = principal.displayName;
    if (principal.principalType === FEISHU_PRINCIPAL_USER) {
      const target = await feishuDirectory.getUser(principal.principalKey);
      if (!target || target.status?.is_resigned) return ok({ success: false, message: '飞书用户不存在或已离职' });
      verifiedName = target.name || target.en_name || verifiedName || principal.principalKey;
    } else {
      const target = await feishuDirectory.getDepartment(principal.principalKey);
      if (!target || target.status?.is_deleted) return ok({ success: false, message: '飞书部门不存在或已删除' });
      verifiedName = target.name || target.i18n_name?.zh_cn || verifiedName || principal.principalKey;
    }
    await query(
      `INSERT INTO project_feishu_grants
       (project_id, principal_type, key_type, principal_key, tenant_key, display_name, role, created_by, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         tenant_key = VALUES(tenant_key), display_name = VALUES(display_name),
         role = VALUES(role), created_by = VALUES(created_by),
         active = 1, updated_at = NOW()`,
      [projectId, principal.principalType, principal.keyType, principal.principalKey, identity.tenantKey,
        verifiedName || null, role, userId]
    );
    const rows = await query(
      `SELECT * FROM project_feishu_grants
       WHERE project_id = ? AND principal_type = ? AND key_type = ? AND principal_key = ? LIMIT 1`,
      [projectId, principal.principalType, principal.keyType, principal.principalKey]
    );
    return ok({
      success: true,
      grant: rows[0] ? formatFeishuProjectGrant(rows[0]) : null,
      message: principal.principalType === FEISHU_PRINCIPAL_DEPARTMENT
        ? '已授权给飞书部门，该部门及下级部门用户使用飞书登录后即可访问'
        : '已授权给飞书用户，对方无需预先注册 Demox'
    });
  } catch (e) {
    return ok(feishuDirectoryFailure(e));
  }
}

async function handleRemoveProjectFeishuGrant(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });
  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const grantId = normalizePositiveId(body.grantId);
  if (!projectId || !grantId) return ok({ success: false, message: '缺少 projectId 或 grantId' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    const rows = await query(
      'SELECT role FROM project_feishu_grants WHERE id = ? AND project_id = ? AND active = 1 LIMIT 1',
      [grantId, projectId]
    );
    if (!rows[0]) return ok({ success: false, message: '飞书授权不存在' });
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && normalizeProjectRole(rows[0].role) !== PROJECT_ROLE_MEMBER) {
      return ok({ success: false, message: 'admin 只能移除 member 授权' });
    }
    await query(
      'UPDATE project_feishu_grants SET active = 0, updated_at = NOW() WHERE id = ? AND project_id = ?',
      [grantId, projectId]
    );
    return ok({ success: true, removedGrantId: String(grantId), message: '飞书授权已移除' });
  } catch (e) {
    return ok({ success: false, message: '移除飞书授权失败：' + e.message });
  }
}

async function handleInviteProjectMember(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const email = normalizeEmail(body.email);
  const role = normalizeProjectRole(body.role);
  if (!projectId) return ok({ success: false, message: '缺少 projectId' });
  if (!isValidEmail(email)) return ok({ success: false, message: '请输入有效邮箱' });
  if (role === PROJECT_ROLE_OWNER) return ok({ success: false, message: 'owner 只能由项目创建者担任' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && role === PROJECT_ROLE_ADMIN) {
      return ok({ success: false, message: 'admin 只能邀请 member' });
    }
    await ensureProjectOwnerMembershipBestEffort(projectId, access.project.user_id);

    const targetUser = await getUserByEmail(email);
    if (targetUser) {
      if (String(targetUser.id) === String(access.project.user_id)) {
        return ok({ success: true, member: formatProjectMemberForClient({
          user_id: targetUser.id,
          email: targetUser.email,
          nickname: targetUser.nickname,
          role: PROJECT_ROLE_OWNER
        }), message: '该用户已经是项目 owner' });
      }

      const currentRows = await query('SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, targetUser.id]);
      if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && currentRows.length > 0) {
        const currentRole = normalizeProjectRole(currentRows[0].role);
        if (currentRole !== PROJECT_ROLE_MEMBER) {
          return ok({ success: false, message: 'admin 只能管理 member' });
        }
      }

      await query(
        `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           role = IF(role = '${PROJECT_ROLE_OWNER}', role, VALUES(role)),
           invited_by = VALUES(invited_by),
           updated_at = NOW()`,
        [projectId, targetUser.id, role, userId]
      );
      await query(
        `UPDATE project_invitations
         SET status = 'accepted', accepted_by = ?, accepted_at = NOW(), updated_at = NOW()
         WHERE project_id = ? AND email = ? AND status = 'pending'`,
        [targetUser.id, projectId, email]
      );
      return ok({
        success: true,
        member: formatProjectMemberForClient({
          user_id: targetUser.id,
          email: targetUser.email,
          nickname: targetUser.nickname,
          role
        }),
        message: '成员已加入项目'
      });
    }

    const token = nodeCrypto.randomBytes(24).toString('hex');
    await query(
      `INSERT INTO project_invitations (project_id, email, role, token, invited_by, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL 30 DAY))
       ON DUPLICATE KEY UPDATE role = VALUES(role), token = VALUES(token), invited_by = VALUES(invited_by),
         status = 'pending', expires_at = VALUES(expires_at), updated_at = NOW()`,
      [projectId, email, role, token, userId]
    );
    const rows = await query(
      `SELECT * FROM project_invitations WHERE project_id = ? AND email = ? AND status = 'pending' LIMIT 1`,
      [projectId, email]
    );
    return ok({
      success: true,
      invitation: rows[0] ? formatProjectInvitationForClient(rows[0]) : { email, role, status: 'pending' },
      message: '邀请已记录，对方注册或登录该邮箱后会自动加入项目'
    });
  } catch (e) {
    return ok({ success: false, message: '邀请失败：' + e.message });
  }
}

async function handleUpdateProjectMemberRole(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const targetUserId = String(body.userId || body.uid || '').trim();
  const role = normalizeProjectRole(body.role);
  if (!projectId || !targetUserId) return ok({ success: false, message: '缺少 projectId 或 userId' });
  if (role === PROJECT_ROLE_OWNER) return ok({ success: false, message: '不能把成员设置为 owner' });

  try {
    const access = await requireProjectMembershipManager(userId, projectId);
    if (access.error) return ok({ success: false, message: access.error });
    if (String(targetUserId) === String(access.project.user_id)) {
      return ok({ success: false, message: '不能修改项目 owner 的角色' });
    }

    const currentRows = await query('SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, targetUserId]);
    if (currentRows.length === 0) return ok({ success: false, message: '成员不存在' });
    const currentRole = normalizeProjectRole(currentRows[0].role);
    if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN) {
      if (projectRoleRank(currentRole) >= projectRoleRank(PROJECT_ROLE_ADMIN) || role === PROJECT_ROLE_ADMIN) {
        return ok({ success: false, message: 'admin 只能管理 member' });
      }
    }

    await query(
      `UPDATE project_members SET role = ?, updated_at = NOW()
       WHERE project_id = ? AND user_id = ? AND role <> '${PROJECT_ROLE_OWNER}'`,
      [role, projectId, targetUserId]
    );
    const target = await getUserById(targetUserId);
    return ok({
      success: true,
      member: formatProjectMemberForClient({
        user_id: targetUserId,
        email: target?.email || '',
        nickname: target?.nickname || '',
        role
      }),
      message: '成员角色已更新'
    });
  } catch (e) {
    return ok({ success: false, message: '更新成员角色失败：' + e.message });
  }
}

async function handleRemoveProjectMember(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ success: false, error: '未登录或token已过期' });

  const body = event.body || event;
  const projectId = await resolveProjectId(body.projectId || body.id);
  const targetUserId = String(body.userId || body.uid || '').trim();
  if (!projectId || !targetUserId) return ok({ success: false, message: '缺少 projectId 或 userId' });

  try {
    const projectRows = await query('SELECT * FROM projects WHERE id = ? LIMIT 1', [projectId]);
    const project = projectRows[0];
    if (!project) return ok({ success: false, message: '项目不存在' });
    if (String(targetUserId) === String(project.user_id)) {
      return ok({ success: false, message: '不能移除项目 owner' });
    }

    const currentRows = await query('SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1', [projectId, targetUserId]);
    if (currentRows.length === 0) return ok({ success: false, message: '成员不存在' });
    const targetRole = normalizeProjectRole(currentRows[0].role);
    const leavingSelf = String(targetUserId) === String(userId);
    let access = null;
    if (!leavingSelf) {
      access = await requireProjectMembershipManager(userId, projectId);
      if (access.error) return ok({ success: false, message: access.error });
      if (!access.isPlatformAdmin && access.role === PROJECT_ROLE_ADMIN && targetRole !== PROJECT_ROLE_MEMBER) {
        return ok({ success: false, message: 'admin 只能移除 member' });
      }
    }

    await query('DELETE FROM project_members WHERE project_id = ? AND user_id = ? AND role <> ?', [projectId, targetUserId, PROJECT_ROLE_OWNER]);
    return ok({ success: true, removedUserId: targetUserId, message: leavingSelf ? '已退出项目' : '成员已移除' });
  } catch (e) {
    return ok({ success: false, message: '移除成员失败：' + e.message });
  }
}

/** 列出所有用户角色(user_roles 表),带 email(LEFT JOIN users) */
async function handleListUserRoles(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  // users 表主键是 id(形如 user_xxx);老站点的纯数字 user_id 不在 users 表中,email 为 null
  const rows = await query(
    `SELECT ur.user_id, ur.roles, ur.updated_at, u.email
     FROM user_roles ur
     LEFT JOIN users u ON u.id = ur.user_id
     ORDER BY ur.updated_at DESC`
  );
  const list = rows.map((r) => ({
    _id: r.user_id,
    email: r.email || '',
    role: typeof r.roles === 'string' ? JSON.parse(r.roles || '[]') : (r.roles || []),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined
  }));
  return ok({ success: true, data: list });
}

/** 设置/新增某用户的角色 */
async function handleSetUserRole(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const { uid, role } = event.body || event;
  const targetUid = String(uid || '').trim();
  if (!targetUid) return ok({ success: false, message: '缺少用户 UID' });
  const rolesArr = Array.isArray(role) ? role.map((x) => String(x).trim()).filter(Boolean) : [];
  await query(
    `INSERT INTO user_roles (user_id, roles, updated_at) VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE roles = VALUES(roles), updated_at = NOW()`,
    [targetUid, JSON.stringify(rolesArr)]
  );
  return ok({ success: true });
}

/** 删除某用户的角色文档 */
async function handleDeleteUserRole(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const { uid } = event.body || event;
  const targetUid = String(uid || '').trim();
  if (!targetUid) return ok({ success: false, message: '缺少用户 UID' });
  await query('DELETE FROM user_roles WHERE user_id = ?', [targetUid]);
  return ok({ success: true });
}

/** 列出角色限额定义(roles 表) */
async function handleListRoleLimits(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const rows = await query('SELECT * FROM roles ORDER BY priority DESC');
  const list = rows.map((r) => ({
    _id: r.id || r.name,
    name: r.name,
    priority: r.priority,
    max_file_size: r.max_file_size,
    deployment_limit: r.deployment_limit,
    max_file_count: r.max_file_count,
    allowed_extensions: typeof r.allowed_extensions === 'string'
      ? JSON.parse(r.allowed_extensions || 'null')
      : (r.allowed_extensions || null),
    enabled: r.enabled === null || r.enabled === undefined ? null : !!r.enabled,
    description: r.description || null
  }));
  return ok({ success: true, data: list });
}

/** 设置/新增角色限额(docId/id 用角色名或现有 id) */
async function handleSetRoleLimit(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const d = event.body || event;
  const id = String(d.id || d.name || '').trim();
  const name = String(d.name || d.id || '').trim();
  if (!name) return ok({ success: false, message: '缺少角色名' });

  const allowedExt = Array.isArray(d.allowed_extensions)
    ? JSON.stringify(d.allowed_extensions)
    : (d.allowed_extensions == null ? null : JSON.stringify(d.allowed_extensions));

  await query(
    `INSERT INTO roles (id, name, priority, enabled, max_file_count, allowed_extensions, deployment_limit, max_file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name), priority = VALUES(priority), enabled = VALUES(enabled),
       max_file_count = VALUES(max_file_count), allowed_extensions = VALUES(allowed_extensions),
       deployment_limit = VALUES(deployment_limit), max_file_size = VALUES(max_file_size)`,
    [
      id || name,
      name,
      d.priority == null ? null : Number(d.priority),
      d.enabled == null ? 1 : (d.enabled ? 1 : 0),
      d.max_file_count == null ? null : Number(d.max_file_count),
      allowedExt,
      d.deployment_limit == null ? null : Number(d.deployment_limit),
      d.max_file_size == null ? null : Number(d.max_file_size)
    ]
  );
  return ok({ success: true });
}

/**
 * 大盘统计：各存储桶 sites/ 用量/对象数 + 用户数/项目数(来自 DB)。
 * 多云后按桶聚合：遍历 storage_buckets，逐桶 provider.list('sites/') 求和，
 * 并返回每桶明细 perBucket[]。表未建/为空时回退旧默认桶。
 * 流量时序需云监控,SCF 默认无权限,best-effort:拿不到返回 null。
 */
async function handleBucketStats(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;

  // 1) 列出要统计的桶：注册表优先，空则回退 LEGACY_BUCKET
  let bucketCfgs = [];
  try {
    const rows = await query('SELECT * FROM storage_buckets WHERE enabled = 1 ORDER BY is_default DESC, id ASC');
    bucketCfgs = rows.map(buckets.rowToConfig);
  } catch (e) {
    console.warn('读取 storage_buckets 失败，回退旧默认桶统计:', e.message);
  }
  if (bucketCfgs.length === 0) bucketCfgs = [LEGACY_BUCKET];

  // 2) 逐桶统计 sites/ 前缀。单桶失败不影响其它桶（best-effort）。
  let sitesBytes = 0;
  let sitesCount = 0;
  const perBucket = [];
  for (const cfg of bucketCfgs) {
    let bytes = 0;
    let count = 0;
    let error = null;
    try {
      const objs = await providerFor(cfg).list('sites/');
      for (const o of objs) {
        bytes += o.size;
        count += 1;
      }
    } catch (e) {
      error = e.message;
      console.error(`桶 ${cfg.name || cfg.bucket} 统计失败:`, e.message);
    }
    sitesBytes += bytes;
    sitesCount += count;
    perBucket.push({
      id: cfg.id || null,
      name: cfg.name || cfg.bucket,
      provider: cfg.provider,
      bucket: cfg.bucket,
      bytes,
      count,
      error
    });
  }

  // 3) DB: 在用用户数(有站点的不同 user)、项目数(站点总数)
  let usersCount = 0;
  let projectsCount = 0;
  try {
    const u = await query('SELECT COUNT(DISTINCT user_id) AS c FROM websites');
    usersCount = u[0]?.c || 0;
    const p = await query('SELECT COUNT(*) AS c FROM websites');
    projectsCount = p[0]?.c || 0;
  } catch (e) {
    console.error('DB 统计失败:', e.message);
  }

  return ok({
    success: true,
    sitesBytes,
    sitesCount,
    perBucket,
    usersCount,
    projectsCount,
    traffic: { timestamps: [], inbound: null, outbound: null }
  });
}

/** 删除角色限额 */
async function handleDeleteRoleLimit(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const { id, name } = event.body || event;
  const key = String(id || name || '').trim();
  if (!key) return ok({ success: false, message: '缺少角色标识' });
  await query('DELETE FROM roles WHERE id = ? OR name = ?', [key, key]);
  return ok({ success: true });
}

/**
 * 按角色名列表返回限额(供 home.jsx 计算用户有效限额)。需登录,不需管理员。
 * 返回 { code: 0, data: [...] }(沿用旧 getRoleLimits 形态)。
 */
async function handleGetRoleLimits(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: [], message: '未登录' });
  const roles = Array.isArray(event.body?.roles) ? event.body.roles : (event.roles || []);
  const names = roles.map((r) => String(r).trim()).filter(Boolean);
  if (names.length === 0) return ok({ code: 0, data: [] });
  const placeholders = names.map(() => '?').join(',');
  // home.jsx 传的是角色 id(如 user/pro/admin);表里 name 是中文展示名,故按 id 或 name 都匹配
  const rows = await query(
    `SELECT * FROM roles WHERE enabled = 1 AND (id IN (${placeholders}) OR name IN (${placeholders})) ORDER BY priority DESC`,
    [...names, ...names]
  );
  const data = rows.map((r) => ({
    name: r.name,
    priority: r.priority,
    max_file_size: r.max_file_size,
    deployment_limit: r.deployment_limit,
    max_file_count: r.max_file_count,
    allowed_extensions: typeof r.allowed_extensions === 'string'
      ? JSON.parse(r.allowed_extensions || 'null')
      : (r.allowed_extensions || null),
    enabled: r.enabled === null ? null : !!r.enabled
  }));
  return ok({ code: 0, data });
}

/**
 * 获取当前用户的真实用量与套餐限额。
 * - deployments: 累计站点数（与 deployment_limit 累计上限对比，是真正的配额比）。
 * - files / storage: 各站点单次部署文件数与上传包体积之和；对应 max_file_count /
 *   max_file_size 是「单次上传」上限而非累计配额，故同时返回 maxSite 供前端展示
 *   「最大单站 vs 单次上限」这一真正受约束的比例。
 * - 历史站点未记录用量列时按 0 聚合。
 */
async function handleGetUsage(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: null, message: '未登录' });

  try {
    await ensureUsageColumns();
    const limits = await getUserLimits(userId);

    // 仅统计用户归属站点（与 deployment_limit 的计数口径一致）。
    const rows = await query(
      `SELECT COUNT(*) AS deployments,
              COALESCE(SUM(file_count), 0) AS files,
              COALESCE(SUM(storage_size), 0) AS storage,
              COALESCE(MAX(file_count), 0) AS maxSiteFiles,
              COALESCE(MAX(storage_size), 0) AS maxSiteStorage
       FROM websites WHERE user_id = ?`,
      [userId]
    );
    const r = (rows && rows[0]) || {};
    const usage = {
      deployments: Number(r.deployments || 0),
      files: Number(r.files || 0),
      storage: Number(r.storage || 0)
    };
    const maxSite = {
      fileCount: Number(r.maxSiteFiles || 0),
      storageSize: Number(r.maxSiteStorage || 0)
    };

    return ok({
      code: 0,
      data: {
        role: { name: limits.name, priority: limits.priority },
        usage,
        maxSite,
        limits: {
          deployment_limit: limits.deployment_limit ?? null,
          max_file_count: limits.max_file_count ?? null,
          max_file_size: limits.max_file_size ?? null
        }
      }
    });
  } catch (e) {
    console.error('获取用量失败:', e);
    return ok({ code: 500, data: null, message: e.message });
  }
}

/**
 * 幂等迁移：补 websites.file_count / storage_size 列。可由管理员通过
 * migrate_website_usage action 触发（需 MIGRATION_KEY），与 008 SQL 等价。
 */
async function handleMigrateWebsiteUsage(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ error: '迁移密钥无效' }) };
  }
  _usageColumnsEnsured = false;
  await ensureUsageColumns();
  return ok({ success: true, message: 'websites 用量列已就绪' });
}

// ── 个人访问令牌（PAT）─────────────────────────────────────────
// PAT = 带 jti 声明的长效 JWT，用 JWT_SECRET 签名。
// 现有 getUserId/authenticate 无需改动即可解析；吊销靠 jti 查表拦截（见 exports.main）。

const PAT_EXPIRES_IN = process.env.PAT_EXPIRES_IN || '730d'; // 默认 2 年

/**
 * 创建个人访问令牌。明文 token 仅此次返回，后续只存 prefix。
 */
async function handleCreateToken(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: null, message: '未登录' });

  const name = String(event.body?.name || '').trim();
  if (!name) return ok({ code: 1, data: null, message: '请填写令牌名称' });
  if (name.length > 120) return ok({ code: 1, data: null, message: '令牌名称过长' });

  await ensureAccessTokensTable();

  const jti = nodeCrypto.randomBytes(16).toString('hex');
  const token = sign({ userId, jti, type: 'pat' }, PAT_EXPIRES_IN);
  const prefix = token.slice(0, 12);

  // 解析 JWT 过期时间写入 expires_at（便于列表展示与过期判断）
  let expiresAt = null;
  try {
    const decoded = require('jsonwebtoken').decode(token);
    if (decoded && decoded.exp) expiresAt = new Date(decoded.exp * 1000);
  } catch (e) { /* ignore */ }

  const result = await query(
    `INSERT INTO access_tokens (user_id, name, jti, prefix, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, name, jti, prefix, expiresAt]
  );

  return ok({
    code: 0,
    data: {
      id: result.insertId,
      token, // 明文 token，仅此一次返回
      name,
      prefix,
      createdAt: Date.now()
    }
  });
}

/**
 * 列出当前用户的令牌（不含明文 token，仅 prefix）。
 */
async function handleListTokens(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: [], message: '未登录' });

  await ensureAccessTokensTable();
  const rows = await query(
    `SELECT id, name, prefix, created_at, last_used_at, expires_at, revoked_at
     FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );

  const data = rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).getTime() : null,
    expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null,
    revoked: !!r.revoked_at
  }));

  return ok({ code: 0, data });
}

/**
 * 吊销令牌（软删除：置 revoked_at）。
 */
async function handleRevokeToken(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: null, message: '未登录' });

  const tokenId = String(event.body?.id || '').trim();
  if (!tokenId) return ok({ code: 1, data: null, message: '缺少令牌 ID' });

  await ensureAccessTokensTable();
  const result = await query(
    `UPDATE access_tokens SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [tokenId, userId]
  );

  if (result.affectedRows === 0) {
    return ok({ code: 1, data: null, message: '令牌不存在或已吊销' });
  }
  return ok({ code: 0, data: { revoked: true } });
}

/**
 * 幂等迁移：建 access_tokens 表。
 */
async function handleMigrateAccessTokens(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ error: '迁移密钥无效' }) };
  }
  _accessTokensTableEnsured = false;
  await ensureAccessTokensTable();
  return ok({ success: true, message: 'access_tokens 表已就绪' });
}

// ── 产品漏斗埋点 ────────────────────────────────────────────────
// 匿名埋点：无需登录，visitor_id 由前端 localStorage 生成。

const PRODUCT_EVENT_NAMES = new Set([
  'landing_view',
  'deploy_click',
  'deploy_success',
  'deploy_fail',
  'example_click',
  'feedback_copy',
  'usecase_click'
]);

/**
 * 接收匿名产品事件（无需鉴权）。
 * body: { eventName, visitorId, page, props }
 */
async function handleTrackProductEvent(event) {
  const body = event.body || {};
  const eventName = String(body.eventName || '').trim();
  if (!PRODUCT_EVENT_NAMES.has(eventName)) {
    return ok({ code: 1, data: null, message: '未知事件名' });
  }
  const visitorId = String(body.visitorId || '').trim().slice(0, 64);
  const page = String(body.page || '').trim().slice(0, 128);
  let props = null;
  if (body.props && typeof body.props === 'object') {
    try { props = JSON.stringify(body.props); } catch (e) { /* ignore */ }
  }

  try {
    await ensureProductEventsTable();
    await query(
      `INSERT INTO product_events (event_name, visitor_id, page, props) VALUES (?, ?, ?, ?)`,
      [eventName, visitorId, page, props]
    );
  } catch (e) {
    console.warn('埋点写入失败（不阻塞）:', e.message);
  }
  // 永远返回成功——埋点失败不应影响用户流程
  return ok({ code: 0, data: { tracked: true } });
}

/**
 * 管理员：查询产品漏斗（最近 N 天的事件计数）。
 */
async function handleGetProductFunnel(event) {
  const userId = getUserId(event);
  if (!userId) return ok({ code: 401, data: null, message: '未登录' });
  const isAdmin = await checkAdmin(userId);
  if (!isAdmin) return ok({ code: 403, data: null, message: '无权限' });

  const days = Math.min(90, Math.max(1, Number(event.body?.days) || 14));
  await ensureProductEventsTable();

  const rows = await query(
    `SELECT event_name, DATE(created_at) AS d, COUNT(*) AS cnt
     FROM product_events
     WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY event_name, d
     ORDER BY d, event_name`,
    [days]
  );

  // 汇总每个事件的总量
  const totals = {};
  for (const r of rows) {
    totals[r.event_name] = (totals[r.event_name] || 0) + Number(r.cnt);
  }

  return ok({
    code: 0,
    data: {
      days,
      totals,
      daily: rows.map((r) => ({ event: r.event_name, date: r.d, count: Number(r.cnt) }))
    }
  });
}

/**
 * 幂等迁移：建 product_events 表。
 */
async function handleMigrateProductEvents(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ error: '迁移密钥无效' }) };
  }
  _productEventsTableEnsured = false;
  await ensureProductEventsTable();
  return ok({ success: true, message: 'product_events 表已就绪' });
}

/**
 * 解析用户 ID -> 邮箱(管理员站点列表用)。
 * 用户表未知时优雅降级:返回 userId 占位,不报错。
 */
async function handleResolveUserEmails(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const ids = Array.isArray(event.body?.userIds) ? event.body.userIds : [];
  const clean = ids.map((x) => String(x).trim()).filter(Boolean);
  if (clean.length === 0) return ok({ success: true, users: [] });

  // users 表主键是 id(形如 user_xxx);老站点的 user_id 是纯数字、不在 users 表中,查不到则空邮箱
  const placeholders = clean.map(() => '?').join(',');
  try {
    const rows = await query(
      `SELECT id, email FROM users WHERE id IN (${placeholders})`,
      clean
    );
    const map = {};
    for (const r of rows) map[r.id] = r.email;
    return ok({ success: true, users: clean.map((id) => ({ userId: id, email: map[id] || '' })) });
  } catch (e) {
    console.error('解析用户邮箱失败:', e.message);
    return ok({ success: true, users: clean.map((id) => ({ userId: id, email: '' })) });
  }
}

async function queryResolvedSiteByLabel(label, domain = defaultDomain, { withBucket = true, withVisibility = true, withSubdomainDomain = true } = {}) {
  const visibilityExpr = withVisibility
    ? `COALESCE(NULLIF(w.visibility, ''), '${VISIBILITY_PUBLIC}')`
    : `'${VISIBILITY_PUBLIC}'`;
  const originExpr = withBucket ? 'b.origin_host' : 'NULL';
  const bucketJoin = withBucket ? 'LEFT JOIN storage_buckets b ON b.id = w.bucket_id' : '';
  const subdomainDomainExpr = withSubdomainDomain
    ? `COALESCE(NULLIF(w.subdomain_domain, ''), '${defaultDomain}')`
    : `'${defaultDomain}'`;
  const selectSql =
    `SELECT w.path AS path,
            w.user_id AS user_id,
            w.project_id AS project_id,
            w.website_id AS website_id,
            w.subdomain AS subdomain,
            w.name AS site_name,
            w.seo_title AS seo_title,
            w.seo_description AS seo_description,
            w.og_image AS og_image,
            ${subdomainDomainExpr} AS subdomain_domain,
            ${visibilityExpr} AS visibility,
            ${originExpr} AS origin_host
     FROM websites w ${bucketJoin}`;

  let rows = [];
  if (withSubdomainDomain) {
    rows = await query(
      `${selectSql} WHERE w.subdomain = ? AND ${subdomainDomainExpr} = ? LIMIT 1`,
      [label, domain]
    );
  } else if (domain === defaultDomain) {
    rows = await query(`${selectSql} WHERE w.subdomain = ? LIMIT 1`, [label]);
  }
  if (rows.length === 0 && domain === defaultDomain) {
    rows = await query(`${selectSql} WHERE LOWER(w.website_id) = ? LIMIT 1`, [label]);
  }
  return rows;
}

/**
 * 解析公开 label 到站点元数据。按能力降级：
 * 1) storage_buckets + visibility
 * 2) visibility
 * 3) 旧表结构(public)
 */
async function resolveSiteMetadataByLabel(label, domain = defaultDomain) {
  const modes = [
    { withBucket: true, withVisibility: true, withSubdomainDomain: true },
    { withBucket: false, withVisibility: true, withSubdomainDomain: true },
    { withBucket: false, withVisibility: false, withSubdomainDomain: true },
    { withBucket: false, withVisibility: false, withSubdomainDomain: false }
  ];
  let lastErr = null;
  for (const mode of modes) {
    try {
      const rows = await queryResolvedSiteByLabel(label, domain, mode);
      return rows.length > 0 ? rows[0] : null;
    } catch (e) {
      lastErr = e;
      console.warn('解析站点元数据失败，尝试降级:', e.message);
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/**
 * 公开解析接口：label -> COS path。供 subdomain-router 边缘函数查表。
 * 无需鉴权：只返回站点路由必要信息，供边缘函数判断 public/private 与回源。
 */
async function handleResolveSubdomain(event) {
  const body = event.body || event;
  let { subdomain, domain } = body;
  if (body.host && !subdomain) {
    const parsed = parseOfficialHost(body.host);
    if (parsed) {
      subdomain = parsed.label;
      domain = parsed.domain;
    }
  }
  const label = String(subdomain || '').trim().toLowerCase();
  const suffix = normalizeOfficialDomain(domain);

  if (!label) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: 'Missing subdomain' })
    };
  }
  if (!suffix) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: 'unsupported official domain' })
    };
  }

  try {
    await ensureSeoColumns();
    const site = await resolveSiteMetadataByLabel(label, suffix);
    if (!site || !site.path) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, message: 'not found' })
      };
    }
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        path: site.path,
        websiteId: site.website_id || null,
        origin: site.origin_host || null,
        domain: suffix,
        host: `${label}.${suffix}`,
        visibility: normalizeVisibility(site.visibility),
        seo: {
          title: site.seo_title || site.site_name || null,
          description: site.seo_description || null,
          ogImage: site.og_image || null
        }
      })
    };
  } catch (error) {
    console.error('解析子域名失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: error.message })
    };
  }
}

/**
 * 边缘函数调用：检查当前 token 是否可访问 label 对应站点。
 * public 永远允许；private 仅站点 owner、平台 admin 或项目成员可访问。
 */
async function handleCheckSiteAccess(event) {
  const body = event.body || event;
  let label = String(body.label || body.subdomain || '').trim().toLowerCase();
  let domain = body.domain || body.subdomainDomain || body.subdomain_domain;
  if (body.host && !label) {
    const parsed = parseOfficialHost(body.host);
    if (parsed) {
      label = parsed.label;
      domain = parsed.domain;
    }
  }
  const suffix = normalizeOfficialDomain(domain);
  if (!label) return ok({ success: false, allowed: false, message: 'Missing label' });
  if (!suffix) return ok({ success: false, allowed: false, message: 'Unsupported official domain' });

  try {
    const site = await resolveSiteMetadataByLabel(label, suffix);
    if (!site || !site.path) {
      return ok({ success: true, allowed: false, reason: 'not_found' });
    }

    const visibility = normalizeVisibility(site.visibility);
    if (visibility !== VISIBILITY_PRIVATE) {
      return ok({ success: true, allowed: true, visibility });
    }

    const user = authenticate(event);
    if (!user || !user.userId) {
      return ok({
        success: true,
        allowed: false,
        visibility,
        loginRequired: true,
        reason: 'login_required'
      });
    }

    if (String(user.userId) === String(site.user_id)) {
      return ok({ success: true, allowed: true, visibility, role: 'owner' });
    }

    const isAdmin = await checkAdmin(user.userId);
    if (isAdmin) {
      return ok({ success: true, allowed: true, visibility, role: 'platform_admin' });
    }

    if (site.project_id) {
      const role = await getProjectRoleForUser(user.userId, site.project_id);
      if (role) {
        return ok({ success: true, allowed: true, visibility, role });
      }
    }

    return ok({
      success: true,
      allowed: false,
      visibility,
      loginRequired: false,
      reason: 'forbidden'
    });
  } catch (error) {
    console.error('检查站点访问权限失败:', error);
    return ok({ success: false, allowed: false, message: error.message });
  }
}


function normalizeAnalyticsEventType(input) {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'badge_click') return 'badge_click';
  if (value === 'scanner_probe') return 'scanner_probe';
  return 'view';
}

function normalizeAnalyticsWebsiteId(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function normalizeAnalyticsPath(input) {
  const value = String(input || '/').trim() || '/';
  const pathOnly = value.split('#')[0].split('?')[0] || '/';
  return pathOnly.startsWith('/') ? pathOnly.slice(0, 512) : `/${pathOnly.slice(0, 511)}`;
}


function isScannerProbePath(input) {
  const value = normalizeAnalyticsPath(input).toLowerCase();
  return (
    value === '/xmlrpc' ||
    value === '/xmlrpc.php' ||
    value === '/wp-login' ||
    value === '/wp-login.php' ||
    value.startsWith('/wp-admin') ||
    value.startsWith('/wp-content') ||
    value.startsWith('/wp-includes') ||
    value === '/.env' ||
    value.startsWith('/.git') ||
    value.includes('/phpmyadmin') ||
    value.includes('/phpinfo') ||
    value.includes('/vendor/phpunit')
  );
}

function scannerPathSqlPredicate(columnName = 'path') {
  return `NOT (
    ${columnName} IN ('/xmlrpc', '/xmlrpc.php', '/wp-login', '/wp-login.php', '/.env') OR
    ${columnName} LIKE '/wp-admin%' OR
    ${columnName} LIKE '/wp-content%' OR
    ${columnName} LIKE '/wp-includes%' OR
    ${columnName} LIKE '/.git%' OR
    ${columnName} LIKE '%/phpmyadmin%' OR
    ${columnName} LIKE '%/phpinfo%' OR
    ${columnName} LIKE '%/vendor/phpunit%'
  )`;
}

function maskIpForDisplay(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.includes(':')) {
    const parts = value.split(':');
    return parts.slice(0, 3).join(':') + ':****';
  }
  const parts = value.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`;
  return '已留档';
}

function normalizeReferrerHost(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'direct';
  try {
    const u = new URL(raw);
    return (u.hostname || 'direct').toLowerCase().replace(/^www\./, '').slice(0, 255) || 'direct';
  } catch (e) {
    return raw.toLowerCase().replace(/^www\./, '').slice(0, 255) || 'direct';
  }
}

function normalizeCountry(input) {
  const value = String(input || '').trim().toUpperCase();
  if (!value || value === 'XX' || value === 'UNKNOWN') return 'UNKNOWN';
  return /^[A-Z]{2}$/.test(value) ? value : 'UNKNOWN';
}

function normalizeProvince(input) {
  const value = String(input || '').trim();
  if (!value || value.toUpperCase() === 'UNKNOWN') return 'UNKNOWN';
  return value.replace(/[\u0000-\u001f<>]/g, '').slice(0, 64) || 'UNKNOWN';
}

const CN_REGION_NAMES = {
  AH: 'Anhui',
  BJ: 'Beijing',
  CQ: 'Chongqing',
  FJ: 'Fujian',
  GD: 'Guangdong',
  GS: 'Gansu',
  GX: 'Guangxi',
  GZ: 'Guizhou',
  HA: 'Henan',
  HB: 'Hubei',
  HE: 'Hebei',
  HI: 'Hainan',
  HK: 'Hong Kong',
  HL: 'Heilongjiang',
  HN: 'Hunan',
  JL: 'Jilin',
  JS: 'Jiangsu',
  JX: 'Jiangxi',
  LN: 'Liaoning',
  MO: 'Macao',
  NM: 'Inner Mongolia',
  NX: 'Ningxia',
  QH: 'Qinghai',
  SC: 'Sichuan',
  SD: 'Shandong',
  SH: 'Shanghai',
  SN: 'Shaanxi',
  SX: 'Shanxi',
  TJ: 'Tianjin',
  TW: 'Taiwan',
  XJ: 'Xinjiang',
  XZ: 'Tibet',
  YN: 'Yunnan',
  ZJ: 'Zhejiang'
};

function isPrivateIp(input) {
  const ip = String(input || '').trim();
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127 ||
    parts[0] === 0
  );
}

function lookupGeoByIp(input) {
  if (!geoip) return { country: 'UNKNOWN', province: 'UNKNOWN' };
  const ip = String(input || '').split(',')[0].trim();
  if (!ip || isPrivateIp(ip)) return { country: 'UNKNOWN', province: 'UNKNOWN' };
  try {
    const hit = geoip.lookup(ip);
    if (!hit) return { country: 'UNKNOWN', province: 'UNKNOWN' };
    const country = normalizeCountry(hit.country);
    const region = String(hit.region || '').trim();
    const province = country === 'CN' && CN_REGION_NAMES[region]
      ? CN_REGION_NAMES[region]
      : (region || hit.city || 'UNKNOWN');
    return { country, province: normalizeProvince(province) };
  } catch (e) {
    return { country: 'UNKNOWN', province: 'UNKNOWN' };
  }
}

function hashAnalyticsValue(input) {
  const raw = String(input || '');
  if (!raw) return '';
  const salt = process.env.ANALYTICS_HASH_SALT || process.env.JWT_SECRET || 'demox-analytics';
  return nodeCrypto.createHash('sha256').update(`${salt}:${raw}`).digest('hex');
}

function getClientIp(event) {
  const headers = event.headers || {};
  const value = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || headers['x-real-ip'] || headers['X-Real-IP'] || event.requestContext?.sourceIp || '';
  return String(value).split(',')[0].trim();
}

function safeDecrypt(value) {
  try {
    return decrypt(value) || '';
  } catch (e) {
    return '';
  }
}

function safeEncrypt(value) {
  try {
    return encrypt(value);
  } catch (e) {
    console.warn('加密统计敏感字段失败:', e.message);
    return null;
  }
}

function analyticsTokenAllowed(event) {
  const expected = process.env.ANALYTICS_TRACK_TOKEN || '';
  if (!expected) return true;
  const body = event.body || event;
  // Badge clicks are emitted from the public hosted page, so they cannot carry a secret.
  if (normalizeAnalyticsEventType(body.type || body.eventType) === 'badge_click') return true;
  const headers = event.headers || {};
  const provided = body.analyticsToken || headers['x-demox-analytics-token'] || headers['X-Demox-Analytics-Token'] || '';
  return String(provided) === expected;
}

async function writeRawAnalyticsEvent(event) {
  if (process.env.ANALYTICS_RAW_ENABLED !== '1') return { skipped: true, reason: 'disabled' };
  const bucketId = normalizePositiveId(process.env.ANALYTICS_RAW_BUCKET_ID);
  if (!bucketId) {
    // Raw analytics can contain sensitive referrer/UA metadata, so require an explicit private bucket.
    return { skipped: true, reason: 'missing ANALYTICS_RAW_BUCKET_ID' };
  }
  try {
    const bucketCfg = await resolveBucketConfig(bucketId);
    const provider = createProvider(buckets.resolveCreds(bucketCfg));
    const d = new Date(event.ts || Date.now());
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const rand = nodeCrypto.randomBytes(6).toString('hex');
    const key = `analytics/raw/date=${yyyy}-${mm}-${dd}/hour=${hh}/${event.websiteId}-${event.ts}-${rand}.ndjson`;
    await provider.put(key, `${JSON.stringify(event)}\n`, {
      contentType: 'application/x-ndjson; charset=utf-8',
      cacheControl: 'private, max-age=0, no-store'
    });
    return { skipped: false, key };
  } catch (e) {
    console.warn('写入原始统计事件失败:', e.message);
    return { skipped: true, reason: e.message };
  }
}

async function handleTrackSiteEvent(event) {
  const body = event.body || event;
  if (!analyticsTokenAllowed(event)) return ok({ success: false, message: 'invalid analytics token' });

  const websiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  if (!websiteId) return ok({ success: false, message: 'missing websiteId' });

  const requestedType = normalizeAnalyticsEventType(body.type || body.eventType);
  const pathValue = normalizeAnalyticsPath(body.path || body.pathname || '/');
  const type = requestedType === 'view' && isScannerProbePath(pathValue) ? 'scanner_probe' : requestedType;
  const ua = String(body.userAgent || body.ua || '').slice(0, 512);
  const clientIp = String(body.ip || getClientIp(event) || '').trim().slice(0, 128);
  const geoFromIp = lookupGeoByIp(clientIp);
  const country = normalizeCountry(body.country || body.countryCode);
  const province = normalizeProvince(body.province || body.region || body.subdivision);
  const finalCountry = country === 'UNKNOWN' ? geoFromIp.country : country;
  const finalProvince = province === 'UNKNOWN' ? geoFromIp.province : province;
  const referrerHost = normalizeReferrerHost(body.referrer || body.referer || '');
  const ipHash = hashAnalyticsValue(clientIp);
  const visitorHash = hashAnalyticsValue(body.visitorId || `${ipHash}:${ua}`);
  const now = new Date();
  const statDate = now.toISOString().slice(0, 10);

  try {
    const raw = await writeRawAnalyticsEvent({
      ts: Date.now(),
      websiteId,
      type,
      path: pathValue,
      referrer: String(body.referrer || body.referer || '').slice(0, 1024),
      referrerHost,
      country: finalCountry,
      province: finalProvince,
      userAgent: ua,
      ipEnc: safeEncrypt(clientIp),
      visitorHash,
      host: String(body.host || '').slice(0, 255)
    });

    return ok({ success: true, raw, delayed: true, delayMinutes: 5, statDate });
  } catch (error) {
    console.error('记录站点统计失败:', error);
    return ok({ success: false, message: error.message });
  }
}

function normalizeStatsRange(input) {
  const n = Number.parseInt(String(input || '7'), 10);
  if (!Number.isFinite(n)) return 7;
  return Math.max(1, Math.min(n, 90));
}

async function handleGetSiteStats(event) {
  const userId = getUserId(event);
  if (!userId) return { statusCode: 401, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '未登录或token已过期' }) };

  const body = event.body || event;
  const websiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  const days = normalizeStatsRange(body.days || body.range);
  if (!websiteId) return ok({ success: false, message: 'missing websiteId' });

  const site = await getWebsiteByIdentity({ websiteId });
  if (!site || !(await canUserReadSite(userId, site))) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '无权限查看该站点统计' }) };
  }

  try {
    const cleanDailyViews = await query(
      `SELECT stat_date, SUM(views) AS views
       FROM site_path_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND ${scannerPathSqlPredicate('path')}
       GROUP BY stat_date
       ORDER BY stat_date ASC`,
      [websiteId, days - 1]
    );
    const dailyBadges = await query(
      `SELECT stat_date, badge_clicks
       FROM site_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY stat_date ASC`,
      [websiteId, days - 1]
    );
    const cleanTotals = await query(
      `SELECT COALESCE(SUM(views), 0) AS views
       FROM site_path_daily_stats
       WHERE website_id = ? AND ${scannerPathSqlPredicate('path')}`,
      [websiteId]
    );
    const badgeTotals = await query(
      `SELECT COALESCE(SUM(badge_clicks), 0) AS badge_clicks
       FROM site_daily_stats
       WHERE website_id = ?`,
      [websiteId]
    );
    const referrers = await query(
      `SELECT referrer_host, SUM(views) AS views
       FROM site_referrer_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY referrer_host
       ORDER BY views DESC
       LIMIT 10`,
      [websiteId, days - 1]
    );
    const paths = await query(
      `SELECT path, SUM(views) AS views
       FROM site_path_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY path
       ORDER BY views DESC
       LIMIT 50`,
      [websiteId, days - 1]
    );
    const countries = await query(
      `SELECT country, SUM(views) AS views
       FROM site_country_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND country <> 'UNKNOWN'
       GROUP BY country
       ORDER BY views DESC
       LIMIT 10`,
      [websiteId, days - 1]
    );
    const provinces = await query(
      `SELECT country, province, SUM(views) AS views
       FROM site_province_daily_stats
       WHERE website_id = ? AND stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND country <> 'UNKNOWN' AND province <> 'UNKNOWN'
       GROUP BY country, province
       ORDER BY views DESC
       LIMIT 20`,
      [websiteId, days - 1]
    );

    return ok({
      success: true,
      websiteId,
      rangeDays: days,
      totals: {
        views: Number(cleanTotals[0]?.views || 0),
        badgeClicks: Number(badgeTotals[0]?.badge_clicks || 0)
      },
      daily: cleanDailyViews.map((r) => {
        const date = r.stat_date instanceof Date ? r.stat_date.toISOString().slice(0, 10) : String(r.stat_date).slice(0, 10);
        const badgeRow = dailyBadges.find((b) => (b.stat_date instanceof Date ? b.stat_date.toISOString().slice(0, 10) : String(b.stat_date).slice(0, 10)) === date);
        return { date, views: Number(r.views || 0), badgeClicks: Number(badgeRow?.badge_clicks || 0) };
      }),
      referrers: referrers.map((r) => ({ host: r.referrer_host || 'direct', views: Number(r.views || 0) })),
      paths: paths
        .map((r) => ({ path: r.path || '/', views: Number(r.views || 0) }))
        .filter((r) => !isScannerProbePath(r.path))
        .slice(0, 10),
      countries: countries.map((r) => ({ country: r.country || 'UNKNOWN', views: Number(r.views || 0) })),
      provinces: provinces.map((r) => ({ country: r.country || 'UNKNOWN', province: r.province || 'UNKNOWN', views: Number(r.views || 0) }))
    });
  } catch (error) {
    console.error('查询站点统计失败:', error);
    return ok({ success: false, message: error.message });
  }
}

function normalizeAccessLogLimit(input) {
  const n = Number.parseInt(String(input || '100'), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(n, 500));
}

function normalizeAccessLogPage(input) {
  const n = Number.parseInt(String(input || '1'), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, n);
}

function normalizeAccessLogPageSize(input) {
  const n = Number.parseInt(String(input || '10'), 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(n, 100));
}

async function ensureColumn(tableName, columnName, alterSql, steps = []) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  if (!Number(rows[0]?.c || 0)) {
    await query(alterSql);
    steps.push(`added ${tableName}.${columnName}`);
  }
}

function listUtcDateKeys(days) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function listUtcHourPrefixes(hours) {
  const out = new Set();
  const now = new Date();
  for (let i = 0; i < hours; i += 1) {
    const d = new Date(now);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() - i);
    const date = d.toISOString().slice(0, 10);
    const hour = String(d.getUTCHours()).padStart(2, '0');
    out.add(`analytics/raw/date=${date}/hour=${hour}/`);
  }
  return Array.from(out);
}

function parseRawAnalyticsLine(line) {
  try {
    const item = JSON.parse(line);
    if (!item || typeof item !== 'object') return null;
    return item;
  } catch (e) {
    return null;
  }
}

function normalizeRollupHours(input) {
  const n = Number.parseInt(String(input || '2'), 10);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(n, 48));
}

function normalizeRollupLimit(input) {
  const n = Number.parseInt(String(input || '2000'), 10);
  if (!Number.isFinite(n)) return 2000;
  return Math.max(1, Math.min(n, 10000));
}

function isAnalyticsRollupTimerEvent(event) {
  const triggerName = String(event.TriggerName || event.triggerName || '');
  const type = String(event.Type || event.type || '');
  return type.toLowerCase() === 'timer' && /analytics.*rollup|rollup.*analytics/i.test(triggerName);
}

function analyticsRollupAllowed(event) {
  if (isAnalyticsRollupTimerEvent(event)) return true;
  const body = getRollupRequestBody(event);
  const headers = event.headers || {};
  const expected = process.env.ANALYTICS_ROLLUP_KEY || process.env.MIGRATION_KEY || '';
  const provided = body.rollupKey || body.migrationKey || headers['x-demox-rollup-key'] || headers['X-Demox-Rollup-Key'] || '';
  return !!expected && String(provided) === expected;
}

function getRollupRequestBody(event) {
  const base = event.body && typeof event.body === 'object' ? event.body : event;
  const rawCustom = event.CustomArgument || event.customArgument || event.Message || event.message || '';
  if (typeof rawCustom === 'string' && rawCustom.trim().startsWith('{')) {
    try {
      return { ...base, ...JSON.parse(rawCustom) };
    } catch (e) {
      return base;
    }
  }
  return base;
}

function addRollupCount(map, keyParts, field, amount) {
  const key = keyParts.join('\u0001');
  const current = map.get(key) || { keyParts, views: 0, badgeClicks: 0 };
  current[field] += amount;
  map.set(key, current);
}

function normalizeRawAnalyticsEvent(item) {
  const websiteId = normalizeAnalyticsWebsiteId(item.websiteId || item.website_id);
  if (!websiteId) return null;
  const rawIp = item.ipEnc ? safeDecrypt(item.ipEnc) : item.ip;
  const pathValue = normalizeAnalyticsPath(item.path || '/');
  const requestedType = normalizeAnalyticsEventType(item.type || item.eventType);
  const type = requestedType === 'view' && isScannerProbePath(pathValue) ? 'scanner_probe' : requestedType;
  const ts = Number(item.ts || 0) || Date.now();
  const statDate = new Date(ts).toISOString().slice(0, 10);
  const geoFromIp = lookupGeoByIp(rawIp);
  const country = normalizeCountry(item.country || item.countryCode);
  const province = normalizeProvince(item.province || item.region || item.subdivision);
  return {
    websiteId,
    type,
    statDate,
    path: pathValue,
    referrer: String(item.referrer || item.referer || '').slice(0, 1024),
    referrerHost: normalizeReferrerHost(item.referrerHost || item.referrer || ''),
    country: country === 'UNKNOWN' ? geoFromIp.country : country,
    province: province === 'UNKNOWN' ? geoFromIp.province : province,
    host: String(item.host || '').slice(0, 255),
    userAgent: String(item.userAgent || item.ua || '').slice(0, 512),
    ipArchived: !!item.ipEnc,
    ipMasked: maskIpForDisplay(rawIp),
    ts
  };
}

async function listRawAnalyticsObjects(provider, body) {
  const limit = normalizeRollupLimit(body.limit || body.maxObjects);
  const prefixes = body.days
    ? listUtcDateKeys(normalizeStatsRange(body.days)).map((date) => `analytics/raw/date=${date}/`)
    : listUtcHourPrefixes(normalizeRollupHours(body.hours));
  const objects = [];
  for (const prefix of prefixes) {
    const items = await provider.list(prefix);
    for (const item of items) {
      if (String(item.key || '').endsWith('.ndjson')) objects.push(item);
    }
  }
  objects.sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')));
  return objects.slice(0, limit);
}

async function upsertAnalyticsRollups(conn, rollups) {
  for (const item of rollups.daily.values()) {
    await conn.query(
      `INSERT INTO site_daily_stats (website_id, stat_date, views, badge_clicks, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         views = views + VALUES(views),
         badge_clicks = badge_clicks + VALUES(badge_clicks),
         updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.views, item.badgeClicks]
    );
  }
  for (const item of rollups.referrers.values()) {
    await conn.query(
      `INSERT INTO site_referrer_daily_stats (website_id, stat_date, referrer_host, views, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE views = views + VALUES(views), updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.keyParts[2], item.views]
    );
  }
  for (const item of rollups.paths.values()) {
    await conn.query(
      `INSERT INTO site_path_daily_stats (website_id, stat_date, path, views, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE views = views + VALUES(views), updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.keyParts[2], item.views]
    );
  }
  for (const item of rollups.countries.values()) {
    await conn.query(
      `INSERT INTO site_country_daily_stats (website_id, stat_date, country, views, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE views = views + VALUES(views), updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.keyParts[2], item.views]
    );
  }
  for (const item of rollups.provinces.values()) {
    await conn.query(
      `INSERT INTO site_province_daily_stats (website_id, stat_date, country, province, views, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE views = views + VALUES(views), updated_at = NOW()`,
      [item.keyParts[0], item.keyParts[1], item.keyParts[2], item.keyParts[3], item.views]
    );
  }
  for (const item of rollups.accessLogs || []) {
    await conn.query(
      `INSERT IGNORE INTO site_access_logs
        (object_key, website_id, event_ts, event_type, host, path, referrer, referrer_host,
         country, province, ip_masked, ip_archived, user_agent, created_at)
       VALUES (?, ?, FROM_UNIXTIME(? / 1000), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        item.objectKey,
        item.websiteId,
        item.ts,
        item.type,
        item.host,
        item.path,
        item.referrer,
        item.referrerHost,
        item.country,
        item.province,
        item.ipMasked,
        item.ipArchived ? 1 : 0,
        item.userAgent
      ]
    );
  }
}

async function handleRollupSiteAnalytics(event) {
  if (!analyticsRollupAllowed(event)) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '无权限执行统计聚合' }) };
  }

  const bucketId = normalizePositiveId(process.env.ANALYTICS_RAW_BUCKET_ID);
  if (process.env.ANALYTICS_RAW_ENABLED !== '1' || !bucketId) {
    return ok({ success: false, message: '原始访问日志未启用，无法延迟聚合' });
  }

  const body = getRollupRequestBody(event);
  try {
    const bucketCfg = await resolveBucketConfig(bucketId);
    const provider = createProvider(buckets.resolveCreds(bucketCfg));
    const objects = await listRawAnalyticsObjects(provider, body);
    let candidates = [];
    for (const obj of objects) {
      if (Number(obj.size || 0) > 256 * 1024) continue;
      const text = await provider.get(obj.key);
      const lines = String(text || '').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const item = normalizeRawAnalyticsEvent(parseRawAnalyticsLine(line) || {});
        if (!item) continue;
        candidates.push({ key: obj.key, item });
      }
    }
    const websiteIds = Array.from(new Set(candidates.map((c) => c.item.websiteId)));
    if (websiteIds.length) {
      const validRows = await query(
        `SELECT website_id FROM websites WHERE website_id IN (${websiteIds.map(() => '?').join(',')})`,
        websiteIds
      );
      const validIds = new Set(validRows.map((r) => String(r.website_id || '')));
      candidates = candidates.filter((c) => validIds.has(c.item.websiteId));
    }

    const summary = await transaction(async (conn) => {
      const rollups = {
        daily: new Map(),
        referrers: new Map(),
        paths: new Map(),
        countries: new Map(),
        provinces: new Map(),
        accessLogs: []
      };
      let processed = 0;
      let skipped = 0;

      for (const candidate of candidates) {
        const { key, item } = candidate;
        const [insertResult] = await conn.query(
          `INSERT IGNORE INTO site_analytics_ingested_events (object_key, website_id, event_ts, created_at)
           VALUES (?, ?, FROM_UNIXTIME(? / 1000), NOW())`,
          [key, item.websiteId, item.ts]
        );
        if (!insertResult.affectedRows) {
          skipped += 1;
          continue;
        }
        processed += 1;
        if (item.type === 'badge_click') {
          addRollupCount(rollups.daily, [item.websiteId, item.statDate], 'badgeClicks', 1);
        } else if (item.type === 'view') {
          rollups.accessLogs.push({ objectKey: key, ...item });
          addRollupCount(rollups.daily, [item.websiteId, item.statDate], 'views', 1);
          addRollupCount(rollups.referrers, [item.websiteId, item.statDate, item.referrerHost], 'views', 1);
          addRollupCount(rollups.paths, [item.websiteId, item.statDate, item.path], 'views', 1);
          addRollupCount(rollups.countries, [item.websiteId, item.statDate, item.country], 'views', 1);
          addRollupCount(rollups.provinces, [item.websiteId, item.statDate, item.country, item.province], 'views', 1);
        }
      }

      await upsertAnalyticsRollups(conn, rollups);
      return {
        processed,
        skipped,
        rollups: {
          daily: rollups.daily.size,
          referrers: rollups.referrers.size,
          paths: rollups.paths.size,
          countries: rollups.countries.size,
          provinces: rollups.provinces.size,
          accessLogs: rollups.accessLogs.length
        }
      };
    });

    return ok({ success: true, delayed: true, delayMinutes: 5, scanned: objects.length, candidates: candidates.length, ...summary });
  } catch (error) {
    console.error('延迟聚合站点统计失败:', error);
    return ok({ success: false, message: error.message });
  }
}

async function handleBackfillSiteAnalyticsGeo(event) {
  if (!analyticsRollupAllowed(event)) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '无权限执行地区回填' }) };
  }

  const bucketId = normalizePositiveId(process.env.ANALYTICS_RAW_BUCKET_ID);
  if (process.env.ANALYTICS_RAW_ENABLED !== '1' || !bucketId) {
    return ok({ success: false, message: '原始访问日志未启用，无法回填地区' });
  }

  const body = getRollupRequestBody(event);
  const requestedWebsiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  try {
    const bucketCfg = await resolveBucketConfig(bucketId);
    const provider = createProvider(buckets.resolveCreds(bucketCfg));
    const objects = await listRawAnalyticsObjects(provider, body);
    let candidates = [];
    for (const obj of objects) {
      if (Number(obj.size || 0) > 256 * 1024) continue;
      const text = await provider.get(obj.key);
      const lines = String(text || '').split(/\r?\n/).filter(Boolean);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const item = normalizeRawAnalyticsEvent(parseRawAnalyticsLine(line) || {});
        if (!item || item.type !== 'view') continue;
        if (requestedWebsiteId && item.websiteId !== requestedWebsiteId) continue;
        candidates.push({ key: `${obj.key}#${lineIndex}`, item });
      }
    }

    const websiteIds = Array.from(new Set(candidates.map((candidate) => candidate.item.websiteId)));
    if (websiteIds.length) {
      const validRows = await query(
        `SELECT website_id FROM websites WHERE website_id IN (${websiteIds.map(() => '?').join(',')})`,
        websiteIds
      );
      const validIds = new Set(validRows.map((r) => String(r.website_id || '')));
      candidates = candidates.filter((candidate) => validIds.has(candidate.item.websiteId));
    }

    const affectedKeys = new Map();
    const rollups = {
      daily: new Map(),
      referrers: new Map(),
      paths: new Map(),
      countries: new Map(),
      provinces: new Map(),
      accessLogs: []
    };
    for (const candidate of candidates) {
      const { key, item } = candidate;
      affectedKeys.set(`${item.websiteId}\u0001${item.statDate}`, [item.websiteId, item.statDate]);
      rollups.accessLogs.push({
        objectKey: key,
        ...item
      });
      if (item.country !== 'UNKNOWN') {
        addRollupCount(rollups.countries, [item.websiteId, item.statDate, item.country], 'views', 1);
      }
      if (item.country !== 'UNKNOWN' && item.province !== 'UNKNOWN') {
        addRollupCount(rollups.provinces, [item.websiteId, item.statDate, item.country, item.province], 'views', 1);
      }
    }

    const summary = await transaction(async (conn) => {
      for (const [websiteId, statDate] of affectedKeys.values()) {
        await conn.query(
          `DELETE FROM site_country_daily_stats WHERE website_id = ? AND stat_date = ?`,
          [websiteId, statDate]
        );
        await conn.query(
          `DELETE FROM site_province_daily_stats WHERE website_id = ? AND stat_date = ?`,
          [websiteId, statDate]
        );
      }
      await upsertAnalyticsRollups(conn, rollups);
      return {
        dates: affectedKeys.size,
        countryRows: rollups.countries.size,
        provinceRows: rollups.provinces.size,
        accessLogRows: rollups.accessLogs.length
      };
    });

    return ok({
      success: true,
      scanned: objects.length,
      candidates: candidates.length,
      websiteId: requestedWebsiteId || null,
      ...summary
    });
  } catch (error) {
    console.error('回填站点地区统计失败:', error);
    return ok({ success: false, message: error.message });
  }
}

async function handleGetSiteAccessLogs(event) {
  const userId = getUserId(event);
  if (!userId) return { statusCode: 401, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '未登录或token已过期' }) };

  const body = event.body || event;
  const websiteId = normalizeAnalyticsWebsiteId(body.websiteId || body.website_id);
  const days = normalizeStatsRange(body.days || body.range || 7);
  const page = normalizeAccessLogPage(body.page);
  const pageSize = normalizeAccessLogPageSize(body.pageSize || body.page_size || body.limit);
  const offset = (page - 1) * pageSize;
  if (!websiteId) return ok({ success: false, message: 'missing websiteId' });

  const site = await getWebsiteByIdentity({ websiteId });
  if (!site || !(await canUserReadSite(userId, site))) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ success: false, error: '无权限查看该站点访问日志' }) };
  }

  try {
    const totalRows = await query(
      `SELECT COUNT(*) AS total
       FROM site_access_logs
       WHERE website_id = ? AND event_ts >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [websiteId, days]
    );
    const rows = await query(
      `SELECT event_ts, event_type, host, path, referrer, referrer_host,
              country, province, ip_masked, ip_archived, user_agent
       FROM site_access_logs
       WHERE website_id = ? AND event_ts >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY event_ts DESC
       LIMIT ? OFFSET ?`,
      [websiteId, days, pageSize, offset]
    );
    const logs = rows.map((row) => ({
      ts: row.event_ts instanceof Date ? row.event_ts.getTime() : (row.event_ts ? new Date(row.event_ts).getTime() : null),
      type: row.event_type || 'view',
      host: row.host || '',
      path: row.path || '/',
      referrer: row.referrer || '',
      referrerHost: row.referrer_host || 'direct',
      country: row.country || 'UNKNOWN',
      province: row.province || 'UNKNOWN',
      ip: row.ip_masked || '',
      ipArchived: !!row.ip_archived,
      userAgent: row.user_agent || ''
    }));
    const total = Number(totalRows[0]?.total || 0);
    return ok({
      success: true,
      websiteId,
      rangeDays: days,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      logs
    });
  } catch (error) {
    console.error('查询站点访问日志失败:', error);
    return ok({ success: false, message: error.message });
  }
}

async function handleMigrateSiteAnalytics(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ error: '迁移密钥无效' }) };
  }

  const steps = [];
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS site_daily_stats (
        website_id VARCHAR(32) NOT NULL,
        stat_date DATE NOT NULL,
        views BIGINT NOT NULL DEFAULT 0,
        visitors BIGINT NOT NULL DEFAULT 0,
        badge_clicks BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (website_id, stat_date),
        INDEX idx_site_daily_date (stat_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日访问聚合'`
    );
    steps.push('ensured site_daily_stats');

    await query(
      `CREATE TABLE IF NOT EXISTS site_referrer_daily_stats (
        website_id VARCHAR(32) NOT NULL,
        stat_date DATE NOT NULL,
        referrer_host VARCHAR(255) NOT NULL DEFAULT 'direct',
        views BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (website_id, stat_date, referrer_host),
        INDEX idx_referrer_daily_date (stat_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日来源聚合'`
    );
    steps.push('ensured site_referrer_daily_stats');

    await query(
      `CREATE TABLE IF NOT EXISTS site_path_daily_stats (
        website_id VARCHAR(32) NOT NULL,
        stat_date DATE NOT NULL,
        path VARCHAR(512) NOT NULL,
        views BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (website_id, stat_date, path),
        INDEX idx_path_daily_date (stat_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日路径聚合'`
    );
    steps.push('ensured site_path_daily_stats');

    await query(
      `CREATE TABLE IF NOT EXISTS site_country_daily_stats (
        website_id VARCHAR(32) NOT NULL,
        stat_date DATE NOT NULL,
        country VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
        views BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (website_id, stat_date, country),
        INDEX idx_country_daily_date (stat_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日地区聚合'`
    );
    steps.push('ensured site_country_daily_stats');

    await query(
      `CREATE TABLE IF NOT EXISTS site_province_daily_stats (
        website_id VARCHAR(32) NOT NULL,
        stat_date DATE NOT NULL,
        country VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
        province VARCHAR(64) NOT NULL DEFAULT 'UNKNOWN',
        views BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (website_id, stat_date, country, province),
        INDEX idx_province_daily_date (stat_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点按日省级地区聚合'`
    );
    steps.push('ensured site_province_daily_stats');

    await query(
      `CREATE TABLE IF NOT EXISTS site_analytics_ingested_events (
        object_key VARCHAR(512) NOT NULL,
        website_id VARCHAR(32) NOT NULL,
        event_ts DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (object_key),
        INDEX idx_ingested_site_ts (website_id, event_ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已聚合的原始访问日志对象，用于延迟统计去重'`
    );
    steps.push('ensured site_analytics_ingested_events');

    await query(
      `CREATE TABLE IF NOT EXISTS site_access_logs (
        object_key VARCHAR(512) NOT NULL,
        website_id VARCHAR(32) NOT NULL,
        event_ts DATETIME NULL,
        event_type VARCHAR(32) NOT NULL DEFAULT 'view',
        host VARCHAR(255) DEFAULT '',
        path VARCHAR(512) NOT NULL DEFAULT '/',
        referrer VARCHAR(1024) DEFAULT '',
        referrer_host VARCHAR(255) NOT NULL DEFAULT 'direct',
        country VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
        province VARCHAR(64) NOT NULL DEFAULT 'UNKNOWN',
        ip_masked VARCHAR(64) DEFAULT '',
        ip_archived TINYINT(1) NOT NULL DEFAULT 0,
        user_agent VARCHAR(512) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (object_key),
        INDEX idx_access_site_ts (website_id, event_ts),
        INDEX idx_access_site_path (website_id, path)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站点访问日志展示索引，不存明文 IP'`
    );
    steps.push('ensured site_access_logs');

    await ensureColumn('site_access_logs', 'ip_masked', "ALTER TABLE site_access_logs ADD COLUMN ip_masked VARCHAR(64) DEFAULT '' AFTER province", steps);
    await ensureColumn('site_access_logs', 'ip_archived', 'ALTER TABLE site_access_logs ADD COLUMN ip_archived TINYINT(1) NOT NULL DEFAULT 0 AFTER ip_masked', steps);
    await ensureColumn('site_access_logs', 'user_agent', "ALTER TABLE site_access_logs ADD COLUMN user_agent VARCHAR(512) DEFAULT '' AFTER ip_archived", steps);

    return ok({ success: true, steps });
  } catch (error) {
    console.error('统计表迁移失败:', error);
    return ok({ success: false, steps, message: error.message });
  }
}

/**
 * 临时迁移：给 websites 表加 subdomain/subdomain_domain 列 + 官方域名唯一索引（幂等）。
 * 用一次性密钥授权（body.migrationKey === env.MIGRATION_KEY），不依赖 DB 角色，
 * 避免“查 admin 需先连库”的鸡生蛋问题。迁移完成后可删除本 handler、路由和环境变量。
 */
async function handleMigrateSubdomain(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '迁移密钥无效' })
    };
  }

  const steps = [];
  try {
    // 列是否已存在
    const col = await query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'subdomain'`
    );
    if (col[0].c === 0) {
      await query(
        `ALTER TABLE websites ADD COLUMN subdomain VARCHAR(63) DEFAULT NULL COMMENT '自定义子域名前缀(label)'`
      );
      steps.push('added column subdomain');
    } else {
      steps.push('column subdomain already exists');
    }

    const domainCol = await query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'subdomain_domain'`
    );
    if (domainCol[0].c === 0) {
      await query(
        `ALTER TABLE websites
         ADD COLUMN subdomain_domain VARCHAR(255) NOT NULL DEFAULT '${defaultDomain}'
         COMMENT '官方域名后缀，如 demox.site / vibeme.cn'`
      );
      steps.push('added column subdomain_domain');
    } else {
      steps.push('column subdomain_domain already exists');
    }

    await query(
      `UPDATE websites
       SET subdomain_domain = '${defaultDomain}'
       WHERE subdomain_domain IS NULL OR subdomain_domain = ''`
    );
    steps.push('normalized empty subdomain_domain');

    // 旧索引全局唯一 subdomain；新模型改为同一官方域名下唯一。
    const idx = await query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND INDEX_NAME = 'uniq_subdomain'`
    );
    if (idx[0].c > 0) {
      await query(`ALTER TABLE websites DROP INDEX uniq_subdomain`);
      steps.push('dropped legacy unique index uniq_subdomain');
    } else {
      steps.push('legacy index uniq_subdomain not found');
    }

    const scopedIdx = await query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND INDEX_NAME = 'uniq_official_subdomain'`
    );
    if (scopedIdx[0].c === 0) {
      await query(`ALTER TABLE websites ADD UNIQUE KEY uniq_official_subdomain (subdomain_domain, subdomain)`);
      steps.push('added unique index uniq_official_subdomain');
    } else {
      steps.push('index uniq_official_subdomain already exists');
    }

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: true, steps })
    };
  } catch (error) {
    console.error('迁移失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, steps, message: error.message })
    };
  }
}

/**
 * 项目维度迁移：创建 projects 表、给 websites 增加 project_id，
 * 为每个用户创建 default 项目，并把既有站点回填到各自 default。
 *
 * 用 body.migrationKey === env.MIGRATION_KEY 授权；幂等，可重复执行。
 */
async function handleMigrateDefaultProjects(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '迁移密钥无效' })
    };
  }

  const steps = [];
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS projects (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        project_key VARCHAR(20) DEFAULT NULL COMMENT '对外展示的随机项目ID',
        user_id     VARCHAR(64) NOT NULL COMMENT '项目归属用户ID',
        name        VARCHAR(255) NOT NULL DEFAULT 'default' COMMENT '项目显示名称',
        slug        VARCHAR(64) NOT NULL DEFAULT 'default' COMMENT '用户内唯一项目标识',
        description TEXT DEFAULT NULL,
        color       VARCHAR(32) DEFAULT NULL,
        icon        VARCHAR(64) DEFAULT NULL,
        archived    TINYINT(1) NOT NULL DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_project_key (project_key),
        UNIQUE KEY uniq_user_project_slug (user_id, slug),
        INDEX idx_projects_user_id (user_id),
        INDEX idx_projects_archived (archived)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户项目表'`
    );
    steps.push('ensured projects table');

    const projectKeyCol = await query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'project_key'`
    );
    if (projectKeyCol[0].c === 0) {
      await query(`ALTER TABLE projects ADD COLUMN project_key VARCHAR(20) DEFAULT NULL COMMENT '对外展示的随机项目ID' AFTER id`);
      steps.push('added projects.project_key column');
    } else {
      steps.push('projects.project_key already exists');
    }

    const projectsMissingKey = await query(`SELECT id FROM projects WHERE project_key IS NULL OR project_key = '' ORDER BY id ASC`);
    for (const row of projectsMissingKey) {
      await ensureProjectKeyForId(row.id);
    }
    steps.push(`backfilled ${projectsMissingKey.length} project random ids`);

    const projectKeyIdx = await query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'uniq_project_key'`
    );
    if (projectKeyIdx[0].c === 0) {
      await query('ALTER TABLE projects ADD UNIQUE KEY uniq_project_key (project_key)');
      steps.push('added projects unique index uniq_project_key');
    } else {
      steps.push('projects unique index uniq_project_key already exists');
    }

    const projectUniqueIdx = await query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'uniq_user_project_slug'`
    );
    if (projectUniqueIdx[0].c === 0) {
      await query('ALTER TABLE projects ADD UNIQUE KEY uniq_user_project_slug (user_id, slug)');
      steps.push('added projects unique index uniq_user_project_slug');
    } else {
      steps.push('projects unique index already exists');
    }

    const col = await query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'project_id'`
    );
    if (col[0].c === 0) {
      await query(`ALTER TABLE websites ADD COLUMN project_id BIGINT DEFAULT NULL COMMENT '所属项目(projects.id)'`);
      steps.push('added websites.project_id column');
    } else {
      steps.push('websites.project_id already exists');
    }

    const addWebsiteIndexIfMissing = async (indexName, ddl) => {
      const idx = await query(
        `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND INDEX_NAME = ?`,
        [indexName]
      );
      if (idx[0].c === 0) {
        await query(ddl);
        steps.push(`added websites index ${indexName}`);
      } else {
        steps.push(`websites index ${indexName} already exists`);
      }
    };
    await addWebsiteIndexIfMissing('idx_project_id', 'ALTER TABLE websites ADD INDEX idx_project_id (project_id)');
    await addWebsiteIndexIfMissing(
      'idx_user_project_updated',
      'ALTER TABLE websites ADD INDEX idx_user_project_updated (user_id, project_id, updated_at)'
    );

    const beforeDefaultRows = await query(`SELECT COUNT(*) AS c FROM projects WHERE slug = 'default'`);
    const usersTable = await query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    if (usersTable[0].c > 0) {
      const userRows = await query(`SELECT DISTINCT id FROM users WHERE id IS NOT NULL AND id <> ''`);
      for (const user of userRows) {
        await ensureDefaultProjectForUser(user.id);
      }
      steps.push('ensured default projects for users table');
    } else {
      steps.push('users table not found, skipped users table defaults');
    }

    const websiteOwnerRows = await query(`SELECT DISTINCT user_id FROM websites WHERE user_id IS NOT NULL AND user_id <> ''`);
    for (const owner of websiteOwnerRows) {
      await ensureDefaultProjectForUser(owner.user_id);
    }
    steps.push('ensured default projects for website owners');

    const afterDefaultRows = await query(`SELECT COUNT(*) AS c FROM projects WHERE slug = 'default'`);
    const backfill = await query(
      `UPDATE websites w
       JOIN projects p ON p.user_id = w.user_id AND p.slug = 'default'
       SET w.project_id = p.id
       WHERE w.project_id IS NULL`
    );
    steps.push(`backfilled ${backfill.affectedRows || 0} websites to default projects`);

    const totals = await query(
      `SELECT
         (SELECT COUNT(*) FROM projects WHERE slug = 'default') AS defaultProjects,
         (SELECT COUNT(*) FROM websites WHERE project_id IS NULL) AS websitesWithoutProject,
         (SELECT COUNT(*) FROM websites) AS websitesTotal`
    );

    return ok({
      success: true,
      steps,
      createdDefaultProjects: (afterDefaultRows[0]?.c || 0) - (beforeDefaultRows[0]?.c || 0),
      backfilledWebsites: backfill.affectedRows || 0,
      defaultProjects: totals[0]?.defaultProjects || 0,
      websitesWithoutProject: totals[0]?.websitesWithoutProject || 0,
      websitesTotal: totals[0]?.websitesTotal || 0
    });
  } catch (error) {
    console.error('默认项目迁移失败:', error);
    return ok({ success: false, steps, message: error.message });
  }
}

/**
 * 站点可见性迁移：websites.visibility = public/private。
 * 用 body.migrationKey === env.MIGRATION_KEY 授权；幂等，可重复执行。
 */
async function handleMigrateSiteVisibility(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '迁移密钥无效' })
    };
  }

  const steps = [];
  try {
    const col = await query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'visibility'`
    );
    if (col[0].c === 0) {
      await query(
        `ALTER TABLE websites
         ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT '${VISIBILITY_PUBLIC}'
         COMMENT '站点访问级别: public/private'`
      );
      steps.push('added websites.visibility column');
    } else {
      steps.push('websites.visibility already exists');
    }

    await query(
      `UPDATE websites
       SET visibility = '${VISIBILITY_PUBLIC}'
       WHERE visibility IS NULL OR visibility NOT IN ('${VISIBILITY_PUBLIC}', '${VISIBILITY_PRIVATE}')`
    );
    steps.push('normalized invalid visibility values');

    const idx = await query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND INDEX_NAME = 'idx_visibility'`
    );
    if (idx[0].c === 0) {
      await query('ALTER TABLE websites ADD INDEX idx_visibility (visibility)');
      steps.push('added websites idx_visibility');
    } else {
      steps.push('websites idx_visibility already exists');
    }

    const totals = await query(
      `SELECT
         SUM(visibility = '${VISIBILITY_PUBLIC}') AS publicCount,
         SUM(visibility = '${VISIBILITY_PRIVATE}') AS privateCount,
         COUNT(*) AS total
       FROM websites`
    );

    return ok({
      success: true,
      steps,
      publicCount: Number(totals[0]?.publicCount || 0),
      privateCount: Number(totals[0]?.privateCount || 0),
      total: Number(totals[0]?.total || 0)
    });
  } catch (error) {
    console.error('站点可见性迁移失败:', error);
    return ok({ success: false, steps, message: error.message });
  }
}

/**
 * 项目协作迁移：项目成员 + 邀请。项目创建者会被回填为 owner。
 * 用 body.migrationKey === env.MIGRATION_KEY 授权；幂等，可重复执行。
 */
async function handleMigrateProjectCollaboration(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '迁移密钥无效' })
    };
  }

  const steps = [];
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS project_members (
        project_id BIGINT NOT NULL COMMENT 'projects.id',
        user_id    VARCHAR(64) NOT NULL COMMENT '成员用户ID',
        role       VARCHAR(16) NOT NULL DEFAULT '${PROJECT_ROLE_MEMBER}' COMMENT 'owner/admin/member',
        invited_by VARCHAR(64) DEFAULT NULL,
        joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id, user_id),
        INDEX idx_project_members_user (user_id, role),
        INDEX idx_project_members_project_role (project_id, role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目成员表'`
    );
    steps.push('ensured project_members table');

    await query(
      `CREATE TABLE IF NOT EXISTS project_invitations (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        project_id  BIGINT NOT NULL COMMENT 'projects.id',
        email       VARCHAR(255) NOT NULL COMMENT '受邀邮箱，小写',
        role        VARCHAR(16) NOT NULL DEFAULT '${PROJECT_ROLE_MEMBER}' COMMENT 'admin/member',
        token       VARCHAR(64) DEFAULT NULL,
        invited_by  VARCHAR(64) NOT NULL,
        status      VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/accepted/canceled/expired',
        accepted_by VARCHAR(64) DEFAULT NULL,
        accepted_at TIMESTAMP NULL DEFAULT NULL,
        expires_at  TIMESTAMP NULL DEFAULT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_project_invite_status (project_id, email, status),
        INDEX idx_project_invitations_email_status (email, status),
        INDEX idx_project_invitations_project_status (project_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目邀请表'`
    );
    steps.push('ensured project_invitations table');

    await query(
      `CREATE TABLE IF NOT EXISTS project_feishu_grants (
        id             BIGINT AUTO_INCREMENT PRIMARY KEY,
        project_id     BIGINT NOT NULL COMMENT 'projects.id',
        principal_type VARCHAR(16) NOT NULL COMMENT 'user/department',
        key_type       VARCHAR(32) NOT NULL COMMENT 'open_id/open_department_id',
        principal_key  VARCHAR(255) NOT NULL COMMENT '标准化后的飞书主体标识',
        tenant_key     VARCHAR(128) DEFAULT NULL COMMENT '授权主体所属飞书租户',
        display_name   VARCHAR(120) DEFAULT NULL,
        role           VARCHAR(16) NOT NULL DEFAULT '${PROJECT_ROLE_MEMBER}' COMMENT 'admin/member',
        created_by     VARCHAR(64) NOT NULL,
        active         TINYINT(1) NOT NULL DEFAULT 1,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_project_feishu_principal (project_id, principal_type, key_type, principal_key),
        INDEX idx_project_feishu_principal (principal_type, key_type, principal_key, active),
        INDEX idx_project_feishu_project (project_id, active, role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目飞书主体授权表'`
    );
    steps.push('ensured project_feishu_grants table');

    const grantColumns = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_feishu_grants'`
    );
    const grantColumnNames = new Set(grantColumns.map((row) => row.COLUMN_NAME));
    if (!grantColumnNames.has('tenant_key')) {
      await query("ALTER TABLE project_feishu_grants ADD COLUMN tenant_key VARCHAR(128) DEFAULT NULL COMMENT '授权主体所属飞书租户' AFTER principal_key");
      steps.push('added project_feishu_grants.tenant_key');
    } else {
      steps.push('project_feishu_grants.tenant_key already exists');
    }
    await query("ALTER TABLE project_feishu_grants MODIFY COLUMN key_type VARCHAR(32) NOT NULL COMMENT 'open_id/open_department_id'");
    steps.push('ensured project_feishu_grants.key_type capacity');

    const userColumns = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    const userColumnNames = new Set(userColumns.map((row) => row.COLUMN_NAME));
    if (!userColumnNames.has('feishu_department_ids')) {
      await query("ALTER TABLE users ADD COLUMN feishu_department_ids TEXT DEFAULT NULL COMMENT '飞书直属部门及祖先部门 open_department_id JSON' AFTER feishu_email");
      steps.push('added users.feishu_department_ids');
    } else {
      steps.push('users.feishu_department_ids already exists');
    }
    if (!userColumnNames.has('feishu_directory_synced_at')) {
      await query("ALTER TABLE users ADD COLUMN feishu_directory_synced_at TIMESTAMP NULL DEFAULT NULL COMMENT '飞书部门身份同步时间' AFTER feishu_department_ids");
      steps.push('added users.feishu_directory_synced_at');
    } else {
      steps.push('users.feishu_directory_synced_at already exists');
    }

    const legacyGrants = await query(
      `UPDATE project_feishu_grants
       SET active = 0, updated_at = NOW()
       WHERE active = 1 AND (
         tenant_key IS NULL
         OR principal_type NOT IN ('${FEISHU_PRINCIPAL_USER}', '${FEISHU_PRINCIPAL_DEPARTMENT}')
         OR key_type NOT IN ('open_id', 'open_department_id')
       )`
    );
    steps.push(`deactivated legacy Feishu grants: ${legacyGrants.affectedRows || 0}`);

    const ownerRowsBefore = await query(`SELECT COUNT(*) AS c FROM project_members WHERE role = '${PROJECT_ROLE_OWNER}'`);
    const backfill = await query(
      `INSERT INTO project_members (project_id, user_id, role, invited_by, joined_at, updated_at)
       SELECT id, user_id, '${PROJECT_ROLE_OWNER}', user_id, created_at, NOW()
       FROM projects
       WHERE user_id IS NOT NULL AND user_id <> ''
       ON DUPLICATE KEY UPDATE role = '${PROJECT_ROLE_OWNER}', updated_at = NOW()`
    );
    steps.push(`backfilled owner memberships: ${backfill.affectedRows || 0}`);

    await query(
      `UPDATE project_members
       SET role = '${PROJECT_ROLE_MEMBER}'
       WHERE role NOT IN ('${PROJECT_ROLE_OWNER}', '${PROJECT_ROLE_ADMIN}', '${PROJECT_ROLE_MEMBER}')`
    );
    steps.push('normalized invalid member roles');

    const totals = await query(
      `SELECT
         (SELECT COUNT(*) FROM project_members) AS membersTotal,
         (SELECT COUNT(*) FROM project_members WHERE role = '${PROJECT_ROLE_OWNER}') AS ownersTotal,
         (SELECT COUNT(*) FROM project_invitations WHERE status = 'pending') AS pendingInvitations,
         (SELECT COUNT(*) FROM project_feishu_grants WHERE active = 1) AS activeFeishuGrants`
    );

    return ok({
      success: true,
      steps,
      createdOwnerMemberships: Math.max(0, Number(totals[0]?.ownersTotal || 0) - Number(ownerRowsBefore[0]?.c || 0)),
      membersTotal: Number(totals[0]?.membersTotal || 0),
      ownersTotal: Number(totals[0]?.ownersTotal || 0),
      pendingInvitations: Number(totals[0]?.pendingInvitations || 0),
      activeFeishuGrants: Number(totals[0]?.activeFeishuGrants || 0)
    });
  } catch (error) {
    console.error('项目协作迁移失败:', error);
    return ok({ success: false, steps, message: error.message });
  }
}

/**
 * 确保用户有 default 项目。项目表未迁移时静默降级，避免影响部署主流程。
 * @returns {Promise<number|null>} default project id
 */
async function ensureDefaultProjectForUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  try {
    const projectKey = await createUniqueProjectKey();
    await query(
      `INSERT INTO projects (project_key, user_id, name, slug)
       VALUES (?, ?, 'default', 'default')
       ON DUPLICATE KEY UPDATE slug = slug`,
      [projectKey, uid]
    );
    const rows = await query(
      `SELECT id, project_key FROM projects WHERE user_id = ? AND slug = 'default' LIMIT 1`,
      [uid]
    );
    if (rows.length > 0) {
      if (!rows[0].project_key) await ensureProjectKeyForId(rows[0].id);
      await ensureProjectOwnerMembershipBestEffort(rows[0].id, uid);
      return rows[0].id;
    }
    return null;
  } catch (e) {
    console.warn('确保 default 项目失败，跳过项目归属写入:', e.message);
    return null;
  }
}

/**
 * 给站点补默认项目；若站点已有 project_id，不覆盖。
 * 该步骤是 best-effort：项目迁移未执行时不影响上传/重部署。
 */
async function ensureWebsiteDefaultProject(userId, websiteId) {
  const projectId = await ensureDefaultProjectForUser(userId);
  if (!projectId) return null;
  try {
    await query(
      `UPDATE websites
       SET project_id = COALESCE(project_id, ?)
       WHERE user_id = ? AND website_id = ?`,
      [projectId, userId, websiteId]
    );
    return projectId;
  } catch (e) {
    console.warn('写入站点 default 项目失败，跳过项目归属写入:', e.message);
    return null;
  }
}

async function assignWebsiteProject(userId, websiteId, projectId) {
  const pid = await resolveProjectId(projectId);
  if (!pid) return await ensureWebsiteDefaultProject(userId, websiteId);
  try {
    let project = await getProjectWithUserRole(userId, pid, { includeArchived: false });
    const isPlatformAdmin = await checkAdmin(userId);
    if (!project && isPlatformAdmin) {
      const rows = await query('SELECT * FROM projects WHERE id = ? AND archived = 0 LIMIT 1', [pid]);
      if (rows[0]) project = { ...rows[0], project_role: PROJECT_ROLE_OWNER };
    }
    if (!project && !isPlatformAdmin) {
      throw new Error('目标项目不存在、已归档或无权限');
    }
    if (!project) {
      throw new Error('目标项目不存在或已归档');
    }
    if (project && !PROJECT_WRITE_ROLES.includes(project.project_role) && !isPlatformAdmin) {
      throw new Error('只有项目 owner/admin 可以写入站点');
    }
    await query(
      `UPDATE websites SET project_id = ? WHERE website_id = ?`,
      [pid, websiteId]
    );
    return pid;
  } catch (e) {
    console.warn('写入站点项目失败:', e.message);
    throw e;
  }
}

function isSafeZipEntry(entry) {
  if (!entry || entry.isDirectory) return false;
  const name = String(entry.entryName || '').replace(/\\/g, '/');
  if (!name || name.startsWith('/') || name.includes('..')) return false;
  if (name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
  return true;
}

function getDeployEntryRecords(zipEntries) {
  const validEntries = zipEntries.filter(isSafeZipEntry);
  let commonPrefix = '';
  if (validEntries.length > 0) {
    const parts = String(validEntries[0].entryName || '').replace(/\\/g, '/').split('/');
    if (parts.length > 1) {
      const potentialPrefix = parts[0] + '/';
      const allMatch = validEntries.every(e =>
        String(e.entryName || '').replace(/\\/g, '/').startsWith(potentialPrefix)
      );
      if (allMatch) commonPrefix = potentialPrefix;
    }
  }

  return validEntries.map((entry) => {
    let name = String(entry.entryName || '').replace(/\\/g, '/');
    if (commonPrefix && name.startsWith(commonPrefix)) {
      name = name.slice(commonPrefix.length);
    }
    return {
      entry,
      originalName: String(entry.entryName || '').replace(/\\/g, '/'),
      name,
      lowerName: name.toLowerCase()
    };
  }).filter(r => r.name && !r.name.endsWith('/'));
}

function readEntryText(entry, maxBytes = 1024 * 1024) {
  try {
    const buf = entry.getData();
    return buf.slice(0, maxBytes).toString('utf8');
  } catch (e) {
    return '';
  }
}

function stripUrlNoise(value) {
  try {
    return decodeURIComponent(String(value || '').split('#')[0].split('?')[0]);
  } catch (e) {
    return String(value || '').split('#')[0].split('?')[0];
  }
}

function isExternalOrSpecialUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('#')) return true;
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw) ||
    /^(?:data|mailto|tel|javascript|blob):/i.test(raw);
}

function normalizeHtmlRef(ref, htmlPath) {
  if (isExternalOrSpecialUrl(ref)) return '';
  const cleaned = stripUrlNoise(ref).trim();
  if (!cleaned || cleaned.startsWith('#')) return '';
  const withoutLeading = cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
  const baseDir = String(htmlPath || '').includes('/')
    ? String(htmlPath).split('/').slice(0, -1).join('/')
    : '';
  const combined = cleaned.startsWith('/')
    ? withoutLeading
    : (baseDir ? `${baseDir}/${withoutLeading}` : withoutLeading);
  const parts = [];
  for (const part of combined.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function extractHtmlAssetRefs(html) {
  const refs = [];
  const add = (kind, value) => {
    if (value) refs.push({ kind, value: String(value).trim() });
  };

  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi;
  let m;
  while ((m = scriptRe.exec(html))) add('script', m[2]);

  const linkRe = /<link\b[^>]*>/gi;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const href = /\bhref\s*=\s*(['"])(.*?)\1/i.exec(tag);
    if (!href) continue;
    const rel = (/\brel\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2] || '').toLowerCase();
    if (/(stylesheet|modulepreload|preload|icon)/.test(rel)) {
      add(rel || 'link', href[2]);
    }
  }

  return refs;
}

function collectSourcePackageSignals(records) {
  const names = new Set(records.map(r => r.lowerName));
  const rootPackage = records.find(r => r.lowerName === 'package.json');
  const configMarkers = records
    .filter(r => /^(vite|next|nuxt|astro|svelte|webpack|rollup|parcel|rsbuild|rspack|angular|vue|tailwind|postcss)\.config\.(js|cjs|mjs|ts|mts|cts)$/i.test(r.name))
    .map(r => r.name);
  const sourceDirs = ['src/', 'app/', 'pages/', 'components/'];
  const sourceDirHits = sourceDirs.filter(prefix => records.some(r => r.lowerName.startsWith(prefix)));
  const lockFiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']
    .filter(name => names.has(name));
  const nodeModules = records.some(r => r.lowerName.startsWith('node_modules/'));

  let packageLooksLikeFrontend = false;
  let packageHints = [];
  if (rootPackage) {
    try {
      const pkg = JSON.parse(readEntryText(rootPackage.entry, 256 * 1024) || '{}');
      const deps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {})
      };
      const depNames = Object.keys(deps);
      packageHints = depNames.filter(name =>
        /^(vite|next|nuxt|astro|svelte|react|react-dom|vue|@vitejs\/|@sveltejs\/|@astrojs\/|@angular\/|webpack|parcel|tailwindcss)$/i.test(name)
      );
      const scripts = pkg.scripts || {};
      packageLooksLikeFrontend = packageHints.length > 0 ||
        Boolean(scripts.build || scripts.dev || scripts.start);
    } catch (e) {
      packageLooksLikeFrontend = true;
    }
  }

  return {
    rootPackage: !!rootPackage,
    configMarkers,
    sourceDirHits,
    lockFiles,
    nodeModules,
    packageLooksLikeFrontend,
    packageHints
  };
}

function sourcePackageMessage(reasons = []) {
  const detail = reasons.length ? `\n检测到：${reasons.slice(0, 8).join('、')}` : '';
  return [
    '检测到你上传的是前端源码项目，而不是静态构建产物，已停止部署。',
    detail,
    'Demox 当前只托管可直接访问的静态文件。',
    '请在本地项目根目录执行：npm install && npm run build',
    '然后上传构建输出目录的压缩包：Vite/React/Vue/Astro 通常是 dist.zip，Next 静态导出通常是 out.zip。',
    '不要上传 package.json、src/、node_modules/ 或 vite.config.ts 所在的项目根目录。'
  ].filter(Boolean).join('\n');
}

function validateStaticSiteZip(zipEntries) {
  const records = getDeployEntryRecords(zipEntries);
  const names = new Set(records.map(r => r.lowerName));
  const sourceSignals = collectSourcePackageSignals(records);
  const sourceReasons = [];

  if (sourceSignals.nodeModules) {
    return {
      valid: false,
      code: 'NODE_MODULES_UPLOADED',
      message: [
        '检测到压缩包里包含 node_modules，已停止部署。',
        '请不要上传依赖目录。静态站点只需要上传构建后的 dist/build/out 目录。'
      ].join('\n')
    };
  }

  if (sourceSignals.rootPackage && sourceSignals.packageLooksLikeFrontend) sourceReasons.push('package.json');
  if (sourceSignals.configMarkers.length) sourceReasons.push(...sourceSignals.configMarkers.slice(0, 4));
  if (sourceSignals.sourceDirHits.length) sourceReasons.push(...sourceSignals.sourceDirHits.map(x => x.replace(/\/$/, '/ 目录')));
  if (sourceSignals.lockFiles.length) sourceReasons.push(...sourceSignals.lockFiles.slice(0, 3));
  if (sourceSignals.packageHints.length) sourceReasons.push(...sourceSignals.packageHints.slice(0, 4));

  const rootIndex = records.find(r => r.lowerName === 'index.html');
  if (!rootIndex) {
    if (sourceReasons.length || names.has('dist/index.html') || names.has('build/index.html') || names.has('out/index.html')) {
      return {
        valid: false,
        code: 'SOURCE_PACKAGE_NO_ROOT_INDEX',
        message: sourcePackageMessage(sourceReasons.length ? sourceReasons : ['未在压缩包根目录找到 index.html'])
      };
    }
    return {
      valid: false,
      code: 'MISSING_INDEX',
      message: [
        'ZIP 根目录必须包含 index.html，已停止部署。',
        '如果这是前端项目，请先运行 npm run build，然后只上传构建输出目录（例如 dist.zip / build.zip / out.zip）。'
      ].join('\n')
    };
  }

  const htmlRecords = records.filter(r => /\.html?$/i.test(r.name));
  const sourceRefs = [];
  const missingAssets = [];
  for (const htmlRecord of htmlRecords) {
    const html = readEntryText(htmlRecord.entry);
    const refs = extractHtmlAssetRefs(html);
    for (const ref of refs) {
      const normalized = normalizeHtmlRef(ref.value, htmlRecord.name);
      if (!normalized) continue;
      const lower = normalized.toLowerCase();
      if (
        lower.startsWith('src/') ||
        /\.(ts|tsx|jsx|vue|svelte|astro)$/i.test(lower) ||
        /(^|\/)(vite|webpack|next)\.config\./i.test(lower)
      ) {
        sourceRefs.push(`${htmlRecord.name} -> ${ref.value}`);
        continue;
      }

      if (ref.kind === 'script' || ref.kind === 'stylesheet' || ref.kind === 'modulepreload') {
        const ext = path.extname(lower);
        if (['.js', '.mjs', '.css'].includes(ext) && !names.has(lower)) {
          missingAssets.push(`${htmlRecord.name} -> ${ref.value}`);
        }
      }
    }
  }

  if (sourceRefs.length > 0) {
    return {
      valid: false,
      code: 'HTML_REFERENCES_SOURCE',
      message: sourcePackageMessage([...sourceReasons, ...sourceRefs.slice(0, 4)])
    };
  }

  if (sourceReasons.length > 0) {
    return {
      valid: false,
      code: 'SOURCE_PACKAGE',
      message: sourcePackageMessage(sourceReasons)
    };
  }

  if (missingAssets.length > 0) {
    return {
      valid: false,
      code: 'MISSING_STATIC_ASSETS',
      message: [
        '检测到 index.html 引用了不存在的 JS/CSS 文件，已停止部署。',
        `缺失资源：${missingAssets.slice(0, 6).join('、')}`,
        '请确认上传的是完整构建产物目录，而不是只上传了 index.html。'
      ].join('\n')
    };
  }

  return { valid: true };
}

// ===========================================================================
// 多云存储桶注册制：CRUD + 数据迁移
// ===========================================================================

/** 列出所有存储桶（管理员）。不返回任何密钥/密文。 */
async function handleListBuckets(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  try {
    const list = await buckets.listBuckets();
    return ok({ success: true, data: list });
  } catch (e) {
    // 表未建时给出明确提示，引导先跑迁移
    return ok({ success: false, message: 'storage_buckets 表不存在，请先执行 migrate_buckets', error: e.message });
  }
}

/**
 * 注册新存储桶（管理员）。
 * body: { name, provider, bucket, region?, endpoint?, originHost?, forcePathStyle?,
 *         secretId?, secretKey?, isDefault?, enabled? }
 * 密钥(secretId/secretKey)用 AES-GCM 加密后入库；留空则该桶用 SCF env 凭证(仅适合旧默认桶)。
 * 设为默认桶时，事务内把其它桶 is_default 清零。
 */
async function handleRegisterBucket(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const b = event.body || event;
  const name = String(b.name || '').trim();
  const provider = String(b.provider || 'cos').trim().toLowerCase();
  const bucket = String(b.bucket || '').trim();
  if (!name || !bucket) return ok({ success: false, message: '缺少必要参数: name, bucket' });
  if (!['cos', 's3'].includes(provider)) return ok({ success: false, message: 'provider 只能是 cos 或 s3' });

  // 加密密钥（两者要么都给要么都不给）
  let secretIdEnc = null;
  let secretKeyEnc = null;
  try {
    if (b.secretId && b.secretKey) {
      secretIdEnc = encrypt(String(b.secretId));
      secretKeyEnc = encrypt(String(b.secretKey));
    } else if (b.secretId || b.secretKey) {
      return ok({ success: false, message: 'secretId 与 secretKey 必须同时提供' });
    }
  } catch (e) {
    return ok({ success: false, message: '密钥加密失败：' + e.message });
  }

  const region = b.region ? String(b.region).trim() : null;
  const endpoint = b.endpoint ? String(b.endpoint).trim() : null;
  const originHost = b.originHost ? String(b.originHost).trim() : null;
  const forcePathStyle = b.forcePathStyle === undefined || b.forcePathStyle === null
    ? null : (b.forcePathStyle ? 1 : 0);
  const isDefault = b.isDefault ? 1 : 0;
  const enabled = b.enabled === undefined ? 1 : (b.enabled ? 1 : 0);

  try {
    const insertId = await transaction(async (conn) => {
      if (isDefault) {
        await conn.query('UPDATE storage_buckets SET is_default = 0 WHERE is_default = 1');
      }
      const [res] = await conn.query(
        `INSERT INTO storage_buckets
         (name, provider, bucket, region, endpoint, origin_host, force_path_style,
          secret_id_enc, secret_key_enc, is_default, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, provider, bucket, region, endpoint, originHost, forcePathStyle,
         secretIdEnc, secretKeyEnc, isDefault, enabled]
      );
      return res.insertId;
    });
    return ok({ success: true, id: insertId, message: '存储桶已注册' });
  } catch (e) {
    return ok({ success: false, message: '注册失败：' + e.message });
  }
}

/**
 * 更新存储桶（管理员）。body.id 必填；其余字段按需更新。
 * 密钥：传 secretId+secretKey 则重新加密覆盖；传空字符串 '' 显式清空(改回用 env)；不传则保持原值。
 */
async function handleUpdateBucket(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const b = event.body || event;
  const id = b.id;
  if (!id && id !== 0) return ok({ success: false, message: '缺少 id' });

  const sets = [];
  const params = [];
  const setField = (col, val) => { sets.push(`${col} = ?`); params.push(val); };

  if (b.name !== undefined) setField('name', String(b.name).trim());
  if (b.provider !== undefined) {
    const p = String(b.provider).trim().toLowerCase();
    if (!['cos', 's3'].includes(p)) return ok({ success: false, message: 'provider 只能是 cos 或 s3' });
    setField('provider', p);
  }
  if (b.bucket !== undefined) setField('bucket', String(b.bucket).trim());
  if (b.region !== undefined) setField('region', b.region ? String(b.region).trim() : null);
  if (b.endpoint !== undefined) setField('endpoint', b.endpoint ? String(b.endpoint).trim() : null);
  if (b.originHost !== undefined) setField('origin_host', b.originHost ? String(b.originHost).trim() : null);
  if (b.forcePathStyle !== undefined) {
    setField('force_path_style', b.forcePathStyle === null ? null : (b.forcePathStyle ? 1 : 0));
  }
  if (b.enabled !== undefined) setField('enabled', b.enabled ? 1 : 0);

  // 密钥更新：同时传两个=重新加密；同时传两个空串=清空回 env；只传一个=报错
  const hasId = b.secretId !== undefined;
  const hasKey = b.secretKey !== undefined;
  if (hasId || hasKey) {
    if (!hasId || !hasKey) return ok({ success: false, message: 'secretId 与 secretKey 需同时提供或同时省略' });
    try {
      if (b.secretId === '' && b.secretKey === '') {
        setField('secret_id_enc', null);
        setField('secret_key_enc', null);
      } else {
        setField('secret_id_enc', encrypt(String(b.secretId)));
        setField('secret_key_enc', encrypt(String(b.secretKey)));
      }
    } catch (e) {
      return ok({ success: false, message: '密钥加密失败：' + e.message });
    }
  }

  if (sets.length === 0) return ok({ success: false, message: '没有要更新的字段' });

  try {
    // 改默认桶单独走 set_default_bucket（带清零逻辑），此处不处理 is_default
    params.push(id);
    await query(`UPDATE storage_buckets SET ${sets.join(', ')} WHERE id = ?`, params);
    return ok({ success: true, message: '已更新' });
  } catch (e) {
    return ok({ success: false, message: '更新失败：' + e.message });
  }
}

/**
 * 删除存储桶（管理员）。只删注册记录，不动桶里的对象（避免误删线上文件）。
 * 拦截条件：1) 默认桶不可删；2) 仍有 websites 关联时不可删（先迁移站点）。
 */
async function handleDeleteBucket(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const id = (event.body || event).id;
  if (!id && id !== 0) return ok({ success: false, message: '缺少 id' });

  try {
    const rows = await query('SELECT is_default FROM storage_buckets WHERE id = ?', [id]);
    if (rows.length === 0) return ok({ success: false, message: '桶不存在' });
    if (rows[0].is_default) return ok({ success: false, message: '默认桶不可删除，请先指定其它桶为默认' });

    const used = await query('SELECT COUNT(*) AS c FROM websites WHERE bucket_id = ?', [id]);
    if ((used[0]?.c || 0) > 0) {
      return ok({ success: false, message: `仍有 ${used[0].c} 个站点关联此桶，无法删除` });
    }
    await query('DELETE FROM storage_buckets WHERE id = ?', [id]);
    return ok({ success: true, message: '已删除' });
  } catch (e) {
    return ok({ success: false, message: '删除失败：' + e.message });
  }
}

/** 设为默认桶（管理员）。事务内把其它桶清零，保证全局唯一默认。 */
async function handleSetDefaultBucket(event) {
  const a = await requireAdmin(event);
  if (a.err) return a.err;
  const id = (event.body || event).id;
  if (!id && id !== 0) return ok({ success: false, message: '缺少 id' });

  try {
    await transaction(async (conn) => {
      const [rows] = await conn.query('SELECT enabled FROM storage_buckets WHERE id = ?', [id]);
      if (rows.length === 0) throw new Error('桶不存在');
      if (!rows[0].enabled) throw new Error('已禁用的桶不能设为默认');
      await conn.query('UPDATE storage_buckets SET is_default = 0 WHERE is_default = 1');
      await conn.query('UPDATE storage_buckets SET is_default = 1 WHERE id = ?', [id]);
    });
    return ok({ success: true, message: '已设为默认桶' });
  } catch (e) {
    return ok({ success: false, message: e.message });
  }
}

/**
 * 数据迁移（一次性，密钥授权）：把现有 COS 桶注册为默认桶 + 回填存量站点 bucket_id。
 * 用 body.migrationKey === env.MIGRATION_KEY 授权（复用 001 迁移的模式，不依赖 DB 角色）。
 * 幂等：已存在默认桶则跳过注册，仅补回填。注册时密钥留空 → 该桶沿用 SCF env 凭证(密钥不入库)。
 */
async function handleMigrateBuckets(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return { statusCode: 403, headers: getCORSHeaders(), body: JSON.stringify({ error: '迁移密钥无效' }) };
  }

  const steps = [];
  try {
    // 0) DDL：建表 + 给 websites 加列（幂等）。自包含，无需直连 MySQL 跑 .sql。
    await query(
      `CREATE TABLE IF NOT EXISTS storage_buckets (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(64)  NOT NULL,
        provider      VARCHAR(16)  NOT NULL DEFAULT 'cos',
        bucket        VARCHAR(128) NOT NULL,
        region        VARCHAR(64)  DEFAULT NULL,
        endpoint      VARCHAR(255) DEFAULT NULL,
        origin_host   VARCHAR(255) DEFAULT NULL,
        force_path_style TINYINT(1) DEFAULT NULL,
        secret_id_enc  TEXT DEFAULT NULL,
        secret_key_enc TEXT DEFAULT NULL,
        is_default    TINYINT(1) NOT NULL DEFAULT 0,
        enabled       TINYINT(1) NOT NULL DEFAULT 1,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='多云存储桶注册表'`
    );
    steps.push('ensured storage_buckets table');

    // websites.bucket_id（列已存在则跳过）
    const col = await query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'bucket_id'`
    );
    if (col[0].c === 0) {
      await query(`ALTER TABLE websites ADD COLUMN bucket_id INT DEFAULT NULL COMMENT '所属存储桶(storage_buckets.id)'`);
      await query(`ALTER TABLE websites ADD INDEX idx_bucket_id (bucket_id)`);
      steps.push('added websites.bucket_id column + index');
    } else {
      steps.push('websites.bucket_id already exists');
    }

    // 1) 确保有默认桶；没有则把现有 COS 桶注册进去（密钥留空 → 用 env）
    let def = await query('SELECT * FROM storage_buckets WHERE is_default = 1 LIMIT 1');
    let defaultId;
    if (def.length === 0) {
      // query() 直接返回 mysql2 结果首元素：INSERT 时为含 insertId 的 ResultSetHeader
      const res = await query(
        `INSERT INTO storage_buckets (name, provider, bucket, region, origin_host, is_default, enabled)
         VALUES (?, 'cos', ?, ?, ?, 1, 1)`,
        ['腾讯云 COS（默认）', LEGACY_BUCKET.bucket, LEGACY_BUCKET.region, LEGACY_BUCKET.originHost]
      );
      defaultId = res.insertId;
      steps.push(`registered default bucket id=${defaultId}`);
    } else {
      defaultId = def[0].id;
      steps.push(`default bucket already exists id=${defaultId}`);
    }

    // 2) 回填存量站点：bucket_id 为 NULL 的全部指向默认桶
    const upd = await query('UPDATE websites SET bucket_id = ? WHERE bucket_id IS NULL', [defaultId]);
    steps.push(`backfilled ${upd.affectedRows} websites → bucket_id=${defaultId}`);

    return ok({ success: true, steps });
  } catch (error) {
    console.error('存储桶迁移失败:', error);
    return ok({ success: false, steps, message: error.message });
  }
}



/**
 * 处理上传并部署
 */
async function handleUploadAndDeploy(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { fileContentBase64, websiteId: inputWebsiteId, fileName, projectId: inputProjectId } = event.body || event;

  if (!fileContentBase64 || !fileName) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: fileContentBase64, fileName' })
    };
  }

  try {
    // 获取用户角色配置（从数据库读取）
    const roleConfig = await getUserLimits(userId);
    console.log(`用户 ${userId} 的角色配置:`, roleConfig);

    // 解析 ZIP
    const buffer = Buffer.from(String(fileContentBase64), 'base64');
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    // 检查文件数量限制
    const validEntries = zipEntries.filter(isSafeZipEntry);

    const staticValidation = validateStaticSiteZip(zipEntries);
    if (!staticValidation.valid) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          code: staticValidation.code || 'INVALID_STATIC_SITE',
          message: staticValidation.message || '上传包不是可直接访问的静态站点'
        })
      };
    }

    if (roleConfig.max_file_count && validEntries.length > roleConfig.max_file_count) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          message: `文件数量超出限制！当前上传包含 ${validEntries.length} 个文件，您的角色限制为 ${roleConfig.max_file_count} 个文件。`
        })
      };
    }

    // 检查文件大小限制
    const totalSize = buffer.length;
    if (roleConfig.max_file_size && totalSize > roleConfig.max_file_size) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          message: `文件大小超出限制！当前文件大小 ${Math.round(totalSize / 1024 / 1024)}MB，您的角色限制为 ${Math.round(roleConfig.max_file_size / 1024 / 1024)}MB。`
        })
      };
    }

    // 生成或使用现有的 websiteId；重部署允许项目 owner/admin 操作协作项目中的站点。
    const websiteId = inputWebsiteId ? normalizeWebsiteId(inputWebsiteId) : generateWebsiteId();
    const existing = inputWebsiteId
      ? await query('SELECT * FROM websites WHERE website_id = ? LIMIT 1', [websiteId])
      : [];
    if (existing.length > 0 && !(await canUserManageSite(userId, existing[0]))) {
      return {
        statusCode: 403,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, message: '无权限重新部署该站点' })
      };
    }

    const requestedProjectId = await resolveProjectId(inputProjectId);
    if (inputProjectId && !requestedProjectId) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({ success: false, message: '目标项目不合法' })
      };
    }
    if (requestedProjectId) {
      const canWriteTarget = await canUserWriteProject(userId, requestedProjectId);
      if (!canWriteTarget) {
        return {
          statusCode: 200,
          headers: getCORSHeaders(),
          body: JSON.stringify({ success: false, message: '目标项目不存在、已归档或无写入权限' })
        };
      }
    }

    // 检查部署数量限制。重部署已有站点不计入新部署数量。
    if (roleConfig.deployment_limit) {
      const countRes = await query('SELECT COUNT(*) as count FROM websites WHERE user_id = ?', [userId]);
      if (existing.length === 0 && countRes[0].count >= roleConfig.deployment_limit) {
        return {
          statusCode: 200,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            success: false,
            message: `已达到部署上限！您的角色限制为 ${roleConfig.deployment_limit} 个网站。`
          })
        };
      }
    }

    const fileNameNoExt = normalizeFileNameNoExt(fileName);
    const deploymentOwnerId = existing.length > 0 ? existing[0].user_id : userId;
    const targetPrefix = `sites/${deploymentOwnerId}/${websiteId}/${fileNameNoExt}`;

    // 选桶：重部署沿用站点已绑定的桶（避免文件分裂在两个桶）；新部署落默认桶。
    const existingBucketId = existing.length > 0 ? existing[0].bucket_id : null;
    const bucketCfg = await resolveBucketConfig(existingBucketId);
    // bucketCfg.id 可能不存在（迁移前回退 LEGACY_BUCKET）；此时 bucket_id 写 NULL（= 默认桶语义）
    const bucketIdToStore = bucketCfg.id || null;

    // 部署到目标桶（COS 或 S3 兼容，由 provider 决定）
    const uploadedCount = await deployZipToBucket(bucketCfg, zipEntries, targetPrefix);
    console.log(`部署完成，上传了 ${uploadedCount} 个文件 → 桶 ${bucketCfg.name || bucketCfg.bucket}`);

    // 默认访问域名 = <websiteId 小写>.demox.site(由边缘函数 resolve 路由到桶 path)
    // 缓存刷新由部署流程主动提交 EdgeOne 清理任务，不再通过 ?v=timestamp 绕过。
    const finalUrl = buildDefaultSiteUrl(websiteId);

    // 默认名称:优先用 index.html 的 <title>,其次文件名
    const extractedTitle = extractTitleFromZip(zipEntries);
    const defaultName = extractedTitle || fileName;

    // 确保用量列存在（幂等），再写入 file_count/storage_size
    await ensureUsageColumns();

    // 保存到数据库
    if (existing.length > 0) {
      // 重部署:仅当用户从未自定义过名称(name 为空或等于旧 file_name)时,才用新默认名覆盖
      const prev = existing[0];
      const prevName = (prev.name || '').trim();
      const userCustomized = prevName && prevName !== (prev.file_name || '').trim();
      const nextName = userCustomized ? prevName : defaultName;
      await query(
        `UPDATE websites SET file_name = ?, name = ?, path = ?, url = ?, bucket_id = ?, file_count = ?, storage_size = ?, updated_at = NOW() WHERE id = ?`,
        [fileName, nextName, targetPrefix, finalUrl, bucketIdToStore, validEntries.length, totalSize, prev.id]
      );
      // 自定义前缀路由实时读 websites.path 列，重部署后 path 已更新，无需额外操作
      // （边缘缓存最长 60s 后自然刷新）
    } else {
      await query(
        `INSERT INTO websites (user_id, website_id, file_name, name, path, url, tags, bucket_id, file_count, storage_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, websiteId, fileName, defaultName, targetPrefix, finalUrl, JSON.stringify([]), bucketIdToStore, validEntries.length, totalSize]
      );
    }

    const projectId = requestedProjectId
      ? await assignWebsiteProject(userId, websiteId, requestedProjectId)
      : (existing.length > 0
          ? (existing[0].project_id || await ensureWebsiteDefaultProject(existing[0].user_id, websiteId))
          : await ensureWebsiteDefaultProject(userId, websiteId));
    const projectKey = projectId ? await ensureProjectKeyForId(projectId) : null;
    const cachePurge = await purgeSiteCache({
      websiteId,
      subdomain: existing.length > 0 ? existing[0].subdomain : null,
      subdomainDomain: existing.length > 0 ? getRowSubdomainDomain(existing[0]) : null
    });
    const existingSubdomainDomain = existing.length > 0 ? getRowSubdomainDomain(existing[0]) : defaultDomain;
    const customUrl = existing.length > 0
      ? buildCustomSiteUrl(existing[0].subdomain, existingSubdomainDomain)
      : '';
    const preferredUrl = customUrl || finalUrl;

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        url: preferredUrl,
        defaultUrl: finalUrl,
        customUrl: customUrl || null,
        subdomainDomain: existing.length > 0 ? existingSubdomainDomain : null,
        preferredUrl,
        message: '部署成功',
        websiteId: websiteId,
        projectId: projectKey || projectId,
        projectInternalId: projectId,
        path: targetPrefix,
        uploadedCount,
        cachePurge
      })
    };
  } catch (error) {
    console.error('部署失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        message: error.message || '部署失败'
      })
    };
  }
}

/**
 * 部署 ZIP 到指定桶（COS / S3 兼容，由 provider 抽象屏蔽差异）。
 * getCacheHeaders 返回的 Cache-Control 透传给 provider，由各适配器映射到自家字段。
 */
async function deployZipToBucket(bucketCfg, zipEntries, targetPrefix) {
  const provider = providerFor(bucketCfg);

  const validEntries = zipEntries.filter(entry => {
    if (entry.isDirectory) return false;
    const name = entry.entryName;
    if (name.includes('..') || name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
    return true;
  });

  let commonPrefix = '';
  if (validEntries.length > 0) {
    const firstEntry = validEntries[0];
    const parts = firstEntry.entryName.split('/');
    if (parts.length > 1) {
      const potentialPrefix = parts[0] + '/';
      const allMatch = validEntries.every(e => e.entryName.startsWith(potentialPrefix));
      if (allMatch) {
        commonPrefix = potentialPrefix;
      }
    }
  }

  const uploadTasks = validEntries.map(entry => {
    let entryName = entry.entryName;
    if (commonPrefix && entryName.startsWith(commonPrefix)) {
      entryName = entryName.slice(commonPrefix.length);
    }
    const key = `${targetPrefix}/${entryName}`;
    const cacheHeaders = getCacheHeaders(key);
    return provider.put(key, entry.getData(), {
      contentType: getContentType(key),
      cacheControl: cacheHeaders && cacheHeaders['Cache-Control']
    });
  });

  await Promise.all(uploadTasks);
  return validEntries.length;
}

/**
 * 生成 8 位网站 ID
 */
function generateWebsiteId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * 从 zip 里提取入口 index.html 的 <title> 作为默认站点名称。
 * 优先取根目录 index.html，其次任意层级最浅的 index.html。提取不到返回 ''。
 */
function extractTitleFromZip(zipEntries) {
  try {
    const indexEntries = zipEntries.filter((e) => {
      if (e.isDirectory) return false;
      const name = e.entryName;
      if (name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
      return /(^|\/)index\.html$/i.test(name);
    });
    if (indexEntries.length === 0) return '';
    // 路径层级最浅的优先(最接近根)
    indexEntries.sort(
      (a, b) => a.entryName.split('/').length - b.entryName.split('/').length
    );
    const html = indexEntries[0].getData().toString('utf8');
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return '';
    // 去标签、压空白、解最常见的 HTML 实体
    let title = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    title = title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    return title.slice(0, 255);
  } catch (e) {
    return '';
  }
}

/**
 * 规范化网站 ID
 */
function normalizeWebsiteId(id) {
  if (typeof id === 'string' && /^[A-Z0-9]{8}$/.test(id)) {
    return id;
  }
  return generateWebsiteId();
}

function normalizePositiveId(id) {
  if (id === null || id === undefined || id === '') return null;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function normalizeVisibility(value) {
  return String(value || '').trim().toLowerCase() === VISIBILITY_PRIVATE
    ? VISIBILITY_PRIVATE
    : VISIBILITY_PUBLIC;
}

/**
 * 规范化文件名
 */
function normalizeFileNameNoExt(name) {
  try {
    const base = String(name || '').replace(/\.[^/.]+$/, '').toLowerCase();
    return /^[a-z0-9]+$/.test(base) ? base : 'dist';
  } catch {
    return 'dist';
  }
}

/**
 * 获取 Content-Type
 */
function getContentType(key) {
  const ext = (path.extname(key) || '').toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.txt': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf'
  };
  return types[ext];
}

/**
 * 获取缓存头
 */
function getCacheHeaders(key) {
  const ext = (path.extname(key) || '').toLowerCase();
  if (ext === '.html') {
    return { 'Cache-Control': 'no-cache, no-store, must-revalidate' };
  }
  return { 'Cache-Control': 'public, max-age=31536000, immutable' };
}

/**
 * 获取 CORS 头
 */
function getCORSHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}
