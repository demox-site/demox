const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
require('../../scripts/log-leak-guard.cjs').installLogLeakGuard();

const { randomTestSecret } = require('../../scripts/test-jwt.cjs');
Object.assign(process.env, {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_USER: 'test',
  MYSQL_PASSWORD: 'test',
  MYSQL_DATABASE: 'test',
  JWT_SECRET: randomTestSecret(),
  FEISHU_APP_ID: 'cli_test',
  FEISHU_APP_SECRET: 'secret_test'
});

const cards = new Map();
let role = 'admin';
let failGallery = false;

function rowOf(id) {
  return cards.get(id) || null;
}

function listRows(whereEnabled) {
  return [...cards.values()]
    .filter((row) => !whereEnabled || Number(row.enabled) === 1)
    .sort((a, b) => a.row_num - b.row_num || a.sort_order - b.sort_order || String(a.id).localeCompare(String(b.id)));
}

let queryImpl = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.includes('FROM user_roles')) {
    if (!role) return [];
    return [{ roles: JSON.stringify([role]), pro_expires_at: null }];
  }
  if (compact.includes('INSERT INTO admin_audit_log')) {
    return { affectedRows: 1 };
  }
  if (failGallery && compact.includes('gallery_cards')) {
    throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' });
  }
  if (compact.startsWith('INSERT INTO gallery_cards')) {
    const [id, title, title_en, url, href, preview, image, caption, caption_en, row_num, sort_order, enabled] = params;
    cards.set(id, { id, title, title_en, url, href, preview, image, caption, caption_en, row_num, sort_order, enabled });
    return { affectedRows: 1 };
  }
  if (compact.startsWith('UPDATE gallery_cards SET sort_order')) {
    const [sort_order, id, rowNum] = params;
    const row = rowOf(id);
    if (row && Number(row.row_num) === Number(rowNum)) row.sort_order = sort_order;
    return { affectedRows: 1 };
  }
  if (compact.startsWith('UPDATE gallery_cards')) {
    const [title, title_en, url, href, preview, image, caption, caption_en, row_num, sort_order, enabled, id] = params;
    cards.set(id, { id, title, title_en, url, href, preview, image, caption, caption_en, row_num, sort_order, enabled });
    return { affectedRows: 1 };
  }
  if (compact.includes('COALESCE(MAX(sort_order)')) {
    const rowNum = params[0];
    const same = [...cards.values()].filter((row) => Number(row.row_num) === Number(rowNum));
    const max = same.reduce((n, row) => Math.max(n, Number(row.sort_order) || 0), 0);
    return [{ n: max + 1 }];
  }
  if (compact.includes('SELECT id, sort_order FROM gallery_cards WHERE id = ?')) {
    const row = rowOf(params[0]);
    return row ? [{ id: row.id, sort_order: row.sort_order }] : [];
  }
  if (compact.includes('SELECT id FROM gallery_cards WHERE row_num = ?')) {
    return listRows(false).filter((row) => Number(row.row_num) === Number(params[0])).map((row) => ({ id: row.id }));
  }
  if (compact.includes('FROM gallery_cards') && compact.includes('WHERE enabled = 1')) return listRows(true);
  if (compact.includes('FROM gallery_cards')) return listRows(false);
  return [];
};

const dbModulePath = require.resolve('./shared/db.js');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: {
    query: (...args) => queryImpl(...args),
    transaction: async (cb) => cb({ query: async (...args) => [await queryImpl(...args), []] })
  }
};

const websiteApi = require('./index.js');
const { sign } = require('./shared/jwt.js');
const gallery = websiteApi._galleryForTest;

function call(action, body = {}, { userId, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (userId) headers.Authorization = `Bearer ${sign({ userId, email: `${userId}@demox.example` })}`;
  return websiteApi.main({
    path: `/website/${action.replaceAll('_', '-')}`,
    httpMethod: 'POST',
    headers,
    body: { action, ...body }
  });
}

function card(partial = {}) {
  return {
    id: 'cafe',
    title: '好咖啡',
    titleEn: 'Coffee',
    url: 'https://coffee.demox.site/',
    href: '',
    preview: 'image',
    image: 'https://www.demox.site/gallery/coffee.webp',
    caption: '用 Demox 搭建',
    captionEn: 'Built with Demox',
    row: 1,
    enabled: true,
    ...partial
  };
}

function json(res) {
  return JSON.parse(res.body);
}

test('migration 019 includes bilingual columns and runtime does not create the table', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/019_add_gallery_cards.sql'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  for (const column of ['title_en', 'caption_en', 'CREATE TABLE IF NOT EXISTS gallery_cards']) {
    assert.match(sql, new RegExp(column));
  }
  assert.equal(source.includes('CREATE TABLE IF NOT EXISTS gallery_cards'), false);
  assert.equal(gallery.GALLERY_CARDS_DDL, undefined);
});

