const https = require('https');

class GithubDirectoryError extends Error {
  constructor(message, code = null, details = null) {
    super(message);
    this.name = 'GithubDirectoryError';
    this.code = code;
    this.details = details;
  }
}

function requestJson({ method = 'GET', path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: 'api.github.com',
      path,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Demox-Website-API',
        'X-GitHub-Api-Version': '2022-11-28',
        ...headers
      },
      timeout: 10000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = {};
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            reject(new GithubDirectoryError(`GitHub 返回了无效响应（HTTP ${res.statusCode}）`, res.statusCode));
            return;
          }
        }
        parsed.__statusCode = res.statusCode;
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('GitHub 请求超时')));
    req.on('error', reject);
    req.end();
  });
}

function normalizeGithubUser(user) {
  if (!user || user.id == null || !user.login) return null;
  return {
    id: String(user.id),
    login: String(user.login),
    name: user.name || user.login,
    avatarUrl: user.avatar_url || null,
    htmlUrl: user.html_url || null
  };
}

function createGithubDirectoryClient({
  token = process.env.GITHUB_TOKEN,
  clientId = process.env.GITHUB_CLIENT_ID,
  clientSecret = process.env.GITHUB_CLIENT_SECRET,
  request = requestJson
} = {}) {
  function authHeaders() {
    if (token) return { Authorization: `Bearer ${token}` };
    if (clientId && clientSecret) {
      return {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      };
    }
    return {};
  }

  async function api(path) {
    const response = await request({
      method: 'GET',
      path,
      headers: authHeaders()
    });
    const status = Number(response.__statusCode || 0);
    if (status === 404) return null;
    if (status === 403 && /rate limit/i.test(String(response.message || ''))) {
      throw new GithubDirectoryError('GitHub 搜索次数过多，请稍后再试', 'RATE_LIMITED', response);
    }
    if (status >= 400) {
      throw new GithubDirectoryError(response.message || `GitHub 请求失败（HTTP ${status}）`, status, response);
    }
    return response;
  }

  async function getUserByLogin(login) {
    const handle = String(login || '').trim();
    if (!handle) return null;
    return normalizeGithubUser(await api(`/users/${encodeURIComponent(handle)}`));
  }

  async function getUserById(id) {
    const githubId = String(id || '').trim();
    if (!/^\d+$/.test(githubId)) return null;
    return normalizeGithubUser(await api(`/user/${githubId}`));
  }

  async function searchUsers(query) {
    const keyword = String(query || '').trim();
    if (!keyword) return [];
    const users = [];
    const seen = new Set();
    const push = (user) => {
      if (!user || seen.has(user.id)) return;
      seen.add(user.id);
      users.push(user);
    };

    if (/^[A-Za-z0-9-]{1,39}$/.test(keyword)) {
      push(await getUserByLogin(keyword));
    }

    const response = await api(`/search/users?q=${encodeURIComponent(keyword)}&per_page=20`);
    for (const item of response?.items || []) {
      push(normalizeGithubUser(item));
    }
    return users.slice(0, 20);
  }

  return { searchUsers, getUserById, getUserByLogin };
}

module.exports = {
  GithubDirectoryError,
  createGithubDirectoryClient
};
