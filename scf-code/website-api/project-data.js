'use strict';

// 一个项目对应一份表和行。表目录和全部行都在 Demox 现有的 MySQL 里，
// 行表按 project_id 分开。这里不新建物理库，也不对外开放数据库端口。

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const TYPES = new Set(['text', 'number', 'boolean']);
const MAX_TABLES = 64;
const MAX_COLUMNS = 32;
const MAX_LIST = 100;
const MAX_ROW_BYTES = 32 * 1024;
const MAX_PK = 255;
// 普通用户默认：每个项目数据库最多 100MB（角色 max_db_bytes 可覆盖；null=不限）
const DEFAULT_MAX_DB_BYTES = 100 * 1024 * 1024;

function dataError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeColumns(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_COLUMNS) {
    throw dataError('bad_schema', '列需要 1 到 32 个');
  }
  const columns = [];
  const seen = new Set();
  let primary = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw dataError('bad_schema', '列格式不正确');
    const name = String(raw.name || '').trim();
    const type = String(raw.type || '');
    if (!NAME_RE.test(name)) throw dataError('bad_name', '列名需要以字母开头，只能包含小写字母、数字和下划线');
    if (!TYPES.has(type)) throw dataError('bad_schema', '列类型只能是 text、number 或 boolean');
    if (seen.has(name)) throw dataError('bad_schema', '列名不能重复');
    seen.add(name);
    const isPrimary = raw.primary === true;
    if (isPrimary) {
      primary += 1;
      if (type !== 'text') throw dataError('bad_schema', '主键列需要是文本');
    }
    columns.push({ name, type, primary: isPrimary });
  }
  if (primary !== 1) throw dataError('bad_schema', '需要正好一个文本主键');
  return columns;
}

function primaryColumn(columns) {
  return columns.find((column) => column.primary);
}

function normalizeValue(column, value) {
  if (value == null || value === '') {
    if (column.primary) throw dataError('bad_row', '主键不能为空');
    return null;
  }
  if (column.type === 'text') {
    if (typeof value !== 'string') throw dataError('bad_row', `${column.name} 需要是文本`);
    return value;
  }
  if (column.type === 'number') {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) throw dataError('bad_row', `${column.name} 需要是数字`);
    return number;
  }
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw dataError('bad_row', `${column.name} 需要是是或否`);
}

function normalizeRow(columns, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw dataError('bad_row', '行格式不正确');
  const known = new Set(columns.map((column) => column.name));
  for (const key of Object.keys(values)) {
    if (!known.has(key)) throw dataError('bad_row', '这一行有表里没有的列');
  }
  const doc = {};
  for (const column of columns) doc[column.name] = normalizeValue(column, values[column.name]);
  const pk = doc[primaryColumn(columns).name];
  if (typeof pk !== 'string' || !pk.trim() || pk.length > MAX_PK) throw dataError('bad_row', '主键不能为空，且不超过 255 个字符');
  doc[primaryColumn(columns).name] = pk;
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_ROW_BYTES) throw dataError('bad_row', '这一行太大');
  return { pk, doc };
}

function publicTable(row, rowCount) {
  return {
    name: row.name,
    columns: parseJson(row.columns_json, []),
    rowCount: Number(rowCount == null ? row.row_count : rowCount) || 0,
    createdAt: row.created_at || null
  };
}

function publicRow(row) {
  return {
    pk: row.pk,
    values: parseJson(row.doc, {}),
    updatedAt: row.updated_at || null
  };
}

function docByteLength(doc) {
  if (doc == null) return 0;
  if (Buffer.isBuffer(doc)) return doc.length;
  if (typeof doc === 'string') return Buffer.byteLength(doc);
  return Buffer.byteLength(JSON.stringify(doc));
}

