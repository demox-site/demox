const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');

Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: 'test-secret-that-is-long-enough-for-unit-tests'
});
delete process.env.FEISHU_APP_ID;
delete process.env.FEISHU_APP_SECRET;

let queryImpl = async (sql) => {
  throw new Error(`Unexpected query: ${sql}`);
};
const dbModulePath = require.resolve('./shared/db.cjs');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: (...args) => queryImpl(...args),
    transaction: async (callback) => callback({ execute: (...args) => queryImpl(...args) })
  }
};

const { main } = require('./index.cjs');
const { sign, verify } = require('./shared/jwt.cjs');

function request(path, body = {}) {
  return main({ path, httpMethod: 'POST', body });
}

test('feishu login requires an authorization code', async () => {
  const response = await request('/auth/feishu');
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /code/);
});

test('feishu login rejects malformed PKCE before contacting the provider', async () => {
  const response = await request('/auth/feishu', {
    code: 'one-time-code',
    codeVerifier: 'too-short'
  });
  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /PKCE/);
});

test('feishu login fails closed when server credentials are missing', async () => {
  const response = await request('/auth/feishu', {
    code: 'one-time-code'
  });
  assert.equal(response.statusCode, 500);
  assert.match(JSON.parse(response.body).error, /未配置飞书 OAuth/);
});

test('feishu login fails closed when the server redirect URI is missing', async () => {
  process.env.FEISHU_APP_ID = 'cli_test';
  process.env.FEISHU_APP_SECRET = 'test-secret';
  delete process.env.FEISHU_REDIRECT_URI;
  try {
    const response = await request('/auth/feishu', {
      code: 'one-time-code'
    });
    assert.equal(response.statusCode, 500);
    assert.match(JSON.parse(response.body).error, /回调地址/);
  } finally {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  }
});

test('feishu login rejects a verifier and challenge mismatch before contacting Feishu', async () => {
  const originalRequest = https.request;
  let providerCalled = false;
  https.request = () => {
    providerCalled = true;
    throw new Error('Feishu must not be called');
  };
  Object.assign(process.env, {
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'test-secret',
    FEISHU_REDIRECT_URI: 'https://www.demox.site/feishu-callback'
  });

  try {
    const response = await request('/auth/feishu', {
      code: 'one-time-code',
      codeVerifier: 'a'.repeat(43),
      codeChallenge: 'b'.repeat(43)
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 400);
    assert.equal(body.errorCode, 'PKCE_PAIR_MISMATCH');
    assert.equal(providerCalled, false);
  } finally {
    https.request = originalRequest;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_REDIRECT_URI;
  }
});

test('feishu provider errors retain the numeric error code without exposing PKCE secrets', async () => {
  const originalRequest = https.request;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  https.request = (options, callback) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.setTimeout = () => req;
    req.end = () => {
      const res = new EventEmitter();
      callback(res);
      process.nextTick(() => {
        res.emit('data', JSON.stringify({
          code: 20049,
          error: 'invalid_grant',
          error_description: 'PKCE code challenge failed.'
        }));
        res.emit('end');
      });
    };
    return req;
  };
  Object.assign(process.env, {
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'test-secret',
    FEISHU_REDIRECT_URI: 'https://www.demox.site/feishu-callback'
  });

  try {
    const verifier = 'a'.repeat(43);
    const challenge = require('crypto')
      .createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64url');
    const response = await request('/auth/feishu', {
      code: 'one-time-code',
      codeVerifier: verifier,
      codeChallenge: challenge
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 401);
    assert.equal(body.feishuCode, 20049);
    assert.match(body.error, /\(20049\)/);
    assert.doesNotMatch(warnings.join('\n'), new RegExp(verifier));
    assert.doesNotMatch(warnings.join('\n'), new RegExp(challenge));
  } finally {
    https.request = originalRequest;
    console.warn = originalWarn;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_REDIRECT_URI;
  }
});

test('feishu finalize rejects an invalid short-lived ticket', async () => {
  const response = await request('/auth/feishu/finalize', {
    ticket: 'invalid-ticket',
    choice: 'create'
  });
  assert.equal(response.statusCode, 401);
  assert.match(JSON.parse(response.body).error, /票据无效或已过期/);
});

test('request logs redact OAuth secrets', async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await request('/auth/feishu', {
      code: 'sensitive-code',
      codeVerifier: 'sensitive-verifier',
      codeChallenge: 'sensitive-challenge'
    });
  } finally {
    console.log = originalLog;
  }

  const output = lines.join('\n');
  assert.match(output, /\[REDACTED\]/);
  assert.doesNotMatch(output, /sensitive-code|sensitive-verifier|sensitive-challenge/);
});

