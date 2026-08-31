'use strict';

const crypto = require('crypto');

function createFunctionId() {
  return `fn_${crypto.randomBytes(10).toString('base64url')}`;
}

function isFunctionId(value) {
  return /^fn_[A-Za-z0-9_-]{8,32}$/.test(String(value || ''));
}

function normalizeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(slug)) {
    throw new Error('函数标识只能使用 2-63 位字母、数字、下划线或短横线');
  }
  return slug;
}

function normalizeName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 80) throw new Error('函数名称不能为空且不能超过 80 个字符');
  return name;
}

module.exports = { createFunctionId, isFunctionId, normalizeSlug, normalizeName };
