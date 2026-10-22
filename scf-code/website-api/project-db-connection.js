'use strict';

const crypto = require('crypto');

function sameSecret(left, right) {
  const a = crypto.createHash('sha256').update(String(left)).digest();
  const b = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const value = headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  if (Array.isArray(value)) return value[0] ? String(value[0]) : '';
  return value ? String(value) : '';
}

function parseBasicAuth(event) {
  const headers = event && event.headers;
  const header = headerValue(headers, 'Authorization') || headerValue(headers, 'authorization');
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!match) return null;
  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return { error: 'denied' };
  }
  const split = decoded.indexOf(':');
  if (split <= 0) return { error: 'denied' };
  const username = decodeURIComponent(decoded.slice(0, split)).trim();
  const password = decoded.slice(split + 1);
  if (!username || !password) return { error: 'denied' };
  return { username, password };
}

function missingTable(error) {
  const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`;
  return /ER_NO_SUCH_TABLE|doesn't exist|does not exist/i.test(text);
}

function createProjectDbConnection({ query, resolveProjectId, encrypt, decrypt }) {
  async function issue(projectId) {
    const existing = await query(
      'SELECT password_enc FROM project_db_credentials WHERE project_id = ? LIMIT 1',
      [projectId]
    );
    if (existing[0]) return decrypt(existing[0].password_enc);
    const password = crypto.randomBytes(24).toString('base64url');
    try {
      await query(
        'INSERT INTO project_db_credentials (project_id, password_enc) VALUES (?, ?)',
        [projectId, encrypt(password)]
      );
      return password;
    } catch (error) {
      if (error && (error.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(error.message || ''))) {
        const again = await query(
          'SELECT password_enc FROM project_db_credentials WHERE project_id = ? LIMIT 1',
          [projectId]
        );
        if (again[0]) return decrypt(again[0].password_enc);
      }
      throw error;
    }
  }

  async function authenticateBasic(event) {
    const parsed = parseBasicAuth(event);
    if (!parsed) return null;
    if (parsed.error) return { error: 'denied' };
    const projectId = await resolveProjectId(parsed.username);
    if (!projectId) return { error: 'denied' };
    let rows;
    try {
      rows = await query(
        'SELECT password_enc FROM project_db_credentials WHERE project_id = ? LIMIT 1',
        [projectId]
      );
    } catch (error) {
      if (missingTable(error)) return { error: 'denied' };
      throw error;
    }
    if (!rows[0]) return { error: 'denied' };
    let stored;
    try {
      stored = decrypt(rows[0].password_enc);
    } catch {
      return { error: 'denied' };
    }
    if (!stored || !sameSecret(stored, parsed.password)) return { error: 'denied' };
    return { projectId, username: parsed.username };
  }

  return { issue, authenticateBasic };
}

module.exports = {
  createProjectDbConnection,
  parseBasicAuth,
  sameSecret
};
