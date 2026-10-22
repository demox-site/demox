const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectDbConnection, parseBasicAuth } = require('./project-db-connection');

function encodeBasic(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function memoryQuery() {
  const rows = [];
  const query = async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT password_enc')) {
      return rows.filter((row) => row.project_id === params[0]).slice(0, 1);
    }
    if (text.startsWith('INSERT INTO project_db_credentials')) {
      if (rows.some((row) => row.project_id === params[0])) {
        const error = new Error('Duplicate entry');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      rows.push({ project_id: params[0], password_enc: params[1] });
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${text}`);
  };
  return { query, rows };
}

function connection(db, projects = { alpha: 7 }) {
  return createProjectDbConnection({
    query: db.query,
    resolveProjectId: async (input) => projects[String(input)] || null,
    encrypt: (plain) => Buffer.from(String(plain), 'utf8').toString('base64'),
    decrypt: (enc) => Buffer.from(String(enc), 'base64').toString('utf8')
  });
}

test('parseBasicAuth reads username and password', () => {
  const parsed = parseBasicAuth({ headers: { Authorization: encodeBasic('alpha', 'secret') } });
  assert.deepEqual(parsed, { username: 'alpha', password: 'secret' });
  assert.equal(parseBasicAuth({ headers: { Authorization: 'Bearer token' } }), null);
});

test('issue returns the same password, and basic auth only opens that project', async () => {
  const db = memoryQuery();
  const api = connection(db);
  const first = await api.issue(7);
  const second = await api.issue(7);
  assert.equal(first, second);
  assert.equal(db.rows.length, 1);

  const ok = await api.authenticateBasic({ headers: { authorization: encodeBasic('alpha', first) } });
  assert.equal(ok.projectId, 7);

  const wrong = await api.authenticateBasic({ headers: { Authorization: encodeBasic('alpha', 'nope') } });
  assert.equal(wrong.error, 'denied');

  const unknown = await api.authenticateBasic({ headers: { Authorization: encodeBasic('beta', first) } });
  assert.equal(unknown.error, 'denied');

  const missing = await api.authenticateBasic({ headers: { Authorization: 'Bearer session' } });
  assert.equal(missing, null);
});

test('a missing credentials table denies basic auth and leaves issuing to the caller', async () => {
  const query = async () => {
    const error = new Error("Table 'demox.project_db_credentials' doesn't exist");
    error.code = 'ER_NO_SUCH_TABLE';
    throw error;
  };
  const api = connection({ query });
  const denied = await api.authenticateBasic({ headers: { Authorization: encodeBasic('alpha', 'secret') } });
  assert.equal(denied.error, 'denied');
  await assert.rejects(() => api.issue(7), /doesn't exist/);
});
