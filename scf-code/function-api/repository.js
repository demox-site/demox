'use strict';

const { DEFAULT_LIMITS, normalizeLimits } = require('./limits.js');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class InMemoryFunctionRepository {
  constructor() {
    this.functions = new Map();
    this.versions = new Map();
    this.usage = [];
    this.nextVersionId = 1;
  }

  async createFunction(record) {
    const functionRecord = {
      id: record.id,
      functionId: record.functionId,
      ownerId: String(record.ownerId),
      websiteId: String(record.websiteId),
      name: record.name,
      slug: record.slug,
      status: 'active',
      publishedVersion: null,
      limits: normalizeLimits(record.limits),
      env: { ...(record.env || {}) },
      allowedOutboundHosts: [],
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.createdAt || new Date().toISOString()
    };
    const duplicate = [...this.functions.values()].find(
      (item) => item.websiteId === functionRecord.websiteId && item.slug === functionRecord.slug
    );
    if (duplicate) throw new Error('该函数标识已存在');
    this.functions.set(functionRecord.functionId, functionRecord);
    return clone(functionRecord);
  }

  async getFunction(functionId) {
    return clone(this.functions.get(functionId) || null);
  }

  async getFunctionByWebsiteSlug(websiteId, slug) {
    const record = [...this.functions.values()].find(
      (item) => item.websiteId === String(websiteId) && item.slug === String(slug)
    );
    return clone(record || null);
  }

  async listFunctions(websiteId) {
    return [...this.functions.values()]
      .filter((item) => item.websiteId === String(websiteId))
      .map(clone);
  }

  async createVersion(record) {
    const functionRecord = this.functions.get(record.functionId);
    if (!functionRecord) return null;
    const versions = [...this.versions.values()].filter((item) => item.functionId === record.functionId);
    const versionNumber = versions.reduce((max, item) => Math.max(max, item.version), 0) + 1;
    const resolvedBundleKey = record.bundleKey || (
      typeof record.bundleKeyFactory === 'function' ? record.bundleKeyFactory(versionNumber) : ''
    );
    const version = {
      id: this.nextVersionId++,
      functionId: record.functionId,
      version: versionNumber,
      bundleKey: resolvedBundleKey,
      sha256: record.sha256,
      sizeBytes: record.sizeBytes,
      entrypoint: record.entrypoint || 'index.mjs',
      status: 'draft',
      createdAt: record.createdAt || new Date().toISOString()
    };
    this.versions.set(`${record.functionId}:${versionNumber}`, version);
    return clone(version);
  }

  async markVersionFailed(functionId, versionNumber) {
    const versionRecord = this.versions.get(`${functionId}:${Number(versionNumber)}`);
    if (!versionRecord) return null;
    versionRecord.status = 'failed';
    return clone(versionRecord);
  }

  async getVersion(functionId, version) {
    const versionRecord = this.versions.get(`${functionId}:${Number(version)}`);
    return clone(versionRecord || null);
  }

  async listVersions(functionId) {
    return [...this.versions.values()]
      .filter((item) => item.functionId === functionId)
      .sort((a, b) => b.version - a.version)
      .map(clone);
  }

  async publishVersion(functionId, versionNumber) {
    const target = this.versions.get(`${functionId}:${Number(versionNumber)}`);
    if (!target) return null;
    for (const item of this.versions.values()) {
      if (item.functionId === functionId && item.status === 'published') item.status = 'archived';
    }
    target.status = 'published';
    const functionRecord = this.functions.get(functionId);
    functionRecord.publishedVersion = target.version;
    functionRecord.updatedAt = new Date().toISOString();
    return clone({ function: functionRecord, version: target });
  }

  async recordInvocation(record) {
    this.usage.push(clone(record));
    if (this.usage.length > 10_000) this.usage.splice(0, this.usage.length - 10_000);
  }
}

/**
 * MySQL adapter. The service only depends on this small repository interface,
 * so the existing website-api connection pool can be supplied without sharing
 * its large action dispatcher.
 */
