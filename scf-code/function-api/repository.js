'use strict';

const { DEFAULT_LIMITS, normalizeLimits } = require('./limits.js');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const FUNCTION_COLUMNS = `function_id, owner_user_id, website_id, name, slug, status, published_version,
                timeout_ms, memory_limit_bytes, max_body_bytes, max_response_bytes,
                max_code_bytes, max_invocations_per_minute, env_json,
                allowed_outbound_hosts_json, runtime, routes_json, triggers_json, timer_name,
                created_at, updated_at`;

class InMemoryFunctionRepository {
  constructor() {
    this.functions = new Map();
    this.versions = new Map();
    this.usage = [];
    this.websiteEnvs = new Map();
    this.websiteOwners = new Map();
    this.aliases = new Map();
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
      limits: normalizeLimits(record.limits, record.runtime),
      env: { ...(record.env || {}) },
      runtime: record.runtime || 'nodejs',
      routes: [...(record.routes || [])],
      triggers: [...(record.triggers || ['http'])],
      timerName: record.timerName || null,
      allowedOutboundHosts: [],
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.createdAt || new Date().toISOString()
    };
    const duplicate = [...this.functions.values()].find(
      (item) => item.websiteId === functionRecord.websiteId && item.slug === functionRecord.slug
    );
    if (duplicate) throw new Error('该函数标识已存在');
    if (functionRecord.timerName) {
      const timerTaken = [...this.functions.values()].find((item) => item.timerName === functionRecord.timerName);
      if (timerTaken) throw new Error('该定时触发名称已存在');
    }
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

