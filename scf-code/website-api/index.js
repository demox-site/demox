/**
 * Demox Website API - SCF 云函数
 * 网站管理服务
 */

const AdmZip = require('adm-zip');
const COS = require('cos-nodejs-sdk-v5');
const path = require('path');
const { query } = require('./shared/db.js');
const { getUserId, authenticate } = require('./shared/jwt.js');
const { kvPut, kvDelete } = require('./shared/edgeone.js');

// COS 配置
const hostingBucket = 'resource-game-1307257815';
const hostingRegion = 'ap-chengdu';
const defaultDomain = 'demox.site';

// 初始化 COS
const cos = new COS({
  SecretId: process.env.COS_SECRET_ID || process.env.TENCENTCLOUD_SECRETID,
  SecretKey: process.env.COS_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY,
  SecurityToken: process.env.COS_SECRET_KEY ? undefined : process.env.TENCENTCLOUD_SESSIONTOKEN,
  UserAgent: 'Demox-Website-API'
});

/**
 * SCF 云函数入口
 */
exports.main = async (event, context) => {
  try {
    // 解析 body
    let body = event.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }
    event.body = body;

    const pathUrl = event.path || body?.path || event.queryString?.path || '/';
    const method = event.httpMethod || 'POST';

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers: getCORSHeaders(), body: '' };
    }

    // 路由分发
    if (pathUrl.includes('/upload') || body?.action === 'upload_and_deploy') {
      return await handleUploadAndDeploy(event);
    } else if (pathUrl.includes('/list') || body?.action === 'list') {
      return await handleListWebsites(event);
    } else if (pathUrl.includes('/delete') || body?.action === 'delete') {
      return await handleDeleteWebsite(event);
    } else if (pathUrl.includes('/list-all') || body?.action === 'list_all') {
      return await handleListAllWebsites(event);
    } else if (pathUrl.includes('/update-name') || body?.action === 'update_name') {
      return await handleUpdateWebsiteName(event);
    } else if (pathUrl.includes('/update-tags') || body?.action === 'update_tags') {
      return await handleUpdateWebsiteTags(event);
    } else if (pathUrl.includes('/set-subdomain') || body?.action === 'set_subdomain') {
      return await handleSetSubdomain(event);
    } else if (pathUrl.includes('/clear-subdomain') || body?.action === 'clear_subdomain') {
      return await handleClearSubdomain(event);
    } else if (pathUrl.includes('/migrate-subdomain') || body?.action === 'migrate_subdomain') {
      return await handleMigrateSubdomain(event);
    } else {
      return {
        statusCode: 404,
        headers: getCORSHeaders(),
        body: JSON.stringify({ error: 'Not Found', message: '接口不存在' })
      };
    }
  } catch (error) {
    console.error('处理请求失败:', error);
    return {
      statusCode: 500,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: 'Internal Server Error', message: error.message })
    };
  }
};

/**
 * 从数据库获取用户角色配置
 */
async function getUserLimits(userId) {
  try {
    // 1. 获取用户的角色
    const userRolesResult = await query('SELECT roles FROM user_roles WHERE user_id = ?', [userId]);

    if (userRolesResult.length === 0) {
      // 没有角色配置，返回默认普通用户配置
      return {
        name: 'user',
        priority: 10,
        deployment_limit: 10,
        max_file_size: 50 * 1024 * 1024,
        max_file_count: 100
      };
    }

    // 处理 roles 字段（可能是字符串或已解析的对象）
    let userRoles = userRolesResult[0].roles;
    if (typeof userRoles === 'string') {
      userRoles = JSON.parse(userRoles || '[]');
    } else if (!Array.isArray(userRoles)) {
      userRoles = [];
    }

    // 2. 获取所有角色配置
    const rolesConfig = await query('SELECT * FROM roles WHERE enabled = 1 ORDER BY priority DESC');

    // 3. 找到用户拥有的最高优先级角色
    let highestRole = null;
    for (const role of rolesConfig) {
      if (userRoles.includes(role.id)) {
        if (!highestRole || role.priority > highestRole.priority) {
          highestRole = role;
        }
      }
    }

    if (!highestRole) {
      // 没有匹配的角色，返回默认配置
      return {
        name: 'user',
        priority: 10,
        deployment_limit: 10,
        max_file_size: 50 * 1024 * 1024,
        max_file_count: 100
      };
    }

    return {
      name: highestRole.name,
      priority: highestRole.priority,
      deployment_limit: highestRole.deployment_limit,
      max_file_size: highestRole.max_file_size || 50 * 1024 * 1024,
      max_file_count: highestRole.max_file_count
    };
  } catch (e) {
    console.error('获取用户角色配置失败:', e);
    // 返回默认配置
    return {
      name: 'user',
      priority: 10,
      deployment_limit: 10,
      max_file_size: 50 * 1024 * 1024,
      max_file_count: 100
    };
  }
}