function createProjectData(query) {
  async function ensure() {
    // Tables are created by migrations/028_add_project_data_tables.sql.
  }

  async function getTableRow(projectId, name) {
    const rows = await query(
      'SELECT id, name, columns_json, created_at FROM project_tables WHERE project_id = ? AND name = ? LIMIT 1',
      [projectId, name]
    );
    return rows[0] || null;
  }

  async function usageBytes(projectId) {
    await ensure();
    const rows = await query(
      `SELECT COALESCE(SUM(OCTET_LENGTH(CAST(doc AS CHAR))), 0) AS n
       FROM project_rows WHERE project_id = ?`,
      [projectId]
    );
    return Number(rows[0] && rows[0].n) || 0;
  }

  async function getUsage(projectId, maxBytes) {
    const bytesUsed = await usageBytes(projectId);
    const bytesLimit = maxBytes == null ? null : Number(maxBytes);
    return {
      bytesUsed,
      bytesLimit: Number.isFinite(bytesLimit) && bytesLimit > 0 ? bytesLimit : null
    };
  }

  async function listTables(projectId) {
    await ensure();
    const rows = await query(
      `SELECT t.id, t.name, t.columns_json, t.created_at, COUNT(r.pk) AS row_count
       FROM project_tables t
       LEFT JOIN project_rows r ON r.project_id = t.project_id AND r.table_id = t.id
       WHERE t.project_id = ?
       GROUP BY t.id
       ORDER BY t.name`,
      [projectId]
    );
    return rows.map((row) => publicTable(row));
  }

  async function createTable(projectId, spec) {
    await ensure();
    const name = String(spec && spec.name || '').trim();
    if (!NAME_RE.test(name)) throw dataError('bad_name', '表名需要以字母开头，只能包含小写字母、数字和下划线');
    const columns = normalizeColumns(spec && spec.columns);
    const counts = await query('SELECT COUNT(*) AS n FROM project_tables WHERE project_id = ?', [projectId]);
    if (Number(counts[0] && counts[0].n) >= MAX_TABLES) throw dataError('quota', '这个项目的表已经到上限');
    try {
      await query(
        'INSERT INTO project_tables (project_id, name, columns_json) VALUES (?, ?, ?)',
        [projectId, name, JSON.stringify(columns)]
      );
    } catch (error) {
      if (error && (error.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(error.message || ''))) {
        throw dataError('exists', '这个表已经存在');
      }
      throw error;
    }
    return publicTable({ name, columns_json: columns, created_at: null }, 0);
  }

  async function getTable(projectId, name) {
    await ensure();
    const row = await getTableRow(projectId, name);
    if (!row) throw dataError('not_found', '没有这张表');
    const counts = await query(
      'SELECT COUNT(*) AS n FROM project_rows WHERE project_id = ? AND table_id = ?',
      [projectId, row.id]
    );
    return publicTable(row, counts[0] && counts[0].n);
  }

  async function deleteTable(projectId, name) {
    await ensure();
    const row = await getTableRow(projectId, name);
    if (!row) throw dataError('not_found', '没有这张表');
    await query('DELETE FROM project_rows WHERE project_id = ? AND table_id = ?', [projectId, row.id]);
    await query('DELETE FROM project_tables WHERE project_id = ? AND id = ?', [projectId, row.id]);
    return { deleted: name };
  }

  async function listRows(projectId, name, { limit, after } = {}) {
    await ensure();
    const table = await getTableRow(projectId, name);
    if (!table) throw dataError('not_found', '没有这张表');
    const size = Math.min(MAX_LIST, Math.max(1, Number(limit) || 50));
    const cursor = after == null ? '' : String(after);
    const params = [projectId, table.id];
    let where = 'project_id = ? AND table_id = ?';
    if (cursor) {
      where += ' AND pk > ?';
      params.push(cursor);
    }
    const rows = await query(
      `SELECT pk, doc, updated_at FROM project_rows WHERE ${where} ORDER BY pk LIMIT ${size + 1}`,
      params
    );
    const page = rows.slice(0, size).map(publicRow);
    const next = rows.length > size ? page[page.length - 1].pk : null;
    return { rows: page, next };
  }

  async function putRow(projectId, name, values, { maxBytes } = {}) {
    await ensure();
    const table = await getTableRow(projectId, name);
    if (!table) throw dataError('not_found', '没有这张表');
    const columns = parseJson(table.columns_json, []);
    const row = normalizeRow(columns, values);
    const newDoc = JSON.stringify(row.doc);
    const newBytes = Buffer.byteLength(newDoc);
    const existing = await query(
      'SELECT pk, doc FROM project_rows WHERE project_id = ? AND table_id = ? AND pk = ? LIMIT 1',
      [projectId, table.id, row.pk]
    );
    const limit = maxBytes === undefined ? DEFAULT_MAX_DB_BYTES : maxBytes;
    if (limit != null && Number(limit) > 0) {
      const oldBytes = existing[0] ? docByteLength(existing[0].doc) : 0;
      const used = await usageBytes(projectId);
      if (used - oldBytes + newBytes > Number(limit)) {
        throw dataError('quota', '这个项目的数据库已到容量上限');
      }
    }
    if (existing[0]) {
      await query(
        'UPDATE project_rows SET doc = ? WHERE project_id = ? AND table_id = ? AND pk = ?',
        [newDoc, projectId, table.id, row.pk]
      );
      return { created: false, pk: row.pk, values: row.doc };
    }
    await query(
      'INSERT INTO project_rows (project_id, table_id, pk, doc) VALUES (?, ?, ?, ?)',
      [projectId, table.id, row.pk, newDoc]
    );
    return { created: true, pk: row.pk, values: row.doc };
  }

  async function deleteRow(projectId, name, pk) {
    await ensure();
    const table = await getTableRow(projectId, name);
    if (!table) throw dataError('not_found', '没有这张表');
    const key = String(pk || '');
    if (!key) throw dataError('bad_row', '主键不能为空');
    const result = await query(
      'DELETE FROM project_rows WHERE project_id = ? AND table_id = ? AND pk = ?',
      [projectId, table.id, key]
    );
    if (!result || !result.affectedRows) throw dataError('not_found', '没有这一行');
    return { deleted: key };
  }

  return { ensure, listTables, createTable, getTable, deleteTable, listRows, putRow, deleteRow, usageBytes, getUsage };
}

async function deleteProjectData(exec, projectId) {
  for (const sql of [
    'DELETE FROM project_rows WHERE project_id = ?',
    'DELETE FROM project_tables WHERE project_id = ?'
  ]) {
    try {
      await exec(sql, [projectId]);
    } catch (error) {
      const text = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`;
      if (!/ER_NO_SUCH_TABLE|doesn't exist|does not exist/i.test(text)) throw error;
    }
  }
}

module.exports = {
  createProjectData,
  deleteProjectData,
  normalizeColumns,
  NAME_RE,
  DEFAULT_MAX_DB_BYTES
};
