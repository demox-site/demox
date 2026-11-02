'use strict';

/**
 * 部署包可执行文件拒收与只读库存共用的后缀判断。
 * 部署入口 index.js 必须逐字内联同一段实现：functions push 只上传入口，
 * 新的 shared 文件不会跟着到线上。
 */

const EXECUTABLE_SUFFIXES = ['.exe', '.msi', '.dmg', '.apk', '.bat', '.ps1'];
const EXECUTABLE_SUFFIX_SET = new Set(EXECUTABLE_SUFFIXES);
const EXECUTABLE_FILE_CODE = 'EXECUTABLE_FILE_REJECTED';

function normalizeExecutableBase(fileName) {
  let base = String(fileName || '').replace(/\\/g, '/').split('/').pop() || '';
  base = base.trim().replace(/\uFF0E/g, '.');
  if (base.includes('%')) {
    try {
      const decoded = decodeURIComponent(base).replace(/\uFF0E/g, '.');
      if (decoded && !decoded.includes('/') && !decoded.includes('\\')) base = decoded;
    } catch (e) {
      // 不完整的百分号编码保持原样，避免把合法文件名判丢。
    }
  }
  return base.split('\0')[0].replace(/[. ]+$/g, '');
}

function executableSuffix(fileName) {
  const base = normalizeExecutableBase(fileName);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = base.slice(dot).toLowerCase();
  return EXECUTABLE_SUFFIX_SET.has(ext) ? ext : '';
}

function findExecutableFile(fileName) {
  const suffix = executableSuffix(fileName);
  if (!suffix) return null;
  return {
    fileName: String(fileName || '').slice(0, 180),
    suffix,
    inArchive: false
  };
}

function findExecutableZipEntry(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    if (!entry || entry.isDirectory) continue;
    const name = String(entry.entryName || entry.name || '').replace(/\\/g, '/');
    if (!name || name.endsWith('/')) continue;
    const suffix = executableSuffix(name);
    if (!suffix) continue;
    return {
      fileName: name.slice(0, 180),
      suffix,
      inArchive: true
    };
  }
  return null;
}

function executableRejectMessage(hit) {
  const suffix = (hit && hit.suffix) || '';
  const raw = String((hit && hit.fileName) || '')
    .replace(/\\/g, '/')
    .split('\0')[0]
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .trim();
  const shown = (raw || '文件').slice(-80);
  const target = hit && hit.inArchive ? `压缩包内的 ${shown}` : shown;
  return `发布失败：${target} 是可执行文件（${suffix}），Demox 不托管。请把安装包放到 GitHub Releases，在站点里只放外部下载链接。`;
}

function siteIdentityFromObjectKey(key) {
  const parts = String(key || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 4 || parts[0] !== 'sites') return null;
  if (!parts[1] || !parts[2] || parts[1].includes('..') || parts[2].includes('..')) return null;
  return {
    userId: parts[1],
    websiteId: parts[2],
    prefix: `sites/${parts[1]}/${parts[2]}/`
  };
}

function orderedSuffixCounts(counts) {
  const ordered = {};
  for (const suffix of EXECUTABLE_SUFFIXES) {
    if (counts[suffix]) ordered[suffix] = counts[suffix];
  }
  return ordered;
}

function summarizeExecutableKeys(keys) {
  const sites = new Map();
  const suffixCounts = {};
  let objectCount = 0;
  let ignoredNonSite = 0;
  for (const key of keys || []) {
    const suffix = executableSuffix(key);
    if (!suffix) continue;
    const site = siteIdentityFromObjectKey(key);
    if (!site) {
      ignoredNonSite += 1;
      continue;
    }
    objectCount += 1;
    suffixCounts[suffix] = (suffixCounts[suffix] || 0) + 1;
    const id = `${site.userId}/${site.websiteId}`;
    let row = sites.get(id);
    if (!row) {
      row = {
        websiteId: site.websiteId,
        userId: site.userId,
        prefix: site.prefix,
        objectCount: 0,
        suffixCounts: {},
        sampleKeys: []
      };
      sites.set(id, row);
    }
    row.objectCount += 1;
    row.suffixCounts[suffix] = (row.suffixCounts[suffix] || 0) + 1;
    if (row.sampleKeys.length < 5) row.sampleKeys.push(String(key));
  }
  const siteRows = [...sites.values()]
    .map((row) => ({ ...row, suffixCounts: orderedSuffixCounts(row.suffixCounts) }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
  return {
    mutate: false,
    suffixes: EXECUTABLE_SUFFIXES.slice(),
    siteCount: siteRows.length,
    objectCount,
    suffixCounts: orderedSuffixCounts(suffixCounts),
    sites: siteRows,
    ignoredNonSite
  };
}

module.exports = {
  EXECUTABLE_SUFFIXES,
  EXECUTABLE_FILE_CODE,
  executableSuffix,
  findExecutableFile,
  findExecutableZipEntry,
  executableRejectMessage,
  siteIdentityFromObjectKey,
  summarizeExecutableKeys
};
