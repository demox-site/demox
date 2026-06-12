const bcrypt = require('bcryptjs');
const { query, transaction } = require('./shared/db.cjs');
const { sign, verify, authenticate, generateUserId, generateRandomString } = require('./shared/jwt.cjs');

/**
 * SCF云函数入口
 */
exports.main = async (event, context) => {
  // 解析 body（HTTP 触发器传递的是字符串）
  if (typeof event.body === 'string') {
    try {
      event.body = JSON.parse(event.body);
    } catch (e) {
      event.body = {};
    }
  }

  console.log('收到请求:', JSON.stringify({ path: event.path, method: event.httpMethod, body: event.body }, null, 2));

  try {
    // 路由分发
    const path = event.path || event.body?.path || event.queryString?.path || '/';
    const method = event.httpMethod || 'POST';

    // 处理OPTIONS预检请求
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: ''
      };
    }

    // 路由匹配
    if (path === '/auth/register' || event.body?.action === 'register') {
      return await handleRegister(event);
    } else if (path === '/auth/login' || event.body?.action === 'login') {
      return await handleLogin(event);
    } else if (path === '/auth/send-code' || event.body?.action === 'send_code') {
      return await handleSendCode(event);
    } else if (path === '/auth/login-code' || event.body?.action === 'login_code') {
      return await handleLoginWithCode(event);
    } else if (path === '/auth/github' || event.body?.action === 'github') {
      return await handleGithubLogin(event);
    } else if (path === '/auth/me' || event.body?.action === 'me') {
      return await handleGetCurrentUser(event);
    } else if (path === '/auth/verify' || event.body?.action === 'verify') {
      return await handleVerifyToken(event);
    } else if (path === '/auth/refresh' || event.body?.action === 'refresh') {
      return await handleRefreshToken(event);
    } else if (path === '/oauth/authorize' || event.body?.action === 'oauth_authorize') {
      return await handleOAuthAuthorize(event);
    } else if (path === '/oauth/token' || event.body?.action === 'oauth_token') {
      return await handleOAuthToken(event);
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
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      })
    };
  }
};

/**
 * 处理用户注册
 */
async function handleRegister(event) {
  const { email, password } = event.body || event;

  if (!email || !password) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: email 和 password' })
    };
  }

  // 检查邮箱是否已存在
  const existingUsers = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existingUsers.length > 0) {
    return {
      statusCode: 409,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '邮箱已被注册' })
    };
  }

  // 加密密码
  const passwordHash = await bcrypt.hash(password, 10);
  const userId = generateUserId();

  // 插入用户
  await query(
    'INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, FALSE)',
    [userId, email, passwordHash]
  );

  // 分配默认角色
  await query(
    'INSERT INTO user_roles (user_id, roles) VALUES (?, ?)',
    [userId, JSON.stringify(['user'])]
  );

  // 生成token
  const token = sign({ userId, email });

  return {
    statusCode: 201,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      token,
      userId,
      email,
      message: '注册成功'
    })
  };
}

/**
 * 处理用户登录
 */
async function handleLogin(event) {
  const { email, password } = event.body || event;

  if (!email || !password) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: email 和 password' })
    };
  }

  // 查询用户
  const users = await query('SELECT id, email, password_hash FROM users WHERE email = ?', [email]);
  if (users.length === 0) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '邮箱或密码错误' })
    };
  }

  const user = users[0];

  // 验证密码
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '邮箱或密码错误' })
    };
  }

  // 生成token
  const token = sign({ userId: user.id, email: user.email });

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      token,
      userId: user.id,
      email: user.email,
      message: '登录成功'
    })
  };
}

/**
 * 发送验证码
 */
async function handleSendCode(event) {
  const { email, type = 'login' } = event.body || event;

  if (!email) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: email' })
    };
  }

  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '邮箱格式不正确' })
    };
  }

  // 检查发送频率限制（1分钟内只能发1次）
  const recentCodes = await query(
    'SELECT id FROM verification_codes WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
    [email]
  );

  if (recentCodes.length > 0) {
    return {
      statusCode: 429,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '发送过于频繁，请1分钟后重试' })
    };
  }

  // 生成6位验证码
  const code = Math.random().toString().slice(-6);

  // 删除该邮箱之前的未使用验证码
  await query('DELETE FROM verification_codes WHERE email = ? AND used_at IS NULL', [email]);

  // 保存验证码（使用 MySQL 的 DATE_ADD 函数设置过期时间，避免时区问题）
  await query(
    'INSERT INTO verification_codes (email, code, type, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [email, code, type]
  );

  // 发送邮件（使用腾讯云 SES 或其他邮件服务）
  const emailSent = await sendEmail(email, code, type);

  if (!emailSent) {
    // 如果邮件发送失败，仍然返回成功（开发阶段）
    // 生产环境应该返回错误
    console.log('邮件发送失败，验证码:', code);
  }

  console.log(`验证码已生成: ${email} -> ${code}`);

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '验证码已发送，请查收邮件',
      // 开发环境返回验证码（生产环境需删除）
      _debug_code: process.env.NODE_ENV === 'development' ? code : undefined
    })
  };
}

