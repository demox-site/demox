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

// Backend URLs are read from EdgeOne environment variables for quick rollback.
var RESOLVE_CACHE_TTL = 60; // 秒
var VISIBILITY_PRIVATE = 'private';

// 自托管 demox 主站（作为被 demox 托管的站点 EPX2UU43，发布走 demox cli，不再走 GitHub Actions→COS 根）：
//   - apex demox.site：301 跳转到 www.demox.site（保留 path+query，OAuth code 不丢）。
//   - www.demox.site：优先走路由表（DB websites.subdomain='www' → path）；
//     resolve 失败时用 WWW_FALLBACK_PATH 兜底，绝不放行回源已清空的桶根。
var APEX_HOST = 'demox.site';        // 跳转源
var WWW_HOST = 'www.demox.site';     // 主站承载域名
var WWW_FALLBACK_PATH = 'sites/1985655011013808129/EPX2UU43/dist'; // www 兜底 path（改绑主站时同步改 DB 与此）
var DEMOX_BADGE_MARKER = 'data-demox-site-badge';
var DEMOX_AUTH_COOKIE = 'demox_access';

function runtimeEnv(name) {
  try {
    if (typeof env !== 'undefined' && env && env[name]) {
      return String(env[name]).replace(/\/+$/, '');
    }
  } catch (e) {}
  return '';
}

function requiredRuntimeEnv(name) {
  const value = runtimeEnv(name);
  if (!value) throw new Error('Missing EdgeOne environment variable: ' + name);
  return value;
}

function backendUrl(path) {
  return requiredRuntimeEnv('DEMOX_API_URL') + path;
}

function demoxHomeUrl() {
  return (runtimeEnv('DEMOX_HOME_URL') || ('https://' + WWW_HOST)).replace(/\/+$/, '') + '/';
}

addEventListener('fetch', (event) => {
  // 异常时回源，避免整站 500
  event.passThroughOnException();
  event.respondWith(handle(event.request));
});

function buildOriginUrl(req, originPath, search, originHost) {
  const origin = new URL(req.url);
  // 多云：回源域由路由表的 origin_host 决定（每个桶绑定自己的回源域）。
  // 缺省(旧数据/默认桶/resolve 未返回 origin)回退到 sites.demox.site。
  origin.hostname = originHost || 'sites.demox.site';
  origin.pathname = originPath.replace(/\/+/g, '/');
  origin.search = search;
  return origin.toString();
}

// 判断 404 是否应回退到 SPA 的 index.html。
// 目标：让每个站点的体验等同于「独占一个桶根的 SPA 静态托管」(Netlify/Vercel 风格)。
//   - 页面导航请求(浏览器地址栏/刷新，Accept 优先 text/html) → 回退，前端路由接管。
//   - 静态资源请求(.js/.css/.png/.json…，或 fetch/XHR 的 */*) → 保持 404，
//     绝不把缺失的资源伪装成 HTML(否则缺失的 chunk.js 返回 HTML，浏览器静默解析失败，极难排查)。
function shouldFallbackToIndex(req, originPath) {
  const last = (originPath.split('?')[0].split('/').pop() || '').toLowerCase();
  if (last.includes('.')) {
    // 带扩展名：只有 .html/.htm 当作页面，其余一律按静态资源处理(404 保持 404)
    return /\.html?$/.test(last);
  }
  // 无扩展名：看是不是浏览器导航请求(Accept 含 text/html)。
  // 资源/接口请求(Accept: */*、image/*、application/json 等)不回退。
  const accept = (req.headers.get('accept') || '').toLowerCase();
  return accept.includes('text/html');
}

async function rewriteOrigin(req, u, originPath, sitePath, originHost) {
  const resp = await fetch(buildOriginUrl(req, originPath, u.search, originHost), req);
  if (resp.status === 404 && sitePath && shouldFallbackToIndex(req, originPath)) {
    const idxResp = await fetch(buildOriginUrl(req, `/${sitePath}/index.html`, '', originHost), { method: 'GET' });
    if (idxResp.ok) {
      // SPA 入口用 200 返回，浏览器交给前端路由渲染(等同站点独占桶根的 fallback 行为)
      return withDemoxBadge(req, new Response(idxResp.body, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }
      }));
    }
  }
  return withDemoxBadge(req, resp);
}

function shouldInjectDemoxBadge(req, resp) {
  if (req.method !== 'GET' || resp.status !== 200) return false;
  const host = new URL(req.url).hostname.toLowerCase();
  if (host === WWW_HOST) return false;
  const type = (resp.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('text/html')) return false;
  const disposition = (resp.headers.get('content-disposition') || '').toLowerCase();
  return !disposition.includes('attachment');
}

