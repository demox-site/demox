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

  console.log('收到请求:', JSON.stringify({
    path: event.path,
    method: event.httpMethod,
    body: redactSensitiveFields(event.body)
  }, null, 2));

  try {
    // Database migrations are reachable only through a direct SCF Invoke payload.
    if (event.internalMigration === 'feishu_identity') {
      return await handleFeishuIdentityMigration(event);
    }

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
    } else if (path === '/auth/github/finalize' || event.body?.action === 'github_finalize') {
      return await handleGithubFinalize(event);
    } else if (path === '/auth/feishu' || event.body?.action === 'feishu') {
      return await handleFeishuLogin(event);
    } else if (path === '/auth/feishu/finalize' || event.body?.action === 'feishu_finalize') {
      return await handleFeishuFinalize(event);
    } else if (path === '/auth/me' || event.body?.action === 'me') {
      return await handleGetCurrentUser(event);
    } else if (path === '/auth/update-profile' || event.body?.action === 'update_profile') {
      return await handleUpdateProfile(event);
    } else if (path === '/auth/change-password' || event.body?.action === 'change_password') {
      return await handleChangePassword(event);
    } else if (path === '/auth/unbind-github' || event.body?.action === 'unbind_github') {
      return await handleUnbindGithub(event);
    } else if (path === '/auth/unbind-feishu' || event.body?.action === 'unbind_feishu') {
      return await handleUnbindFeishu(event);
    } else if (path === '/auth/migrate-nicknames' || event.body?.action === 'migrate_nicknames') {
      return await handleMigrateNicknames(event);
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
    if (error?.code === 'FEISHU_IDENTITY_CONFLICT') {
      return feishuIdentityConflictResponse();
    }
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

function redactSensitiveFields(body) {
  if (!body || typeof body !== 'object') return body;

  const sensitiveKeys = new Set([
    'password',
    'currentPassword',
    'newPassword',
    'code',
    'codeVerifier',
    'ticket',
    'token',
    'client_secret'
  ]);

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      sensitiveKeys.has(key) ? '[REDACTED]' : value
    ])
  );
}

/**
 * 处理用户注册
 */
async function handleRegister(event) {
  const { email, password } = event.body || event;
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail || !password) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: email 和 password' })
    };
  }

  // 检查邮箱是否已存在
  const existingUsers = await query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
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
  const nickname = defaultNicknameFromEmail(cleanEmail);

  // 插入用户
  await query(
    'INSERT INTO users (id, email, password_hash, email_verified, nickname) VALUES (?, ?, ?, FALSE, ?)',
    [userId, cleanEmail, passwordHash, nickname]
  );

  // 分配默认角色
  await query(
    'INSERT INTO user_roles (user_id, roles) VALUES (?, ?)',
    [userId, JSON.stringify(['user'])]
  );

  // 生成token
  const token = sign({ userId, email: cleanEmail });

  return {
    statusCode: 201,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      token,
      userId,
      email: cleanEmail,
      nickname,
      message: '注册成功'
    })
  };
}

/**
 * 处理用户登录
 */
async function handleLogin(event) {
  const { email, password } = event.body || event;
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail || !password) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: email 和 password' })
    };
  }

  // 查询用户
  const users = await query('SELECT id, email, password_hash, nickname FROM users WHERE email = ?', [cleanEmail]);
  if (users.length === 0) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '邮箱或密码错误' })
    };
  }

  const user = users[0];
  const nickname = await ensureUserNickname(user);

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
      nickname,
      message: '登录成功'
    })
  };
}

/**
 * 发送验证码
 */
