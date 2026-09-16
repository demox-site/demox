const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: 'website-api-test-secret',
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret_test'
});

let queryImpl = async (sql) => { throw new Error(`Unexpected query: ${sql}`); };
let directoryImpl = {};

const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: (...args) => queryImpl(...args),
    transaction: async (callback) => callback({
      query: async (...args) => [await queryImpl(...args), []]
    })
  }
};

const directoryModulePath = require.resolve('./shared/feishu-directory.js');
const ActualDirectoryError = require(directoryModulePath).FeishuDirectoryError;
require.cache[directoryModulePath] = {
  id: directoryModulePath,
  filename: directoryModulePath,
  loaded: true,
  exports: {
    FeishuDirectoryError: ActualDirectoryError,
    createFeishuDirectoryClient: () => ({
      getUser: (...args) => directoryImpl.getUser(...args),
      getDepartment: (...args) => directoryImpl.getDepartment(...args),
      resolveUserByEmail: (...args) => directoryImpl.resolveUserByEmail(...args),
      listDepartments: (...args) => directoryImpl.listDepartments(...args),
      listUsers: (...args) => directoryImpl.listUsers(...args),
      getUserDepartmentClosure: (...args) => directoryImpl.getUserDepartmentClosure(...args)
    })
  }
};

let githubImpl = {};
const githubModulePath = require.resolve('./shared/github-directory.js');
const ActualGithubError = require(githubModulePath).GithubDirectoryError;
require.cache[githubModulePath] = {
  id: githubModulePath,
  filename: githubModulePath,
  loaded: true,
  exports: {
    GithubDirectoryError: ActualGithubError,
    createGithubDirectoryClient: () => ({
      searchUsers: (...args) => githubImpl.searchUsers(...args),
      getUserById: (...args) => githubImpl.getUserById(...args),
      getUserByLogin: (...args) => githubImpl.getUserByLogin(...args)
    })
  }
};

const websiteApi = require('./index.js');
const { main, setCustomDomainRuntime } = websiteApi;
const { sign } = require('./shared/jwt.js');

function request(action, body = {}, userId = 'user-feishu', tokenEmail = `${userId}@demox.example`) {
  const token = sign({ userId, email: tokenEmail });
  return main({
    path: `/website/${action.replaceAll('_', '-')}`,
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: { action, ...body }
  });
}

function ownerAccessQueries(sql) {
  if (sql.includes('FROM user_roles')) return [];
  if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) return [];
  if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) {
    return [{ id: 42, user_id: 'project-owner', project_role: 'owner' }];
  }
  return null;
}

test.beforeEach(() => {
  setCustomDomainRuntime({
    lookupGatewayAddresses: async () => ['119.91.123.2'],
    probeHttps: async () => ({ ok: true, status: 200 }),
    provision: async () => ({ ok: true })
  });
  directoryImpl = {
    getUser: async (openId) => ({ open_id: openId, name: 'Feishu Person', status: { is_resigned: false } }),
    getDepartment: async (id) => ({ open_department_id: id, name: 'Engineering', status: { is_deleted: false } }),
    resolveUserByEmail: async (email) => ({ openId: 'ou_target', name: 'Feishu Person', email }),
    listDepartments: async () => [],
    listUsers: async () => [],
    getUserDepartmentClosure: async () => ({ departmentIds: [] })
  };
  githubImpl = {
    searchUsers: async () => [],
    getUserById: async (id) => ({ id: String(id), login: 'octocat', name: 'The Octocat', avatarUrl: 'https://example/a.png' }),
    getUserByLogin: async (login) => ({ id: '1', login, name: login, avatarUrl: null })
  };
});

test('project deletion requires authentication', async () => {
  let queried = false;
  queryImpl = async () => {
    queried = true;
    return [];
  };

  const response = await main({
    path: '/website/delete-project',
    httpMethod: 'POST',
    headers: {},
    body: { action: 'delete_project', id: 42 }
  });
  const body = JSON.parse(response.body);
  assert.equal(body.success, false);
  assert.equal(body.error, '未登录或token已过期');
  assert.equal(queried, false);
});

test('platform role list reports linked login providers without exposing provider ids', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('information_schema.COLUMNS')) {
      if (sql.includes('COUNT(*)')) return [{ c: 1 }];
      return [{ COLUMN_NAME: 'file_count' }, { COLUMN_NAME: 'storage_size' }, { COLUMN_NAME: 'deployed_size' }, { COLUMN_NAME: 'pro_expires_at' }];
    }
    if (sql.includes('deployed_size IS NULL')) return [{ c: 0 }];
    if (sql.includes('SELECT ur.user_id') && sql.includes('u.nickname') && sql.includes('u.github_id') && sql.includes('u.feishu_open_id')) {
      return [
        { user_id: 'github-user', email: 'github@example.com', nickname: 'GitHub User', roles: ['user'], github_id: '1', feishu_open_id: null, sites_count: 3, storage_bytes: 4096 },
        { user_id: 'feishu-user', email: 'feishu@example.com', nickname: '飞书用户', roles: ['user'], github_id: null, feishu_open_id: 'ou_1', sites_count: 0, storage_bytes: 0 },
        { user_id: 'linked-user', email: 'linked@example.com', nickname: 'Linked User', roles: ['user'], github_id: '2', feishu_open_id: 'ou_2', sites_count: 1, storage_bytes: 1024 },
        { user_id: 'email-user', email: 'email@example.com', nickname: '', roles: ['user'], github_id: null, feishu_open_id: null, sites_count: 0, storage_bytes: 0 }
      ];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('list_user_roles', {}, 'platform-admin')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.deepEqual(body.data.map((item) => item.authProviders), [
    ['github'], ['feishu'], ['github', 'feishu'], []
  ]);
  assert.deepEqual(body.data.map((item) => item.nickname), [
    'GitHub User', '飞书用户', 'Linked User', ''
  ]);
  assert.equal('github_id' in body.data[0], false);
  assert.equal('feishu_open_id' in body.data[0], false);
  assert.deepEqual(body.data.map((item) => item.siteCount), [3, 0, 1, 0]);
  assert.deepEqual(body.data.map((item) => item.storageBytes), [4096, 0, 1024, 0]);
});