function getDemoxBadgeHtml() {
  return `
<style data-demox-site-badge-style>
@media screen {
  a[${DEMOX_BADGE_MARKER}="link"] {
    position: fixed !important;
    left: max(14px, calc(env(safe-area-inset-left) + 12px)) !important;
    bottom: max(14px, calc(env(safe-area-inset-bottom) + 12px)) !important;
    z-index: 2147483647 !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    min-height: 34px !important;
    padding: 8px 11px 8px 10px !important;
    border-radius: 999px !important;
    border: 1px solid rgba(255,255,255,.18) !important;
    background: linear-gradient(135deg, rgba(5,22,40,.9), rgba(8,78,82,.86)) !important;
    color: #f8fffb !important;
    box-shadow: 0 14px 34px rgba(2,12,27,.22), inset 0 1px 0 rgba(255,255,255,.18) !important;
    -webkit-backdrop-filter: blur(14px) saturate(1.12) !important;
    backdrop-filter: blur(14px) saturate(1.12) !important;
    font-family: "Avenir Next", "Trebuchet MS", "Gill Sans", sans-serif !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    line-height: 1 !important;
    letter-spacing: .01em !important;
    text-decoration: none !important;
    text-transform: none !important;
    opacity: .94 !important;
    transition: transform .18s ease, opacity .18s ease, box-shadow .18s ease !important;
  }
  a[${DEMOX_BADGE_MARKER}="link"]::before {
    content: "" !important;
    width: 9px !important;
    height: 9px !important;
    border-radius: 999px !important;
    background: radial-gradient(circle at 35% 30%, #ffffff 0 12%, #7df9d4 13% 48%, #2bb5ff 49% 100%) !important;
    box-shadow: 0 0 16px rgba(125,249,212,.72) !important;
    flex: 0 0 auto !important;
  }
  a[${DEMOX_BADGE_MARKER}="link"]:hover {
    opacity: 1 !important;
    transform: translateY(-2px) !important;
    box-shadow: 0 18px 40px rgba(2,12,27,.28), inset 0 1px 0 rgba(255,255,255,.2) !important;
  }
  a[${DEMOX_BADGE_MARKER}="link"]:focus-visible {
    outline: 3px solid rgba(125,249,212,.86) !important;
    outline-offset: 3px !important;
  }
}
@media screen and (prefers-reduced-motion: no-preference) {
  a[${DEMOX_BADGE_MARKER}="link"] {
    animation: demoxBadgeRise .34s cubic-bezier(.2,.8,.2,1) both !important;
  }
  @keyframes demoxBadgeRise {
    from { opacity: 0; transform: translateY(8px) scale(.98); }
    to { opacity: .94; transform: translateY(0) scale(1); }
  }
}
@media print {
  a[${DEMOX_BADGE_MARKER}="link"] { display: none !important; }
}
</style>
<a ${DEMOX_BADGE_MARKER}="link" href="${DEMOX_HOME_URL}" target="_blank" rel="noopener noreferrer" aria-label="Go to Demox homepage">Powered by Demox</a>`;
}

function injectDemoxBadge(html) {
  if (!html || html.indexOf(DEMOX_BADGE_MARKER) !== -1) return html;
  const badge = getDemoxBadgeHtml();
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, function (match) {
      return badge + match;
    });
  }
  return html + badge;
}

async function withDemoxBadge(req, resp) {
  if (!shouldInjectDemoxBadge(req, resp)) return resp;

  const html = await resp.text();
  const headers = new Headers(resp.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  if (!(headers.get('content-type') || '').toLowerCase().includes('charset=')) {
    headers.set('content-type', 'text/html; charset=utf-8');
  }

  return new Response(injectDemoxBadge(html), {
    status: resp.status,
    statusText: resp.statusText,
    headers
  });
}

function getCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i].trim();
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    if (p.slice(0, eq) === name) {
      try {
        return decodeURIComponent(p.slice(eq + 1));
      } catch (e) {
        return p.slice(eq + 1);
      }
    }
  }
  return '';
}

function redirectToLogin(req) {
  const next = new URL(req.url);
  const target = new URL('/site-auth', 'https://' + WWW_HOST);
  target.searchParams.set('next', next.toString());
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      'Cache-Control': 'no-store'
    }
  });
}

