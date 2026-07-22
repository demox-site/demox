const https = require('https');

class FeishuDirectoryError extends Error {
  constructor(message, code = null, details = null) {
    super(message);
    this.name = 'FeishuDirectoryError';
    this.code = code;
    this.details = details;
  }
}

function requestJson({ method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = https.request({
      method,
      hostname: 'open.feishu.cn',
      path,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      },
      timeout: 10000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (error) {
          reject(new FeishuDirectoryError(`飞书通讯录返回了无效响应（HTTP ${res.statusCode}）`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('飞书通讯录请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createFeishuDirectoryClient({ appId, appSecret, request = requestJson }) {
  let tokenCache = null;
  let departmentsCache = null;
  let usersCache = null;

  async function getTenantToken() {
    if (!appId || !appSecret) {
      throw new FeishuDirectoryError('服务端未配置飞书通讯录凭据', 'DIRECTORY_NOT_CONFIGURED');
    }
    if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
    const response = await request({
      method: 'POST',
      path: '/open-apis/auth/v3/tenant_access_token/internal',
      body: { app_id: appId, app_secret: appSecret }
    });
    if (response.code !== 0 || !response.tenant_access_token) {
      throw new FeishuDirectoryError(response.msg || '无法获取飞书 tenant_access_token', response.code, response.error);
    }
    tokenCache = {
      token: response.tenant_access_token,
      expiresAt: Date.now() + Math.max(60, Number(response.expire || 3600)) * 1000
    };
    return tokenCache.token;
  }

  async function api(method, path, body = null) {
    const token = await getTenantToken();
    const response = await request({
      method,
      path,
      body,
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.code !== 0) {
      throw new FeishuDirectoryError(response.msg || '飞书通讯录请求失败', response.code, response.error);
    }
    return response.data || {};
  }

  async function getUser(openId) {
    const id = String(openId || '').trim();
    if (!/^ou_[A-Za-z0-9_-]+$/.test(id)) throw new FeishuDirectoryError('无效的飞书 open_id', 'INVALID_OPEN_ID');
    const data = await api(
      'GET',
      `/open-apis/contact/v3/users/${encodeURIComponent(id)}?user_id_type=open_id&department_id_type=open_department_id`
    );
    return data.user || null;
  }

  async function resolveUserByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new FeishuDirectoryError('请输入有效的飞书登录邮箱', 'INVALID_EMAIL');
    }
    const data = await api(
      'POST',
      '/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id',
      { emails: [normalized] }
    );
    const match = (data.user_list || []).find((item) => item.user_id && !item.status?.is_resigned);
    if (!match) throw new FeishuDirectoryError('未找到该飞书用户；企业邮箱不能用于此接口，请输入用户的飞书登录邮箱', 'USER_NOT_FOUND');
    const user = await getUser(match.user_id);
    return {
      openId: match.user_id,
      name: user?.name || user?.en_name || normalized,
      email: match.email || normalized,
      avatarUrl: user?.avatar?.avatar_72 || user?.avatar?.avatar_240 || null,
      departmentIds: Array.isArray(user?.department_ids) ? user.department_ids : []
    };
  }

  async function getDepartment(openDepartmentId) {
    const id = String(openDepartmentId || '').trim();
    if (!/^od-[A-Za-z0-9_-]+$/.test(id)) {
      throw new FeishuDirectoryError('无效的飞书 open_department_id', 'INVALID_DEPARTMENT_ID');
    }
    const data = await api(
      'GET',
      `/open-apis/contact/v3/departments/${encodeURIComponent(id)}?department_id_type=open_department_id&user_id_type=open_id`
    );
    return data.department || null;
  }

  async function listDepartments({ force = false } = {}) {
    if (!force && departmentsCache && departmentsCache.expiresAt > Date.now()) return departmentsCache.items;
    const items = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        department_id_type: 'open_department_id',
        user_id_type: 'open_id',
        fetch_child: 'true',
        page_size: '50'
      });
      if (pageToken) params.set('page_token', pageToken);
      const data = await api('GET', `/open-apis/contact/v3/departments/0/children?${params.toString()}`);
      items.push(...(data.items || []).filter((item) => item.open_department_id && !item.status?.is_deleted));
      pageToken = data.has_more ? String(data.page_token || '') : '';
    } while (pageToken && items.length < 5000);
    departmentsCache = { items, expiresAt: Date.now() + 5 * 60 * 1000 };
    return items;
  }

  async function listUsers({ force = false } = {}) {
    if (!force && usersCache && usersCache.expiresAt > Date.now()) return usersCache.items;

    const departments = await listDepartments({ force });
    const departmentIds = ['0', ...departments.map((item) => item.open_department_id).filter(Boolean)];
    const usersById = new Map();

    async function loadDepartmentUsers(departmentId) {
      let pageToken = '';
      do {
        const params = new URLSearchParams({
          department_id: departmentId,
          department_id_type: 'open_department_id',
          user_id_type: 'open_id',
          page_size: '50'
        });
        if (pageToken) params.set('page_token', pageToken);
        const data = await api('GET', `/open-apis/contact/v3/users/find_by_department?${params.toString()}`);
        for (const user of data.items || []) {
          if (user.open_id && !user.status?.is_resigned) usersById.set(user.open_id, user);
        }
        pageToken = data.has_more ? String(data.page_token || '') : '';
      } while (pageToken && usersById.size < 5000);
    }

    // Keep pressure on Feishu bounded for tenants with a large department tree.
    for (let offset = 0; offset < departmentIds.length && usersById.size < 5000; offset += 5) {
      await Promise.all(departmentIds.slice(offset, offset + 5).map(loadDepartmentUsers));
    }

    const items = Array.from(usersById.values()).slice(0, 5000);
    usersCache = { items, expiresAt: Date.now() + 5 * 60 * 1000 };
    return items;
  }

  async function getDepartmentAncestors(departmentId) {
    const ancestors = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        department_id: departmentId,
        department_id_type: 'open_department_id',
        user_id_type: 'open_id',
        page_size: '50'
      });
      if (pageToken) params.set('page_token', pageToken);
      const data = await api('GET', `/open-apis/contact/v3/departments/parent?${params.toString()}`);
      ancestors.push(...(data.items || []).map((item) => item.open_department_id).filter(Boolean));
      pageToken = data.has_more ? String(data.page_token || '') : '';
    } while (pageToken);
    return ancestors;
  }

  async function getUserDepartmentClosure(openId) {
    const user = await getUser(openId);
    if (!user) throw new FeishuDirectoryError('飞书用户不存在', 'USER_NOT_FOUND');
    const directIds = Array.isArray(user.department_ids) ? user.department_ids.filter(Boolean) : [];
    const closure = new Set(directIds);
    for (const departmentId of directIds) {
      const ancestors = await getDepartmentAncestors(departmentId);
      ancestors.forEach((id) => closure.add(id));
    }
    return {
      user,
      directDepartmentIds: directIds,
      departmentIds: Array.from(closure)
    };
  }

  return {
    getTenantToken,
    getUser,
    resolveUserByEmail,
    getDepartment,
    listDepartments,
    listUsers,
    getDepartmentAncestors,
    getUserDepartmentClosure
  };
}

module.exports = {
  FeishuDirectoryError,
  createFeishuDirectoryClient,
  requestJson
};