test('admin user overview returns project, site, and traffic board', async () => {
  queryImpl = async (sql, params) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }, { COLUMN_NAME: 'file_count' }, { COLUMN_NAME: 'storage_size' }, { COLUMN_NAME: 'deployed_size' }];
    if (sql.includes('deployed_size IS NULL')) return [{ c: 0 }];
    if (sql.includes('FROM user_roles WHERE user_id')) {
      return params && params[0] === 'board-user'
        ? [{ roles: ['user', 'pro'], pro_expires_at: null }]
        : [{ roles: ['admin', 'user'] }];
    }
    if (sql.includes('FROM users WHERE id')) {
      return [{
        id: 'board-user',
        email: 'board@example.com',
        nickname: '看板用户',
        github_id: '1',
        feishu_open_id: null,
        created_at: '2026-01-01T00:00:00Z'
      }];
    }
    if (sql.includes('SELECT * FROM roles WHERE enabled = 1')) {
      return [{ id: 'user', name: '普通用户', priority: 10, deployment_limit: 10, max_file_size: 1, max_file_count: 10 }];
    }
    if (sql.includes('FROM projects WHERE user_id') && sql.includes('archived')) {
      return [{ projects: 2, archivedProjects: 1 }];
    }
    if (sql.includes('COUNT(*) AS sites') && sql.includes('FROM websites WHERE user_id')) {
      return [{ sites: 3, files: 12, storage: 4096 }];
    }
    if (sql.includes('FROM site_path_daily_stats') && sql.includes('GROUP BY s.stat_date')) {
      return [
        { stat_date: '2026-08-20', views: 10 },
        { stat_date: '2026-08-25', views: 4 }
      ];
    }
    if (sql.includes('FROM site_path_daily_stats') && sql.includes('COALESCE(SUM(s.views)')) {
      return [{ views: 99 }];
    }
    if (sql.includes('FROM projects p') && sql.includes('WHERE p.user_id')) {
      return [{
        id: 8,
        project_key: 'proj_demo',
        name: 'Demo',
        slug: 'demo',
        archived: 0,
        updated_at: '2026-08-20T00:00:00Z'
      }];
    }
    if (sql.includes('FROM websites w') && sql.includes('views30d')) {
      return [
        {
          website_id: 'SITE1',
          name: 'Landing',
          subdomain: 'hello',
          subdomain_domain: 'demox.site',
          url: null,
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-20T00:00:00Z',
          project_id: 8,
          project_key: 'proj_demo',
          project_name: 'Demo',
          storage: 2048,
          views30d: 14
        },
        {
          website_id: 'SITE2',
          name: 'Orphan',
          subdomain: null,
          subdomain_domain: null,
          url: 'https://orphan.example',
          created_at: '2026-08-02T00:00:00Z',
          updated_at: '2026-08-21T00:00:00Z',
          project_id: null,
          project_key: null,
          project_name: null,
          storage: 512,
          views30d: 2
        }
      ];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('get_user_overview', { uid: 'board-user' }, 'platform-admin')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.user.email, 'board@example.com');
  assert.equal(body.counts.projects, 2);
  assert.equal(body.counts.sites, 3);
  assert.equal(body.traffic.viewsAll, 99);
  assert.equal(body.traffic.views30d, 14);
  assert.equal(body.projects[0].name, 'Demo');
  assert.equal(body.projects[0].websitesCount, 1);
  assert.equal(body.projects[0].sites[0].websiteId, 'SITE1');
  assert.equal(body.sites[0].websiteId, 'SITE1');
  assert.equal(body.sites[0].views30d, 14);
  assert.equal(body.sites[0].storage, 2048);
  assert.equal(body.ungroupedSites[0].websiteId, 'SITE2');
});

test('admin platform overview returns live product counts and traffic', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }, { COLUMN_NAME: 'file_count' }, { COLUMN_NAME: 'storage_size' }, { COLUMN_NAME: 'deployed_size' }];
    if (sql.includes('deployed_size IS NULL')) return [{ c: 0 }];
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT COUNT(*) AS c FROM users WHERE created_at')) return [{ c: 2 }];
    if (sql.includes('SELECT COUNT(*) AS c FROM users')) return [{ c: 12 }];
    if (sql.includes('COUNT(*) AS sites') && sql.includes('FROM websites')) {
      return [{ sites: 9, usersWithSites: 6, storage: 2048 }];
    }
    if (sql.includes('FROM websites WHERE created_at')) return [{ c: 1 }];
    if (sql.includes('FROM projects') && sql.includes('archived')) {
      return [{ projects: 5, archivedProjects: 1 }];
    }
    if (sql.includes('SELECT roles, pro_expires_at FROM user_roles')) {
      return [
        { roles: ['admin', 'user'], pro_expires_at: null },
        { roles: ['user', 'pro'], pro_expires_at: null },
        { roles: ['user', 'pro'], pro_expires_at: '2020-01-01T00:00:00Z' }
      ];
    }
    if (sql.includes('FROM site_path_daily_stats') && sql.includes('GROUP BY stat_date')) {
      return [{ stat_date: '2026-08-24', views: 20 }, { stat_date: '2026-08-25', views: 5 }];
    }
    if (sql.includes('FROM site_path_daily_stats') && sql.includes('COALESCE(SUM(views)')) {
      return [{ views: 80 }];
    }
    if (sql.includes('FROM websites w') && sql.includes('views30d')) {
      return [{
        website_id: 'HOT1',
        name: 'Hot Site',
        subdomain: 'hot',
        subdomain_domain: 'demox.site',
        url: null,
        user_id: 'board-user',
        nickname: '看板用户',
        email: 'board@example.com',
        views30d: 25,
        storage: 8192
      }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('get_platform_overview', {}, 'platform-admin')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.counts.users, 12);
  assert.equal(body.counts.sites, 9);
  assert.equal(body.counts.proActive, 1);
  assert.equal(body.counts.proExpired, 1);
  assert.equal(body.counts.admins, 1);
  assert.equal(body.traffic.viewsAll, 80);
  assert.equal(body.traffic.views30d, 25);
  assert.equal(body.topSites[0].websiteId, 'HOT1');
  assert.equal(body.topSites[0].storage, 8192);
  assert.equal(body.counts.bucketStorage, null);
  assert.equal(body.counts.bucketObjects, null);
});

test('admin user overview rejects a missing uid', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }];
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const body = JSON.parse((await request('get_user_overview', {}, 'platform-admin')).body);
  assert.equal(body.success, false);
  assert.match(body.message, /UID/);
});

test('platform role updates normalize roles and keep the baseline user role', async () => {
  let savedRoles = null;
  queryImpl = async (sql, params) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }];
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT id, priority FROM roles WHERE enabled = 1')) {
      return [
        { id: 'user', priority: 10 },
        { id: 'pro', priority: 50 },
        { id: 'admin', priority: 100 }
      ];
    }
    if (sql.includes('SELECT id FROM users WHERE id = ?')) return [{ id: params[0] }];
    if (sql.includes('SELECT roles, pro_expires_at FROM user_roles')) return [];
    if (sql.includes('INSERT INTO user_roles')) {
      savedRoles = JSON.parse(params[1]);
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('set_user_role', {
    uid: 'target-user',
    role: ['PRO', 'pro']
  }, 'platform-admin')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.deepEqual(body.role, ['user', 'pro']);
  assert.deepEqual(savedRoles, ['user', 'pro']);
  assert.equal(body.proLifetime, false);
  assert.equal(typeof body.proExpiresAt, 'string');
});

test('granting pro without duration defaults to 30 days and can be lifetime', async () => {
  let savedExpiry = null;
  queryImpl = async (sql, params) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }];
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT id, priority FROM roles WHERE enabled = 1')) {
      return [{ id: 'user', priority: 10 }, { id: 'pro', priority: 50 }, { id: 'admin', priority: 100 }];
    }
    if (sql.includes('SELECT id FROM users WHERE id = ?')) return [{ id: params[0] }];
    if (sql.includes('SELECT roles, pro_expires_at FROM user_roles')) return [];
    if (sql.includes('INSERT INTO user_roles')) {
      savedExpiry = params[2];
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const timed = JSON.parse((await request('set_user_role', {
    uid: 'member-user',
    role: ['pro']
  }, 'platform-admin')).body);
  assert.equal(timed.success, true, JSON.stringify(timed));
  assert.ok(savedExpiry instanceof Date);
  assert.equal(timed.remainingDays, 30);

  const forever = JSON.parse((await request('set_user_role', {
    uid: 'member-user',
    role: ['pro'],
    proLifetime: true
  }, 'platform-admin')).body);
  assert.equal(forever.success, true, JSON.stringify(forever));
  assert.equal(forever.proLifetime, true);
  assert.equal(forever.proExpiresAt, null);
});

test('re-granting expired pro without days starts a new 30-day period', async () => {
  let savedExpiry = null;
  queryImpl = async (sql, params) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }];
    if (sql.includes('SELECT roles, pro_expires_at FROM user_roles')) {
      return [{ roles: ['user', 'pro'], pro_expires_at: '2020-01-01T00:00:00Z' }];
    }
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT id, priority FROM roles WHERE enabled = 1')) {
      return [{ id: 'user', priority: 10 }, { id: 'pro', priority: 50 }, { id: 'admin', priority: 100 }];
    }
    if (sql.includes('SELECT id FROM users WHERE id = ?')) return [{ id: params[0] }];
    if (sql.includes('INSERT INTO user_roles')) {
      savedExpiry = params[2];
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('set_user_role', {
    uid: 'expired-member',
    role: ['pro']
  }, 'platform-admin')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.ok(savedExpiry instanceof Date);
  assert.ok(savedExpiry.getTime() > Date.now());
  assert.equal(body.remainingDays, 30);
  assert.equal(body.proLifetime, false);
});

