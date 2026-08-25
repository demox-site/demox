const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findBlockedPhrase,
  isRasterImage,
  pickImages,
  scanLocalFile,
  scanZipEntries,
  listBlockedPhrasesCatalog,
  BLOCK_PHRASES
} = require('./content-scan.js');
const publicCatalog = require('../../../public/content-scan.json');

function entry(name, body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    entryName: name,
    isDirectory: false,
    getData: () => buffer
  };
}

test('official phrase catalog files are not scanned against themselves', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const catalog = fs.readFileSync(path.join(__dirname, '../../../public/content-scan.json'));
  const result = await scanZipEntries(
    [entry('content-scan.json', catalog), entry('assets/blocked-phrases.json', catalog)],
    { config: { enabled: true, imsEnabled: false } }
  );
  assert.equal(result.blocked, false, JSON.stringify(result));
  assert.equal(result.code, 'CONTENT_PASSED');

  const disguised = await scanZipEntries(
    [entry('notes.txt', catalog)],
    { config: { enabled: true, imsEnabled: false } }
  );
  assert.equal(disguised.blocked, true);
});

test('public catalog lists every phrase used by the scanner', () => {
  const catalog = listBlockedPhrasesCatalog();
  assert.equal(catalog.success, true);
  assert.equal(catalog.docs, 'https://www.demox.site/content-scan');
  assert.equal(catalog.count, BLOCK_PHRASES.length);
  assert.deepEqual(catalog.phrases, BLOCK_PHRASES);
  assert.ok(catalog.groups.length >= 4);
  assert.deepEqual(publicCatalog.phrases, BLOCK_PHRASES);
});

test('local phrases catch illegal text but miss normal landing pages', () => {
  assert.equal(findBlockedPhrase('<p>欢迎来到我的作品集</p>'), null);
  assert.equal(findBlockedPhrase('function kill() { process.exit(0) }'), null);
  assert.equal(findBlockedPhrase('sexagesimal clock demo'), null);
  assert.equal(findBlockedPhrase('我们反对色情内容传播'), null);
  assert.equal(findBlockedPhrase('免费色情入口'), '免费色情');
  assert.equal(findBlockedPhrase('法轮功宣传页'), '法轮功');
});

test('filename and html text are both scanned', async () => {
  const config = { maxTextBytes: 2 * 1024 * 1024 };
  const byName = scanLocalFile('sites/色情网站-index.html', Buffer.from('<h1>hi</h1>'), config);
  assert.equal(byName.via, 'filename');
  const byText = scanLocalFile('index.html', Buffer.from('<article>网上赌场开户送彩金</article>'), config);
  assert.equal(byText.via, 'text');
  assert.equal(scanLocalFile('index.html', Buffer.from('<h1>Hello Demox</h1>'), config), null);

  const named = await scanZipEntries(
    [entry('sites/色情网站-index.html', '<h1>hi</h1>')],
    { config: { enabled: true, imsEnabled: false } }
  );
  assert.match(named.message, /文件名含有违规词「色情网站」/);
});

test('tiny png icons are not sent to IMS; larger raster images are', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(20 * 1024, 1)
  ]);
  const icon = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(100, 2)
  ]);
  assert.equal(isRasterImage(png, 'hero.png'), true);
  const picked = pickImages([
    { fileName: 'hero.png', buffer: png },
    { fileName: 'favicon.png', buffer: icon }
  ], { minImageBytes: 8 * 1024, maxImageBytes: 7 * 1024 * 1024, imsMax: 12 });
  assert.deepEqual(picked.map((f) => f.fileName), ['hero.png']);
});

test('scanZipEntries blocks locally before calling IMS', async () => {
  let called = 0;
  const result = await scanZipEntries(
    [entry('index.html', '<p>六合彩今晚开奖</p>')],
    {
      config: { enabled: true, imsEnabled: true },
      moderateImage: async () => {
        called += 1;
        return { Suggestion: 'Pass' };
      }
    }
  );
  assert.equal(result.blocked, true);
  assert.equal(result.code, 'CONTENT_BLOCKED');
  assert.equal(result.phrase, '六合彩');
  assert.match(result.message, /违规词「六合彩」/);
  assert.equal(called, 0);
});

test('IMS Block rejects the deploy; Review/Pass do not', async () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(12 * 1024, 7)
  ]);
  const blocked = await scanZipEntries(
    [entry('index.html', '<h1>ok</h1>'), entry('cover.png', png)],
    {
      config: { enabled: true, imsEnabled: true, minImageBytes: 8 * 1024, imsMax: 12, maxImageBytes: 7 * 1024 * 1024 },
      moderateImage: async () => ({ Suggestion: 'Block', Label: 'Porn' })
    }
  );
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.via, 'ims');
  assert.match(blocked.message, /图片审核判定为「色情」/);

  const review = await scanZipEntries(
    [entry('index.html', '<h1>ok</h1>'), entry('cover.png', png)],
    {
      config: { enabled: true, imsEnabled: true, minImageBytes: 8 * 1024, imsMax: 12, maxImageBytes: 7 * 1024 * 1024 },
      moderateImage: async () => ({ Suggestion: 'Review', Label: 'Porn' })
    }
  );
  assert.equal(review.blocked, false);
});

test('IMS outage fails open so a deploy is not bricked', async () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(12 * 1024, 7)
  ]);
  const result = await scanZipEntries(
    [entry('index.html', '<h1>ok</h1>'), entry('cover.png', png)],
    {
      config: { enabled: true, imsEnabled: true, minImageBytes: 8 * 1024, imsMax: 12, maxImageBytes: 7 * 1024 * 1024 },
      moderateImage: async () => {
        throw new Error('UnauthorizedOperation: service not opened');
      }
    }
  );
  assert.equal(result.blocked, false);
  assert.equal(result.code, 'CONTENT_PASSED');
});
