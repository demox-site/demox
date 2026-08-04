const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEPLOY_UPLOAD_CHUNK_SIZE,
  decodeBase64Chunk,
  expectedChunkSize,
  isDeployUploadExpired,
  normalizeSha256,
  sha256Hex,
  uploadObjectKey
} = require('./deploy-upload.js');

test('2 MiB chunks stay well below an 8 MiB JSON request after Base64 encoding', () => {
  const encoded = Buffer.alloc(DEPLOY_UPLOAD_CHUNK_SIZE).toString('base64');
  const requestBytes = Buffer.byteLength(JSON.stringify({ action: 'upload_deploy_chunk', chunkBase64: encoded }));
  assert.ok(requestBytes < 4 * 1024 * 1024);
});

test('strict Base64 decoding rejects malformed chunks', () => {
  assert.deepEqual(decodeBase64Chunk(Buffer.from('demox').toString('base64')), Buffer.from('demox'));
  assert.throws(() => decodeBase64Chunk('not base64!'), /Base64/);
  assert.throws(() => decodeBase64Chunk('ZGVtb3g'), /Base64/);
});

test('chunk sizes include an exact final remainder', () => {
  const session = {
    total_size: DEPLOY_UPLOAD_CHUNK_SIZE * 2 + 17,
    chunk_size: DEPLOY_UPLOAD_CHUNK_SIZE,
    total_chunks: 3
  };
  assert.equal(expectedChunkSize(session, 0), DEPLOY_UPLOAD_CHUNK_SIZE);
  assert.equal(expectedChunkSize(session, 1), DEPLOY_UPLOAD_CHUNK_SIZE);
  assert.equal(expectedChunkSize(session, 2), 17);
  assert.equal(expectedChunkSize(session, 3), null);
});

test('hashes and temporary keys are deterministic and sanitized', () => {
  assert.equal(normalizeSha256(sha256Hex(Buffer.from('demox'))), sha256Hex(Buffer.from('demox')));
  assert.equal(normalizeSha256('not-a-hash'), '');
  assert.equal(
    uploadObjectKey('user/../id', '550e8400-e29b-41d4-a716-446655440000', 12),
    '_deploy_uploads/user____id/550e8400-e29b-41d4-a716-446655440000/00000012.part'
  );
});

test('database expiration result wins over a timezone-shifted JavaScript date', () => {
  const apparentlyExpired = new Date(Date.now() - 60_000);
  assert.equal(isDeployUploadExpired({ expires_at: apparentlyExpired, is_expired: 0 }), false);
  assert.equal(isDeployUploadExpired({ expires_at: apparentlyExpired, is_expired: 1 }), true);
});