test('platform role updates reject unknown or disabled roles before writing', async () => {
  let wrote = false;
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }];
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT id, priority FROM roles WHERE enabled = 1')) {
      return [{ id: 'user', priority: 10 }, { id: 'admin', priority: 100 }];
    }
    if (sql.includes('INSERT INTO user_roles')) wrote = true;
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('set_user_role', {
    uid: 'target-user',
    role: ['pro']
  }, 'platform-admin')).body);
  assert.equal(body.success, false);
  assert.equal(body.code, 'INVALID_USER_ROLE');
  assert.match(body.message, /pro/);
  assert.equal(wrote, false);
});

test('platform role updates reject a UID that has no user or legacy role record', async () => {
  let wrote = false;
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }];
    if (sql.includes('SELECT user_id FROM user_roles')) return [];
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT id, priority FROM roles WHERE enabled = 1')) {
      return [{ id: 'user', priority: 10 }, { id: 'pro', priority: 50 }, { id: 'admin', priority: 100 }];
    }
    if (sql.includes('SELECT id FROM users WHERE id = ?')) return [];
    if (sql.includes('INSERT INTO user_roles')) wrote = true;
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('set_user_role', {
    uid: 'missing-user',
    role: ['pro']
  }, 'platform-admin')).body);
  assert.equal(body.success, false);
  assert.equal(body.code, 'USER_NOT_FOUND');
  assert.equal(wrote, false);
});

test('a platform admin cannot remove or reset their own admin role', async () => {
  let wrote = false;
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS')) return [{ c: 1 }];
    if (sql.includes('FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT id, priority FROM roles WHERE enabled = 1')) {
      return [{ id: 'user', priority: 10 }, { id: 'admin', priority: 100 }];
    }
    if (sql.includes('INSERT INTO user_roles') || sql.includes('DELETE FROM user_roles')) wrote = true;
    throw new Error(`Unexpected query: ${sql}`);
  };

  const demotion = JSON.parse((await request('set_user_role', {
    uid: 'platform-admin',
    role: ['user']
  }, 'platform-admin')).body);
  assert.equal(demotion.success, false);
  assert.equal(demotion.code, 'SELF_ADMIN_ROLE_REQUIRED');

  const reset = JSON.parse((await request('delete_user_role', {
    uid: 'platform-admin'
  }, 'platform-admin')).body);
  assert.equal(reset.success, false);
  assert.equal(reset.code, 'SELF_ADMIN_ROLE_REQUIRED');
  assert.equal(wrote, false);
});

test('project admins cannot delete a project they do not own', async () => {
  let deleteAttempted = false;
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM projects WHERE id') && sql.includes('FOR UPDATE')) {
      return [{ id: 42, user_id: 'project-owner', slug: 'team-project' }];
    }
    if (sql.includes('DELETE')) deleteAttempted = true;
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('delete_project', { id: 42 }, 'project-admin')).body);
  assert.equal(body.success, false, JSON.stringify(body));
  assert.equal(body.code, 'PROJECT_DELETE_FORBIDDEN');
  assert.equal(deleteAttempted, false);
});

test('default projects cannot be deleted', async () => {
  let websiteCheckAttempted = false;
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM projects WHERE id') && sql.includes('FOR UPDATE')) {
      return [{ id: 42, user_id: 'project-owner', slug: 'default' }];
    }
    if (sql.includes('FROM websites')) websiteCheckAttempted = true;
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('delete_project', { id: 42 }, 'project-owner')).body);
  assert.equal(body.success, false, JSON.stringify(body));
  assert.equal(body.code, 'DEFAULT_PROJECT_DELETE_FORBIDDEN');
  assert.equal(websiteCheckAttempted, false);
});

test('projects containing websites cannot be deleted', async () => {
  let deleteAttempted = false;
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM projects WHERE id') && sql.includes('FOR UPDATE')) {
      return [{ id: 42, user_id: 'project-owner', slug: 'team-project' }];
    }
    if (sql.includes('FROM websites') && sql.includes('FOR UPDATE')) return [{ id: 9 }];
    if (sql.includes('DELETE')) deleteAttempted = true;
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('delete_project', { id: 42 }, 'project-owner')).body);
  assert.equal(body.success, false, JSON.stringify(body));
  assert.equal(body.code, 'PROJECT_NOT_EMPTY');
  assert.equal(deleteAttempted, false);
});

test('an owner deletes an empty project and its collaboration data in one guarded transaction', async () => {
  const deletionOrder = [];
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM projects WHERE id') && sql.includes('FOR UPDATE')) {
      return [{ id: 42, user_id: 'project-owner', slug: 'team-project' }];
    }
    if (sql.includes('FROM websites') && sql.includes('FOR UPDATE')) return [];
    if (sql.startsWith('DELETE FROM project_feishu_grants')) { deletionOrder.push('grants'); return { affectedRows: 2 }; }
    if (sql.startsWith('DELETE FROM project_invitations')) { deletionOrder.push('invitations'); return { affectedRows: 1 }; }
    if (sql.startsWith('DELETE FROM project_members')) { deletionOrder.push('members'); return { affectedRows: 3 }; }
    if (sql.includes('DELETE p FROM projects p')) {
      assert.match(sql, /NOT EXISTS[\s\S]+FROM websites/);
      deletionOrder.push('project');
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('delete_project', { id: 42 }, 'project-owner')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.deleted, true);
  assert.deepEqual(deletionOrder, ['grants', 'invitations', 'members', 'project']);
});

test('a platform admin can delete another owners empty project', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles')) return [{ roles: ['admin'] }];
    if (sql.includes('FROM projects WHERE id') && sql.includes('FOR UPDATE')) {
      return [{ id: 42, user_id: 'project-owner', slug: 'team-project' }];
    }
    if (sql.includes('FROM websites') && sql.includes('FOR UPDATE')) return [];
    if (sql.startsWith('DELETE FROM project_')) return { affectedRows: 0 };
    if (sql.includes('DELETE p FROM projects p')) return { affectedRows: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('delete_project', { id: 42 }, 'platform-admin')).body);
  assert.equal(body.success, true, JSON.stringify(body));
});

test('project deletion fails closed if the final empty-project guard no longer matches', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('FROM projects WHERE id') && sql.includes('FOR UPDATE')) {
      return [{ id: 42, user_id: 'project-owner', slug: 'team-project' }];
    }
    if (sql.includes('FROM websites') && sql.includes('FOR UPDATE')) return [];
    if (sql.startsWith('DELETE FROM project_')) return { affectedRows: 1 };
    if (sql.includes('DELETE p FROM projects p')) return { affectedRows: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('delete_project', { id: 42 }, 'project-owner')).body);
  assert.equal(body.success, false, JSON.stringify(body));
  assert.equal(body.code, 'PROJECT_DELETE_CONFLICT');
});

test('moving a site locks and rechecks the target project before changing its project id', async () => {
  const writes = [];
  queryImpl = async (sql) => {
    if (sql.includes('SELECT * FROM websites WHERE id = ?')) {
      return [{ id: 7, website_id: 'MOVESITE', user_id: 'project-owner', project_id: 9 }];
    }
    if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) return [];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) {
      return [{ id: 42, user_id: 'project-owner', archived: 0, project_role: 'owner' }];
    }
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('SELECT id FROM projects') && sql.includes('FOR UPDATE')) {
      writes.push('lock-project');
      return [{ id: 42 }];
    }
    if (sql.includes('UPDATE websites SET project_id')) {
      writes.push('update-website');
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('set_website_project', {
    docId: 7,
    projectId: 42
  }, 'project-owner')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.deepEqual(writes, ['lock-project', 'update-website']);
});

