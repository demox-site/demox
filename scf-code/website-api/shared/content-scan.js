/**
 * 部署包全文件非法内容检测（最低成本）。
 *
 * 成本原则：
 *  1. 每个文件都先走本地规则（文件名 + 可提取文本），¥0。
 *  2. 不把 HTML/JS/CSS/MD 送给付费文本审核（CI 文本 2.2 元/千条 × 场景，会爆）。
 *  3. 栅格图才走腾讯云 IMS：一张图一次全场景，约 0.0025 元；跳过小图标，只审最大的 N 张。
 *  4. COS 桶级自动审核不要开——会把 .js/.css 当文本计费。
 *
 * 环境变量：
 *  CONTENT_SCAN=0          总开关
 *  CONTENT_SCAN_IMS=0      关闭付费图片审核（纯本地，部署成本 ¥0）
 *  CONTENT_SCAN_IMS_MAX    单次部署最多送审图片数，默认 12
 */

const DEFAULT_IMS_MAX = 12;
const MIN_IMAGE_BYTES = 8 * 1024;
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const TEXT_EXT = new Set([
  '.html', '.htm', '.xhtml', '.shtml',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.css', '.scss', '.less',
  '.json', '.xml', '.svg', '.txt', '.md', '.markdown',
  '.csv', '.tsv', '.yml', '.yaml',
  '.pdf', '.doc', '.docx', '.rtf'
]);
const SKIP_EXT = new Set([
  '.map', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.wasm', '.gz', '.br', '.zip', '.7z', '.rar',
  '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg',
  '.ico', '.cur'
]);

const PHRASE_CATALOG = require('./blocked-phrases.json');
const BLOCK_PHRASE_GROUPS = Array.isArray(PHRASE_CATALOG.groups) ? PHRASE_CATALOG.groups : [];
const BLOCK_PHRASES = BLOCK_PHRASE_GROUPS.flatMap((group) => group.phrases || []);

const CONTENT_SCAN_DOCS = 'https://www.demox.site/content-scan';
const CONTENT_SCAN_SKILL = 'https://github.com/demox-site/skill';