/**
 * 验证码登录/注册
 */
async function handleLoginWithCode(event) {
  const { email, code } = event.body || event;

  if (!email || !code) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: email 和 code' })
    };
  }

  // 查询验证码
  const codes = await query(
    'SELECT * FROM verification_codes WHERE email = ? AND code = ? AND used_at IS NULL AND expires_at > NOW()',
    [email, code]
  );

  if (codes.length === 0) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '验证码无效或已过期' })
    };
  }

  // 标记验证码已使用
  await query('UPDATE verification_codes SET used_at = NOW() WHERE id = ?', [codes[0].id]);

  // 查询用户是否存在
  const users = await query('SELECT id, email FROM users WHERE email = ?', [email]);

  let user;
  let isNewUser = false;

  if (users.length === 0) {
    // 新用户，自动注册
    isNewUser = true;
    const userId = generateUserId();

    await query(
      'INSERT INTO users (id, email, email_verified, password_hash) VALUES (?, ?, TRUE, ?)',
      [userId, email, ''] // 验证码登录的用户没有密码
    );

    // 分配默认角色
    await query(
      'INSERT INTO user_roles (user_id, roles) VALUES (?, ?)',
      [userId, JSON.stringify(['user'])]
    );

    user = { id: userId, email };
  } else {
    user = users[0];

    // 更新邮箱验证状态
    await query('UPDATE users SET email_verified = TRUE WHERE id = ?', [user.id]);
  }

  // 生成token
  const token = sign({ userId: user.id, email: user.email });

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      token,
      userId: user.id,
      email: user.email,
      isNewUser,
      message: isNewUser ? '注册成功' : '登录成功'
    })
  };
}

/**
 * GitHub OAuth 登录 / 绑定
 * 前端拿到 GitHub 回调的 code 后调用本接口。
 * - 未登录：用 GitHub 账号登录或自动注册，返回 JWT
 * - 已登录（带 Authorization）：把 GitHub 账号绑定到当前用户
 */
async function handleGithubLogin(event) {
  const { code } = event.body || event;

  if (!code) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: code' })
    };
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '服务端未配置 GitHub OAuth' })
    };
  }

  // 1. 用 code 换取 GitHub access_token
  let ghToken;
  try {
    const tokenResp = await httpsJson({
      method: 'POST',
      hostname: 'github.com',
      path: '/login/oauth/access_token',
      headers: { Accept: 'application/json' }
    }, { client_id: clientId, client_secret: clientSecret, code });

    if (tokenResp.error || !tokenResp.access_token) {
      return {
        statusCode: 401,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: 'GitHub 授权失败: ' + (tokenResp.error_description || tokenResp.error || '未知错误') })
      };
    }
    ghToken = tokenResp.access_token;
  } catch (e) {
    return {
      statusCode: 502,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无法连接 GitHub: ' + e.message })
    };
  }

  // 2. 拉取 GitHub 用户信息
  let ghUser, ghEmail;
  try {
    ghUser = await httpsJson({
      method: 'GET',
      hostname: 'api.github.com',
      path: '/user',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${ghToken}`,
        'User-Agent': 'demox-auth'
      }
    });

    ghEmail = ghUser.email;
    // 公开邮箱可能为空，再拉一次 emails 取主邮箱
    if (!ghEmail) {
      const emails = await httpsJson({
        method: 'GET',
        hostname: 'api.github.com',
        path: '/user/emails',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${ghToken}`,
          'User-Agent': 'demox-auth'
        }
      });
      if (Array.isArray(emails)) {
        const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
        ghEmail = primary ? primary.email : null;
      }
    }
  } catch (e) {
    return {
      statusCode: 502,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无法获取 GitHub 用户信息: ' + e.message })
    };
  }

  const githubId = String(ghUser.id);
  const githubLogin = ghUser.login;
  const avatarUrl = ghUser.avatar_url || null;
  const nickname = ghUser.name || ghUser.login || null;

  return await resolveGithubUser(event, { githubId, githubLogin, avatarUrl, nickname, ghEmail });
}

/**
 * 根据 GitHub 资料定位/创建用户并签发 JWT。
 * 匹配优先级：github_id > 邮箱。
 * 若请求带有效 Authorization，则进入「绑定」模式，把 GitHub 账号挂到当前用户。
 */