test('system invite search fuzzily matches email or nickname and excludes current members', async () => {
  let searchParams;
  queryImpl = async (sql, params) => {
    const access = ownerAccessQueries(sql);
    if (access !== null) return access;
    if (sql.includes('FROM users u') && sql.includes('NOT EXISTS')) {
      searchParams = params;
      return [{ id: 'target-user', email: 'alice@example.com', nickname: 'Alice Chen' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('search_project_invite_users', {
    projectId: 42,
    query: ' Ali '
  }, 'project-owner')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.deepEqual(body.users, [{ userId: 'target-user', email: 'alice@example.com', nickname: 'Alice Chen' }]);
  assert.deepEqual(searchParams, ['project-owner', 'ali', 'ali', 42, 'ali']);
});

test('Feishu people search fuzzily matches directory names and returns stable open_id values', async () => {
  directoryImpl.listUsers = async () => [
    { open_id: 'ou_alice', name: 'Alice Chen', email: 'alice@example.com' },
    { open_id: 'ou_bob', name: 'Bob Li', email: 'bob@example.com' }
  ];
  queryImpl = async (sql) => {
    if (sql.includes('SELECT feishu_open_id') && sql.includes('feishu_email')) {
      return [{ feishu_open_id: 'ou_owner', feishu_tenant_key: 'tenant_a' }];
    }
    const access = ownerAccessQueries(sql);
    if (access !== null) return access;
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('search_feishu_project_principals', {
    projectId: 42,
    principalType: 'user',
    query: 'ice'
  }, 'project-owner')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.principals.length, 1);
  assert.equal(body.principals[0].name, 'Alice Chen');
  assert.equal(body.principals[0].principalKey, 'ou_alice');
});

test('a direct open_id grant ignores a different Demox account email', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM websites w')) {
      return [{ path: 'sites/private/index.html', user_id: 'project-owner', project_id: 42, website_id: 'PRIVATE1', visibility: 'private' }];
    }
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) {
      return [{ feishu_open_id: 'ou_target', feishu_tenant_key: 'tenant_a', feishu_department_ids: '[]', feishu_directory_synced_at: new Date() }];
    }
    if (sql.includes("principal_type = 'user'") && sql.includes("key_type = 'open_id'")) return [{ project_id: 42, role: 'member' }];
    if (sql.includes("principal_type = 'department'") && sql.includes('COUNT(*)')) return [{ c: 0 }];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) return [{ id: 42, user_id: 'project-owner', project_role: null }];
    throw new Error(`Unexpected query: ${sql}`);
  };

  const response = await request('check_site_access', { label: 'private1', domain: 'demox.site' }, 'target-demox', 'totally-different@demox.example');
  const body = JSON.parse(response.body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.allowed, true);
  assert.equal(body.role, 'member');
});

test('a first-time Feishu account sees its open_id-granted project in the project list', async () => {
  let listParams;
  queryImpl = async (sql, params) => {
    if (sql.includes('SELECT id FROM projects WHERE project_key = ?')) return [];
    if (sql.includes('INSERT INTO projects')) return { affectedRows: 1 };
    if (sql.includes("SELECT id, project_key FROM projects WHERE user_id = ? AND slug = 'default'")) {
      return [{ id: 99, project_key: 'PDEFAULT1' }];
    }
    if (sql.includes('INSERT INTO project_members')) return { affectedRows: 1 };
    if (sql.includes('SELECT id, email, nickname FROM users WHERE id = ?')) {
      return [{ id: 'new-demox-account', email: 'different@demox.example', nickname: 'New user' }];
    }
    if (sql.includes('FROM project_invitations pi')) return [];
    if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) {
      return [{
        feishu_open_id: 'ou_target',
        feishu_tenant_key: 'tenant_a',
        feishu_department_ids: '[]',
        feishu_directory_synced_at: new Date()
      }];
    }
    if (sql.includes("principal_type = 'user'") && sql.includes("key_type = 'open_id'")) {
      return [{ project_id: 42, role: 'member' }];
    }
    if (sql.includes("principal_type = 'department'") && sql.includes('COUNT(*)')) return [{ c: 0 }];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members pm')) {
      listParams = params;
      return [{
        id: 42,
        project_key: 'PGRANTED1',
        user_id: 'project-owner',
        name: 'Granted project',
        slug: 'granted-project',
        archived: 0,
        websites_count: 1,
        project_role: null
      }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request(
    'list_projects',
    {},
    'new-demox-account',
    'different@demox.example'
  )).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.count, 1);
  assert.equal(body.projects[0].name, 'Granted project');
  assert.equal(body.projects[0].role, 'member');
  assert.equal(listParams.includes('42'), true);
  assert.equal(listParams.includes('different@demox.example'), false);
});

test('a child-department user matches a parent department grant', async () => {
  const stale = new Date(0);
  directoryImpl.getUserDepartmentClosure = async () => ({ departmentIds: ['od-child', 'od-parent'] });
  queryImpl = async (sql, params) => {
    if (sql.includes('FROM websites w')) return [{ path: 'x', user_id: 'owner', project_id: 42, website_id: 'PRIVATE1', visibility: 'private' }];
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) {
      return [{ feishu_open_id: 'ou_child', feishu_tenant_key: 'tenant_a', feishu_department_ids: '["od-child"]', feishu_directory_synced_at: stale }];
    }
    if (sql.includes("principal_type = 'user'") && sql.includes("key_type = 'open_id'")) return [];
    if (sql.includes("principal_type = 'department'") && sql.includes('COUNT(*)')) return [{ c: 1 }];
    if (sql.includes('UPDATE users') && sql.includes('feishu_department_ids')) return { affectedRows: 1 };
    if (sql.includes("principal_type = 'department'") && sql.includes('principal_key IN')) {
      assert.deepEqual(params, ['tenant_a', 'od-child', 'od-parent']);
      return [{ project_id: 42, role: 'member' }];
    }
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) return [{ id: 42, user_id: 'owner', project_role: null }];
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('check_site_access', { label: 'private1', domain: 'demox.site' })).body);
  assert.equal(body.allowed, true);
});

test('failed directory refresh denies department access but preserves direct grants', async () => {
  directoryImpl.getUserDepartmentClosure = async () => { throw new ActualDirectoryError('no authority', 40004); };
  let includeDirectGrant = false;
  queryImpl = async (sql) => {
    if (sql.includes('FROM websites w')) return [{ path: 'x', user_id: 'owner', project_id: 42, website_id: 'PRIVATE1', visibility: 'private' }];
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) {
      return [{ feishu_open_id: 'ou_target', feishu_tenant_key: 'tenant_a', feishu_department_ids: '["od-parent"]', feishu_directory_synced_at: new Date(0) }];
    }
    if (sql.includes("principal_type = 'user'") && sql.includes("key_type = 'open_id'")) return includeDirectGrant ? [{ project_id: 42, role: 'member' }] : [];
    if (sql.includes("principal_type = 'department'") && sql.includes('COUNT(*)')) return [{ c: 1 }];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) return includeDirectGrant ? [{ id: 42, user_id: 'owner', project_role: null }] : [];
    if (sql.includes("SELECT *, 'owner' AS project_role")) return [];
    throw new Error(`Unexpected query: ${sql}`);
  };

  let body = JSON.parse((await request('check_site_access', { label: 'private1', domain: 'demox.site' })).body);
  assert.equal(body.allowed, false);
  includeDirectGrant = true;
  body = JSON.parse((await request('check_site_access', { label: 'private1', domain: 'demox.site' })).body);
  assert.equal(body.allowed, true);
});

