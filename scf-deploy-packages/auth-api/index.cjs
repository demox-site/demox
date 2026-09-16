const bcrypt = require('bcryptjs');
const { query, transaction } = require('./shared/db.cjs');
const { sign, verify, authenticate, generateUserId, generateRandomString } = require('./shared/jwt.cjs');
const { membershipSummary } = require('./shared/membership.cjs');

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
    'code_verifier',
    'codeChallenge',
    'code_challenge',
    'ticket',
    'token',
    'refresh_token',
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

  if (!hasPasswordHash(user.password_hash)) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '该账号未设置密码，请使用验证码登录' })
    };
  }

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
    await query(
      'DELETE FROM verification_codes WHERE email = ? AND code = ? AND used_at IS NULL',
      [cleanEmail, code]
    );
    return {
      statusCode: 502,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '验证码邮件发送失败，请稍后重试' })
    };
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
  const users = await query('SELECT id, email, nickname, password_hash FROM users WHERE email = ?', [cleanEmail]);

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

    user = { id: userId, email: cleanEmail, nickname, password_hash: '' };
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
      hasPassword: hasPasswordHash(user.password_hash),
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
      // 用 400 而不是 401，避免前端把 OAuth 换票失败误判成「登录态失效」
      return {
        statusCode: 400,
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
  const { code, codeVerifier, codeChallenge } = event.body || event;

  if (!code) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: code' })
    };
  }

  const pkceEnabled = codeVerifier !== undefined || codeChallenge !== undefined;
  if (pkceEnabled && (!isValidPkceVerifier(codeVerifier) || !isValidPkceChallenge(codeChallenge))) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: 'PKCE 参数格式错误' })
    };
  }

  const computedChallenge = pkceEnabled ? createPkceChallenge(codeVerifier) : null;
  const challengeMatches = pkceEnabled && safeStringEqual(codeChallenge, computedChallenge);
  const pkceLog = pkceEnabled
    ? {
        pkceEnabled: true,
        verifierLength: codeVerifier.length,
        challengeFingerprint: computedChallenge.slice(0, 12),
        challengeMatches
      }
    : { pkceEnabled: false };

  if (pkceEnabled && !challengeMatches) {
    console.warn('飞书 PKCE 本地配对失败:', JSON.stringify(pkceLog));
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        error: 'PKCE 配对校验失败，请重新发起飞书登录',
        errorCode: 'PKCE_PAIR_MISMATCH'
      })
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
    const tokenRequest = {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    };
    if (pkceEnabled) tokenRequest.code_verifier = codeVerifier;

    const tokenResp = await httpsJson({
      method: 'POST',
      hostname: 'accounts.feishu.cn',
      path: '/oauth/v3/token',
      bodyType: 'json'
    }, tokenRequest);

    if (tokenResp.code !== 0 || !tokenResp.access_token) {
      const feishuCode = Number.isInteger(tokenResp.code) ? tokenResp.code : null;
      console.warn('飞书 token 兑换失败:', JSON.stringify({ ...pkceLog, feishuCode }));
      return {
        statusCode: 401,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          error: `飞书授权失败${feishuCode === null ? '' : ` (${feishuCode})`}: ` +
            (tokenResp.error_description || tokenResp.msg || tokenResp.error || '未知错误'),
          feishuCode
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
  const tenantKey = feishuUser.tenant_key ? String(feishuUser.tenant_key) : null;
  const feishuEmail = normalizeEmail(feishuUser.enterprise_email || feishuUser.email || '');
  const feishuName = normalizeNickname(feishuUser.name || feishuUser.en_name).slice(0, 80) || '飞书用户';
  const avatarUrl = feishuUser.avatar_url || feishuUser.avatar_middle || null;

  return await resolveFeishuUser(event, { openId, unionId, tenantKey, feishuEmail, feishuName, avatarUrl });
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

  const { openId, unionId, tenantKey, feishuEmail, feishuName, avatarUrl } = payload;
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
           (id, email, password_hash, email_verified, feishu_open_id, feishu_union_id,
            feishu_tenant_key, feishu_email, feishu_name, avatar_url, nickname)
           VALUES (?, ?, ?, FALSE, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, email, '', openId, unionId || null, tenantKey || null, feishuEmail || null,
            cleanFeishuName, avatarUrl || null, cleanFeishuName]
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
      tenantKey,
      feishuEmail,
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
  const { openId, unionId, tenantKey, feishuEmail, feishuName, avatarUrl } = profile;
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
    tenantKey: tenantKey || null,
    feishuEmail: feishuEmail || null,
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
           feishu_tenant_key = COALESCE(?, feishu_tenant_key),
           feishu_email = COALESCE(?, feishu_email),
           feishu_name = ?,
           avatar_url = COALESCE(?, avatar_url),
           nickname = CASE WHEN nickname IS NULL OR TRIM(nickname) = '' THEN ? ELSE nickname END,
           updated_at = NOW()
       WHERE id = ?`,
      [
        profile.openId,
        profile.unionId || null,
        profile.tenantKey || null,
        profile.feishuEmail || null,
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

function isValidPkceChallenge(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function createPkceChallenge(verifier) {
  return require('crypto').createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function safeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'ascii');
  const rightBuffer = Buffer.from(right, 'ascii');
  return leftBuffer.length === rightBuffer.length &&
    require('crypto').timingSafeEqual(leftBuffer, rightBuffer);
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

function hasPasswordHash(hash) {
  return typeof hash === 'string' && hash.length > 0;
}

function invalidNewPasswordMessage(newPassword) {
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    return '新密码长度需在 8-128 个字符之间';
  }
  return null;
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
  if (process.env.AUTH_EMAIL_DRY_RUN === '1') {
    console.log('AUTH_EMAIL_DRY_RUN=1，跳过真实发信');
    return true;
  }

  const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.TENCENT_SECRET_KEY;
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN || '';

  if (!secretId || !secretKey) {
    console.log('未配置腾讯云密钥，跳过邮件发送');
    console.log('验证码:', code, '| 邮箱:', to);
    return false;
  }

  try {
    const ses = require('tencentcloud-sdk-nodejs-ses').ses.v20201002;

    const client = new ses.Client({
      credential: { secretId, secretKey, token },
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
            feishu_open_id, feishu_name, avatar_url, nickname, created_at, password_hash
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

  // 角色按会员时效计算：过期 pro 不再出现在 roles 里，前端用 roles 判断权益即可。
  const roles = await query('SELECT * FROM user_roles WHERE user_id = ?', [user.userId]);
  const membership = membershipSummary(
    roles[0]?.roles || ['user'],
    roles[0]?.pro_expires_at
  );
  const userRoles = membership.effectiveRoles.length > 0 ? membership.effectiveRoles : ['user'];

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
        hasPassword: hasPasswordHash(userData.password_hash),
        roles: userRoles,
        membership: {
          hasPro: membership.hasPro,
          proExpired: membership.proExpired,
          proLifetime: membership.proLifetime,
          proExpiresAt: membership.proExpiresAt,
          remainingDays: membership.remainingDays
        },
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
 * 修改当前用户密码。验证码/第三方登录账号尚未设密时，只需提交新密码。
 * body: { currentPassword?, newPassword }
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

  if (!newPassword) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '请输入新密码' })
    };
  }

  const passwordError = invalidNewPasswordMessage(newPassword);
  if (passwordError) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: passwordError })
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
  const alreadyHasPassword = hasPasswordHash(storedHash);
  if (alreadyHasPassword) {
    if (!currentPassword) {
      return {
        statusCode: 400,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: '请输入当前密码' })
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
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [newHash, current.userId]);

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: alreadyHasPassword ? '密码已更新' : '密码已设置'
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
     SET feishu_open_id = NULL, feishu_union_id = NULL, feishu_tenant_key = NULL,
         feishu_email = NULL, feishu_name = NULL, updated_at = NOW()
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
    },
    {
      name: 'feishu_tenant_key',
      ddl: "ADD COLUMN feishu_tenant_key VARCHAR(128) DEFAULT NULL COMMENT '飞书租户唯一标识'"
    },
    {
      name: 'feishu_email',
      ddl: "ADD COLUMN feishu_email VARCHAR(255) DEFAULT NULL COMMENT '飞书认证邮箱'"
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
       AND COLUMN_NAME IN ('feishu_open_id', 'feishu_union_id', 'feishu_name', 'feishu_tenant_key', 'feishu_email')`
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
         AND COLUMN_NAME IN ('feishu_open_id', 'feishu_union_id', 'feishu_name', 'feishu_tenant_key', 'feishu_email')`
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

const OFFICIAL_OAUTH_CLIENT = Object.freeze({
  id: 'demox-mcp-client',
  redirectUris: Object.freeze(['http://localhost:39897/callback', 'http://localhost:*/callback']),
  scopes: Object.freeze(['website:deploy', 'website:list', 'website:delete', 'website:update'])
});
const OAUTH_ACCESS_TTL_SECONDS = 3600;
const OAUTH_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;

function oauthError(status, error, description) {
  return {
    statusCode: status,
    headers: getCORSHeaders(),
    body: JSON.stringify({ error, error_description: description, message: description })
  };
}

function oauthRedirectAllowed(patterns, redirectUri) {
  const value = String(redirectUri || '');
  return (patterns || []).some((pattern) => {
    if (String(pattern).includes('*')) {
      const regex = new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      return regex.test(value);
    }
    return pattern === value;
  });
}

function parseOAuthScopes(scope, allowed) {
  const scopes = [...new Set(String(scope || '').split(/\s+/).filter(Boolean))];
  const allowedScopes = allowed && allowed.length ? allowed : [...OFFICIAL_OAUTH_CLIENT.scopes];
  if (!scopes.length) return [...allowedScopes];
  if (scopes.some((item) => !allowedScopes.includes(item))) return null;
  return scopes;
}

function isMissingMysqlColumn(error) {
  return error?.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(String(error?.message || ''));
}

async function ensureOfficialOAuthClient() {
  await query(
    `INSERT INTO oauth_clients (id, client_secret, redirect_uris, scopes, client_name)
     VALUES (?, '', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       redirect_uris = VALUES(redirect_uris),
       scopes = VALUES(scopes),
       client_name = VALUES(client_name)`,
    [
      OFFICIAL_OAUTH_CLIENT.id,
      JSON.stringify(OFFICIAL_OAUTH_CLIENT.redirectUris),
      JSON.stringify(OFFICIAL_OAUTH_CLIENT.scopes),
      'Demox MCP / CLI'
    ]
  );
}

async function resolveOAuthClient(clientId) {
  if (clientId === OFFICIAL_OAUTH_CLIENT.id) {
    await ensureOfficialOAuthClient();
    return { id: OFFICIAL_OAUTH_CLIENT.id, public: true, redirectUris: [...OFFICIAL_OAUTH_CLIENT.redirectUris], scopes: [...OFFICIAL_OAUTH_CLIENT.scopes] };
  }
  const rows = await query('SELECT id, client_secret, redirect_uris, scopes FROM oauth_clients WHERE id = ?', [clientId]);
  if (!rows.length) return null;
  const row = rows[0];
  const redirectUris = Array.isArray(row.redirect_uris) ? row.redirect_uris : [];
  const scopes = Array.isArray(row.scopes) ? row.scopes : [...OFFICIAL_OAUTH_CLIENT.scopes];
  return {
    id: row.id,
    public: !row.client_secret,
    redirectUris,
    scopes,
    clientSecret: row.client_secret
  };
}

async function insertAuthCode({ code, userId, clientId, redirectUri, expiresAt, scopes, codeChallenge }) {
  const params = [code, userId, clientId, redirectUri, expiresAt, JSON.stringify(scopes), codeChallenge];
  try {
    await query(
      `INSERT INTO oauth_auth_codes (code, user_id, client_id, redirect_uri, expires_at, scopes, code_challenge)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params
    );
  } catch (error) {
    if (!isMissingMysqlColumn(error)) throw error;
    await query('ALTER TABLE oauth_auth_codes ADD COLUMN code_challenge VARCHAR(128) NULL');
    await query(
      `INSERT INTO oauth_auth_codes (code, user_id, client_id, redirect_uri, expires_at, scopes, code_challenge)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params
    );
  }
}

async function loadAuthCode(code, clientId, redirectUri) {
  try {
    return await query(
      `SELECT user_id, scopes, expires_at, code_challenge FROM oauth_auth_codes
       WHERE code = ? AND client_id = ? AND redirect_uri = ?`,
      [code, clientId, redirectUri]
    );
  } catch (error) {
    if (!isMissingMysqlColumn(error)) throw error;
    await query('ALTER TABLE oauth_auth_codes ADD COLUMN code_challenge VARCHAR(128) NULL');
    return loadAuthCode(code, clientId, redirectUri);
  }
}

function readScopeList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return value.split(/\s+/).filter(Boolean);
    }
  }
  return [];
}

async function issueOAuthTokens({ userId, clientId, scopes }) {
  const users = await query('SELECT id, email FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!users.length) return oauthError(400, 'invalid_grant', '授权用户不存在');
  const accessToken = sign({ userId, email: users[0].email, scopes }, `${OAUTH_ACCESS_TTL_SECONDS}s`);
  const refreshToken = generateRandomString(64);
  const refreshExpiresAt = new Date(Date.now() + OAUTH_REFRESH_TTL_SECONDS * 1000);
  await query(
    `INSERT INTO oauth_refresh_tokens (token, user_id, client_id, expires_at, scopes)
     VALUES (?, ?, ?, ?, ?)`,
    [refreshToken, userId, clientId, refreshExpiresAt, JSON.stringify(scopes)]
  );
  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: OAUTH_ACCESS_TTL_SECONDS,
      refresh_expires_in: OAUTH_REFRESH_TTL_SECONDS,
      token_type: 'Bearer',
      scope: scopes.join(' '),
      user_id: userId
    })
  };
}

/**
 * OAuth 2.0 授权码模式 - 发放授权码。Node CLI/MCP 只接受 code 回调。
 */
async function handleOAuthAuthorize(event) {
  const body = event.body || event;
  const clientId = body.client_id;
  const redirectUri = body.redirect_uri;
  const responseType = body.response_type || 'code';
  const state = body.state;
  const codeChallenge = body.code_challenge;
  const codeChallengeMethod = body.code_challenge_method;

  const user = authenticate(event);
  if (!user?.userId) return oauthError(401, 'login_required', '未登录');

  const client = await resolveOAuthClient(clientId);
  if (!client) return oauthError(401, 'invalid_client', '无效的客户端 ID');
  if (responseType !== 'code') return oauthError(400, 'unsupported_response_type', '仅支持 authorization code');
  if (!oauthRedirectAllowed(client.redirectUris, redirectUri)) {
    return oauthError(400, 'invalid_redirect_uri', '无效的回调地址');
  }
  const scopes = parseOAuthScopes(body.scope, client.scopes);
  if (!scopes) return oauthError(400, 'invalid_scope', 'OAuth scope 无效');
  if (!state || !/^[A-Za-z0-9._~-]{16,128}$/.test(state)) {
    return oauthError(400, 'invalid_state', 'OAuth state 格式无效');
  }
  if (client.public && (codeChallengeMethod !== 'S256' || !isValidPkceChallenge(codeChallenge))) {
    return oauthError(400, 'invalid_request', '缺少有效的 OAuth PKCE 参数');
  }
  if (codeChallenge && (codeChallengeMethod !== 'S256' || !isValidPkceChallenge(codeChallenge))) {
    return oauthError(400, 'invalid_request', 'OAuth PKCE 参数无效');
  }

  const code = generateRandomString(64);
  await insertAuthCode({
    code,
    userId: user.userId,
    clientId: client.id,
    redirectUri,
    expiresAt: new Date(Date.now() + OAUTH_CODE_TTL_MS),
    scopes,
    codeChallenge: codeChallenge || null
  });

  const callback = new URL(redirectUri);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', state);

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      code,
      redirect_uri: callback.toString()
    })
  };
}

/**
 * OAuth 2.0 Token：authorization_code + PKCE，以及 refresh_token。
 */
async function handleOAuthToken(event) {
  const body = event.body || event;
  const grantType = body.grant_type || 'authorization_code';
  const clientId = body.client_id;
  const client = await resolveOAuthClient(clientId);
  if (!client) return oauthError(401, 'invalid_client', '无效的客户端 ID');
  if (!client.public && body.client_secret !== client.clientSecret) {
    return oauthError(401, 'invalid_client', '客户端验证失败');
  }

  if (grantType === 'refresh_token') {
    const refreshToken = body.refresh_token;
    if (!refreshToken) return oauthError(400, 'invalid_request', '缺少 refresh_token');
    const rows = await query(
      `SELECT user_id, scopes, expires_at FROM oauth_refresh_tokens WHERE token = ? AND client_id = ?`,
      [refreshToken, client.id]
    );
    if (!rows.length) return oauthError(400, 'invalid_grant', '刷新令牌无效');
    if (new Date(rows[0].expires_at) < new Date()) {
      await query('DELETE FROM oauth_refresh_tokens WHERE token = ?', [refreshToken]);
      return oauthError(400, 'invalid_grant', '刷新令牌已过期');
    }
    await query('DELETE FROM oauth_refresh_tokens WHERE token = ?', [refreshToken]);
    return issueOAuthTokens({
      userId: rows[0].user_id,
      clientId: client.id,
      scopes: readScopeList(rows[0].scopes)
    });
  }

  if (grantType !== 'authorization_code') {
    return oauthError(400, 'unsupported_grant_type', '不支持的授权类型');
  }

  const { code, redirect_uri: redirectUri, code_verifier: codeVerifier } = body;
  if (!code || !redirectUri) return oauthError(400, 'invalid_request', '缺少必要参数');
  if (client.public && !isValidPkceVerifier(codeVerifier)) {
    return oauthError(400, 'invalid_request', '缺少有效的 OAuth PKCE 参数');
  }

  const authCodes = await loadAuthCode(code, client.id, redirectUri);
  await query('DELETE FROM oauth_auth_codes WHERE code = ?', [code]);
  if (!authCodes.length) return oauthError(400, 'invalid_grant', '授权码无效');
  const authCode = authCodes[0];
  if (new Date(authCode.expires_at) < new Date()) return oauthError(400, 'invalid_grant', '授权码已过期');
  if (authCode.code_challenge) {
    if (!isValidPkceVerifier(codeVerifier) || !safeStringEqual(authCode.code_challenge, createPkceChallenge(codeVerifier))) {
      return oauthError(400, 'invalid_grant', 'PKCE 校验失败');
    }
  }

  return issueOAuthTokens({
    userId: authCode.user_id,
    clientId: client.id,
    scopes: readScopeList(authCode.scopes)
  });
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