async function resolveGithubUser(event, profile) {
  const { githubId, githubLogin, avatarUrl, nickname, ghEmail } = profile;

  // 绑定模式：已登录用户把 GitHub 账号绑定到自身
  const current = authenticate(event);
  if (current) {
    // 该 GitHub 账号是否已被别的用户占用
    const taken = await query('SELECT id FROM users WHERE github_id = ? AND id != ?', [githubId, current.userId]);
    if (taken.length > 0) {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '该 GitHub 账号已绑定到其他用户' })
      };
    }
    await query(
      'UPDATE users SET github_id = ?, github_login = ?, avatar_url = COALESCE(?, avatar_url), nickname = COALESCE(nickname, ?) WHERE id = ?',
      [githubId, githubLogin, avatarUrl, nickname, current.userId]
    );
    const users = await query('SELECT id, email FROM users WHERE id = ?', [current.userId]);
    const token = sign({ userId: current.userId, email: users[0]?.email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        bound: true,
        token,
        userId: current.userId,
        email: users[0]?.email,
        message: 'GitHub 账号绑定成功'
      })
    };
  }

  // 登录模式 1：按 github_id 匹配已有用户
  let users = await query('SELECT id, email FROM users WHERE github_id = ?', [githubId]);
  let user;
  let isNewUser = false;

  if (users.length > 0) {
    user = users[0];
    // 资料回填（头像/昵称可能更新）
    await query(
      'UPDATE users SET github_login = ?, avatar_url = COALESCE(?, avatar_url), nickname = COALESCE(nickname, ?) WHERE id = ?',
      [githubLogin, avatarUrl, nickname, user.id]
    );
  } else if (ghEmail) {
    // 登录模式 2：按邮箱匹配已有账号并补绑 GitHub
    const byEmail = await query('SELECT id, email FROM users WHERE email = ?', [ghEmail]);
    if (byEmail.length > 0) {
      user = byEmail[0];
      await query(
        'UPDATE users SET github_id = ?, github_login = ?, avatar_url = COALESCE(?, avatar_url), nickname = COALESCE(nickname, ?), email_verified = TRUE WHERE id = ?',
        [githubId, githubLogin, avatarUrl, nickname, user.id]
      );
    }
  }

  // 登录模式 3：全新用户，自动注册
  if (!user) {
    isNewUser = true;
    const userId = generateUserId();
    // GitHub 未公开邮箱时用占位邮箱，保证 email 非空约束
    const email = ghEmail || `gh_${githubId}@users.noreply.github.com`;

    await query(
      'INSERT INTO users (id, email, password_hash, email_verified, github_id, github_login, avatar_url, nickname) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, email, '', ghEmail ? true : false, githubId, githubLogin, avatarUrl, nickname]
    );
    await query('INSERT INTO user_roles (user_id, roles) VALUES (?, ?)', [userId, JSON.stringify(['user'])]);
    user = { id: userId, email };
  }

  const token = sign({ userId: user.id, email: user.email });
  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      token,
      userId: user.id,
      email: user.email,
      isNewUser,
      message: isNewUser ? '注册成功' : '登录成功'
    })
  };
}

/**
 * 极简 HTTPS JSON 请求工具（避免引入额外依赖）。
 * options: { method, hostname, path, headers }
 * body: 对象。POST 时按 application/x-www-form-urlencoded 发送（GitHub token 接口要求）。
 */
function httpsJson(options, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    let payload = null;
    const headers = { ...(options.headers || {}) };

    if (body && options.method === 'POST') {
      payload = new URLSearchParams(body).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(
      { method: options.method, hostname: options.hostname, path: options.path, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            reject(new Error('响应解析失败: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('请求超时')));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 发送邮件（使用腾讯云 SES 模板）
 */
async function sendEmail(to, code, type) {
  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENT_SECRET_KEY;

  if (!secretId || !secretKey) {
    console.log('未配置腾讯云密钥，跳过邮件发送');
    console.log('验证码:', code, '| 邮箱:', to);
    return false;
  }

  try {
    const ses = require('tencentcloud-sdk-nodejs-ses').ses.v20201002;

    const client = new ses.Client({
      credential: { secretId, secretKey },
      region: 'ap-hongkong'
    });

    // 使用已审核通过的模板（模板ID: 137482）
    const result = await client.SendEmail({
      FromEmailAddress: 'noreply@mail.aigc.sx.cn',
      Destination: [to],
      Subject: '【Demox】验证码',
      Template: {
        TemplateID: 137482,
        TemplateData: JSON.stringify({ code: code })
      }
    });

    console.log(`邮件发送成功: ${to} | MessageId: ${result.MessageId}`);
    return true;
  } catch (error) {
    console.error('邮件发送失败:', error.message);
    console.log('验证码:', code, '| 邮箱:', to);
    return false;
  }
}

/**
 * 获取当前用户信息
 */
async function handleGetCurrentUser(event) {
  // 验证token
  const user = authenticate(event);
  if (!user) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const users = await query(
    'SELECT id, email, email_verified, github_id, github_login, avatar_url, nickname, created_at FROM users WHERE id = ?',
    [user.userId]
  );

  if (users.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '用户不存在' })
    };
  }

  const userData = users[0];

  // 获取用户角色
  const roles = await query('SELECT roles FROM user_roles WHERE user_id = ?', [user.userId]);
  const userRoles = roles.length > 0 ? JSON.parse(roles[0].roles) : ['user'];

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      user: {
        id: userData.id,
        email: userData.email,
        emailVerified: userData.email_verified,
        githubId: userData.github_id,
        githubLogin: userData.github_login,
        avatarUrl: userData.avatar_url,
        nickname: userData.nickname,
        roles: userRoles,
        createdAt: userData.created_at
      }
    })
  };
}