/**
 * 检查管理员权限
 */
async function checkAdmin(userId) {
  const roles = await query('SELECT roles FROM user_roles WHERE user_id = ?', [userId]);
  if (roles.length === 0) {
    return false;
  }
  const userRoles = JSON.parse(roles[0].roles || '[]');
  return userRoles.includes('admin');
}

/**
 * 获取用户网站列表
 */
async function handleListWebsites(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const websites = await query(
    'SELECT * FROM websites WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      websites,
      count: websites.length
    })
  };
}

/**
 * 管理员查看所有网站
 */
async function handleListAllWebsites(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const isAdmin = await checkAdmin(userId);
  if (!isAdmin) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '仅管理员可访问' })
    };
  }

  const websites = await query('SELECT * FROM websites ORDER BY created_at DESC');

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      websites,
      count: websites.length
    })
  };
}

/**
 * 删除网站
 */
async function handleDeleteWebsite(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { id, websiteId, key } = event.body || event;

  if (!id && !websiteId && !key) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: id 或 websiteId 或 key' })
    };
  }

  let whereClause = 'user_id = ?';
  const params = [userId];

  if (id) {
    whereClause += ' AND id = ?';
    params.push(id);
  } else if (websiteId) {
    whereClause += ' AND website_id = ?';
    params.push(websiteId);
  } else if (key) {
    whereClause += ' AND path = ?';
    params.push(key);
  }

  // 删除前清理自定义子域名前缀的 KV 记录，失败不阻断删除
  try {
    const toDelete = await query(
      `SELECT subdomain FROM websites WHERE ${whereClause}`,
      params
    );
    for (const row of toDelete) {
      const label = row.subdomain;
      if (!label) continue;
      try { await kvDelete(label); } catch (e) { console.error('KV delete 失败:', e.message); }
    }
  } catch (e) {
    console.error('清理自定义前缀失败:', e.message);
  }

  const result = await query(`DELETE FROM websites WHERE ${whereClause}`, params);

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '删除成功',
      deletedCount: result.affectedRows
    })
  };
}

/**
 * 更新网站名称
 */
async function handleUpdateWebsiteName(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, name } = event.body || event;

  if (!docId || !name) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: docId, name' })
    };
  }

  const websites = await query('SELECT * FROM websites WHERE id = ?', [docId]);
  if (websites.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '记录不存在' })
    };
  }

  if (websites[0].user_id !== userId) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限更新该记录' })
    };
  }

  await query(
    'UPDATE websites SET name = ?, updated_at = NOW() WHERE id = ?',
    [name, docId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '名称已更新',
      name
    })
  };
}

/**
 * 更新网站标签
 */
async function handleUpdateWebsiteTags(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, tags } = event.body || event;

  if (!docId || !Array.isArray(tags)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: docId, tags' })
    };
  }

  const cleanTags = tags
    .map(t => String(t || '').trim())
    .filter(t => t.length > 0 && t.length <= 32);

  if (cleanTags.length > 20) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '标签数量不能超过20个' })
    };
  }

  const websites = await query('SELECT * FROM websites WHERE id = ?', [docId]);
  if (websites.length === 0) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '记录不存在' })
    };
  }

  if (websites[0].user_id !== userId) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '无权限更新该记录' })
    };
  }

  await query(
    'UPDATE websites SET tags = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(cleanTags), docId]
  );

  return {
    statusCode: 200,
    headers: getCORSHeaders(),
    body: JSON.stringify({
      success: true,
      message: '标签已更新',
      tags: cleanTags
    })
  };
}


/**
 * 校验自定义子域名前缀(label)：只允许小写字母、数字、连字符，
 * 不以连字符开头/结尾，长度 1-63；并排除会与旧格式/平台冲突的前缀。
 */
const RESERVED_LABELS = new Set([
  'www', 'sites', 'kv-admin', 'api', 'app', 'admin', 'mail', 'ftp',
  'cdn', 'static', 'assets', 'blog', 'demox'
]);