function createMysqlFunctionRepository({ query, transaction }) {
  if (typeof query !== 'function' || typeof transaction !== 'function') {
    throw new TypeError('MySQL repository requires query and transaction functions');
  }

  return {
    async createFunction(record) {
      await query(
        `INSERT INTO demox_functions
          (function_id, owner_user_id, website_id, name, slug, status, published_version,
           timeout_ms, memory_limit_bytes, max_body_bytes, max_response_bytes,
           max_code_bytes, max_invocations_per_minute, env_json, allowed_outbound_hosts_json)
         VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.functionId,
          String(record.ownerId),
          String(record.websiteId),
          record.name,
          record.slug,
          record.limits.timeoutMs,
          record.limits.memoryLimitBytes,
          record.limits.maxBodyBytes,
          record.limits.maxResponseBytes,
          record.limits.maxCodeBytes,
          record.limits.maxInvocationsPerMinute,
          JSON.stringify(record.env || {}),
          JSON.stringify(record.allowedOutboundHosts || [])
        ]
      );
      return this.getFunction(record.functionId);
    },

    async getFunction(functionId) {
      const rows = await query(
        `SELECT function_id, owner_user_id, website_id, name, slug, status, published_version,
                timeout_ms, memory_limit_bytes, max_body_bytes, max_response_bytes,
                max_code_bytes, max_invocations_per_minute, env_json,
                allowed_outbound_hosts_json, created_at, updated_at
           FROM demox_functions WHERE function_id = ? LIMIT 1`,
        [functionId]
      );
      if (!rows.length) return null;
      return mapFunctionRow(rows[0]);
    },

    async getFunctionByWebsiteSlug(websiteId, slug) {
      const rows = await query(
        `SELECT function_id, owner_user_id, website_id, name, slug, status, published_version,
                timeout_ms, memory_limit_bytes, max_body_bytes, max_response_bytes,
                max_code_bytes, max_invocations_per_minute, env_json,
                allowed_outbound_hosts_json, created_at, updated_at
           FROM demox_functions WHERE website_id = ? AND slug = ? LIMIT 1`,
        [String(websiteId), String(slug)]
      );
      if (!rows.length) return null;
      return mapFunctionRow(rows[0]);
    },

    async listFunctions(websiteId) {
      const rows = await query(
        `SELECT function_id, owner_user_id, website_id, name, slug, status, published_version,
                timeout_ms, memory_limit_bytes, max_body_bytes, max_response_bytes,
                max_code_bytes, max_invocations_per_minute, env_json,
                allowed_outbound_hosts_json, created_at, updated_at
           FROM demox_functions WHERE website_id = ? ORDER BY created_at DESC`,
        [String(websiteId)]
      );
      return rows.map(mapFunctionRow);
    },

    async createVersion(record) {
      return transaction(async (conn) => {
        // Lock the parent row so concurrent uploads cannot allocate the same version.
        const [functions] = await conn.query(
          'SELECT id FROM demox_functions WHERE function_id = ? LIMIT 1 FOR UPDATE',
          [record.functionId]
        );
        if (!functions.length) return null;
        const [rows] = await conn.query(
          'SELECT COALESCE(MAX(version), 0) AS latest FROM demox_function_versions WHERE function_id = ?',
          [record.functionId]
        );
        const versionNumber = Number(rows[0]?.latest || 0) + 1;
        const resolvedBundleKey = record.bundleKey || (
          typeof record.bundleKeyFactory === 'function'
            ? record.bundleKeyFactory(versionNumber)
            : ''
        );
        await conn.query(
          `INSERT INTO demox_function_versions
            (function_id, version, bundle_key, sha256, size_bytes, entrypoint, status)
           VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
          [record.functionId, versionNumber, resolvedBundleKey, record.sha256, record.sizeBytes, record.entrypoint || 'index.mjs']
        );
        return {
          id: null,
          functionId: record.functionId,
          version: versionNumber,
          bundleKey: resolvedBundleKey,
          sha256: record.sha256,
          sizeBytes: record.sizeBytes,
          entrypoint: record.entrypoint || 'index.mjs',
          status: 'draft',
          createdAt: new Date().toISOString()
        };
      });
    },

    async markVersionFailed(functionId, versionNumber) {
      await query(
        "UPDATE demox_function_versions SET status = 'failed' WHERE function_id = ? AND version = ?",
        [functionId, Number(versionNumber)]
      );
      return this.getVersion(functionId, versionNumber);
    },

    async getVersion(functionId, version) {
      const rows = await query(
        `SELECT id, function_id, version, bundle_key, sha256, size_bytes, entrypoint,
                status, created_at
           FROM demox_function_versions WHERE function_id = ? AND version = ? LIMIT 1`,
        [functionId, Number(version)]
      );
      return rows.length ? mapVersionRow(rows[0]) : null;
    },

    async listVersions(functionId) {
      const rows = await query(
        `SELECT id, function_id, version, bundle_key, sha256, size_bytes, entrypoint,
                status, created_at
           FROM demox_function_versions WHERE function_id = ? ORDER BY version DESC`,
        [functionId]
      );
      return rows.map(mapVersionRow);
    },

    async publishVersion(functionId, versionNumber) {
      return transaction(async (conn) => {
        const [versions] = await conn.query(
          'SELECT id, function_id, version, bundle_key, sha256, size_bytes, entrypoint, status, created_at FROM demox_function_versions WHERE function_id = ? AND version = ? LIMIT 1 FOR UPDATE',
          [functionId, Number(versionNumber)]
        );
        if (!versions.length) return null;
        await conn.query(
          `UPDATE demox_function_versions SET status = CASE WHEN version = ? THEN 'published' ELSE 'archived' END
             WHERE function_id = ?`,
          [Number(versionNumber), functionId]
        );
        await conn.query(
          'UPDATE demox_functions SET published_version = ?, updated_at = CURRENT_TIMESTAMP WHERE function_id = ?',
          [Number(versionNumber), functionId]
        );
        const [functions] = await conn.query(
          `SELECT function_id, owner_user_id, website_id, name, slug, status, published_version,
                  timeout_ms, memory_limit_bytes, max_body_bytes, max_response_bytes,
                  max_code_bytes, max_invocations_per_minute, env_json,
                  allowed_outbound_hosts_json, created_at, updated_at
             FROM demox_functions WHERE function_id = ? LIMIT 1`,
          [functionId]
        );
        return { function: mapFunctionRow(functions[0]), version: mapVersionRow({ ...versions[0], status: 'published' }) };
      });
    },

    async recordInvocation(record) {
      await query(
        `INSERT INTO demox_function_invocations
          (function_id, version, owner_user_id, status, duration_ms, request_bytes, response_bytes, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [record.functionId, record.version, String(record.ownerId), record.status, record.durationMs, record.requestBytes, record.responseBytes, record.errorCode || null]
      );
    }
  };
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function mapFunctionRow(row) {
  return {
    id: row.id,
    functionId: row.function_id,
    ownerId: String(row.owner_user_id),
    websiteId: String(row.website_id || ''),
    name: row.name,
    slug: row.slug,
    status: row.status,
    publishedVersion: row.published_version == null ? null : Number(row.published_version),
    limits: normalizeLimits({
      timeoutMs: row.timeout_ms,
      memoryLimitBytes: row.memory_limit_bytes,
      maxBodyBytes: row.max_body_bytes,
      maxResponseBytes: row.max_response_bytes,
      maxCodeBytes: row.max_code_bytes,
      maxInvocationsPerMinute: row.max_invocations_per_minute
    }),
    env: parseJson(row.env_json, {}),
    allowedOutboundHosts: parseJson(row.allowed_outbound_hosts_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapVersionRow(row) {
  return {
    id: row.id,
    functionId: row.function_id,
    version: Number(row.version),
    bundleKey: row.bundle_key,
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes),
    entrypoint: row.entrypoint || 'index.mjs',
    status: row.status,
    createdAt: row.created_at
  };
}

module.exports = {
  InMemoryFunctionRepository,
  createMysqlFunctionRepository,
  DEFAULT_LIMITS
};