function accessDeniedPage(req) {
  const host = new URL(req.url).hostname;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Access denied - Demox</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 20% 20%, rgba(45,212,191,.14), transparent 28rem),
        linear-gradient(135deg, #05070d, #101827 56%, #071512);
      color: #f8fafc;
      font-family: "Avenir Next", "Trebuchet MS", "Gill Sans", sans-serif;
    }
    main {
      width: min(92vw, 440px);
      padding: 34px;
      border: 1px solid rgba(148,163,184,.18);
      border-radius: 24px;
      background: rgba(2,6,23,.62);
      box-shadow: 0 24px 80px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.08);
      backdrop-filter: blur(18px);
      text-align: left;
    }
    .kicker {
      color: #7dd3fc;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1 {
      margin: 12px 0 10px;
      font-size: clamp(30px, 8vw, 48px);
      line-height: .95;
      letter-spacing: -.05em;
    }
    p {
      margin: 0;
      color: #94a3b8;
      line-height: 1.65;
      font-size: 15px;
    }
    a {
      display: inline-flex;
      margin-top: 24px;
      color: #020617;
      background: #f8fafc;
      border-radius: 999px;
      padding: 11px 15px;
      font-size: 13px;
      font-weight: 800;
      text-decoration: none;
    }
    code { color: #cbd5e1; }
  </style>
</head>
<body>
  <main>
    <div class="kicker">Private Demox site</div>
    <h1>Access denied</h1>
    <p>You are signed in, but your account does not have permission to view <code>${host}</code>.</p>
    <a href="${demoxHomeUrl()}">Go to Demox</a>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function checkPrivateSiteAccess(req, label) {
  const token = getCookie(req, DEMOX_AUTH_COOKIE);
  if (!token) return { allowed: false, loginRequired: true };

  try {
    const resp = await fetch(backendUrl('/check-site-access'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check_site_access', label: label, token: token })
    });
    if (!resp.ok) return { allowed: false, loginRequired: false };
    const data = await resp.json();
    return {
      allowed: !!(data && data.success && data.allowed),
      loginRequired: !!(data && data.loginRequired)
    };
  } catch (e) {
    return { allowed: false, loginRequired: false };
  }
}

/**
 * 查 label -> { path, origin }，带边缘缓存。
 * path = 桶内路径前缀；origin = 该站点所属桶的回源域(多云)，为空时回退默认回源域。
 * 用 caches.default 把解析结果缓存 RESOLVE_CACHE_TTL 秒，避免每请求打 SCF。
 */
async function resolveSite(label) {
  const cacheKey = new Request('https://resolve.demox.site/label/' + encodeURIComponent(label));
  let cache = null;
  try { cache = caches.default; } catch (e) { cache = null; }

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const j = await hit.json();
        return {
          path: j && j.path ? j.path : null,
          origin: (j && j.origin) || null,
          visibility: (j && j.visibility) || 'public'
        };
      }
    } catch (e) {}
  }

  // 未命中：调 website-api 解析
  let path = null;
  let origin = null;
  let visibility = 'public';
  try {
    const resp = await fetch(backendUrl('/resolve-subdomain'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve_subdomain', subdomain: label })
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.success && data.path) {
        path = data.path;
        origin = data.origin || null;
        visibility = data.visibility || 'public';
      }
    }
  } catch (e) {
    path = null;
  }

  // 写缓存（命中和未命中都缓存，未命中缓存空对象以挡住穿透）
  if (cache) {
    try {
      const body = JSON.stringify({ path: path, origin: origin, visibility: visibility });
      const cacheResp = new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=' + RESOLVE_CACHE_TTL
        }
      });
      await cache.put(cacheKey, cacheResp);
    } catch (e) {}
  }

  return { path: path, origin: origin, visibility: visibility };
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
  let rest = u.pathname.replace(/^\/+/, '');

  // 目录请求(根 / 或结尾 /)直接补 index.html，避免回源到「目录」让 COS 慢解析
  // index 文档(实测 www/ 比 www/index.html 慢 ~4s，且会触发回退二次 fetch)。
  if (rest === '' || rest.endsWith('/')) {
    rest += 'index.html';
  }

  // 查路由表：label 可能是站点默认域名(websiteId 小写)或自定义前缀。
  // 经 website-api resolve + 边缘 Cache。返回 { path, origin }(origin=该站点所属桶的回源域)。
  let { path, origin, visibility } = await resolveSite(label);

  // www 是主站基础设施(自托管 demox 本身)，path 固定。
  // resolveSite 偶发失败(SCF 抖动)时绝不放行回源桶根(桶根已清空会白屏)，
  // 用硬编码兜底。改绑主站时同时改 DB 与此常量。
  if (!path && label === 'www') {
    path = WWW_FALLBACK_PATH;
  }

  if (path) {
    if (label !== 'www' && visibility === VISIBILITY_PRIVATE) {
      const access = await checkPrivateSiteAccess(req, label);
      if (!access.allowed) {
        return access.loginRequired ? redirectToLogin(req) : accessDeniedPage(req);
      }
    }
    // origin 为空(旧数据/默认桶)时 buildOriginUrl 回退到 sites.demox.site
    return rewriteOrigin(req, u, `/${path}/${rest}`, path, origin);
  }

  // 未知子域名：放行回源（由 COS 返回 404）
  return fetch(req);
}