  async getFunctionByTimerName(timerName) {
    const name = String(timerName || '').trim();
    if (!name) return null;
    const record = [...this.functions.values()].find((item) => item.timerName === name);
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

  async markVersionAvailable(functionId, versionNumber) {
    const target = this.versions.get(`${functionId}:${Number(versionNumber)}`);
    if (!target) return null;
    target.status = 'published';
    const functionRecord = this.functions.get(functionId);
    const latest = Number(functionRecord.publishedVersion || 0);
    if (target.version > latest) functionRecord.publishedVersion = target.version;
    functionRecord.updatedAt = new Date().toISOString();
    return clone(target);
  }

  async publishVersion(functionId, versionNumber) {
    const target = await this.markVersionAvailable(functionId, versionNumber);
    if (!target) return null;
    await this.ensureDefaultAliases(functionId, target.version);
    await this.setAlias(functionId, 'production', target.version);
    const functionRecord = this.functions.get(functionId);
    return clone({ function: functionRecord, version: target });
  }

  async listAliases(functionId) {
    return [...this.aliases.values()]
      .filter((item) => item.functionId === functionId)
      .sort((a, b) => a.alias.localeCompare(b.alias))
      .map(clone);
  }

  async getAlias(functionId, alias) {
    return clone(this.aliases.get(`${functionId}:${alias}`) || null);
  }

  async setAlias(functionId, alias, versionNumber) {
    const version = this.versions.get(`${functionId}:${Number(versionNumber)}`);
    if (!version || version.status === 'failed') return null;
    const record = { functionId, alias: String(alias), version: Number(versionNumber) };
    this.aliases.set(`${functionId}:${alias}`, record);
    return clone(record);
  }

  async deleteAlias(functionId, alias) {
    return this.aliases.delete(`${functionId}:${alias}`);
  }

  async ensureDefaultAliases(functionId, versionNumber) {
    if (!(await this.getAlias(functionId, 'production'))) {
      await this.setAlias(functionId, 'production', versionNumber);
    }
    if (!(await this.getAlias(functionId, 'develop'))) {
      await this.setAlias(functionId, 'develop', versionNumber);
    }
    return this.listAliases(functionId);
  }

  async putFunctionEnv(functionId, env) {
    const record = this.functions.get(functionId);
    if (!record) return null;
    record.env = { ...(env || {}) };
    record.updatedAt = new Date().toISOString();
    return clone(record.env);
  }

  async recordInvocation(record) {
    this.usage.push(clone(record));
    if (this.usage.length > 10_000) this.usage.splice(0, this.usage.length - 10_000);
  }

  async getWebsiteEnv(websiteId) {
    return clone(this.websiteEnvs.get(String(websiteId)) || {});
  }

  async putWebsiteEnv(websiteId, env) {
    this.websiteEnvs.set(String(websiteId), { ...(env || {}) });
    return this.getWebsiteEnv(websiteId);
  }

  async getWebsiteOwner(websiteId) {
    if (!this.websiteOwners.has(String(websiteId))) return null;
    return this.websiteOwners.get(String(websiteId));
  }

  async updateFunctionSpec(functionId, spec = {}) {
    const record = this.functions.get(functionId);
    if (!record) return null;
    if (spec.name) record.name = spec.name;
    if (spec.routes) record.routes = [...spec.routes];
    if (spec.triggers) record.triggers = [...spec.triggers];
    if (spec.timerName !== undefined) record.timerName = spec.timerName || null;
    if (spec.limits) record.limits = normalizeLimits(spec.limits, record.runtime);
    record.updatedAt = new Date().toISOString();
    return clone(record);
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
           max_code_bytes, max_invocations_per_minute, env_json, allowed_outbound_hosts_json,
           runtime, routes_json, triggers_json, timer_name)
         VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          JSON.stringify(record.allowedOutboundHosts || []),
          record.runtime || 'nodejs',
          JSON.stringify(record.routes || []),
          JSON.stringify(record.triggers || ['http']),
          record.timerName || null
        ]
      );
      return this.getFunction(record.functionId);
    },

    async getFunction(functionId) {
      const rows = await query(
        `SELECT ${FUNCTION_COLUMNS}
           FROM demox_functions WHERE function_id = ? LIMIT 1`,
        [functionId]
      );
      if (!rows.length) return null;
      return mapFunctionRow(rows[0]);
    },

    async getFunctionByWebsiteSlug(websiteId, slug) {
      const rows = await query(
        `SELECT ${FUNCTION_COLUMNS}
           FROM demox_functions WHERE website_id = ? AND slug = ? LIMIT 1`,
        [String(websiteId), String(slug)]
      );
      if (!rows.length) return null;
      return mapFunctionRow(rows[0]);
    },

    async getFunctionByTimerName(timerName) {
      const name = String(timerName || '').trim();
      if (!name) return null;
      const rows = await query(
        `SELECT ${FUNCTION_COLUMNS}
           FROM demox_functions WHERE timer_name = ? LIMIT 1`,
        [name]
      );
      if (!rows.length) return null;
      return mapFunctionRow(rows[0]);
    },

    async listFunctions(websiteId) {
      const rows = await query(
        `SELECT ${FUNCTION_COLUMNS}
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

    async markVersionAvailable(functionId, versionNumber) {
      await query(
        "UPDATE demox_function_versions SET status = 'published' WHERE function_id = ? AND version = ? AND status <> 'failed'",
        [functionId, Number(versionNumber)]
      );
      await query(
        `UPDATE demox_functions
            SET published_version = GREATEST(COALESCE(published_version, 0), ?), updated_at = CURRENT_TIMESTAMP
          WHERE function_id = ?`,
        [Number(versionNumber), functionId]
      );
      return this.getVersion(functionId, versionNumber);
    },

    async publishVersion(functionId, versionNumber) {
      const version = await this.markVersionAvailable(functionId, versionNumber);
      if (!version) return null;
      await this.ensureDefaultAliases(functionId, version.version);
      await this.setAlias(functionId, 'production', version.version);
      return { function: await this.getFunction(functionId), version };
    },

    async listAliases(functionId) {
      const rows = await query(
        'SELECT function_id, alias, version, updated_at FROM demox_function_aliases WHERE function_id = ? ORDER BY alias ASC',
        [functionId]
      );
      return rows.map((row) => ({
        functionId: row.function_id,
        alias: row.alias,
        version: Number(row.version),
        updatedAt: row.updated_at
      }));
    },

    async getAlias(functionId, alias) {
      const rows = await query(
        'SELECT function_id, alias, version, updated_at FROM demox_function_aliases WHERE function_id = ? AND alias = ? LIMIT 1',
        [functionId, String(alias)]
      );
      if (!rows.length) return null;
      return { functionId: rows[0].function_id, alias: rows[0].alias, version: Number(rows[0].version), updatedAt: rows[0].updated_at };
    },

    async setAlias(functionId, alias, versionNumber) {
      const version = await this.getVersion(functionId, versionNumber);
      if (!version || version.status === 'failed') return null;
      await query(
        `INSERT INTO demox_function_aliases (function_id, alias, version)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE version = VALUES(version), updated_at = CURRENT_TIMESTAMP`,
        [functionId, String(alias), Number(versionNumber)]
      );
      return this.getAlias(functionId, alias);
    },

    async deleteAlias(functionId, alias) {
      const result = await query(
        'DELETE FROM demox_function_aliases WHERE function_id = ? AND alias = ?',
        [functionId, String(alias)]
      );
      return Boolean(result?.affectedRows);
    },

    async ensureDefaultAliases(functionId, versionNumber) {
      await query(
        `INSERT IGNORE INTO demox_function_aliases (function_id, alias, version)
         VALUES (?, 'production', ?), (?, 'develop', ?)`,
        [functionId, Number(versionNumber), functionId, Number(versionNumber)]
      );
      return this.listAliases(functionId);
    },

    async putFunctionEnv(functionId, env) {
      await query(
        'UPDATE demox_functions SET env_json = ?, updated_at = CURRENT_TIMESTAMP WHERE function_id = ?',
        [JSON.stringify(env || {}), functionId]
      );
      const record = await this.getFunction(functionId);
      return record ? record.env : null;
    },

    async recordInvocation(record) {
      await query(
        `INSERT INTO demox_function_invocations
          (function_id, version, owner_user_id, status, duration_ms, request_bytes, response_bytes, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [record.functionId, record.version, String(record.ownerId), record.status, record.durationMs, record.requestBytes, record.responseBytes, record.errorCode || null]
      );
    },

    async getWebsiteEnv(websiteId) {
      const rows = await query(
        'SELECT env_json FROM demox_website_envs WHERE website_id = ? LIMIT 1',
        [String(websiteId)]
      );
      if (!rows.length) return {};
      return parseJson(rows[0].env_json, {});
    },

    async putWebsiteEnv(websiteId, env) {
      const payload = JSON.stringify(env || {});
      await query(
        `INSERT INTO demox_website_envs (website_id, env_json)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE env_json = VALUES(env_json), updated_at = CURRENT_TIMESTAMP`,
        [String(websiteId), payload]
      );
      return this.getWebsiteEnv(websiteId);
    },

    async getWebsiteOwner(websiteId) {
      try {
        const rows = await query(
          'SELECT user_id FROM websites WHERE website_id = ? LIMIT 1',
          [String(websiteId)]
        );
        if (!rows.length) return null;
        return rows[0].user_id == null ? null : String(rows[0].user_id);
      } catch {
        return null;
      }
    },

    async updateFunctionSpec(functionId, spec = {}) {
      const current = await this.getFunction(functionId);
      if (!current) return null;
      const limits = spec.limits ? normalizeLimits(spec.limits, current.runtime) : current.limits;
      await query(
        `UPDATE demox_functions
            SET name = ?, routes_json = ?, triggers_json = ?, timer_name = ?,
                timeout_ms = ?, memory_limit_bytes = ?, max_body_bytes = ?,
                max_response_bytes = ?, max_code_bytes = ?, max_invocations_per_minute = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE function_id = ?`,
        [
          spec.name || current.name,
          JSON.stringify(spec.routes || current.routes || []),
          JSON.stringify(spec.triggers || current.triggers || ['http']),
          spec.timerName !== undefined ? (spec.timerName || null) : current.timerName,
          limits.timeoutMs,
          limits.memoryLimitBytes,
          limits.maxBodyBytes,
          limits.maxResponseBytes,
          limits.maxCodeBytes,
          limits.maxInvocationsPerMinute,
          functionId
        ]
      );
      return this.getFunction(functionId);
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
  const runtime = row.runtime === 'quickjs' || !row.runtime ? 'nodejs' : row.runtime;
  const legacyQuickjs = row.runtime === 'quickjs' || row.runtime == null;
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
      timeoutMs: legacyQuickjs && Number(row.timeout_ms) <= 1000 ? undefined : row.timeout_ms,
      memoryLimitBytes: legacyQuickjs && Number(row.memory_limit_bytes) <= 16 * 1024 * 1024 ? undefined : row.memory_limit_bytes,
      maxBodyBytes: row.max_body_bytes,
      maxResponseBytes: row.max_response_bytes,
      maxCodeBytes: row.max_code_bytes,
      maxInvocationsPerMinute: row.max_invocations_per_minute
    }, runtime),
    env: parseJson(row.env_json, {}),
    runtime,
    routes: parseJson(row.routes_json, []),
    triggers: parseJson(row.triggers_json, ['http']),
    timerName: row.timer_name || null,
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
