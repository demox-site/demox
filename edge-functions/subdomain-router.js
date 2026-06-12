/**
 * EdgeOne 边缘函数：subdomain-router
 * ---------------------------------------------------------------------------
 * 作用：处理 *.demox.site 的访问，支持两种子域名：
 *   1. 旧格式（向后兼容，零改动）：sites-{userId}-{fileId}-{dir}.demox.site
 *      → 回源 /sites/{userId}/{FILEID}/{dir}/{rest}
 *   2. 自定义前缀（新增）：{label}.demox.site
 *      → 查 KV(ROUTES) 取 { path }，回源 /{path}/{rest}
 *
 * 部署/共存策略（重要）：
 *   - 本函数与旧函数 ef-7ej45f3q 都匹配 host=*.demox.site。
 *   - 给本函数的触发规则设更高优先级（Priority 数值更小/置顶），
 *     让它接管 *.demox.site；旧函数保持不动，作为即时回滚：
 *     只要把本函数的触发规则停用/删除，流量立刻回到旧函数。
 *   - 本函数已内置旧正则逻辑，所以接管后旧站点照常工作。
 *
 * 部署要点（控制台）：
 *   1. 新建边缘函数，名称 subdomain-router，粘贴本文件内容。
 *   2. 拓展服务 → 新增服务绑定 → KV 命名空间 ns-rHwjjy513D6S，变量名填 ROUTES。
 *   3. 触发规则：host equal *.demox.site，优先级高于 ef-7ej45f3q。
 */

/* global ROUTES */

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

  // 2) 自定义前缀：查 KV 路由表 label -> { userId, websiteId, path }
  let mapping = null;
  try {
    mapping = await ROUTES.get(label, 'json');
  } catch (e) {
    mapping = null;
  }
  if (mapping && mapping.path) {
    return rewriteOrigin(req, u, `/${mapping.path}/${rest}`);
  }

  // 未知子域名：放行回源（由 COS 返回 404）
  return fetch(req);
}
