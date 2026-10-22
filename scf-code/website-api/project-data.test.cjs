const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectData, deleteProjectData } = require('./project-data');

function memoryQuery() {
  const tables = [];
  const rows = [];
  let nextId = 1;
  const query = async (sql, params = []) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text.startsWith('CREATE TABLE')) return { affectedRows: 0 };
    if (text.startsWith('SELECT t.id')) {
      const projectId = params[0];
      return tables
        .filter((table) => table.project_id === projectId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((table) => ({
          ...table,
          row_count: rows.filter((row) => row.project_id === projectId && row.table_id === table.id).length
        }));
    }
    if (text.startsWith('SELECT COUNT(*) AS n FROM project_tables')) {
      return [{ n: tables.filter((table) => table.project_id === params[0]).length }];
    }
    if (text.startsWith('SELECT COUNT(*) AS n FROM project_rows')) {
      return [{ n: rows.filter((row) => row.project_id === params[0] && row.table_id === params[1]).length }];
    }
    if (text.startsWith('SELECT id, name, columns_json')) {
      return tables.filter((table) => table.project_id === params[0] && table.name === params[1]).slice(0, 1);
    }
    if (text.startsWith('INSERT INTO project_tables')) {
      if (tables.some((table) => table.project_id === params[0] && table.name === params[1])) {
        const error = new Error('Duplicate entry');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      tables.push({
        id: nextId++,
        project_id: params[0],
        name: params[1],
        columns_json: params[2],
        created_at: '2026-10-20T00:00:00.000Z'
      });
      return { affectedRows: 1, insertId: nextId - 1 };
    }
    if (text.startsWith('SELECT pk, doc')) {
      const matched = rows
        .filter((row) => row.project_id === params[0] && row.table_id === params[1] && (params.length < 3 || row.pk > params[2]))
        .sort((a, b) => (a.pk < b.pk ? -1 : a.pk > b.pk ? 1 : 0));
      return matched;
    }
    if (text.startsWith('SELECT pk FROM project_rows')) {
      return rows.filter((row) => row.project_id === params[0] && row.table_id === params[1] && row.pk === params[2]).slice(0, 1);
    }
    if (text.startsWith('UPDATE project_rows')) {
      const row = rows.find((item) => item.project_id === params[1] && item.table_id === params[2] && item.pk === params[3]);
      if (row) row.doc = params[0];
      return { affectedRows: row ? 1 : 0 };
    }
    if (text.startsWith('INSERT INTO project_rows')) {
      rows.push({ project_id: params[0], table_id: params[1], pk: params[2], doc: params[3], updated_at: '2026-10-20T00:00:00.000Z' });
      return { affectedRows: 1 };
    }
    if (text.startsWith('DELETE FROM project_rows WHERE project_id = ? AND table_id = ? AND pk = ?')) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (row.project_id === params[0] && row.table_id === params[1] && row.pk === params[2]) rows.splice(i, 1);
      }
      return { affectedRows: before - rows.length };
    }
    if (text.startsWith('DELETE FROM project_rows WHERE project_id = ? AND table_id = ?')) {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].project_id === params[0] && rows[i].table_id === params[1]) rows.splice(i, 1);
      }
      return { affectedRows: 1 };
    }
    if (text.startsWith('DELETE FROM project_tables WHERE project_id = ? AND id = ?')) {
      const index = tables.findIndex((table) => table.project_id === params[0] && table.id === params[1]);
      if (index >= 0) tables.splice(index, 1);
      return { affectedRows: index >= 0 ? 1 : 0 };
    }
    if (text === 'DELETE FROM project_rows WHERE project_id = ?') {
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].project_id === params[0]) rows.splice(i, 1);
      return { affectedRows: 1 };
    }
    if (text === 'DELETE FROM project_tables WHERE project_id = ?') {
      for (let i = tables.length - 1; i >= 0; i -= 1) if (tables[i].project_id === params[0]) tables.splice(i, 1);
      return { affectedRows: 1 };
    }
    if (text === 'DELETE FROM project_db_credentials WHERE project_id = ?') {
      return { affectedRows: 0 };
    }
    throw new Error(`Unexpected query: ${text}`);
  };
  return { query, tables, rows };
}

const columns = [
  { name: 'title', type: 'text', primary: true },
  { name: 'count', type: 'number' },
  { name: 'open', type: 'boolean' }
];

test('rows stay inside the project that owns the table', async () => {
  const db = memoryQuery();
  const data = createProjectData(db.query);
  await data.createTable(7, { name: 'notes', columns });
  await data.createTable(8, { name: 'notes', columns });
  await data.putRow(7, 'notes', { title: 'a', count: 1, open: true });

  const own = await data.listRows(7, 'notes');
  const other = await data.listRows(8, 'notes');
  assert.equal(own.rows.length, 1);
  assert.equal(own.rows[0].values.title, 'a');
  assert.equal(own.rows[0].values.count, 1);
  assert.equal(own.rows[0].values.open, true);
  assert.equal(other.rows.length, 0);
  assert.equal((await data.listTables(8))[0].rowCount, 0);
  assert.equal((await data.listTables(7))[0].rowCount, 1);
});

test('a table needs one text primary key and a fresh name', async () => {
  const db = memoryQuery();
  const data = createProjectData(db.query);
  await assert.rejects(
    data.createTable(7, { name: 'Notes', columns }),
    (error) => error.code === 'bad_name'
  );
  await assert.rejects(
    data.createTable(7, { name: 'notes', columns: [{ name: 'id', type: 'number', primary: true }] }),
    (error) => error.code === 'bad_schema'
  );
  await data.createTable(7, { name: 'notes', columns });
  await assert.rejects(data.createTable(7, { name: 'notes', columns }), (error) => error.code === 'exists');
});

test('putting the same primary key replaces the row', async () => {
  const db = memoryQuery();
  const data = createProjectData(db.query);
  await data.createTable(7, { name: 'notes', columns });
  const created = await data.putRow(7, 'notes', { title: 'a', count: 1, open: false });
  const replaced = await data.putRow(7, 'notes', { title: 'a', count: 2, open: true });
  assert.equal(created.created, true);
  assert.equal(replaced.created, false);
  const listed = await data.listRows(7, 'notes');
  assert.equal(listed.rows.length, 1);
  assert.equal(listed.rows[0].values.count, 2);
  await data.deleteRow(7, 'notes', 'a');
  assert.equal((await data.listRows(7, 'notes')).rows.length, 0);
});

test('a row cannot carry a column the table does not have', async () => {
  const db = memoryQuery();
  const data = createProjectData(db.query);
  await data.createTable(7, { name: 'notes', columns });
  await assert.rejects(
    data.putRow(7, 'notes', { title: 'a', extra: 1 }),
    (error) => error.code === 'bad_row'
  );
});

test('deleting a project removes its tables and rows only', async () => {
  const db = memoryQuery();
  const data = createProjectData(db.query);
  await data.createTable(7, { name: 'notes', columns });
  await data.createTable(8, { name: 'notes', columns });
  await data.putRow(7, 'notes', { title: 'a', count: 1, open: true });
  await data.putRow(8, 'notes', { title: 'b', count: 1, open: false });
  await deleteProjectData(db.query, 7);
  assert.equal((await data.listTables(7)).length, 0);
  assert.equal((await data.listTables(8)).length, 1);
  assert.equal((await data.listRows(8, 'notes')).rows[0].pk, 'b');
});
