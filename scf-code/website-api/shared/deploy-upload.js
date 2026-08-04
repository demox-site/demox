const crypto = require('crypto');

const DEPLOY_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024;
const DEPLOY_UPLOAD_TTL_SECONDS = 24 * 60 * 60;
const COMPLETING_STALE_SECONDS = 5 * 60;

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeSha256(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function decodeBase64Chunk(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('分块内容不是有效的 Base64');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.toString('base64') !== encoded) {
    throw new Error('分块内容不是规范的 Base64');
  }
  return buffer;
}

function expectedChunkSize(session, chunkIndex) {
  const index = Number(chunkIndex);
  const totalChunks = Number(session.total_chunks);
  const chunkSize = Number(session.chunk_size);
  const totalSize = Number(session.total_size);
  if (!Number.isSafeInteger(index) || index < 0 || index >= totalChunks) return null;
  if (index < totalChunks - 1) return chunkSize;
  return totalSize - chunkSize * (totalChunks - 1);
}

function uploadObjectPrefix(userId, uploadId) {
  const safeUserId = String(userId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  const safeUploadId = String(uploadId || '').replace(/[^A-Za-z0-9-]/g, '');
  return `_deploy_uploads/${safeUserId}/${safeUploadId}/`;
}

function uploadObjectKey(userId, uploadId, chunkIndex) {
  return `${uploadObjectPrefix(userId, uploadId)}${String(chunkIndex).padStart(8, '0')}.part`;
}

function parseResultJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

module.exports = {
  DEPLOY_UPLOAD_CHUNK_SIZE,
  DEPLOY_UPLOAD_TTL_SECONDS,
  COMPLETING_STALE_SECONDS,
  sha256Hex,
  normalizeSha256,
  decodeBase64Chunk,
  expectedChunkSize,
  uploadObjectPrefix,
  uploadObjectKey,
  parseResultJson
};
