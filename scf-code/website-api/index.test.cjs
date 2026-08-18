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

const { main } = require('./index.js');
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
  directoryImpl = {
    getUser: async (openId) => ({ open_id: openId, name: 'Feishu Person', status: { is_resigned: false } }),
    getDepartment: async (id) => ({ open_department_id: id, name: 'Engineering', status: { is_deleted: false } }),
    resolveUserByEmail: async (email) => ({ openId: 'ou_target', name: 'Feishu Person', email }),
    listDepartments: async () => [],
    listUsers: async () => [],
    getUserDepartmentClosure: async () => ({ departmentIds: [] })
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

test('platform role updates normalize roles and keep the baseline user role', async () => {
  let savedRoles = null;
  queryImpl = async (sql, params) => {
    if (sql.includes('SELECT roles FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT id, priority FROM roles WHERE enabled = 1')) {
      return [
        { id: 'user', priority: 10 },
        { id: 'pro', priority: 50 },
        { id: 'admin', priority: 100 }
      ];
    }
    if (sql.includes('SELECT id FROM users WHERE id = ?')) return [{ id: params[0] }];
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
});

test('platform role updates reject unknown or disabled roles before writing', async () => {
  let wrote = false;
  queryImpl = async (sql) => {
    if (sql.includes('SELECT roles FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
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
    if (sql.includes('SELECT roles FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
    if (sql.includes('SELECT id, priority FROM roles WHERE enabled = 1')) {
      return [{ id: 'user', priority: 10 }, { id: 'pro', priority: 50 }, { id: 'admin', priority: 100 }];
    }
    if (sql.includes('SELECT id FROM users WHERE id = ?')) return [];
    if (sql.includes('SELECT user_id FROM user_roles WHERE user_id = ?')) return [];
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
    if (sql.includes('SELECT roles FROM user_roles WHERE user_id')) return [{ roles: ['admin', 'user'] }];
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
});
