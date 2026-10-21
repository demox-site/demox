const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const scanRoots = [
  path.join(repoRoot, 'scf-code'),
  path.join(repoRoot, 'scf-deploy-packages/auth-api')
];

// Schema-changing SQL. Comments are stripped first so a note can name a migration
// without counting as a statement the process would send.
const DDL = /\b(?:ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX|RENAME\s+TABLE|TRUNCATE(?:\s+TABLE)?|CREATE\s+DATABASE|DROP\s+DATABASE|MODIFY\s+COLUMN|CHANGE\s+COLUMN|ADD\s+COLUMN|DROP\s+COLUMN|CREATE\s+PROCEDURE)\b/i;
const READS_MIGRATION = /readFileSync\s*\([\s\S]{0,400}?\.sql/;
const DESTRUCTIVE = /\b(?:DROP\s+TABLE|DROP\s+COLUMN|DROP\s+INDEX|RENAME\s+TABLE|TRUNCATE\s+TABLE|DROP\s+DATABASE)\b/i;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'migrations') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.(?:js|cjs|mjs)$/.test(entry.name)) continue;
    if (/\.test\.(?:js|cjs|mjs)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function violationsIn(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const source = stripComments(raw);
  const found = [];
  const ddl = source.match(DDL);
  if (ddl) found.push(ddl[0]);
  if (READS_MIGRATION.test(source)) found.push('readFileSync(.sql)');
  return found;
}

test('the DDL detector matches a schema statement and ignores a comment', () => {
  assert.match(stripComments('await query("ALTER TABLE websites ADD COLUMN x INT")'), DDL);
  assert.equal(DDL.test(stripComments('// ALTER TABLE websites ADD COLUMN x INT\nconst n = 1;')), false);
  assert.equal(DDL.test(stripComments('/* CREATE TABLE t (id INT) */\nconst n = 1;')), false);
});

test('runtime code under scf-code and auth-api has no schema-changing SQL', () => {
  const files = scanRoots.flatMap((root) => walk(root, []));
  assert.ok(files.some((file) => file.endsWith(`${path.sep}website-api${path.sep}index.js`)));
  assert.ok(files.some((file) => file.endsWith(`${path.sep}project-data.js`)));
  assert.ok(files.some((file) => file.endsWith(`${path.sep}function-api${path.sep}index.js`)));
  assert.ok(files.some((file) => file.endsWith(`${path.sep}login-throttle.cjs`)));
  const hits = [];
  for (const file of files) {
    for (const hit of violationsIn(file)) {
      hits.push(`${path.relative(repoRoot, file)}: ${hit}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('new and rewritten migrations are idempotent and do not drop or rename', () => {
  const files = [
    'scf-code/website-api/migrations/016_add_pro_expires_at.sql',
    'scf-code/website-api/migrations/025_add_website_deployed_size.sql',
    'scf-code/website-api/migrations/026_add_website_disable_columns.sql',
    'scf-code/website-api/migrations/028_add_project_data_tables.sql',
    'scf-code/website-api/migrations/029_backfill_custom_domain_routes.sql',
    'scf-code/function-api/migrations/003_add_runtime_routes.sql',
    'scf-code/function-api/migrations/005_add_website_binding.sql',
    'scf-code/function-api/migrations/006_create_function_platform_secrets.sql',
    'scf-deploy-packages/auth-api/migrations/003_oauth_pkce.sql'
  ];
  for (const rel of files) {
    const sql = stripComments(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
    assert.equal(DESTRUCTIVE.test(sql), false, rel);
    assert.match(sql, /information_schema|IF NOT EXISTS/i, rel);
  }
  const projectData = fs.readFileSync(path.join(repoRoot, 'scf-code/website-api/migrations/028_add_project_data_tables.sql'), 'utf8');
  assert.match(projectData, /CREATE TABLE IF NOT EXISTS project_tables/);
  assert.match(projectData, /CREATE TABLE IF NOT EXISTS project_rows/);
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'scf-code/website-api/migrations/027_add_role_quota_columns.sql')),
    false
  );
  const binding = fs.readFileSync(path.join(repoRoot, 'scf-code/function-api/migrations/005_add_website_binding.sql'), 'utf8');
  assert.equal(/DROP\s+INDEX/i.test(stripComments(binding)), false);
  assert.match(binding, /uq_demox_functions_website_slug/);
});