test('grant creation stores resolved open_id, never the lookup or Demox email', async () => {
  let insertedParams;
  queryImpl = async (sql, params) => {
    if (sql.includes('SELECT feishu_open_id') && sql.includes('feishu_email')) {
      return [{ feishu_open_id: 'ou_owner', feishu_tenant_key: 'tenant_a' }];
    }
    const access = ownerAccessQueries(sql);
    if (access !== null) return access;
    if (sql.includes('INSERT INTO project_feishu_grants')) { insertedParams = params; return { affectedRows: 1 }; }
    if (sql.includes('SELECT * FROM project_feishu_grants')) {
      return [{ id: 7, project_id: 42, principal_type: 'user', key_type: 'open_id', principal_key: 'ou_target', tenant_key: 'tenant_a', display_name: 'Feishu Person', role: 'member', created_by: 'project-owner' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('grant_project_to_feishu', {
    projectId: 42,
    principalType: 'user',
    principalKey: 'ou_target',
    displayName: 'Untrusted Name',
    role: 'member'
  }, 'project-owner', 'different@demox.example')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.grant.name, 'Feishu Person');
  assert.equal(insertedParams[3], 'ou_target');
  assert.equal(insertedParams[4], 'tenant_a');
  assert.equal(insertedParams.includes('different@demox.example'), false);
  assert.equal(insertedParams.includes('Untrusted Name'), false);
});

test('project admin cannot grant the admin role', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) return [];
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) return [{ id: 42, user_id: 'project-owner', project_role: 'admin' }];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const body = JSON.parse((await request('grant_project_to_feishu', {
    projectId: 42,
    principalType: 'department',
    principalKey: 'od-engineering',
    role: 'admin'
  }, 'project-admin')).body);
  assert.equal(body.success, false);
  assert.match(body.message, /admin 只能授予 member/);
});