async function handleSendCode(event) {
  const { email, type = 'login' } = event.body || event;
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: email' })
    };
  }

  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '邮箱格式不正确' })
    };
  }

  // 检查发送频率限制（1分钟内只能发1次）
  const recentCodes = await query(
    'SELECT id FROM verification_codes WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
    [cleanEmail]
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
  await query('DELETE FROM verification_codes WHERE email = ? AND used_at IS NULL', [cleanEmail]);

  // 保存验证码（使用 MySQL 的 DATE_ADD 函数设置过期时间，避免时区问题）
  await query(
    'INSERT INTO verification_codes (email, code, type, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))',
    [cleanEmail, code, type]
  );

  // 发送邮件（使用腾讯云 SES 或其他邮件服务）
  const emailSent = await sendEmail(cleanEmail, code, type);

  if (!emailSent) {
    // 如果邮件发送失败，仍然返回成功（开发阶段）
    // 生产环境应该返回错误
    console.log('邮件发送失败，验证码:', code);
  }

  console.log(`验证码已生成: ${cleanEmail} -> ${code}`);

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
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail || !code) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: email 和 code' })
    };
  }

  // 查询验证码
  const codes = await query(
    'SELECT * FROM verification_codes WHERE email = ? AND code = ? AND used_at IS NULL AND expires_at > NOW()',
    [cleanEmail, code]
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
  const users = await query('SELECT id, email, nickname FROM users WHERE email = ?', [cleanEmail]);

  let user;
  let isNewUser = false;

  if (users.length === 0) {
    // 新用户，自动注册
    isNewUser = true;
    const userId = generateUserId();
    const nickname = defaultNicknameFromEmail(cleanEmail);

    await query(
      'INSERT INTO users (id, email, email_verified, password_hash, nickname) VALUES (?, ?, TRUE, ?, ?)',
      [userId, cleanEmail, '', nickname] // 验证码登录的用户没有密码
    );

    // 分配默认角色
    await query(
      'INSERT INTO user_roles (user_id, roles) VALUES (?, ?)',
      [userId, JSON.stringify(['user'])]
    );

    user = { id: userId, email: cleanEmail, nickname };
  } else {
    user = users[0];
    user.nickname = await ensureUserNickname(user);

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
      nickname: user.nickname,
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
  const nickname =
    normalizeNickname(ghUser.name || ghUser.login) ||
    defaultNicknameFromEmail(ghEmail || `gh_${githubId}@users.noreply.github.com`);

  return await resolveGithubUser(event, { githubId, githubLogin, avatarUrl, nickname, ghEmail });
}

/**
 * 完成 GitHub 关联选择：用前一步签发的 github_ticket 完成
 * 「创建新账号」或「关联到已有账号」。
 * - choice='create'：用票据里的 GitHub 资料新建账号并登录
 * - choice='link'：要求 Authorization(原账号 token)，把票据里的 github_id 绑到当前账号
 */
async function handleGithubFinalize(event) {
  const { ticket, choice } = event.body || event;

  if (!ticket || !choice) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: ticket 和 choice' })
    };
  }

  // 校验票据
  let payload;
  try {
    payload = verify(ticket);
  } catch (e) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '关联票据无效或已过期，请重新发起 GitHub 授权' })
    };
  }

  if (payload.kind !== 'github_link' || !payload.githubId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '关联票据格式错误' })
    };
  }

  const { githubId, githubLogin, avatarUrl, nickname, ghEmail } = payload;
  const cleanGithubNickname =
    normalizeNickname(nickname) ||
    defaultNicknameFromEmail(ghEmail || `gh_${githubId}@users.noreply.github.com`);

  // 该 github_id 在选择期间可能已被占用，统一先查一次
  const owned = await query('SELECT id FROM users WHERE github_id = ?', [githubId]);

  if (choice === 'create') {
    if (owned.length > 0) {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '该 GitHub 账号已被使用，请改为登录' })
      };
    }
    const userId = generateUserId();
    const email = normalizeEmail(ghEmail) || `gh_${githubId}@users.noreply.github.com`;
    await query(
      'INSERT INTO users (id, email, password_hash, email_verified, github_id, github_login, avatar_url, nickname) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, email, '', ghEmail ? true : false, githubId, githubLogin, avatarUrl, cleanGithubNickname]
    );
    await query('INSERT INTO user_roles (user_id, roles) VALUES (?, ?)', [userId, JSON.stringify(['user'])]);
    const token = sign({ userId, email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        token,
        userId,
        email,
        nickname: cleanGithubNickname,
        isNewUser: true,
        message: '注册成功'
      })
    };
  }

  if (choice === 'link') {
    // 必须证明原账号所有权：带原账号 token
    const current = authenticate(event);
    if (!current) {
      return {
        statusCode: 401,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '请先登录要关联的账号' })
      };
    }
    // github_id 是否已被别的账号占用
    if (owned.length > 0 && owned[0].id !== current.userId) {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '该 GitHub 账号已绑定到其他用户' })
      };
    }
    await query(
      `UPDATE users
       SET github_id = ?,
           github_login = ?,
           avatar_url = COALESCE(?, avatar_url),
           nickname = CASE WHEN nickname IS NULL OR TRIM(nickname) = '' THEN ? ELSE nickname END
       WHERE id = ?`,
      [githubId, githubLogin, avatarUrl, cleanGithubNickname, current.userId]
    );
    const users = await query('SELECT id, email, nickname FROM users WHERE id = ?', [current.userId]);
    const user = users[0] || {};
    const finalNickname = await ensureUserNickname(user);
    const token = sign({ userId: current.userId, email: user.email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        bound: true,
        token,
        userId: current.userId,
        email: user.email,
        nickname: finalNickname,
        message: 'GitHub 账号关联成功'
      })
    };
  }

  return {
    statusCode: 400,
    headers: getCORSHeaders(),
    body: JSON.stringify({ error: '无效的 choice，应为 create 或 link' })
  };
}

