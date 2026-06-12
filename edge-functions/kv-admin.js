/**
 * EdgeOne 边缘函数：kv-admin
 * ---------------------------------------------------------------------------
 * 作用：给后端（website-api SCF）提供一个“写 KV”的内部入口。
 *       EdgeOne KV 只能在边缘函数内访问，没有对外 REST 写接口，
 *       所以由本函数承担写入，后端用共享密钥调用它。
 *
 * 部署要点（控制台）：
 *   1. 新建边缘函数，名称 kv-admin，粘贴本文件内容。
 *   2. 拓展服务 → 新增服务绑定 → KV 命名空间 ns-rHwjjy513D6S，
 *      变量名称填：ROUTES
 *   3. 运行时环境变量新增：KV_ADMIN_SECRET = <一段随机长字符串>
 *      （后端用同一个值调用本函数）
 *   4. 触发规则：建议绑定到一个独立内部域名，例如
 *      host equal kv-admin.demox.site（不要和 *.demox.site 业务路由冲突）。
 *
 * 调用约定（后端 → 本函数）：
 *   POST  body: { "action": "put", "key": "<host>", "value": { ... } }
 *   POST  body: { "action": "delete", "key": "<host>" }
 *   POST  body: { "action": "get", "key": "<host>" }
 *   Header: X-KV-Admin-Secret: <KV_ADMIN_SECRET>
 *
 * key 统一用自定义域名（小写 host），value 为 JSON：
 *   { "userId": "...", "websiteId": "...", "path": "sites/<userId>/<websiteId>/<dir>" }
 */

// 绑定 KV 命名空间后注入的全局变量名（ROUTES）。
// 环境变量通过全局 env 对象读取：env.KV_ADMIN_SECRET
/* global ROUTES, env */

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function handle(req) {
  if (req.method !== 'POST') {
    return json(405, { success: false, message: 'Method Not Allowed' });
  }

  // 共享密钥鉴权（环境变量通过全局 env 对象读取）
  const secret = req.headers.get('X-KV-Admin-Secret');
  if (!secret || secret !== env.KV_ADMIN_SECRET) {
    return json(401, { success: false, message: 'Unauthorized' });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { success: false, message: 'Invalid JSON body' });
  }

  const action = body && body.action;
  const key = body && body.key ? String(body.key).trim().toLowerCase() : '';

  if (!action) return json(400, { success: false, message: 'Missing action' });
  if (!key) return json(400, { success: false, message: 'Missing key' });

  try {
    if (action === 'put') {
      if (body.value === undefined || body.value === null) {
        return json(400, { success: false, message: 'Missing value' });
      }
      const value =
        typeof body.value === 'string' ? body.value : JSON.stringify(body.value);
      await ROUTES.put(key, value);
      return json(200, { success: true });
    }

    if (action === 'delete') {
      await ROUTES.delete(key);
      return json(200, { success: true });
    }

    if (action === 'get') {
      const value = await ROUTES.get(key);
      return json(200, { success: true, value });
    }

    return json(400, { success: false, message: `Unknown action: ${action}` });
  } catch (err) {
    return json(500, { success: false, message: err && err.message ? err.message : 'KV error' });
  }
}