test('url and image must be https://*.demox.site', () => {
  assert.equal(gallery.isDemoxHttpsUrl('https://coffee.demox.site/'), true);
  assert.equal(gallery.isDemoxHttpsUrl('https://www.demox.site/gallery/a.webp'), true);
  assert.equal(gallery.isDemoxHttpsUrl('https://demox.site/'), true);
  assert.equal(gallery.isDemoxHttpsUrl('http://coffee.demox.site/'), false);
  assert.equal(gallery.isDemoxHttpsUrl('https://evil.com/'), false);
  assert.equal(gallery.isDemoxHttpsUrl('https://demox.site.evil.com/'), false);
  assert.equal(gallery.isDemoxHttpsUrl('https://notdemox.site/'), false);
  assert.equal(gallery.isDemoxHttpsUrl('https://user:pass@www.demox.site/'), false);
});

test('unauthenticated list_gallery_cards is 200 and enabled only', async () => {
  cards.clear();
  failGallery = false;
  gallery.reset();
  role = 'admin';
  const saved = await call('save_gallery_card', card(), { userId: 'user_admin' });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(json(saved).success, true);
  const hidden = await call('save_gallery_card', card({ id: 'hidden', enabled: false, row: 2, title: '隐藏' }), { userId: 'user_admin' });
  assert.equal(json(hidden).success, true);
  const pub = await call('list_gallery_cards');
  assert.equal(pub.statusCode, 200);
  const body = json(pub);
  assert.equal(body.success, true);
  assert.deepEqual(body.data.map((item) => item.id), ['cafe']);
  assert.equal(body.data[0].titleEn, 'Coffee');
  assert.equal(body.data[0].captionEn, 'Built with Demox');
  assert.equal(body.data[0].enabled, true);
});

test('non-admin cannot save or reorder; invalid hosts are rejected and not stored', async () => {
  cards.clear();
  gallery.reset();
  const anon = await call('save_gallery_card', card({ id: 'anon' }));
  assert.equal(anon.statusCode, 401);
  role = 'user';
  const forbidden = await call('save_gallery_card', card({ id: 'nope' }), { userId: 'user_member' });
  assert.equal(forbidden.statusCode, 403);
  role = 'admin';
  const badUrl = await call('save_gallery_card', card({ id: 'bad-url', url: 'https://evil.example/' }), { userId: 'user_admin' });
  assert.equal(badUrl.statusCode, 400);
  assert.equal(json(badUrl).code, 'INVALID_GALLERY_URL');
  const badImage = await call('save_gallery_card', card({ id: 'bad-img', image: 'http://www.demox.site/a.webp' }), { userId: 'user_admin' });
  assert.equal(badImage.statusCode, 400);
  assert.equal(json(badImage).code, 'INVALID_GALLERY_IMAGE');
  assert.equal(cards.has('bad-url'), false);
  assert.equal(cards.has('bad-img'), false);
  assert.equal(cards.has('anon'), false);
});

test('admin can create, update, disable, and reorder within a row', async () => {
  cards.clear();
  gallery.reset();
  role = 'admin';
  await call('save_gallery_card', card({ id: 'a', title: '甲', row: 1 }), { userId: 'user_admin' });
  await call('save_gallery_card', card({ id: 'b', title: '乙', row: 1 }), { userId: 'user_admin' });
  await call('save_gallery_card', card({ id: 'c', title: '丙', row: 2, preview: 'coffee', image: '' }), { userId: 'user_admin' });
  const updated = await call('save_gallery_card', card({ id: 'a', title: '甲改', enabled: false, row: 1 }), { userId: 'user_admin' });
  assert.equal(json(updated).card.enabled, false);
  assert.equal(json(updated).card.title, '甲改');
  const reordered = await call('reorder_gallery_cards', { row: 1, ids: ['b', 'a'] }, { userId: 'user_admin' });
  assert.equal(reordered.statusCode, 200);
  assert.equal(json(reordered).success, true);
  const adminList = await call('admin_list_gallery_cards', {}, { userId: 'user_admin' });
  const ids = json(adminList).data.filter((item) => item.row === 1).map((item) => item.id);
  assert.deepEqual(ids, ['b', 'a']);
  const partial = await call('reorder_gallery_cards', { row: 1, ids: ['b'] }, { userId: 'user_admin' });
  assert.equal(partial.statusCode, 400);
});

test('database failure on the public list is success:false so the homepage can keep built-in cards', async () => {
  cards.clear();
  gallery.reset();
  failGallery = true;
  const res = await call('list_gallery_cards');
  failGallery = false;
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).success, false);
  assert.equal(json(res).code, 'GALLERY_UNAVAILABLE');
});