/**
 * 根据 GitHub 资料定位/创建用户并签发 JWT。
 * 匹配优先级：github_id > 邮箱。
 * 若请求带有效 Authorization，则进入「绑定」模式，把 GitHub 账号挂到当前用户。
 */
async function resolveGithubUser(event, profile) {
  const { githubId, githubLogin, avatarUrl, nickname, ghEmail } = profile;
  const cleanGithubNickname =
    normalizeNickname(nickname) ||
    defaultNicknameFromEmail(ghEmail || `gh_${githubId}@users.noreply.github.com`);

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
      `UPDATE users
       SET github_id = ?,
           github_login = ?,
           avatar_url = COALESCE(?, avatar_url),
           nickname = CASE WHEN nickname IS NULL OR TRIM(nickname) = '' THEN ? ELSE nickname END
       WHERE id = ?`,
      [githubId, githubLogin, avatarUrl, cleanGithubNickname, current.userId]
    );
    const users = await query('SELECT id, email, nickname FROM users WHERE id = ?', [current.userId]);
    const user = users[0] || {};
    const finalNickname = await ensureUserNickname(user);
    const token = sign({ userId: current.userId, email: user.email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        bound: true,
        token,
        userId: current.userId,
        email: user.email,
        nickname: finalNickname,
        message: 'GitHub 账号绑定成功'
      })
    };
  }

  // 登录模式 1：github_id 已绑定某账号 → 回头客，直接登录
  let users = await query('SELECT id, email, nickname FROM users WHERE github_id = ?', [githubId]);
  if (users.length > 0) {
    const user = users[0];
    // 资料回填（头像/昵称可能更新）
    await query(
      `UPDATE users
       SET github_login = ?,
           avatar_url = COALESCE(?, avatar_url),
           nickname = CASE WHEN nickname IS NULL OR TRIM(nickname) = '' THEN ? ELSE nickname END
       WHERE id = ?`,
      [githubLogin, avatarUrl, cleanGithubNickname, user.id]
    );
    user.nickname = await ensureUserNickname(user);
    const token = sign({ userId: user.id, email: user.email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        token,
        userId: user.id,
        email: user.email,
        nickname: user.nickname,
        isNewUser: false,
        message: '登录成功'
      })
    };
  }

  // github_id 无主：不自动建号，签发短期票据让前端引导用户选择
  // （创建新账号 / 关联到已有账号）。统一处理，无论邮箱是否匹配。
  const ticket = sign(
    { kind: 'github_link', githubId, githubLogin, avatarUrl, nickname: cleanGithubNickname, ghEmail: ghEmail || null },
    '5m'
  );

  // 按 GitHub 邮箱探测是否已有账号，仅用于前端提示（回脱敏邮箱）
  let matchedAccount = { exists: false, emailMasked: null };
  if (ghEmail) {
    const byEmail = await query('SELECT email FROM users WHERE email = ?', [ghEmail]);
    if (byEmail.length > 0) {
      matchedAccount = { exists: true, emailMasked: maskEmail(byEmail[0].email) };
    }
  }

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      needsChoice: true,
      githubTicket: ticket,
      githubEmail: ghEmail || null,
      matchedAccount
    })
  };
}

