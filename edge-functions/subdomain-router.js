/**
 * EdgeOne 边缘函数：subdomain-router
 * ---------------------------------------------------------------------------
 * 作用：处理 *.demox.site 的访问。每个站点默认域名 = <websiteId 小写>.demox.site，
 * 另可选配一个自定义前缀。两者都查同一张路由表(websites 表):
 *   {label}.demox.site → 调 website-api /resolve-subdomain 查 label→path
 *   (label 匹配 websites.subdomain 或 LOWER(website_id))→ 回源 /{path}/{rest}
 * 结果走边缘 Cache(默认 60s)。旧的 sites-{userId}-{fileId}-{dir} 格式已废弃。
 *
 * 路由表用现有 MySQL，不用 KV(标准版 EdgeOne 边缘函数无法绑定 Pages KV,
 * 但支持 fetch 子请求)。
 *
 * 部署/共存策略：
 *   - 与旧函数 ef-7ej45f3q 都匹配 host=*.demox.site；本函数接管该规则。
 *   - 回滚：把触发规则的 FunctionId 改回 ef-7ej45f3q。
 */

// website-api 解析接口（SCF HTTP 触发器）
var RESOLVE_API = 'https://1307257815-3empxtnzn9.ap-guangzhou.tencentscf.com/resolve-subdomain';
var RESOLVE_CACHE_TTL = 60; // 秒

// 自托管 demox 主站（作为被 demox 托管的站点 EPX2UU43，发布走 demox cli，不再走 GitHub Actions→COS 根）：
//   - apex demox.site：301 跳转到 www.demox.site（保留 path+query，OAuth code 不丢）。
//   - www.demox.site：优先走路由表（DB websites.subdomain='www' → path）；
//     resolve 失败时用 WWW_FALLBACK_PATH 兜底，绝不放行回源已清空的桶根。
var APEX_HOST = 'demox.site';        // 跳转源
var WWW_HOST = 'www.demox.site';     // 主站承载域名
var WWW_FALLBACK_PATH = 'sites/1985655011013808129/EPX2UU43/dist'; // www 兜底 path（改绑主站时同步改 DB 与此）

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

  // 0a) apex demox.site → 301 跳转到 www（保留 path+query，OAuth callback 的 code 不丢）
  if (host === APEX_HOST) {
    const target = 'https://' + WWW_HOST + u.pathname + u.search;
    return new Response(null, {
      status: 301,
      headers: { 'Location': target, 'Cache-Control': 'no-cache' }
    });
  }

  // www.demox.site 不写死：label='www' 走下方通用路由表逻辑（DB websites.subdomain='www'）
  // 只处理 xxx.demox.site 这种单层子域名；多层放行回源
  const m = host.match(/^([^.]+)\.demox\.site$/);
  if (!m) return fetch(req);

  const label = m[1];
  const rest = u.pathname.replace(/^\/+/, '');

  // 查路由表：label 可能是站点默认域名(websiteId 小写)或自定义前缀。
  // 经 website-api resolve + 边缘 Cache。
  let path = await resolvePath(label);

  // www 是主站基础设施(自托管 demox 本身)，path 固定。
  // resolvePath 偶发失败(SCF 抖动)时绝不放行回源桶根(桶根已清空会白屏)，
  // 用硬编码兜底。改绑主站时同时改 DB 与此常量。
  if (!path && label === 'www') {
    path = WWW_FALLBACK_PATH;
  }

  if (path) {
    return rewriteOrigin(req, u, `/${path}/${rest}`);
  }

  // 未知子域名：放行回源（由 COS 返回 404）
  return fetch(req);
}
