/**
 * EdgeOne 边缘函数：subdomain-router
 * ---------------------------------------------------------------------------
 * 作用：处理 *.demox.site 的访问，支持两种子域名：
 *   1. 旧格式（向后兼容，零改动）：sites-{userId}-{fileId}-{dir}.demox.site
 *      → 回源 /sites/{userId}/{FILEID}/{dir}/{rest}
 *   2. 自定义前缀（新增）：{label}.demox.site
 *      → 调 website-api 解析接口查 label -> path（边缘 Cache 缓存），回源 /{path}/{rest}
 *
 * 路由表用现有 MySQL（websites.subdomain 列），不用 KV：
 *   标准版 EdgeOne 边缘函数无法绑定 Pages KV，但支持 fetch 子请求，
 *   所以查表走 website-api 的 /resolve-subdomain 接口 + 边缘 Cache（默认 60s）。
 *
 * 部署/共存策略：
 *   - 与旧函数 ef-7ej45f3q 都匹配 host=*.demox.site；本函数接管该规则。
 *   - 本函数内置旧正则逻辑，旧站点照常工作。
 *   - 回滚：把触发规则的 FunctionId 改回 ef-7ej45f3q。
 */

// website-api 解析接口（SCF HTTP 触发器）
var RESOLVE_API = 'https://1307257815-3empxtnzn9.ap-guangzhou.tencentscf.com/resolve-subdomain';
var RESOLVE_CACHE_TTL = 60; // 秒

addEventListener('fetch', (event) => {
  // 异常时回源，避免整站 500
  event.passThroughOnException();
  event.respondWith(handle(event.request));
});

function rewriteOrigin(req, u, originPath) {
  const origin = new URL(req.url);
  origin.hostname = 'sites.demox.site';
  origin.pathname = originPath.replace(/\/+/g, '/');
  origin.search = u.search;
  return fetch(origin.toString(), req);
}

/**
 * 查 label -> path，带边缘缓存。
 * 用 caches.default 把解析结果缓存 RESOLVE_CACHE_TTL 秒，避免每请求打 SCF。
 */
async function resolvePath(label) {
  const cacheKey = new Request('https://resolve.demox.site/label/' + encodeURIComponent(label));
  let cache = null;
  try { cache = caches.default; } catch (e) { cache = null; }

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const j = await hit.json();
        return j && j.path ? j.path : null;
      }
    } catch (e) {}
  }

  // 未命中：调 website-api 解析
  let path = null;
  try {
    const resp = await fetch(RESOLVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve_subdomain', subdomain: label })
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.success && data.path) path = data.path;
    }
  } catch (e) {
    path = null;
  }

  // 写缓存（命中和未命中都缓存，未命中缓存空对象以挡住穿透）
  if (cache) {
    try {
      const body = JSON.stringify({ path: path });
      const cacheResp = new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=' + RESOLVE_CACHE_TTL
        }
      });
      await cache.put(cacheKey, cacheResp);
    } catch (e) {}
  }

  return path;
}

async function handle(req) {
  const u = new URL(req.url);
  const host = u.hostname.toLowerCase();

  // 只处理 xxx.demox.site 这种单层子域名；apex/多层放行回源
  const m = host.match(/^([^.]+)\.demox\.site$/);
  if (!m) return fetch(req);

  const label = m[1];
  const rest = u.pathname.replace(/^\/+/, '');

  // 1) 向后兼容：旧的 sites-{userId}-{fileId}-{dir} 格式
  const legacy = host.match(/^sites-([^-]+)-([^-]+)-(.+)\.demox\.site$/);
  if (legacy) {
    const userId = legacy[1];
    const fileId = legacy[2].toUpperCase();
    const dir = legacy[3];
    return rewriteOrigin(req, u, `/sites/${userId}/${fileId}/${dir}/${rest}`);
  }

  // 2) 自定义前缀：查 MySQL 路由表（经 website-api + 边缘缓存）
  const path = await resolvePath(label);
  if (path) {
    return rewriteOrigin(req, u, `/${path}/${rest}`);
  }

  // 未知子域名：放行回源（由 COS 返回 404）
  return fetch(req);
}