/**
 * 飞书 OAuth 登录 / 绑定。授权码使用 PKCE 校验，服务端只保存 Demox 登录态，
 * 不保存飞书 user_access_token 或 refresh_token。
 */
async function handleFeishuLogin(event) {
  const { code, codeVerifier } = event.body || event;

  if (!code || !codeVerifier) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: code 和 codeVerifier' })
    };
  }

  if (!isValidPkceVerifier(codeVerifier)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: 'PKCE codeVerifier 格式错误' })
    };
  }

  const clientId = process.env.FEISHU_APP_ID;
  const clientSecret = process.env.FEISHU_APP_SECRET;
  const redirectUri = process.env.FEISHU_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '服务端未配置飞书 OAuth' })
    };
  }

  if (!isValidRedirectUri(redirectUri)) {
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '服务端未配置有效的飞书 OAuth 回调地址' })
    };
  }

  let userAccessToken;
  try {
    const tokenResp = await httpsJson({
      method: 'POST',
      hostname: 'accounts.feishu.cn',
      path: '/oauth/v3/token',
      bodyType: 'json'
    }, {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });

    if (tokenResp.code !== 0 || !tokenResp.access_token) {
      return {
        statusCode: 401,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          error: '飞书授权失败: ' + (tokenResp.error_description || tokenResp.msg || tokenResp.error || '未知错误')
        })
      };
    }
    userAccessToken = tokenResp.access_token;
  } catch (e) {
    return {
      statusCode: 502,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无法连接飞书授权服务: ' + e.message })
    };
  }

  let feishuUser;
  try {
    const userResp = await httpsJson({
      method: 'GET',
      hostname: 'open.feishu.cn',
      path: '/open-apis/authen/v1/user_info',
      headers: { Authorization: `Bearer ${userAccessToken}` }
    });

    if (userResp.code !== 0 || !userResp.data?.open_id) {
      return {
        statusCode: 401,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '无法获取飞书用户信息: ' + (userResp.msg || '未知错误') })
      };
    }
    feishuUser = userResp.data;
  } catch (e) {
    return {
      statusCode: 502,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无法获取飞书用户信息: ' + e.message })
    };
  }

  const openId = String(feishuUser.open_id);
  const unionId = feishuUser.union_id ? String(feishuUser.union_id) : null;
  const feishuName = normalizeNickname(feishuUser.name || feishuUser.en_name).slice(0, 80) || '飞书用户';
  const avatarUrl = feishuUser.avatar_url || feishuUser.avatar_middle || null;

  return await resolveFeishuUser(event, { openId, unionId, feishuName, avatarUrl });
}

async function handleFeishuFinalize(event) {
  const { ticket, choice } = event.body || event;

  if (!ticket || !choice) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: ticket 和 choice' })
    };
  }

  let payload;
  try {
    payload = verify(ticket);
  } catch (e) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '关联票据无效或已过期，请重新发起飞书授权' })
    };
  }

  if (payload.kind !== 'feishu_link' || !payload.openId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '关联票据格式错误' })
    };
  }

  const { openId, unionId, feishuName, avatarUrl } = payload;
  const cleanFeishuName = normalizeNickname(feishuName).slice(0, 80) || '飞书用户';
  const owned = await findFeishuUser(openId, unionId);
  if (owned.length > 1) {
    return feishuIdentityConflictResponse();
  }

  if (choice === 'create') {
    if (owned.length > 0) {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '该飞书账号已被使用，请改为登录' })
      };
    }

    const userId = generateUserId();
    const email = feishuSyntheticEmail(openId);
    try {
      await transaction(async (conn) => {
        await conn.execute(
          `INSERT INTO users
           (id, email, password_hash, email_verified, feishu_open_id, feishu_union_id, feishu_name, avatar_url, nickname)
           VALUES (?, ?, ?, FALSE, ?, ?, ?, ?, ?)`,
          [userId, email, '', openId, unionId || null, cleanFeishuName, avatarUrl || null, cleanFeishuName]
        );
        await conn.execute(
          'INSERT INTO user_roles (user_id, roles) VALUES (?, ?)',
          [userId, JSON.stringify(['user'])]
        );
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return {
          statusCode: 409,
          headers: getCORSHeaders(),
          body: JSON.stringify({ error: '该飞书账号已被使用，请改为登录' })
        };
      }
      throw error;
    }

    const token = sign({ userId, email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        token,
        userId,
        email,
        nickname: cleanFeishuName,
        isNewUser: true,
        message: '注册成功'
      })
    };
  }

  if (choice === 'link') {
    const current = authenticate(event);
    if (!current) {
      return {
        statusCode: 401,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '请先登录要关联的账号' })
      };
    }
    if (owned.length > 0 && owned[0].id !== current.userId) {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '该飞书账号已绑定到其他用户' })
      };
    }

    await bindFeishuIdentity(current.userId, {
      openId,
      unionId,
      feishuName: cleanFeishuName,
      avatarUrl
    });
    const users = await query('SELECT id, email, nickname FROM users WHERE id = ?', [current.userId]);
    const user = users[0] || {};
    const nickname = await ensureUserNickname(user);
    const token = sign({ userId: current.userId, email: user.email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        bound: true,
        token,
        userId: current.userId,
        email: user.email,
        nickname,
        message: '飞书账号关联成功'
      })
    };
  }

  return {
    statusCode: 400,
    headers: getCORSHeaders(),
    body: JSON.stringify({ error: '无效的 choice，应为 create 或 link' })
  };
}