function normalizeLabel(input) {
  return String(input || '').trim().toLowerCase();
}

function isValidLabel(label) {
  if (typeof label !== 'string') return false;
  if (label.length < 1 || label.length > 63) return false;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return false;
  // 旧格式以 sites- 开头，避免与向后兼容正则冲突
  if (label.startsWith('sites-')) return false;
  if (RESERVED_LABELS.has(label)) return false;
  return true;
}

/**
 * 设置/修改站点的自定义子域名前缀。
 * 流程：校验归属 + 前缀合法/未占用 → 写 KV(label->{path}) → 删旧 label 的 KV → 落库。
 * 访问地址：https://{label}.demox.site
 */
async function handleSetSubdomain(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, websiteId, subdomain } = event.body || event;
  const label = normalizeLabel(subdomain);

  if (!isValidLabel(label)) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        message: '前缀不合法：仅限小写字母、数字、连字符，1-63 位，且不能用保留词'
      })
    };
  }

  // 定位站点并校验归属
  let site;
  if (docId) {
    const rows = await query('SELECT * FROM websites WHERE id = ?', [docId]);
    site = rows[0];
  } else if (websiteId) {
    const rows = await query('SELECT * FROM websites WHERE user_id = ? AND website_id = ?', [userId, websiteId]);
    site = rows[0];
  }

  if (!site) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '站点不存在' })
    };
  }
  if (site.user_id !== userId) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '无权操作该站点' })
    };
  }

  // 前缀是否被其它站点占用
  const occupied = await query('SELECT id FROM websites WHERE subdomain = ?', [label]);
  if (occupied.length > 0 && String(occupied[0].id) !== String(site.id)) {
    return {
      statusCode: 409,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '该前缀已被占用，请换一个' })
    };
  }

  try {
    // 写 KV：label -> { userId, websiteId, path }
    await kvPut(label, {
      userId: site.user_id,
      websiteId: site.website_id,
      path: site.path
    });

    // 若改了前缀，删除旧 label 的 KV（失败不阻断）
    if (site.subdomain && site.subdomain !== label) {
      try { await kvDelete(site.subdomain); } catch (e) { console.error('删除旧前缀 KV 失败:', e.message); }
    }

    // 落库
    await query(
      'UPDATE websites SET subdomain = ?, updated_at = NOW() WHERE id = ?',
      [label, site.id]
    );

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        subdomain: label,
        url: `https://${label}.demox.site`,
        message: '设置成功，访问可能有最长 60 秒的边缘缓存同步延迟'
      })
    };
  } catch (error) {
    console.error('设置子域名失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: error.message || '设置失败' })
    };
  }
}

/**
 * 清除站点的自定义子域名前缀（删 KV + 清库），站点仍可用原始长地址访问。
 */
async function handleClearSubdomain(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { docId, websiteId } = event.body || event;

  let site;
  if (docId) {
    const rows = await query('SELECT * FROM websites WHERE id = ?', [docId]);
    site = rows[0];
  } else if (websiteId) {
    const rows = await query('SELECT * FROM websites WHERE user_id = ? AND website_id = ?', [userId, websiteId]);
    site = rows[0];
  }

  if (!site) {
    return {
      statusCode: 404,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '站点不存在' })
    };
  }
  if (site.user_id !== userId) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: '无权操作该站点' })
    };
  }

  if (!site.subdomain) {
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: true, message: '该站点未设置自定义前缀' })
    };
  }

  try {
    try { await kvDelete(site.subdomain); } catch (e) { console.error('删除前缀 KV 失败:', e.message); }
    await query('UPDATE websites SET subdomain = NULL, updated_at = NOW() WHERE id = ?', [site.id]);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: true, message: '已清除自定义前缀' })
    };
  } catch (error) {
    console.error('清除子域名失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, message: error.message || '清除失败' })
    };
  }
}

/**
 * 临时迁移：给 websites 表加 subdomain 列 + 唯一索引（幂等）。
 * 用一次性密钥授权（body.migrationKey === env.MIGRATION_KEY），不依赖 DB 角色，
 * 避免“查 admin 需先连库”的鸡生蛋问题。迁移完成后可删除本 handler、路由和环境变量。
 */