test('removing a grant changes active to zero immediately', async () => {
  let revoked = false;
  queryImpl = async (sql) => {
    const access = ownerAccessQueries(sql);
    if (access !== null) return access;
    if (sql.includes('SELECT role FROM project_feishu_grants')) return [{ role: 'member' }];
    if (sql.includes('UPDATE project_feishu_grants SET active = 0')) { revoked = true; return { affectedRows: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const body = JSON.parse((await request('remove_project_feishu_grant', { projectId: 42, grantId: 7 }, 'project-owner')).body);
  assert.equal(body.success, true);
  assert.equal(revoked, true);
});

test('GitHub people search is denied when the caller has not bound GitHub', async () => {
  queryImpl = async (sql) => {
    const access = ownerAccessQueries(sql);
    if (access !== null) return access;
    if (sql.includes('SELECT github_id, github_login FROM users WHERE id')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const body = JSON.parse((await request('search_github_project_principals', {
    projectId: 42,
    query: 'alice'
  }, 'project-owner')).body);
  assert.equal(body.success, false);
  assert.match(body.message, /关联 GitHub/);
});

test('GitHub people search returns local Demox users first and remote GitHub users after', async () => {
  githubImpl.searchUsers = async () => [
    { id: '1', login: 'octocat', name: 'The Octocat', avatarUrl: 'https://example/a.png' },
    { id: '99', login: 'alice-gh', name: 'Alice GH', avatarUrl: null }
  ];
  queryImpl = async (sql) => {
    const access = ownerAccessQueries(sql);
    if (access !== null) return access;
    if (sql.includes('SELECT github_id, github_login FROM users WHERE id')) {
      return [{ github_id: '42', github_login: 'owner-gh' }];
    }
    if (sql.includes('CREATE TABLE IF NOT EXISTS project_github_grants')) return { affectedRows: 0 };
    if (sql.includes('FROM users u') && sql.includes('github_id')) {
      return [{ id: 'local-alice', email: 'alice@example.com', nickname: 'Alice Chen', github_id: '99', github_login: 'alice-gh', avatar_url: null }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('search_github_project_principals', {
    projectId: 42,
    query: 'alice'
  }, 'project-owner')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.principals.length, 2);
  assert.equal(body.principals[0].principalKey, '99');
  assert.equal(body.principals[0].alreadyOnDemox, true);
  assert.equal(body.principals[1].principalKey, '1');
  assert.equal(body.principals[1].githubLogin, 'octocat');
});

test('granting a GitHub user who already has a Demox account adds them as a member', async () => {
  let insertedMember;
  githubImpl.getUserById = async () => ({ id: '99', login: 'alice-gh', name: 'Alice GH', avatarUrl: null });
  queryImpl = async (sql, params) => {
    const access = ownerAccessQueries(sql);
    if (access !== null) return access;
    if (sql.includes('SELECT github_id, github_login FROM users WHERE id')) {
      return [{ github_id: '42', github_login: 'owner-gh' }];
    }
    if (sql.includes('CREATE TABLE IF NOT EXISTS project_github_grants')) return { affectedRows: 0 };
    if (sql.includes('FROM users') && sql.includes('github_id')) {
      return [{ id: 'local-alice', email: 'alice@example.com', nickname: 'Alice Chen' }];
    }
    if (sql.includes('SELECT role FROM project_members')) return [];
    if (sql.includes('INSERT INTO project_members')) {
      insertedMember = params;
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('grant_project_to_github', {
    projectId: 42,
    principalKey: '99',
    role: 'member'
  }, 'project-owner')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.member.userId, 'local-alice');
  assert.deepEqual(insertedMember.slice(0, 3), [42, 'local-alice', 'member']);
});

test('granting an unknown GitHub user stores a github_id grant', async () => {
  let insertedParams;
  githubImpl.getUserById = async () => ({ id: '1', login: 'octocat', name: 'The Octocat', avatarUrl: 'https://example/a.png' });
  queryImpl = async (sql, params) => {
    const access = ownerAccessQueries(sql);
    if (access !== null) return access;
    if (sql.includes('SELECT github_id, github_login FROM users WHERE id')) {
      return [{ github_id: '42', github_login: 'owner-gh' }];
    }
    if (sql.includes('CREATE TABLE IF NOT EXISTS project_github_grants')) return { affectedRows: 0 };
    if (sql.includes('FROM users') && sql.includes('github_id')) return [];
    if (sql.includes('INSERT INTO project_github_grants')) {
      insertedParams = params;
      return { affectedRows: 1 };
    }
    if (sql.includes('SELECT * FROM project_github_grants')) {
      return [{ id: 8, project_id: 42, principal_type: 'user', key_type: 'github_id', principal_key: '1', github_login: 'octocat', display_name: 'The Octocat', role: 'admin', created_by: 'project-owner' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('grant_project_to_github', {
    projectId: 42,
    principalKey: '1',
    role: 'admin'
  }, 'project-owner')).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.grant.principalKey, '1');
  assert.equal(body.grant.githubLogin, 'octocat');
  assert.equal(insertedParams[1], '1');
  assert.equal(insertedParams[5], 'admin');
});

test('a GitHub grant lets the matching github_id access a private project site', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('FROM websites w')) {
      return [{ path: 'sites/private/index.html', user_id: 'project-owner', project_id: 42, website_id: 'PRIVATE1', visibility: 'private' }];
    }
    if (sql.includes('FROM user_roles')) return [];
    if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) return [];
    if (sql.includes('CREATE TABLE IF NOT EXISTS project_github_grants')) return { affectedRows: 0 };
    if (sql.includes('SELECT github_id') && sql.includes('FROM users WHERE id')) {
      return [{ github_id: '1', github_login: 'octocat' }];
    }
    if (sql.includes('FROM project_github_grants') && sql.includes("key_type = 'github_id'")) {
      return [{ project_id: 42, role: 'member' }];
    }
    if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) {
      return [{ id: 42, user_id: 'project-owner', project_role: null }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('check_site_access', { label: 'private1', domain: 'demox.site' }, 'github-user')).body);
  assert.equal(body.allowed, true);
});

test('pro and admin roles can configure whether a site hides the watermark', async () => {
  for (const role of ['pro', 'admin']) {
    let updatedParams = null;
    queryImpl = async (sql, params) => {
      if (sql.includes('information_schema.COLUMNS') && sql.includes('hide_watermark')) {
        return [{ COLUMN_NAME: 'hide_watermark' }];
      }
      if (sql.includes('SELECT * FROM websites WHERE id = ?')) {
        return [{ id: 7, user_id: `watermark-${role}`, hide_watermark: 0 }];
      }
      if (sql.includes('FROM user_roles')) return [{ roles: [role, 'user'] }];
      if (sql.includes('UPDATE websites SET hide_watermark')) {
        updatedParams = params;
        return { affectedRows: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    const body = JSON.parse((await request(
      'update_watermark',
      { docId: 7, hideWatermark: true },
      `watermark-${role}`
    )).body);
    assert.equal(body.success, true, JSON.stringify(body));
    assert.equal(body.hideWatermark, true);
    assert.deepEqual(updatedParams, [1, 7]);
  }
});

test('roles other than pro and admin cannot view site analytics', async () => {
  let statsQueried = false;
  queryImpl = async (sql) => {
    if (sql.includes('SELECT * FROM websites WHERE website_id = ?')) {
      return [{ id: 9, website_id: 'ANALYTICS1', user_id: 'analytics-basic' }];
    }
    if (sql.includes('FROM user_roles')) return [{ roles: ['user'] }];
    if (sql.includes('FROM site_path_daily_stats') || sql.includes('FROM site_daily_stats') || sql.includes('FROM site_access_logs')) {
      statsQueried = true;
      return [];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const statsBody = JSON.parse((await request(
    'get_site_stats',
    { websiteId: 'ANALYTICS1' },
    'analytics-basic'
  )).body);
  assert.equal(statsBody.success, false, JSON.stringify(statsBody));
  assert.equal(statsBody.code, 'ANALYTICS_ROLE_REQUIRED');

  const logsBody = JSON.parse((await request(
    'get_site_access_logs',
    { websiteId: 'ANALYTICS1' },
    'analytics-basic'
  )).body);
  assert.equal(logsBody.success, false, JSON.stringify(logsBody));
  assert.equal(logsBody.code, 'ANALYTICS_ROLE_REQUIRED');
  assert.equal(statsQueried, false);
});

test('pro and admin roles can request site analytics', async () => {
  for (const role of ['pro', 'admin']) {
    queryImpl = async (sql) => {
      if (sql.includes('SELECT * FROM websites WHERE website_id = ?')) {
        return [{ id: 10, website_id: 'ANALYTICS2', user_id: `analytics-${role}` }];
      }
      if (sql.includes('FROM user_roles')) return [{ roles: [role, 'user'] }];
      if (
        sql.includes('FROM site_path_daily_stats') ||
        sql.includes('FROM site_daily_stats') ||
        sql.includes('FROM site_referrer_daily_stats') ||
        sql.includes('FROM site_country_daily_stats') ||
        sql.includes('FROM site_province_daily_stats')
      ) {
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    const body = JSON.parse((await request(
      'get_site_stats',
      { websiteId: 'ANALYTICS2' },
      `analytics-${role}`
    )).body);
    assert.equal(body.success, true, JSON.stringify(body));
    assert.equal(body.websiteId, 'ANALYTICS2');
  }
});

test('expired pro cannot request site analytics', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('SELECT * FROM websites WHERE website_id = ?')) {
      return [{ id: 11, website_id: 'ANALYTICS3', user_id: 'expired-pro' }];
    }
    if (sql.includes('FROM user_roles')) {
      return [{ roles: ['pro', 'user'], pro_expires_at: '2020-01-01T00:00:00Z' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request(
    'get_site_stats',
    { websiteId: 'ANALYTICS3' },
    'expired-pro'
  )).body);
  assert.equal(body.success, false, JSON.stringify(body));
  assert.equal(body.code, 'ANALYTICS_ROLE_REQUIRED');
});

test('roles other than pro and admin cannot update SEO', async () => {
  let updateAttempted = false;
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS') && sql.includes("COLUMN_NAME IN ('seo_title'")) {
      return [
        { COLUMN_NAME: 'seo_title' },
        { COLUMN_NAME: 'seo_description' },
        { COLUMN_NAME: 'og_image' }
      ];
    }
    if (sql.includes('SELECT * FROM websites WHERE id = ?')) {
      return [{ id: 11, user_id: 'seo-basic', website_id: 'SEO1' }];
    }
    if (sql.includes('FROM user_roles')) return [{ roles: ['user'] }];
    if (sql.includes('UPDATE websites SET seo_title')) {
      updateAttempted = true;
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request(
    'update_seo',
    { docId: 11, seoTitle: 'New title' },
    'seo-basic'
  )).body);
  assert.equal(body.success, false, JSON.stringify(body));
  assert.equal(body.code, 'SEO_ROLE_REQUIRED');
  assert.equal(updateAttempted, false);
});

test('roles other than pro and admin cannot configure the watermark', async () => {
  let updateAttempted = false;
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS') && sql.includes('hide_watermark')) {
      return [{ COLUMN_NAME: 'hide_watermark' }];
    }
    if (sql.includes('SELECT * FROM websites WHERE id = ?')) {
      return [{ id: 8, user_id: 'watermark-basic', hide_watermark: 0 }];
    }
    if (sql.includes('FROM user_roles')) return [{ roles: ['user'] }];
    if (sql.includes('UPDATE websites SET hide_watermark')) {
      updateAttempted = true;
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  for (const hideWatermark of [true, false]) {
    const body = JSON.parse((await request(
      'update_watermark',
      { docId: 8, hideWatermark },
      'watermark-basic'
    )).body);
    assert.equal(body.success, false, JSON.stringify(body));
    assert.equal(body.code, 'WATERMARK_ROLE_REQUIRED');
  }
  assert.equal(updateAttempted, false);
});

test('public site resolution exposes the persisted watermark preference to the edge', async () => {
  queryImpl = async (sql) => {
    if (sql.includes('information_schema.COLUMNS') && sql.includes("COLUMN_NAME IN ('seo_title'")) {
      return [
        { COLUMN_NAME: 'seo_title' },
        { COLUMN_NAME: 'seo_description' },
        { COLUMN_NAME: 'og_image' }
      ];
    }
    if (sql.includes('FROM websites w') && sql.includes('hide_watermark')) {
      return [{
        path: 'sites/watermark/index.html',
        user_id: 'watermark-pro',
        project_id: null,
        website_id: 'WATERMARK1',
        site_name: 'Watermark site',
        seo_title: 'Share title',
        seo_description: 'Share desc',
        og_image: 'https://cdn.example/og.png',
        visibility: 'public',
        hide_watermark: 1,
        origin_host: 'sites.demox.site'
      }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const body = JSON.parse((await request('resolve_subdomain', {
    subdomain: 'watermark1',
    domain: 'demox.site'
  })).body);
  assert.equal(body.success, true, JSON.stringify(body));
  assert.equal(body.websiteId, 'WATERMARK1');
  assert.equal(body.hideWatermark, true);
  assert.deepEqual(body.seo, {
    title: 'Share title',
    description: 'Share desc',
    ogImage: 'https://cdn.example/og.png'
  });
});

const dns = require('dns');
const originalResolveCname = dns.promises.resolveCname;

function customDomainFixtureQueries(sql, extras = {}) {
  if (sql.includes('CREATE TABLE IF NOT EXISTS custom_domains') || sql.includes('CREATE TABLE IF NOT EXISTS custom_domain_routes')) {
    return { affectedRows: 0 };
  }
  if (sql.includes('FROM user_roles')) return extras.roles || [];
  if (sql.includes('SELECT feishu_open_id') && sql.includes('FROM users WHERE id')) return [];
  if (sql.includes('FROM project_github_grants') || sql.includes('FROM project_feishu_grants')) return [];
  if (sql.includes('github_id') && sql.includes('FROM users WHERE id')) return [];
  if (sql.includes('FROM projects p') && sql.includes('LEFT JOIN project_members')) {
    return [{
      id: 42,
      user_id: extras.ownerId || 'project-owner',
      project_role: extras.role || 'owner',
      archived: 0
    }];
  }
  if (sql.includes('FROM projects') && sql.includes('user_id =')) {
    return [{ id: 42, user_id: extras.ownerId || 'project-owner', project_role: 'owner', archived: 0 }];
  }
  if (sql.includes('SELECT id FROM projects WHERE id = ? AND archived = 0')) return [{ id: 42 }];
  if (sql.includes('information_schema.COLUMNS')) {
    if (sql.includes("TABLE_NAME = 'custom_domains'") && sql.includes("COLUMN_NAME = 'website_id'")) return [];
    if (sql.includes('hide_watermark')) return [{ COLUMN_NAME: 'hide_watermark' }];
    return [{ COLUMN_NAME: 'seo_title' }, { COLUMN_NAME: 'seo_description' }, { COLUMN_NAME: 'og_image' }];
  }
  return extras.fallback ? extras.fallback(sql) : null;
}

const projectDomainRow = {
  id: 17,
  project_id: 42,
  hostname: 'demox.aigc.sx.cn',
  status: 'pending',
  created_by: 'project-owner',
  verified_at: null,
  created_at: '2026-08-31T00:00:00Z'
};

function siteResolveRow(websiteId, path) {
  return {
    path,
    user_id: 'project-owner',
    project_id: 42,
    website_id: websiteId,
    subdomain: null,
    site_name: websiteId,
    seo_title: null,
    seo_description: null,
    og_image: null,
    subdomain_domain: 'demox.site',
    visibility: 'public',
    hide_watermark: 0,
    origin_host: 'sites.demox.site'
  };
}

test('project custom domain belongs to the project and can route root plus a subdomain', async () => {
  const insertedDomains = [];
  const insertedRoutes = [];
  dns.promises.resolveCname = async () => {
    throw Object.assign(new Error('queryCname ENODATA'), { code: 'ENODATA' });
  };
  queryImpl = async (sql, params) => {
    const shared = customDomainFixtureQueries(sql);
    if (shared) return shared;
    if (sql.includes('SELECT * FROM websites WHERE website_id = ?')) {
      return [{
        id: params[0] === 'SUBSITE1' ? 10 : 9,
        user_id: 'project-owner',
        website_id: params[0],
        project_id: 42,
        name: params[0] === 'SUBSITE1' ? 'Sub site' : 'Demox site'
      }];
    }
    if (sql.includes('FROM custom_domains') && sql.includes('LIKE CONCAT')) return [];
    if (sql.includes('INSERT INTO custom_domains')) {
      insertedDomains.push(params);
      return { insertId: 17, affectedRows: 1 };
    }
    if (sql.includes('SELECT id FROM custom_domain_routes')) return [];
    if (sql.includes('INSERT INTO custom_domain_routes')) {
      insertedRoutes.push(params);
      return { insertId: insertedRoutes.length, affectedRows: 1 };
    }
    if (sql.includes('SELECT * FROM custom_domains WHERE') && sql.includes('id = ?')) return [{ ...projectDomainRow }];
    if (sql.includes('FROM custom_domain_routes r')) {
      return insertedRoutes.map((route, index) => ({
        id: index + 1,
        label: route[1],
        website_id: route[2],
        created_at: '2026-08-31T00:00:00Z',
        website_public_id: route[2] === 10 ? 'SUBSITE1' : 'SITEOK01',
        website_name: route[2] === 10 ? 'Sub site' : 'Demox site'
      }));
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const rejected = JSON.parse((await request('add_project_custom_domain', {
      projectId: 42,
      hostname: 'hello.demox.site',
      websiteId: 'SITEOK01'
    }, 'project-owner')).body);
    assert.equal(rejected.success, false, JSON.stringify(rejected));
    assert.equal(rejected.reason, 'official');

    const added = JSON.parse((await request('add_project_custom_domain', {
      projectId: 42,
      hostname: 'https://Demox.Aigc.sx.cn/path',
      websiteId: 'SITEOK01'
    }, 'project-owner')).body);
    assert.equal(added.success, true, JSON.stringify(added));
    assert.equal(added.domain.hostname, 'demox.aigc.sx.cn');
    assert.equal(added.domain.defaultWebsiteId, 'SITEOK01');
    assert.equal(added.domain.cnameHost, 'demox');
    assert.equal(added.domain.wildcardHost, '*.demox');
    assert.equal(insertedDomains[0][1], 'demox.aigc.sx.cn');
    assert.equal(insertedRoutes[0][1], '');

    const routed = JSON.parse((await request('set_project_custom_domain_route', {
      projectId: 42,
      domainId: 17,
      label: 'subsite',
      websiteId: 'SUBSITE1'
    }, 'project-owner')).body);
    assert.equal(routed.success, true, JSON.stringify(routed));
    assert.equal(routed.route.hostname, 'subsite.demox.aigc.sx.cn');
    assert.equal(routed.route.websiteId, 'SUBSITE1');
    assert.equal(insertedRoutes[1][1], 'subsite');
  } finally {
    dns.promises.resolveCname = originalResolveCname;
  }
});

test('project custom domain list and public resolve use root and subdomain routes', async () => {
  queryImpl = async (sql, params = []) => {
    const shared = customDomainFixtureQueries(sql);
    if (shared) return shared;
    if (sql.includes('SELECT * FROM custom_domains WHERE project_id = ?')) return [{ ...projectDomainRow }];
    if (sql.includes('FROM custom_domain_routes r') && sql.includes('r.custom_domain_id = ?')) {
      return [
        { id: 1, label: '', website_id: 9, website_public_id: 'SITEOK01', website_name: 'Demox site' },
        { id: 2, label: 'subsite', website_id: 10, website_public_id: 'SUBSITE1', website_name: 'Sub site' }
      ];
    }
    if (sql.includes("CONCAT(r.label, '.', cd.hostname)")) {
      return [siteResolveRow('SUBSITE1', 'sites/42/SUBSITE1/dist')];
    }
    if (sql.includes("AND r.label = ''") && sql.includes('cd.hostname = ?')) {
      const host = params[params.length - 1];
      if (host !== 'demox.aigc.sx.cn') return [];
      return [siteResolveRow('SITEOK01', 'sites/42/SITEOK01/dist')];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const listed = JSON.parse((await request('list_project_custom_domains', {
    projectId: 42
  }, 'project-owner')).body);
  assert.equal(listed.success, true, JSON.stringify(listed));
  assert.equal(listed.domains[0].hostname, 'demox.aigc.sx.cn');
  assert.equal(listed.domains[0].routes.length, 2);
  assert.equal(listed.domains[0].routes[1].hostname, 'subsite.demox.aigc.sx.cn');

  const root = JSON.parse((await request('resolve_subdomain', { host: 'demox.aigc.sx.cn' })).body);
  assert.equal(root.success, true, JSON.stringify(root));
  assert.equal(root.websiteId, 'SITEOK01');

  const sub = JSON.parse((await request('resolve_subdomain', { host: 'subsite.demox.aigc.sx.cn' })).body);
  assert.equal(sub.success, true, JSON.stringify(sub));
  assert.equal(sub.websiteId, 'SUBSITE1');
  assert.equal(sub.path, 'sites/42/SUBSITE1/dist');
});

test('website list exposes custom hosts for the site card links', async () => {
  queryImpl = async (sql) => {
    const shared = customDomainFixtureQueries(sql);
    if (shared) return shared;
    if (sql.includes('FROM websites w') && sql.includes('LEFT JOIN projects p')) {
      return [{
        id: 9,
        user_id: 'project-owner',
        website_id: 'SITEOK01',
        project_id: 42,
        name: 'Demox site',
        subdomain: null,
        subdomain_domain: 'demox.site',
        visibility: 'public',
        hide_watermark: 0
      }];
    }
    if (sql.includes('JOIN custom_domains cd') && sql.includes('custom_domain_routes r')) {
      return [{ numeric_id: 9, root_hostname: 'demox.aigc.sx.cn', label: '' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const listed = JSON.parse((await request('list', {}, 'project-owner')).body);
  assert.equal(listed.success, true, JSON.stringify(listed));
  assert.deepEqual(listed.websites[0].customHosts, ['demox.aigc.sx.cn']);
  assert.equal(listed.websites[0].url, 'https://demox.aigc.sx.cn/');
});

test('project custom domain verify rejects CNAME to an official demox.site host', async () => {
  dns.promises.resolveCname = async (hostname) => {
    if (hostname === 'markdown.frostplume.top') return ['podfwngc.demox.site.'];
    throw Object.assign(new Error('queryCname ENODATA'), { code: 'ENODATA' });
  };
  queryImpl = async (sql) => {
    const shared = customDomainFixtureQueries(sql);
    if (shared) return shared;
    if (sql.includes('SELECT * FROM custom_domains WHERE') && sql.includes('id = ?')) {
      return [{ ...projectDomainRow, hostname: 'markdown.frostplume.top', status: 'pending' }];
    }
    if (sql.includes('FROM custom_domain_routes r')) return [];
    if (sql.includes('UPDATE custom_domains') && sql.includes('SET status = ?')) return { affectedRows: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const body = JSON.parse((await request('verify_project_custom_domain', {
      projectId: 42,
      domainId: 17
    }, 'project-owner')).body);
    assert.equal(body.success, true, JSON.stringify(body));
    assert.equal(body.domain.status, 'pending');
    assert.match(body.message, /customers\.demox\.site/);
    assert.match(body.message, /不能指向/);
  } finally {
    dns.promises.resolveCname = originalResolveCname;
  }
});

test('project custom domain verify marks active when CNAME hits the shared entrance', async () => {
  dns.promises.resolveCname = async (hostname) => {
    if (hostname === 'demox.aigc.sx.cn') return ['customers.demox.site.'];
    throw Object.assign(new Error('queryCname ENODATA'), { code: 'ENODATA' });
  };
  const updates = [];
  queryImpl = async (sql, params) => {
    const shared = customDomainFixtureQueries(sql);
    if (shared) return shared;
    if (sql.includes('SELECT * FROM custom_domains WHERE') && sql.includes('id = ?')) return [{ ...projectDomainRow }];
    if (sql.includes('FROM custom_domain_routes r')) return [];
    if (sql.includes('UPDATE custom_domains') && sql.includes('SET status = ?')) {
      updates.push(params);
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const body = JSON.parse((await request('verify_project_custom_domain', {
      projectId: 42,
      domainId: 17
    }, 'project-owner')).body);
    assert.equal(body.success, true, JSON.stringify(body));
    assert.equal(body.domain.status, 'active');
    assert.deepEqual(body.domain.cnameChain, ['customers.demox.site']);
    assert.equal(updates[0][0], 'active');
    assert.match(body.message, /可访问/);
  } finally {
    dns.promises.resolveCname = originalResolveCname;
  }
});

test('project custom domain stays pending when the shared CNAME target is not the gateway', async () => {
  dns.promises.resolveCname = async (hostname) => {
    if (hostname === 'demox.aigc.sx.cn') return ['customers.demox.site.'];
    throw Object.assign(new Error('queryCname ENODATA'), { code: 'ENODATA' });
  };
  setCustomDomainRuntime({
    lookupGatewayAddresses: async () => ['1.1.1.1'],
    probeHttps: async () => ({ ok: true, status: 200 }),
    provision: async () => ({ ok: true })
  });
  queryImpl = async (sql) => {
    const shared = customDomainFixtureQueries(sql);
    if (shared) return shared;
    if (sql.includes('SELECT * FROM custom_domains WHERE') && sql.includes('id = ?')) return [{ ...projectDomainRow }];
    if (sql.includes('FROM custom_domain_routes r')) return [];
    if (sql.includes('UPDATE custom_domains') && sql.includes('SET status = ?')) return { affectedRows: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const body = JSON.parse((await request('verify_project_custom_domain', {
      projectId: 42,
      domainId: 17
    }, 'project-owner')).body);
    assert.equal(body.success, true, JSON.stringify(body));
    assert.equal(body.domain.status, 'pending');
    assert.match(body.message, /网关/);
  } finally {
    dns.promises.resolveCname = originalResolveCname;
  }
});

test('project custom domain stays pending until HTTPS actually serves the site', async () => {
  dns.promises.resolveCname = async (hostname) => {
    if (hostname === 'demox.aigc.sx.cn') return ['customers.demox.site.'];
    throw Object.assign(new Error('queryCname ENODATA'), { code: 'ENODATA' });
  };
  setCustomDomainRuntime({
    lookupGatewayAddresses: async () => ['119.91.123.2'],
    probeHttps: async () => ({ ok: false, reason: 'teapot', status: 418 }),
    provision: async () => ({ ok: true })
  });
  queryImpl = async (sql) => {
    const shared = customDomainFixtureQueries(sql);
    if (shared) return shared;
    if (sql.includes('SELECT * FROM custom_domains WHERE') && sql.includes('id = ?')) return [{ ...projectDomainRow }];
    if (sql.includes('FROM custom_domain_routes r')) return [];
    if (sql.includes('UPDATE custom_domains') && sql.includes('SET status = ?')) return { affectedRows: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  try {
    const body = JSON.parse((await request('verify_project_custom_domain', {
      projectId: 42,
      domainId: 17
    }, 'project-owner')).body);
    assert.equal(body.success, true, JSON.stringify(body));
    assert.equal(body.domain.status, 'pending');
    assert.match(body.message, /签发 HTTPS/);
  } finally {
    dns.promises.resolveCname = originalResolveCname;
  }
});


const { buildOriginPurgeTargets, websiteStoragePrefix, websitePrefixFromTarget, staleObjectKeys } = require('./index.js');

test('buildOriginPurgeTargets includes origin prefix for edge fetch', () => {
  const targets = buildOriginPurgeTargets({
    originHost: 'sites.demox.site',
    originPath: 'sites/42/EPX2UU43/dist',
    ownerId: 42,
    websiteId: 'EPX2UU43'
  });
  assert.ok(targets.includes('https://sites.demox.site/sites/42/EPX2UU43/'));
  assert.ok(targets.includes('https://sites.demox.site/sites/42/EPX2UU43/dist/'));
});

test('buildOriginPurgeTargets rejects unsafe origin paths', () => {
  const targets = buildOriginPurgeTargets({
    originHost: 'sites.demox.site',
    originPath: 'sites/42/../etc',
    ownerId: '',
    websiteId: ''
  });
  assert.deepEqual(targets, []);
});

test('websiteStoragePrefix rejects empty or path-like ids', () => {
  assert.equal(websiteStoragePrefix('42', 'EPX2UU43'), 'sites/42/EPX2UU43/');
  assert.equal(websiteStoragePrefix('', 'EPX2UU43'), '');
  assert.equal(websiteStoragePrefix('42', ''), '');
  assert.equal(websiteStoragePrefix('42/../x', 'EPX2UU43'), '');
  assert.equal(websiteStoragePrefix('42', 'EPX/2'), '');
});

test('websitePrefixFromTarget keeps only the website root', () => {
  assert.equal(websitePrefixFromTarget('sites/42/EPX2UU43/dist'), 'sites/42/EPX2UU43/');
  assert.equal(websitePrefixFromTarget('sites/42/EPX2UU43/build/'), 'sites/42/EPX2UU43/');
  assert.equal(websitePrefixFromTarget('other/42/EPX2UU43/dist'), '');
  assert.equal(websitePrefixFromTarget('sites/42'), '');
});

test('staleObjectKeys only removes leftovers under the same website prefix', () => {
  const prefix = 'sites/u1/SITE1/';
  const keep = [
    'sites/u1/SITE1/dist/index.html',
    'sites/u1/SITE1/dist/assets/a.js'
  ];
  const existing = [
    ...keep,
    'sites/u1/SITE1/dist/assets/old.js',
    'sites/u1/SITE1/oldzip/index.html',
    'sites/u1/SITE2/dist/index.html',
    'sites/u2/SITE1/dist/index.html'
  ];
  assert.deepEqual(staleObjectKeys(existing, keep, prefix).sort(), [
    'sites/u1/SITE1/dist/assets/old.js',
    'sites/u1/SITE1/oldzip/index.html'
  ]);
  assert.deepEqual(staleObjectKeys(existing, keep, ''), []);
  assert.deepEqual(staleObjectKeys(existing, keep, 'sites/'), []);
});