async function resolveFeishuUser(event, profile) {
  const { openId, unionId, feishuName, avatarUrl } = profile;
  const current = authenticate(event);
  const owned = await findFeishuUser(openId, unionId);
  if (owned.length > 1) {
    return feishuIdentityConflictResponse();
  }

  if (current) {
    if (owned.length > 0 && owned[0].id !== current.userId) {
      return {
        statusCode: 409,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '该飞书账号已绑定到其他用户' })
      };
    }

    await bindFeishuIdentity(current.userId, profile);
    const users = await query('SELECT id, email, nickname FROM users WHERE id = ?', [current.userId]);
    const user = users[0] || {};
    const nickname = await ensureUserNickname(user);
    const token = sign({ userId: current.userId, email: user.email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        bound: true,
        token,
        userId: current.userId,
        email: user.email,
        nickname,
        message: '飞书账号绑定成功'
      })
    };
  }

  if (owned.length > 0) {
    const user = owned[0];
    await bindFeishuIdentity(user.id, profile);
    user.nickname = await ensureUserNickname(user);
    const token = sign({ userId: user.id, email: user.email });
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        token,
        userId: user.id,
        email: user.email,
        nickname: user.nickname,
        isNewUser: false,
        message: '登录成功'
      })
    };
  }

  const ticket = sign({
    kind: 'feishu_link',
    openId,
    unionId: unionId || null,
    feishuName,
    avatarUrl: avatarUrl || null
  }, '5m');

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      needsChoice: true,
      feishuTicket: ticket,
      feishuName
    })
  };
}

async function findFeishuUser(openId, unionId) {
  const conditions = ['feishu_open_id = ?'];
  const params = [openId];
  if (unionId) {
    conditions.push('feishu_union_id = ?');
    params.push(unionId);
  }

  return await query(
    `SELECT id, email, nickname
     FROM users
     WHERE ${conditions.join(' OR ')}`,
    params
  );
}

function feishuIdentityConflictResponse() {
  return {
    statusCode: 409,
    headers: getCORSHeaders(),
    body: JSON.stringify({ error: '飞书身份绑定冲突，请联系管理员处理' })
  };
}

async function bindFeishuIdentity(userId, profile) {
  const cleanFeishuName = normalizeNickname(profile.feishuName).slice(0, 80) || '飞书用户';
  try {
    await query(
      `UPDATE users
       SET feishu_open_id = ?,
           feishu_union_id = COALESCE(?, feishu_union_id),
           feishu_name = ?,
           avatar_url = COALESCE(?, avatar_url),
           nickname = CASE WHEN nickname IS NULL OR TRIM(nickname) = '' THEN ? ELSE nickname END,
           updated_at = NOW()
       WHERE id = ?`,
      [
        profile.openId,
        profile.unionId || null,
        cleanFeishuName,
        profile.avatarUrl || null,
        cleanFeishuName,
        userId
      ]
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      const conflict = new Error('Feishu identity conflict');
      conflict.code = 'FEISHU_IDENTITY_CONFLICT';
      throw conflict;
    }
    throw error;
  }
}