async function handleMigrateSubdomain(event) {
  const provided = (event.body && event.body.migrationKey) || event.migrationKey;
  const expected = process.env.MIGRATION_KEY || '';
  if (!expected || provided !== expected) {
    return {
      statusCode: 403,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '迁移密钥无效' })
    };
  }

  const steps = [];
  try {
    // 列是否已存在
    const col = await query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND COLUMN_NAME = 'subdomain'`
    );
    if (col[0].c === 0) {
      await query(
        `ALTER TABLE websites ADD COLUMN subdomain VARCHAR(63) DEFAULT NULL COMMENT '自定义子域名前缀(label)'`
      );
      steps.push('added column subdomain');
    } else {
      steps.push('column subdomain already exists');
    }

    // 唯一索引是否已存在
    const idx = await query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'websites' AND INDEX_NAME = 'uniq_subdomain'`
    );
    if (idx[0].c === 0) {
      await query(`ALTER TABLE websites ADD UNIQUE KEY uniq_subdomain (subdomain)`);
      steps.push('added unique index uniq_subdomain');
    } else {
      steps.push('index uniq_subdomain already exists');
    }

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: true, steps })
    };
  } catch (error) {
    console.error('迁移失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({ success: false, steps, message: error.message })
    };
  }
}

/**
 * 处理上传并部署
 */