function listBlockedPhrasesCatalog() {
  const phrases = BLOCK_PHRASES.slice();
  return {
    success: true,
    docs: CONTENT_SCAN_DOCS,
    skill: CONTENT_SCAN_SKILL,
    method: PHRASE_CATALOG.method || 'phrase_match',
    updatedAt: PHRASE_CATALOG.updatedAt || '',
    count: phrases.length,
    phrases,
    groups: BLOCK_PHRASE_GROUPS.map((group) => ({
      category: group.category,
      label: group.label,
      labelEn: group.labelEn,
      phrases: Array.isArray(group.phrases) ? group.phrases.slice() : []
    })),
    imageReview: {
      provider: 'tencent_ims',
      billed: true,
      note: 'Raster images use Tencent IMS labels, not this phrase list.'
    }
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function getConfig(overrides = {}) {
  return {
    enabled: process.env.CONTENT_SCAN !== '0',
    imsEnabled: process.env.CONTENT_SCAN_IMS !== '0',
    imsMax: clampInt(process.env.CONTENT_SCAN_IMS_MAX, 1, 40, DEFAULT_IMS_MAX),
    minImageBytes: MIN_IMAGE_BYTES,
    maxImageBytes: MAX_IMAGE_BYTES,
    maxTextBytes: MAX_TEXT_BYTES,
    ...overrides
  };
}

function extname(fileName) {
  const base = String(fileName || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

function isRasterImage(buffer, fileName) {
  const ext = extname(fileName);
  if (RASTER_EXT.has(ext)) return true;
  if (!buffer || buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  if (buffer.slice(0, 4).toString('ascii') === 'GIF8') return true;
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return true;
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return true;
  return false;
}

function shouldSkipBinary(fileName) {
  return SKIP_EXT.has(extname(fileName));
}

function normalizeHaystack(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, '');
}

function findBlockedPhrase(text) {
  const haystack = normalizeHaystack(text);
  if (!haystack) return null;
  for (const phrase of BLOCK_PHRASES) {
    if (haystack.includes(phrase)) return phrase;
  }
  return null;
}

function extractScanText(buffer, maxBytes) {
  if (!buffer || !buffer.length) return '';
  const slice = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
  const utf8 = slice.toString('utf8');
  // PDF / 二进制里常有未压缩的中文或 ASCII 句子，一并纳入
  const loose = slice.toString('latin1').replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, '');
  return `${utf8}\n${loose}`;
}

function readEntryBuffer(entry) {
  if (!entry) return Buffer.alloc(0);
  if (Buffer.isBuffer(entry.buffer)) return entry.buffer;
  if (typeof entry.getData === 'function') {
    try {
      const data = entry.getData();
      return Buffer.isBuffer(data) ? data : Buffer.from(data || '');
    } catch (e) {
      return Buffer.alloc(0);
    }
  }
  return Buffer.alloc(0);
}

function entryFileName(entry) {
  return String(entry.entryName || entry.name || '').replace(/\\/g, '/');
}

function isOfficialPhraseCatalogFile(fileName) {
  const base = String(fileName || '').split('/').pop().toLowerCase();
  return base === 'content-scan.json' || base === 'blocked-phrases.json';
}

function scanLocalFile(fileName, buffer, config) {
  const nameHit = findBlockedPhrase(fileName);
  if (nameHit) {
    return { fileName, phrase: nameHit, via: 'filename' };
  }
  if (shouldSkipBinary(fileName) || isRasterImage(buffer, fileName)) {
    return null;
  }
  const ext = extname(fileName);
  const looksText = TEXT_EXT.has(ext) || !ext;
  if (!looksText && buffer.length > 0) {
    // 未知后缀：只在看起来像文本时扫描，避免把压缩包当文本误伤
    const sample = buffer.subarray(0, 256);
    const nul = sample.includes(0);
    if (nul) return null;
  }
  const text = extractScanText(buffer, config.maxTextBytes);
  const textHit = findBlockedPhrase(text);
  if (textHit) {
    return { fileName, phrase: textHit, via: 'text' };
  }
  return null;
}

function pickImages(files, config) {
  return files
    .filter((file) => (
      isRasterImage(file.buffer, file.fileName)
      && file.buffer.length >= config.minImageBytes
      && file.buffer.length <= config.maxImageBytes
    ))
    .sort((a, b) => b.buffer.length - a.buffer.length)
    .slice(0, config.imsMax);
}

const IMS_LABELS = {
  Porn: '色情',
  Sexy: '低俗',
  Politics: '政治敏感',
  Terrorism: '暴恐',
  Illegal: '违法',
  Abuse: '谩骂',
  Ads: '广告',
  Teen: '未成年相关'
};

function sanitizeDisplayToken(value, fallback = '') {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 32);
  return cleaned || fallback;
}

function describeHit(hit) {
  if (hit.via === 'ims') {
    const label = IMS_LABELS[hit.phrase] || sanitizeDisplayToken(hit.phrase, '图片违规');
    return `图片审核判定为「${label}」`;
  }
  const phrase = sanitizeDisplayToken(hit.phrase, '违规内容');
  const where = hit.via === 'filename' ? '文件名' : '文件内容';
  return `${where}含有违规词「${phrase}」`;
}

function blockedResponse(hit) {
  const safeName = sanitizeDisplayToken(String(hit.fileName || '').split('/').pop(), '文件');
  return {
    blocked: true,
    code: 'CONTENT_BLOCKED',
    message: `发布失败：${safeName} 未通过安全审核，${describeHit(hit)}。请修改后重试`,
    fileName: hit.fileName || '',
    phrase: hit.phrase || '',
    via: hit.via
  };
}

function passedResponse(stats) {
  return {
    blocked: false,
    code: 'CONTENT_PASSED',
    scanned: stats.scanned,
    images: stats.images || 0,
    skippedImages: stats.skippedImages || 0
  };
}

/**
 * 审核一组 zip entry（adm-zip 或 { entryName, getData/buffer }）。
 * options.moderateImage({ buffer, fileName }) 返回 IMS 风格 { Suggestion, Label }
 */
async function scanZipEntries(entries, options = {}) {
  const config = getConfig(options.config || {});
  if (!config.enabled) {
    return { blocked: false, skipped: true, code: 'CONTENT_SCAN_DISABLED' };
  }

  const list = Array.isArray(entries) ? entries : [];
  const files = [];
  for (const entry of list) {
    if (entry && entry.isDirectory) continue;
    const fileName = entryFileName(entry);
    if (!fileName || fileName.includes('..') || fileName.includes('__MACOSX') || fileName.includes('.DS_Store')) {
      continue;
    }
    files.push({ fileName, buffer: readEntryBuffer(entry) });
  }

  for (const file of files) {
    if (isOfficialPhraseCatalogFile(file.fileName)) continue;
    const hit = scanLocalFile(file.fileName, file.buffer, config);
    if (hit) return blockedResponse(hit);
  }

  const moderateImage = options.moderateImage;
  if (!config.imsEnabled || typeof moderateImage !== 'function') {
    return passedResponse({ scanned: files.length, images: 0 });
  }

  const images = pickImages(files, config);
  let scannedImages = 0;
  for (const image of images) {
    try {
      const result = await moderateImage({
        buffer: image.buffer,
        fileName: image.fileName
      });
      scannedImages += 1;
      const suggestion = String((result && result.Suggestion) || '').trim();
      if (suggestion === 'Block') {
        return blockedResponse({
          fileName: image.fileName,
          via: 'ims',
          phrase: (result && result.Label) || 'image'
        });
      }
    } catch (error) {
      const message = String((error && error.message) || error || '');
      // 未开通 IMS / 欠费 / 无权限：本请求剩余图片不再重试，避免拖垮部署
      if (/Unauthorized|AuthFailure|FailedOperation|ResourceUnavailable|LimitExceeded|密钥|Secret/i.test(message)) {
        console.warn('内容审核 IMS 不可用，回退本地规则:', message);
        break;
      }
      console.warn('内容审核 IMS 调用失败，跳过该图:', image.fileName, message);
    }
  }

  return passedResponse({
    scanned: files.length,
    images: scannedImages,
    skippedImages: Math.max(0, images.length - scannedImages)
  });
}

function createImsModerator(callTencentCloudApi) {
  return async function moderateImage({ buffer, fileName }) {
    return callTencentCloudApi({
      service: 'ims',
      host: 'ims.tencentcloudapi.com',
      version: '2020-12-29',
      action: 'ImageModeration',
      payload: {
        FileContent: buffer.toString('base64'),
        DataId: String(fileName || 'image').slice(0, 64)
      }
    });
  };
}

module.exports = {
  BLOCK_PHRASES,
  BLOCK_PHRASE_GROUPS,
  CONTENT_SCAN_DOCS,
  listBlockedPhrasesCatalog,
  getConfig,
  findBlockedPhrase,
  isRasterImage,
  pickImages,
  scanLocalFile,
  scanZipEntries,
  isOfficialPhraseCatalogFile,
  createImsModerator
};