function feishuSyntheticEmail(openId) {
  const crypto = require('crypto');
  const digest = crypto.createHash('sha256').update(String(openId)).digest('hex').slice(0, 32);
  return `feishu_${digest}@users.noreply.demox.site`;
}

function isValidPkceVerifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function isValidRedirectUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * 邮箱脱敏：前两位 + ... + 最后一位 @ 域名
 */
function maskEmail(email) {
  if (!email || email.indexOf('@') === -1) return null;
  const [name, domain] = email.split('@');
  const masked = name.length > 2 ? `${name.slice(0, 2)}...${name.slice(-1)}` : name;
  return `${masked}@${domain}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeNickname(value) {
  return String(value || '').trim();
}

function defaultNicknameFromEmail(email) {
  const cleanEmail = normalizeEmail(email);
  const prefix = cleanEmail.includes('@') ? cleanEmail.split('@')[0] : cleanEmail;
  return normalizeNickname(prefix).slice(0, 80) || 'user';
}

async function ensureUserNickname(user) {
  const existing = normalizeNickname(user?.nickname);
  if (existing) return existing;

  const fallback = defaultNicknameFromEmail(user?.email);
  if (user?.id) {
    await query(
      `UPDATE users
       SET nickname = ?
       WHERE id = ? AND (nickname IS NULL OR TRIM(nickname) = '')`,
      [fallback, user.id]
    );
  }
  return fallback;
}

/**
 * 极简 HTTPS JSON 请求工具（避免引入额外依赖）。
 * options: { method, hostname, path, headers, bodyType }
 * body: 对象。默认按 form 发送；bodyType='json' 时按 JSON 发送。
 */
function httpsJson(options, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    let payload = null;
    const headers = { ...(options.headers || {}) };

    if (body && options.method === 'POST') {
      const isJson = options.bodyType === 'json';
      payload = isJson ? JSON.stringify(body) : new URLSearchParams(body).toString();
      headers['Content-Type'] = isJson
        ? 'application/json; charset=utf-8'
        : 'application/x-www-form-urlencoded';
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
    `SELECT id, email, email_verified, github_id, github_login,
            feishu_open_id, feishu_name, avatar_url, nickname, created_at
     FROM users WHERE id = ?`,
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
  const nickname = await ensureUserNickname(userData);

  // 获取用户角色（MySQL JSON 列可能已被驱动解析为数组，也可能是字符串）
  const roles = await query('SELECT roles FROM user_roles WHERE user_id = ?', [user.userId]);
  let userRoles = ['user'];
  if (roles.length > 0 && roles[0].roles != null) {
    const r = roles[0].roles;
    userRoles = Array.isArray(r) ? r : (typeof r === 'string' ? JSON.parse(r) : r);
  }

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
        feishuOpenId: userData.feishu_open_id,
        feishuName: userData.feishu_name,
        avatarUrl: userData.avatar_url,
        nickname,
        roles: userRoles,
        createdAt: userData.created_at
      }
    })
  };
}

/**
 * 更新当前用户资料
 */
async function handleUpdateProfile(event) {
  const current = authenticate(event);
  if (!current) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const rawNickname = String((event.body || event).nickname || '').trim();
  if (!rawNickname) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '昵称不能为空' })
    };
  }

  if (rawNickname.length > 80) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '昵称不能超过80个字符' })
    };
  }

  await query('UPDATE users SET nickname = ?, updated_at = NOW() WHERE id = ?', [rawNickname, current.userId]);

  const users = await query(
    `SELECT id, email, email_verified, github_id, github_login,
            feishu_open_id, feishu_name, avatar_url, nickname, created_at
     FROM users WHERE id = ?`,
    [current.userId]
  );

  if (users.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '用户不存在' })
    };
  }

  const userData = users[0];
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
        feishuOpenId: userData.feishu_open_id,
        feishuName: userData.feishu_name,
        avatarUrl: userData.avatar_url,
        nickname: userData.nickname,
        createdAt: userData.created_at
      },
      nickname: userData.nickname,
      message: '资料已更新'
    })
  };
}

/**
 * 修改当前用户密码
 * body: { currentPassword, newPassword }
 */
async function handleChangePassword(event) {
  const current = authenticate(event);
  if (!current) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { currentPassword, newPassword } = event.body || event;

  if (!currentPassword || !newPassword) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '请输入当前密码与新密码' })
    };
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '新密码长度需在 8-128 个字符之间' })
    };
  }

  const users = await query('SELECT password_hash FROM users WHERE id = ?', [current.userId]);
  if (users.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '用户不存在' })
    };
  }

  const storedHash = users[0].password_hash;
  if (!storedHash) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '当前账号未设置密码，请先通过忘记密码流程设置' })
    };
  }

  const valid = await bcrypt.compare(currentPassword, storedHash);
  if (!valid) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '当前密码错误' })
    };
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [newHash, current.userId]);

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '密码已更新'
    })
  };
}

/**
 * 解绑当前用户的 GitHub 账号
 * 安全约束：仅当用户已设置密码（password_hash 非空）时才允许解绑，
 * 避免解绑后账号无法登录。
 */
async function handleUnbindGithub(event) {
  const current = authenticate(event);
  if (!current) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const users = await query('SELECT password_hash, github_id FROM users WHERE id = ?', [current.userId]);
  if (users.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '用户不存在' })
    };
  }

  const userData = users[0];
  if (!userData.github_id) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '当前账号未绑定 GitHub' })
    };
  }

  if (!userData.password_hash) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '当前账号未设置密码，解绑后将无法登录，请先设置密码' })
    };
  }

  await query(
    'UPDATE users SET github_id = NULL, github_login = NULL, updated_at = NOW() WHERE id = ?',
    [current.userId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: 'GitHub 已解绑'
    })
  };
}

/**
 * 解绑飞书账号。沿用 GitHub 的保守约束：账号必须已设置密码，避免解绑后失去登录入口。
 */
async function handleUnbindFeishu(event) {
  const current = authenticate(event);
  if (!current) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const users = await query('SELECT password_hash, feishu_open_id FROM users WHERE id = ?', [current.userId]);
  if (users.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '用户不存在' })
    };
  }

  const userData = users[0];
  if (!userData.feishu_open_id) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '当前账号未绑定飞书' })
    };
  }

  if (!userData.password_hash) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '当前账号未设置密码，解绑后将无法登录，请先设置密码' })
    };
  }

  await query(
    `UPDATE users
     SET feishu_open_id = NULL, feishu_union_id = NULL, feishu_name = NULL, updated_at = NOW()
     WHERE id = ?`,
    [current.userId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '飞书已解绑'
    })
  };
}

/**
 * 幂等补充飞书身份字段。只接受直接 SCF Invoke 的顶层标记，避免暴露公网迁移入口。
 */
async function handleFeishuIdentityMigration(event) {
  const columnDefinitions = [
    {
      name: 'feishu_open_id',
      ddl: "ADD COLUMN feishu_open_id VARCHAR(128) DEFAULT NULL COMMENT '飞书应用内用户唯一标识'"
    },
    {
      name: 'feishu_union_id',
      ddl: "ADD COLUMN feishu_union_id VARCHAR(128) DEFAULT NULL COMMENT '飞书开发者维度用户唯一标识'"
    },
    {
      name: 'feishu_name',
      ddl: "ADD COLUMN feishu_name VARCHAR(255) DEFAULT NULL COMMENT '飞书用户名称'"
    }
  ];
  const indexDefinitions = [
    {
      name: 'uniq_feishu_open_id',
      column: 'feishu_open_id',
      ddl: 'ADD UNIQUE KEY uniq_feishu_open_id (feishu_open_id)'
    },
    {
      name: 'uniq_feishu_union_id',
      column: 'feishu_union_id',
      ddl: 'ADD UNIQUE KEY uniq_feishu_union_id (feishu_union_id)'
    }
  ];

  const columnsBefore = await query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME IN ('feishu_open_id', 'feishu_union_id', 'feishu_name')`
  );
  const indexesBefore = await query(
    `SELECT DISTINCT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND INDEX_NAME IN ('uniq_feishu_open_id', 'uniq_feishu_union_id')`
  );
  const tableStats = await query(
    `SELECT TABLE_ROWS
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  if (tableStats.length === 0) {
    throw new Error('目标数据库缺少 users 表');
  }

  const existingColumns = new Set(columnsBefore.map((row) => row.COLUMN_NAME));
  const existingIndexes = new Set(indexesBefore.map((row) => row.INDEX_NAME));
  const duplicateGroups = {};

  for (const definition of indexDefinitions) {
    if (existingColumns.has(definition.column) && !existingIndexes.has(definition.name)) {
      const duplicates = await query(
        `SELECT COUNT(*) AS count
         FROM (
           SELECT ${definition.column}
           FROM users
           WHERE ${definition.column} IS NOT NULL
           GROUP BY ${definition.column}
           HAVING COUNT(*) > 1
         ) AS duplicate_groups`
      );
      duplicateGroups[definition.column] = Number(duplicates[0]?.count || 0);
    } else {
      duplicateGroups[definition.column] = 0;
    }
  }

  if (Object.values(duplicateGroups).some((count) => count > 0)) {
    return {
      statusCode: 409,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        error: '飞书身份字段存在重复值，无法安全建立唯一索引',
        duplicateGroups
      })
    };
  }

  const missingColumns = columnDefinitions.filter((item) => !existingColumns.has(item.name));
  const missingIndexes = indexDefinitions.filter((item) => !existingIndexes.has(item.name));
  const alterClauses = [
    ...missingColumns.map((item) => item.ddl),
    ...missingIndexes.map((item) => item.ddl)
  ];

  if (event.dryRun !== true && alterClauses.length > 0) {
    await query(`ALTER TABLE users\n  ${alterClauses.join(',\n  ')}`);
  }

  let verified = false;
  if (event.dryRun !== true) {
    const columnsAfter = await query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('feishu_open_id', 'feishu_union_id', 'feishu_name')`
    );
    const indexesAfter = await query(
      `SELECT DISTINCT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
         AND INDEX_NAME IN ('uniq_feishu_open_id', 'uniq_feishu_union_id')`
    );
    const finalColumns = new Set(columnsAfter.map((row) => row.COLUMN_NAME));
    const finalIndexes = new Set(indexesAfter.map((row) => row.INDEX_NAME));
    verified = columnDefinitions.every((item) => finalColumns.has(item.name)) &&
      indexDefinitions.every((item) => finalIndexes.has(item.name));
    if (!verified) throw new Error('飞书身份数据库迁移后校验失败');
  }

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      dryRun: event.dryRun === true,
      estimatedRows: Number(tableStats[0]?.TABLE_ROWS || 0),
      changesRequired: alterClauses.length,
      addedColumns: event.dryRun === true ? [] : missingColumns.map((item) => item.name),
      addedIndexes: event.dryRun === true ? [] : missingIndexes.map((item) => item.name),
      plannedColumns: missingColumns.map((item) => item.name),
      plannedIndexes: missingIndexes.map((item) => item.name),
      duplicateGroups,
      verified
    })
  };
}

/**
 * 一次性补齐历史账号昵称。
 * 仅允许通过 SCF Invoke 传入顶层 internalMigration，公网 HTTP 请求无法设置该顶层字段。
 */
async function handleMigrateNicknames(event) {
  if (event.internalMigration !== true) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限执行迁移' })
    };
  }

  const before = await query(
    `SELECT COUNT(*) AS count
     FROM users
     WHERE (nickname IS NULL OR TRIM(nickname) = '')
       AND email IS NOT NULL
       AND email <> ''`
  );

  const result = await query(
    `UPDATE users
     SET nickname = COALESCE(NULLIF(LEFT(SUBSTRING_INDEX(email, '@', 1), 80), ''), 'user')
     WHERE (nickname IS NULL OR TRIM(nickname) = '')
       AND email IS NOT NULL
       AND email <> ''`
  );

  const after = await query(
    `SELECT COUNT(*) AS count
     FROM users
     WHERE (nickname IS NULL OR TRIM(nickname) = '')
       AND email IS NOT NULL
       AND email <> ''`
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      before: Number(before[0]?.count || 0),
      affectedRows: result.affectedRows || 0,
      after: Number(after[0]?.count || 0)
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