async function handleUploadAndDeploy(event) {
  const userId = getUserId(event);
  if (!userId) {
    return {
      statusCode: 401,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '未登录或token已过期' })
    };
  }

  const { fileContentBase64, websiteId: inputWebsiteId, fileName } = event.body || event;

  if (!fileContentBase64 || !fileName) {
    return {
      statusCode: 400,
      headers: getCORSHeaders(),
      body: JSON.stringify({ error: '缺少必要参数: fileContentBase64, fileName' })
    };
  }

  try {
    // 获取用户角色配置（从数据库读取）
    const roleConfig = await getUserLimits(userId);
    console.log(`用户 ${userId} 的角色配置:`, roleConfig);

    // 解析 ZIP
    const buffer = Buffer.from(String(fileContentBase64), 'base64');
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    // 检查文件数量限制
    const validEntries = zipEntries.filter(e =>
      !e.isDirectory &&
      !e.entryName.includes('..') &&
      !e.entryName.includes('__MACOSX') &&
      !e.entryName.includes('.DS_Store')
    );

    if (roleConfig.max_file_count && validEntries.length > roleConfig.max_file_count) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          message: `文件数量超出限制！当前上传包含 ${validEntries.length} 个文件，您的角色限制为 ${roleConfig.max_file_count} 个文件。`
        })
      };
    }

    // 检查文件大小限制
    const totalSize = buffer.length;
    if (roleConfig.max_file_size && totalSize > roleConfig.max_file_size) {
      return {
        statusCode: 200,
        headers: getCORSHeaders(),
        body: JSON.stringify({
          success: false,
          message: `文件大小超出限制！当前文件大小 ${Math.round(totalSize / 1024 / 1024)}MB，您的角色限制为 ${Math.round(roleConfig.max_file_size / 1024 / 1024)}MB。`
        })
      };
    }

    // 检查部署数量限制
    if (roleConfig.deployment_limit) {
      const countRes = await query('SELECT COUNT(*) as count FROM websites WHERE user_id = ?', [userId]);
      const websiteId = inputWebsiteId ? normalizeWebsiteId(inputWebsiteId) : null;

      // 如果是更新现有网站，不算入新部署
      if (websiteId) {
        const existing = await query('SELECT id FROM websites WHERE user_id = ? AND website_id = ?', [userId, websiteId]);
        if (existing.length === 0 && countRes[0].count >= roleConfig.deployment_limit) {
          return {
            statusCode: 200,
            headers: getCORSHeaders(),
            body: JSON.stringify({
              success: false,
              message: `已达到部署上限！您的角色限制为 ${roleConfig.deployment_limit} 个网站。`
            })
          };
        }
      } else if (countRes[0].count >= roleConfig.deployment_limit) {
        return {
          statusCode: 200,
          headers: getCORSHeaders(),
          body: JSON.stringify({
            success: false,
            message: `已达到部署上限！您的角色限制为 ${roleConfig.deployment_limit} 个网站。`
          })
        };
      }
    }

    // 生成或使用现有的 websiteId
    const websiteId = inputWebsiteId ? normalizeWebsiteId(inputWebsiteId) : generateWebsiteId();
    const fileNameNoExt = normalizeFileNameNoExt(fileName);
    const targetPrefix = `sites/${userId}/${websiteId}/${fileNameNoExt}`;
    const urlPrefix = `sites-${userId}-${websiteId}-${fileNameNoExt}`;

    // 部署到 COS
    const uploadedCount = await deployZipToCos(zipEntries, targetPrefix);
    console.log(`部署完成，上传了 ${uploadedCount} 个文件`);

    // 生成访问 URL
    const finalUrl = `https://${urlPrefix}.${defaultDomain}/index.html?v=${Date.now()}`;

    // 保存到数据库
    const existing = await query('SELECT id, subdomain FROM websites WHERE user_id = ? AND website_id = ?', [userId, websiteId]);
    if (existing.length > 0) {
      await query(
        `UPDATE websites SET file_name = ?, name = ?, path = ?, url = ?, updated_at = NOW() WHERE user_id = ? AND website_id = ?`,
        [fileName, fileName, targetPrefix, finalUrl, userId, websiteId]
      );
      // 若已设置自定义前缀，重部署后 path 可能变化，刷新 KV 路由表
      const label = existing[0].subdomain;
      if (label) {
        try {
          await kvPut(label, { userId, websiteId, path: targetPrefix });
        } catch (e) {
          console.error('重部署刷新 KV 失败:', e.message);
        }
      }
    } else {
      await query(
        `INSERT INTO websites (user_id, website_id, file_name, name, path, url, tags) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, websiteId, fileName, fileName, targetPrefix, finalUrl, JSON.stringify([])]
      );
    }

    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: true,
        url: finalUrl,
        message: '部署成功',
        websiteId: websiteId,
        path: targetPrefix,
        uploadedCount
      })
    };
  } catch (error) {
    console.error('部署失败:', error);
    return {
      statusCode: 200,
      headers: getCORSHeaders(),
      body: JSON.stringify({
        success: false,
        message: error.message || '部署失败'
      })
    };
  }
}

/**
 * 部署 ZIP 到 COS
 */
async function deployZipToCos(zipEntries, targetPrefix) {
  const validEntries = zipEntries.filter(entry => {
    if (entry.isDirectory) return false;
    const name = entry.entryName;
    if (name.includes('..') || name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
    return true;
  });

  let commonPrefix = '';
  if (validEntries.length > 0) {
    const firstEntry = validEntries[0];
    const parts = firstEntry.entryName.split('/');
    if (parts.length > 1) {
      const potentialPrefix = parts[0] + '/';
      const allMatch = validEntries.every(e => e.entryName.startsWith(potentialPrefix));
      if (allMatch) {
        commonPrefix = potentialPrefix;
      }
    }
  }

  const uploadTasks = validEntries.map(entry => {
    return new Promise((resolve, reject) => {
      let entryName = entry.entryName;
      if (commonPrefix && entryName.startsWith(commonPrefix)) {
        entryName = entryName.slice(commonPrefix.length);
      }
      const key = `${targetPrefix}/${entryName}`;
      const contentType = getContentType(key);
      const headers = getCacheHeaders(key);

      const putParams = {
        Bucket: hostingBucket,
        Region: hostingRegion,
        Key: key,
        Body: entry.getData()
      };
      if (contentType) {
        putParams.ContentType = contentType;
      }
      if (headers) {
        putParams.Headers = headers;
      }

      cos.putObject(putParams, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  });

  await Promise.all(uploadTasks);
  return validEntries.length;
}

/**
 * 生成 8 位网站 ID
 */
function generateWebsiteId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * 规范化网站 ID
 */
function normalizeWebsiteId(id) {
  if (typeof id === 'string' && /^[A-Z0-9]{8}$/.test(id)) {
    return id;
  }
  return generateWebsiteId();
}

/**
 * 规范化文件名
 */
function normalizeFileNameNoExt(name) {
  try {
    const base = String(name || '').replace(/\.[^/.]+$/, '').toLowerCase();
    return /^[a-z0-9]+$/.test(base) ? base : 'dist';
  } catch {
    return 'dist';
  }
}

/**
 * 获取 Content-Type
 */
function getContentType(key) {
  const ext = (path.extname(key) || '').toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.mp4': 'video/mp4',
    '.txt': 'text/plain; charset=utf-8'
  };
  return types[ext];
}

/**
 * 获取缓存头
 */
function getCacheHeaders(key) {
  const ext = (path.extname(key) || '').toLowerCase();
  if (ext === '.html') {
    return { 'Cache-Control': 'no-cache, no-store, must-revalidate' };
  }
  return { 'Cache-Control': 'public, max-age=31536000, immutable' };
}

/**
 * 获取 CORS 头
 */
function getCORSHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}
