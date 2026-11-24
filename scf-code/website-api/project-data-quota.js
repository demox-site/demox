'use strict';

const policy = require('./project-data-quota.json');

function quotaError(message, code = 'quota') {
  return Object.assign(new Error(message), { code });
}

// All growth paths (including the Python MySQL gateway) lock the SAME owner row.
// READ COMMITTED is essential: a transaction waiting for that lock must see the
// previous writer's committed usage, not a snapshot from its initial owner lookup.
function createProjectDataQuota(withConnection, limits = policy) {
  return async function withQuota(projectId, write) {
    if (typeof withConnection !== 'function') throw quotaError('数据库额度服务不可用', 'quota_unavailable');
    return withConnection(async (conn) => {
      const query = async (sql, params = []) => (await conn.query(sql, params))[0];
      await query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      try {
        const [project] = await query(policy.ownerSql, [projectId]);
        if (!project) throw quotaError('项目不存在', 'not_found');
        const owner = project.user_id;
        if (!(await query(policy.lockOwnerSql, [owner])).length) throw quotaError('项目所有者不存在', 'not_found');
        const [lockedProject] = await query(policy.lockProjectSql, [projectId]);
        if (!lockedProject || lockedProject.user_id !== owner) throw quotaError('项目归属已变化，请重试', 'quota_unavailable');
        const [plan] = await query(policy.planSql, [owner]);
        const limitBytes = Number(plan.is_pro) ? limits.proBytes : limits.userBytes;
        let usedBytes = null;

        const checkRow = async (tableId, pk, doc) => {
          // Lock the target row so concurrent deletes cannot change the delta.
          const [existing] = await query(policy.rowSql, [projectId, tableId, pk]);
          const [size] = await query(policy.sizeSql, [doc]);
          const delta = Number(size.row_bytes) - Number(existing?.row_bytes || 0);
          if (delta > 0) {
            if (usedBytes === null) {
              const [usage] = await query(policy.usageSql, [owner]);
              usedBytes = Number(usage.used_bytes);
            }
            if (usedBytes + delta > limitBytes) {
              throw quotaError(`账号项目数据库总容量已达上限（${limitBytes / 1024 / 1024} MiB），请删除数据或升级会员`);
            }
          }
          if (usedBytes !== null) usedBytes += delta;
          return !!existing;
        };
        const result = await write({ query, checkRow });
        await conn.commit();
        return result;
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    });
  };
}

module.exports = { createProjectDataQuota, policy };