/**
 * 验证token
 */
async function handleVerifyToken(event) {
  const user = authenticate(event);

  if (!user) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: 'Token无效或已过期' })
    };
  }

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      valid: true,
      userId: user.userId,
      email: user.email
    })
  };
}

/**
 * 刷新token
 */
async function handleRefreshToken(event) {
  const user = authenticate(event);

  if (!user) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: 'Token无效或已过期' })
    };
  }

  // 生成新token
  const newToken = sign({ userId: user.userId, email: user.email });

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      token: newToken
    })
  };
}

/**
 * OAuth 2.0 授权码模式 - 获取授权码
 */
async function handleOAuthAuthorize(event) {
  const { client_id, redirect_uri, response_type = 'code', scope, state } = event.body || event;

  // 验证token（获取当前用户）
  const user = authenticate(event);
  if (!user) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录' })
    };
  }

  // 验证客户端
  const clients = await query(
    'SELECT id, redirect_uris FROM oauth_clients WHERE id = ?',
    [client_id]
  );

  if (clients.length === 0) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '客户端验证失败' })
    };
  }

  const client = clients[0];
  // MySQL JSON类型会自动解析为JavaScript对象
  const redirectUris = Array.isArray(client.redirect_uris) ? client.redirect_uris : [client.redirect_uris];

  // 验证redirect_uri
  if (!redirectUris.includes(redirect_uri)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无效的回调地址' })
    };
  }

  // 生成授权码
  const code = generateRandomString(64);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分钟过期

  await query(
    `INSERT INTO oauth_auth_codes (code, user_id, client_id, redirect_uri, expires_at, scopes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [code, user.userId, client_id, redirect_uri, expiresAt, JSON.stringify(scope ? scope.split(' ') : [])]
  );

  // 返回授权码
  const authUrl = `${redirect_uri}?code=${code}${state ? '&state=' + state : ''}`;

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      code,
      redirect_uri: authUrl
    })
  };
}

/**
 * OAuth 2.0 授权码模式 - 交换访问令牌
 */
async function handleOAuthToken(event) {
  const { grant_type = 'authorization_code', code, client_id, client_secret, redirect_uri } = event.body || event;

  // 参数验证
  if (!code || !client_id || !client_secret || !redirect_uri) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数' })
    };
  }

  if (grant_type !== 'authorization_code') {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '不支持的授权类型' })
    };
  }

  // 验证客户端
  const clients = await query(
    'SELECT id FROM oauth_clients WHERE id = ? AND client_secret = ?',
    [client_id, client_secret]
  );

  if (clients.length === 0) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '客户端验证失败' })
    };
  }

  // 查询授权码
  const authCodes = await query(
    `SELECT user_id, scopes, expires_at FROM oauth_auth_codes
     WHERE code = ? AND client_id = ? AND redirect_uri = ?`,
    [code, client_id, redirect_uri]
  );

  if (authCodes.length === 0) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '授权码无效' })
    };
  }

  const authCode = authCodes[0];

  // 检查是否过期
  if (new Date(authCode.expires_at) < new Date()) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '授权码已过期' })
    };
  }

  // 删除已使用的授权码
  await query('DELETE FROM oauth_auth_codes WHERE code = ?', [code]);

  // MySQL JSON类型会自动解析为JavaScript对象
  const scopes = Array.isArray(authCode.scopes) ? authCode.scopes : [];

  // 生成访问令牌
  const accessToken = sign({
    userId: authCode.user_id,
    scopes: scopes
  }, '1h');

  const refreshToken = generateRandomString(64);
  const refreshTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天

  // 保存刷新令牌
  // MySQL JSON字段可以直接插入JavaScript数组
  await query(
    `INSERT INTO oauth_refresh_tokens (token, user_id, client_id, expires_at, scopes)
     VALUES (?, ?, ?, ?, ?)`,
    [refreshToken, authCode.user_id, client_id, refreshTokenExpiresAt, JSON.stringify(scopes)]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
      token_type: 'Bearer'
    })
  };
}

/**
 * 获取CORS响应头
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