test('returning feishu user exchanges code and signs into the bound account', async () => {
  const originalRequest = https.request;
  const requests = [];
  https.request = (options, callback) => {
    const req = new EventEmitter();
    let requestBody = '';
    req.write = (chunk) => {
      requestBody += chunk;
    };
    req.setTimeout = () => req;
    req.end = () => {
      requests.push({ options, body: requestBody });
      const res = new EventEmitter();
      callback(res);
      const responseBody = options.hostname === 'accounts.feishu.cn'
        ? { code: 0, access_token: 'user-access-token' }
        : {
            code: 0,
            data: {
              open_id: 'ou_test',
              union_id: 'on_test',
              tenant_key: 'tenant_test',
              enterprise_email: 'user@company.example',
              name: 'Feishu User',
              avatar_url: 'https://example.com/avatar.png'
            }
          };
      process.nextTick(() => {
        res.emit('data', JSON.stringify(responseBody));
        res.emit('end');
      });
    };
    return req;
  };

  queryImpl = async (sql) => {
    if (sql.includes('FROM users') && sql.includes('feishu_open_id')) {
      return [{ id: 'user-1', email: 'user@example.com', nickname: 'Existing User' }];
    }
    if (sql.trim().startsWith('UPDATE users')) return { affectedRows: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  Object.assign(process.env, {
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'test-secret',
    FEISHU_REDIRECT_URI: 'https://www.demox.site/feishu-callback'
  });

  try {
    const response = await request('/auth/feishu', {
      code: 'one-time-code'
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.userId, 'user-1');
    assert.equal(body.isNewUser, false);
    assert.ok(body.token);
    assert.deepEqual(requests.map((item) => item.options.hostname), [
      'accounts.feishu.cn',
      'open.feishu.cn'
    ]);
    const tokenRequest = JSON.parse(requests[0].body);
    assert.equal('code_verifier' in tokenRequest, false);
    assert.equal(tokenRequest.redirect_uri, process.env.FEISHU_REDIRECT_URI);
  } finally {
    https.request = originalRequest;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_REDIRECT_URI;
  }
});

test('first-time feishu identity is created atomically from a short-lived ticket', async () => {
  const writes = [];
  queryImpl = async (sql, params) => {
    if (sql.includes('FROM users') && sql.includes('feishu_open_id')) return [];
    if (sql.trim().startsWith('INSERT INTO')) {
      writes.push({ sql, params });
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const ticket = sign({
    kind: 'feishu_link',
    openId: 'ou_new_user',
    unionId: 'on_new_user',
    tenantKey: 'tenant_new',
    feishuEmail: 'new.user@company.example',
    feishuName: 'New User',
    avatarUrl: null
  }, '5m');

  const response = await request('/auth/feishu/finalize', {
    ticket,
    choice: 'create'
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.isNewUser, true);
  assert.match(body.email, /^feishu_[a-f0-9]{32}@users\.noreply\.demox\.site$/);
  assert.equal(writes.length, 2);
  assert.match(writes[0].sql, /INSERT INTO users/);
  assert.match(writes[0].sql, /feishu_tenant_key, feishu_email/);
  assert.ok(writes[0].params.includes('tenant_new'));
  assert.ok(writes[0].params.includes('new.user@company.example'));
  assert.match(writes[1].sql, /INSERT INTO user_roles/);
});

test('feishu schema migration cannot be triggered through the public request body', async () => {
  queryImpl = async (sql) => {
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await request('/auth/not-found', {
    internalMigration: 'feishu_identity',
    dryRun: false
  });

  assert.equal(response.statusCode, 404);
});

test('direct SCF invoke applies and verifies the feishu schema migration', async () => {
  let migrated = false;
  let alterSql = '';
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) {
      return migrated
        ? [
            { COLUMN_NAME: 'feishu_open_id' },
            { COLUMN_NAME: 'feishu_union_id' },
            { COLUMN_NAME: 'feishu_name' },
            { COLUMN_NAME: 'feishu_tenant_key' },
            { COLUMN_NAME: 'feishu_email' }
          ]
        : [];
    }
    if (sql.includes('information_schema.STATISTICS')) {
      return migrated
        ? [
            { INDEX_NAME: 'uniq_feishu_open_id' },
            { INDEX_NAME: 'uniq_feishu_union_id' }
          ]
        : [];
    }
    if (sql.includes('information_schema.TABLES')) return [{ TABLE_ROWS: 12 }];
    if (sql.startsWith('ALTER TABLE users')) {
      alterSql = sql;
      migrated = true;
      return { affectedRows: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await main({
    internalMigration: 'feishu_identity',
    dryRun: false,
    body: {}
  });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.verified, true);
  assert.equal(body.estimatedRows, 12);
  assert.deepEqual(body.addedColumns, [
    'feishu_open_id',
    'feishu_union_id',
    'feishu_name',
    'feishu_tenant_key',
    'feishu_email'
  ]);
  assert.deepEqual(body.addedIndexes, [
    'uniq_feishu_open_id',
    'uniq_feishu_union_id'
  ]);
  assert.match(alterSql, /ADD COLUMN feishu_open_id/);
  assert.match(alterSql, /ADD COLUMN feishu_tenant_key/);
  assert.match(alterSql, /ADD UNIQUE KEY uniq_feishu_union_id/);
});

test('send-code fails closed when SES is not configured', async () => {
  const writes = [];
  queryImpl = async (sql, params = []) => {
    writes.push({ sql, params });
    if (sql.includes('FROM verification_codes') && sql.includes('INTERVAL 1 MINUTE')) {
      return [];
    }
    return { affectedRows: 1 };
  };

  delete process.env.AUTH_EMAIL_DRY_RUN;
  delete process.env.TENCENTCLOUD_SECRETID;
  delete process.env.TENCENTCLOUD_SECRETKEY;
  delete process.env.TENCENT_SECRET_ID;
  delete process.env.TENCENT_SECRET_KEY;

  const response = await request('/auth/send-code', {
    email: 'user@example.com',
    type: 'login'
  });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 502);
  assert.match(body.error, /发送失败/);
  assert.equal(writes.some((item) => item.sql.startsWith('INSERT INTO verification_codes')), true);
  assert.equal(writes.some((item) => item.sql.startsWith('DELETE FROM verification_codes') && item.sql.includes('code = ?')), true);
});

test('send-code succeeds when email sending is dry-run', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM verification_codes') && sql.includes('INTERVAL 1 MINUTE')) {
      return [];
    }
    return { affectedRows: 1 };
  };

  process.env.AUTH_EMAIL_DRY_RUN = '1';
  try {
    const response = await request('/auth/send-code', {
      email: 'user@example.com',
      type: 'login'
    });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
  } finally {
    delete process.env.AUTH_EMAIL_DRY_RUN;
  }
});

test('current user drops expired pro from effective roles', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM users WHERE id = ?')) {
      return [{
        id: 'expired-pro',
        email: 'expired@example.com',
        email_verified: 1,
        github_id: null,
        github_login: null,
        feishu_open_id: null,
        feishu_name: null,
        avatar_url: null,
        nickname: 'Expired',
        created_at: '2026-01-01T00:00:00Z'
      }];
    }
    if (sql.includes('FROM user_roles WHERE user_id')) {
      return [{ roles: ['user', 'pro'], pro_expires_at: '2020-01-01T00:00:00Z' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const token = sign({ userId: 'expired-pro' }, '1h');
  const response = await main({
    path: '/auth/me',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {}
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200, JSON.stringify(body));
  assert.deepEqual(body.user.roles, ['user']);
  assert.equal(body.user.membership.hasPro, false);
  assert.equal(body.user.membership.proExpired, true);
});

test('current user keeps lifetime pro in effective roles', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM users WHERE id = ?')) {
      return [{
        id: 'lifetime-pro',
        email: 'pro@example.com',
        email_verified: 1,
        github_id: null,
        github_login: null,
        feishu_open_id: null,
        feishu_name: null,
        avatar_url: null,
        nickname: 'Pro',
        created_at: '2026-01-01T00:00:00Z'
      }];
    }
    if (sql.includes('FROM user_roles WHERE user_id')) {
      return [{ roles: ['user', 'pro'], pro_expires_at: null }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const token = sign({ userId: 'lifetime-pro' }, '1h');
  const response = await main({
    path: '/auth/me',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {}
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200, JSON.stringify(body));
  assert.deepEqual(body.user.roles, ['user', 'pro']);
  assert.equal(body.user.membership.hasPro, true);
  assert.equal(body.user.membership.proLifetime, true);
});

const crypto = require('node:crypto');

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

function oauthStore() {
  const codes = new Map();
  const refresh = new Map();
  return async (sql, params = []) => {
    if (sql.includes('INSERT INTO oauth_clients')) return { affectedRows: 1 };
    if (sql.includes('INSERT INTO oauth_auth_codes')) {
      codes.set(params[0], {
        user_id: params[1],
        client_id: params[2],
        redirect_uri: params[3],
        expires_at: params[4],
        scopes: JSON.parse(params[5]),
        code_challenge: params[6]
      });
      return { affectedRows: 1 };
    }
    if (sql.includes('FROM oauth_auth_codes')) {
      const row = codes.get(params[0]);
      if (row && row.client_id === params[1] && row.redirect_uri === params[2]) return [row];
      return [];
    }
    if (sql.includes('DELETE FROM oauth_auth_codes')) {
      codes.delete(params[0]);
      return { affectedRows: 1 };
    }
    if (sql.includes('FROM users WHERE id = ?')) {
      return [{ id: params[0], email: 'user@example.com' }];
    }
    if (sql.includes('INSERT INTO oauth_refresh_tokens')) {
      refresh.set(params[0], {
        user_id: params[1],
        client_id: params[2],
        expires_at: params[3],
        scopes: JSON.parse(params[4])
      });
      return { affectedRows: 1 };
    }
    if (sql.includes('FROM oauth_refresh_tokens')) {
      const row = refresh.get(params[0]);
      if (row && row.client_id === params[1]) return [row];
      return [];
    }
    if (sql.includes('DELETE FROM oauth_refresh_tokens')) {
      refresh.delete(params[0]);
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
}

test('oauth authorize requires a logged-in user', async () => {
  queryImpl = oauthStore();
  const response = await main({
    path: '/oauth/authorize',
    httpMethod: 'POST',
    body: { client_id: 'demox-mcp-client' }
  });
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).error, 'login_required');
});

test('oauth authorize issues a code and token exchange requires matching PKCE', async () => {
  const { verifier, challenge } = pkcePair();
  queryImpl = oauthStore();
  const session = sign({ userId: 'user-1', email: 'user@example.com' }, '1h');
  const authorize = await main({
    path: '/oauth/authorize',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${session}` },
    body: {
      client_id: 'demox-mcp-client',
      redirect_uri: 'http://localhost:39897/callback',
      response_type: 'code',
      state: 'state-with-at-least-16',
      scope: 'website:deploy website:list website:delete website:update',
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }
  });
  const issued = JSON.parse(authorize.body);
  assert.equal(authorize.statusCode, 200, authorize.body);
  assert.equal(typeof issued.code, 'string');
  assert.match(issued.redirect_uri, /[?&]code=/);
  assert.doesNotMatch(issued.redirect_uri, /access_token=/);

  const denied = await main({
    path: '/oauth/token',
    httpMethod: 'POST',
    body: {
      grant_type: 'authorization_code',
      code: issued.code,
      client_id: 'demox-mcp-client',
      redirect_uri: 'http://localhost:39897/callback',
      code_verifier: pkcePair().verifier
    }
  });
  assert.equal(denied.statusCode, 400);
  assert.equal(JSON.parse(denied.body).error, 'invalid_grant');

  const authorizeAgain = await main({
    path: '/oauth/authorize',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${session}` },
    body: {
      client_id: 'demox-mcp-client',
      redirect_uri: 'http://localhost:39897/callback',
      response_type: 'code',
      state: 'state-with-at-least-16',
      scope: 'website:deploy website:list website:delete website:update',
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }
  });
  const code = JSON.parse(authorizeAgain.body).code;
  const token = await main({
    path: '/oauth/token',
    httpMethod: 'POST',
    body: {
      grant_type: 'authorization_code',
      code,
      client_id: 'demox-mcp-client',
      redirect_uri: 'http://localhost:39897/callback',
      code_verifier: verifier
    }
  });
  const body = JSON.parse(token.body);
  assert.equal(token.statusCode, 200, token.body);
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.user_id, 'user-1');
  assert.equal(body.expires_in, 3600);
  assert.ok(body.refresh_token);
  assert.equal(verify(body.access_token).userId, 'user-1');
});

test('oauth token refresh rotates the refresh token', async () => {
  const { verifier, challenge } = pkcePair();
  queryImpl = oauthStore();
  const session = sign({ userId: 'user-1', email: 'user@example.com' }, '1h');
  const authorize = await main({
    path: '/oauth/authorize',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${session}` },
    body: {
      client_id: 'demox-mcp-client',
      redirect_uri: 'http://localhost:39897/callback',
      response_type: 'code',
      state: 'state-with-at-least-16',
      scope: 'website:deploy website:list website:delete website:update',
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }
  });
  const first = JSON.parse((await main({
    path: '/oauth/token',
    httpMethod: 'POST',
    body: {
      grant_type: 'authorization_code',
      code: JSON.parse(authorize.body).code,
      client_id: 'demox-mcp-client',
      redirect_uri: 'http://localhost:39897/callback',
      code_verifier: verifier
    }
  })).body);
  const refreshed = JSON.parse((await main({
    path: '/oauth/token',
    httpMethod: 'POST',
    body: {
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      client_id: 'demox-mcp-client'
    }
  })).body);
  assert.ok(refreshed.access_token);
  assert.ok(refreshed.refresh_token);
  assert.notEqual(refreshed.refresh_token, first.refresh_token);
});

const bcrypt = require('bcryptjs');

test('current user reports hasPassword from stored hash', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM users WHERE id = ?')) {
      return [{
        id: 'code-user',
        email: 'code@example.com',
        email_verified: 1,
        github_id: null,
        github_login: null,
        feishu_open_id: null,
        feishu_name: null,
        avatar_url: null,
        nickname: 'Code',
        created_at: '2026-01-01T00:00:00Z',
        password_hash: ''
      }];
    }
    if (sql.includes('FROM user_roles WHERE user_id')) {
      return [{ roles: ['user'], pro_expires_at: null }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const token = sign({ userId: 'code-user' }, '1h');
  const response = await main({
    path: '/auth/me',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {}
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200, JSON.stringify(body));
  assert.equal(body.user.hasPassword, false);
  assert.equal(Object.prototype.hasOwnProperty.call(body.user, 'password_hash'), false);
});

test('change-password sets a password for accounts that never had one', async () => {
  const updates = [];
  queryImpl = async (sql, params = []) => {
    if (sql.includes('SELECT password_hash FROM users WHERE id = ?')) {
      return [{ password_hash: '' }];
    }
    if (sql.startsWith('UPDATE users SET password_hash')) {
      updates.push(params);
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const token = sign({ userId: 'code-user', email: 'code@example.com' }, '1h');
  const response = await main({
    path: '/auth/change-password',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { newPassword: 'newpassw0rd' }
  });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.match(body.message, /已设置/);
  assert.equal(updates.length, 1);
  assert.equal(await bcrypt.compare('newpassw0rd', updates[0][0]), true);
});

test('change-password still requires the current password when one exists', async () => {
  const hash = await bcrypt.hash('oldpassw0rd', 4);
  const updates = [];
  queryImpl = async (sql, params = []) => {
    if (sql.includes('SELECT password_hash FROM users WHERE id = ?')) {
      return [{ password_hash: hash }];
    }
    if (sql.startsWith('UPDATE users SET password_hash')) {
      updates.push(params);
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const token = sign({ userId: 'pwd-user', email: 'pwd@example.com' }, '1h');
  const missingCurrent = await main({
    path: '/auth/change-password',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { newPassword: 'newpassw0rd' }
  });
  assert.equal(missingCurrent.statusCode, 400);
  assert.match(JSON.parse(missingCurrent.body).error, /当前密码/);

  const wrongCurrent = await main({
    path: '/auth/change-password',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { currentPassword: 'not-it', newPassword: 'newpassw0rd' }
  });
  assert.equal(wrongCurrent.statusCode, 401);

  const ok = await main({
    path: '/auth/change-password',
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { currentPassword: 'oldpassw0rd', newPassword: 'newpassw0rd' }
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(updates.length, 1);
});

test('password login tells code-only accounts to use a verification code', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM users WHERE email')) {
      return [{ id: 'code-user', email: 'code@example.com', password_hash: '', nickname: 'Code' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await request('/auth/login', {
    email: 'code@example.com',
    password: 'whatever1'
  });
  assert.equal(response.statusCode, 401);
  assert.match(JSON.parse(response.body).error, /未设置密码/);
});
