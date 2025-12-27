const tcb = require('@cloudbase/node-sdk');
const AdmZip = require('adm-zip');
const COS = require('cos-nodejs-sdk-v5');
const tencentcloud = require('tencentcloud-sdk-nodejs');
const MonitorClient = tencentcloud.monitor.v20180724.Client;
const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');

exports.main = async (event, context) => {
  const { action = 'bucket_stats', fileId, userId, websiteId, fileName, taskId } = event || {};
  
  // 静态网站托管 Bucket 名称及区域
  const hostingBucket = 'resource-game-1307257815';
  const region = 'ap-chengdu';

  // 初始化 COS
  // 优先从环境变量获取自定义配置(COS_SECRET_ID/KEY)，否则使用云函数临时密钥
  const cos = new COS({
    SecretId: process.env.COS_SECRET_ID || process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.COS_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.COS_SECRET_KEY ? undefined : process.env.TENCENTCLOUD_SESSIONTOKEN,
    UserAgent: 'CloudBase-Deploy-Function'
  });

  const app = tcb.init();
  const db = app.database();

  /**
   * updateProgress
   * 更新任务进度
   */
  const updateProgress = async (status, data = {}) => {
    if (!taskId) return;
    try {
      // 使用 set 覆盖或创建，保持最新状态
      await db.collection('ai_builder_task_progress').doc(taskId).set({
        _openid: userId, // 显式设置 _openid 以确保前端用户有权限读取（假设默认 ACL 为仅创建者/管理员可读写，设置后用户即为所有者）
        userId, // 记录归属用户，便于权限控制
        websiteId,
        status,
        ...data,
        updatedAt: db.serverDate()
      });
    } catch (e) {
      console.warn('Failed to update progress:', e);
    }
  };

  /**
   * getUserLimits
   * 获取用户角色的文件数量限制
   */
  const getUserLimits = async (targetUserId) => {
      try {
        // 1. 获取用户角色
        const userRoleRes = await db.collection('ai_builder_user_roles').doc(targetUserId).get();
        let roles = ['user'];
        if (userRoleRes.data && userRoleRes.data.length > 0 && userRoleRes.data[0].role) {
            roles = userRoleRes.data[0].role;
        }
        
        // 确保 'user' 角色存在于候选列表中
        if (!roles.includes('user')) {
            roles.push('user');
        }

        // 2. 查询角色配置
        const _ = db.command;
        const limitsRes = await db.collection('ai_builder_roles')
            .where({
                _id: _.in(roles)
            })
            .get();
        
        if (!limitsRes.data || limitsRes.data.length === 0) {
             console.warn(`未找到用户 ${targetUserId} 的任何角色配置 (roles: ${roles})`);
             return null; 
        }

        // 3. 按优先级排序取最高者
        const sorted = limitsRes.data.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        const effectiveRole = sorted[0];
        
        console.log(`用户 ${targetUserId} 生效角色: ${effectiveRole.name || effectiveRole._id}, 配置: ${JSON.stringify(effectiveRole)}`);
        return effectiveRole;
    } catch (e) {
        console.warn('获取用户角色配置失败:', e);
        return null;
    }
  };

  /**
   * getContentType
   * 根据文件扩展名返回合理的 Content-Type
   */
  const getContentType = (key) => {
    const ext = (path.extname(key) || '').toLowerCase();
    switch (ext) {
      case '.html': return 'text/html; charset=utf-8';
      case '.css': return 'text/css; charset=utf-8';
      case '.js': return 'application/javascript; charset=utf-8';
      case '.mjs': return 'application/javascript; charset=utf-8';
      case '.json': return 'application/json; charset=utf-8';
      case '.svg': return 'image/svg+xml';
      case '.png': return 'image/png';
      case '.jpg':
      case '.jpeg': return 'image/jpeg';
      case '.gif': return 'image/gif';
      case '.webp': return 'image/webp';
      case '.ico': return 'image/x-icon';
      case '.woff': return 'font/woff';
      case '.woff2': return 'font/woff2';
      case '.ttf': return 'font/ttf';
      case '.mp4': return 'video/mp4';
      case '.txt': return 'text/plain; charset=utf-8';
      default: return undefined;
    }
  };

  /**
   * getCacheHeaders
   * 返回适合的缓存控制头：HTML 不缓存；静态资源长缓存
   */
  const getCacheHeaders = (key) => {
    const ext = (path.extname(key) || '').toLowerCase();
    if (ext === '.html') {
      return {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      };
    }
    // 其它静态资源按一年不可变缓存
    return {
      'Cache-Control': 'public, max-age=31536000, immutable'
    };
  };

  /**
   * resolveExistingPath
   * 返回已有站点的部署路径前缀，如果不存在则返回 null
   */
  const resolveExistingPath = async (uid, wid) => {
    try {
      let doc = null;
      if (wid) {
        const resById = await db.collection('resource-game').doc(wid).get();
        doc = resById.data && resById.data[0] ? resById.data[0] : null;
      }
      if (!doc && uid && wid) {
        const resByFields = await db.collection('resource-game').where({ userId: uid, websiteId: wid }).limit(1).get();
        doc = resByFields.data && resByFields.data[0] ? resByFields.data[0] : null;
      }
      return doc && doc.path ? String(doc.path) : null;
    } catch {
      return null;
    }
  };

  /**
   * deployZipToTarget
   * 将 zipEntries 部署到指定目标前缀，覆盖同名文件
   */
  const deployZipToTarget = async (zipEntries, targetPrefix, onProgress) => {
    const validEntries = zipEntries.filter(entry => {
      if (entry.isDirectory) return false;
      const name = entry.entryName;
      if (name.includes('..')) return false;
      if (name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
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

    // 此处不处理 update_name 动作；名称更新属于主流程的独立动作

    const uploadTasks = [];
    let uploadedCount = 0;

    for (const entry of validEntries) {
      let entryName = entry.entryName;
      if (commonPrefix && entryName.startsWith(commonPrefix)) {
        entryName = entryName.slice(commonPrefix.length);
      }
      const key = `${targetPrefix}/${entryName}`;
      uploadTasks.push(() => {
        return new Promise((resolve, reject) => {
          const headers = getCacheHeaders(key);
          const contentType = getContentType(key);
          const putParams = {
            Bucket: hostingBucket,
            Region: region,
            Key: key,
            Body: entry.getData()
          };
          if (contentType) {
            putParams.ContentType = contentType;
          }
          if (headers) {
            putParams.Headers = headers;
          }
          cos.putObject(putParams, function(err, data) {
            if (err) {
              reject(err);
            } else {
              uploadedCount++;
              if (onProgress) onProgress(uploadedCount);
              resolve(data);
            }
          });
        });
      });
    }

    // Concurrency limit could be added here if needed, but for now we use Promise.all
    // Since Promise.all runs all at once, we might want to use p-limit if files are many
    // But for simplicity and existing behavior, we keep Promise.all but with tracking
    await Promise.all(uploadTasks.map(p => p()));
  };
  /**
   * normalizeWebsiteId
   * 将传入的 websiteId 规范为 8 位大写字母与数字的字符串
   * 若入参不符合规则，则生成新的随机 ID
   */
  const normalizeWebsiteId = (id) => {
    const ok = typeof id === 'string' && /^[A-Z0-9]{8}$/.test(id);
    if (ok) return id;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 8; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  };

  /**
   * normalizeFileNameNoExt
   * 从文件名取不带扩展名的段，若包含非英文字母和数字，则返回 'dist'
   */
  const normalizeFileNameNoExt = (name) => {
    try {
      const base = String(name || '').replace(/\.[^/.]+$/, '').toLowerCase();
      return /^[a-z0-9]+$/.test(base) ? base : 'dist';
    } catch {
      return 'dist';
    }
  };

  /**
   * sumSites
   * 统计 sites/ 前缀下对象的体积与数量
   * @returns {{ bytes: number, count: number }}
   */
  const sumSites = async () => {
      let marker = '';
      let totalBytes = 0;
      let totalCount = 0;
      const prefix = 'sites/';
      while (true) {
          const resp = await new Promise((resolve, reject) => {
              cos.getBucket({
                  Bucket: hostingBucket,
                  Region: region,
                  Prefix: prefix,
                  Marker: marker,
                  MaxKeys: 1000
              }, (err, data) => {
                  if (err) return reject(err);
                  resolve(data);
              });
          });
          const contents = resp.Contents || [];
          for (const item of contents) {
              totalBytes += Number(item.Size || 0);
              totalCount += 1;
          }
          if (resp.IsTruncated && resp.NextMarker) {
              marker = resp.NextMarker;
          } else {
              break;
          }
      }
      return { bytes: totalBytes, count: totalCount };
  };

  /**
   * countUsageStats
   * 统计在用用户数量（sites 下二级目录数量）与在用项目数量（三级目录数量）
   * @returns {{ usersCount: number, projectsCount: number }}
   */
  const countUsageStats = async () => {
      /**
       * listDirsAll
       * 分页列出某前缀下的所有“目录”（使用 Delimiter='/' 获取 CommonPrefixes）
       * @param {string} prefix
       * @returns {Promise<Array<{ Prefix: string }>>}
       */
      const listDirsAll = async (prefix) => {
          let marker = '';
          const all = [];
          while (true) {
              const resp = await new Promise((resolve, reject) => {
                  cos.getBucket({
                      Bucket: hostingBucket,
                      Region: region,
                      Prefix: prefix,
                      Delimiter: '/',
                      Marker: marker,
                      MaxKeys: 1000
                  }, (err, data) => {
                      if (err) return reject(err);
                      resolve(data);
                  });
              });
              const dirs = resp.CommonPrefixes || [];
              for (const d of dirs) all.push(d);
              if (resp.IsTruncated && resp.NextMarker) {
                  marker = resp.NextMarker;
              } else {
                  break;
              }
          }
          return all;
      };
      
      // 用户目录：sites/<userId>/
      const userDirs = await listDirsAll('sites/');
      const usersCount = userDirs.length;
      
      // 项目目录（三级目录）：sites/<userId>/<websiteId>/<fileNameNoExt>/
      let projectsCount = 0;
      for (const u of userDirs) {
          const webDirs = await listDirsAll(u.Prefix); // 二级：websiteId
          for (const w of webDirs) {
              const thirdDirs = await listDirsAll(w.Prefix); // 三级：fileNameNoExt
              projectsCount += thirdDirs.length;
          }
      }
      
      return { usersCount, projectsCount };
  };

  /**
   * fetchCosTraffic
   * 拉取 COS 桶流量时间序列（按天/小时）
   * @param {'day'|'hour'} level 时间维度
   * @param {number} startMs 开始时间戳（毫秒）
   * @param {number} endMs 结束时间戳（毫秒）
   * @returns {{ timestamps: string[], inbound: number[]|null, outbound: number[]|null }}
   */
  const fetchCosTraffic = async (level, startMs, endMs) => {
      try {
          // 从 bucket 名中提取 APPID（例如 example-1250000000 → 1250000000）
          const appidMatch = String(hostingBucket).match(/(\d{5,})$/);
          const appid = appidMatch ? appidMatch[1] : '';

          if (!appid) {
              console.warn('未能从 Bucket 名中解析 APPID，跳过监控统计');
              return { inBytes: null, outBytes: null };
          }

          const secretId = process.env.COS_SECRET_ID || process.env.TENCENTCLOUD_SECRETID;
          const secretKey = process.env.COS_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY;
          const sessionToken = process.env.COS_SECRET_KEY ? undefined : process.env.TENCENTCLOUD_SESSIONTOKEN;

          const monitorClient = new MonitorClient({
              credential: { secretId, secretKey, token: sessionToken },
              region: 'ap-guangzhou',
              profile: {
                  httpProfile: {
                      endpoint: 'monitor.tencentcloudapi.com'
                  }
              }
          });

          const fmt = (ms) => {
            const d = new Date(ms);
            const pad = (n) => String(n).padStart(2, '0');
            const YYYY = d.getFullYear();
            const MM = pad(d.getMonth() + 1);
            const DD = pad(d.getDate());
            const hh = pad(d.getHours());
            const mm = pad(d.getMinutes());
            const ss = pad(d.getSeconds());
            // 统一使用东八区偏移
            return `${YYYY}-${MM}-${DD}T${hh}:${mm}:${ss}+08:00`;
          };
          const start = fmt(startMs);
          const end = fmt(endMs);
          const period = level === 'hour' ? 3600 : 86400;

          const commonParams = {
              Period: period,
              StartTime: start,
              EndTime: end,
              Instances: [
                {
                  Dimensions: [
                    { Name: 'appid', Value: appid },
                    { Name: 'bucket', Value: hostingBucket }
                  ]
                }
              ]
          };

          const tryGet = async (Namespace, MetricName) => {
              try {
                  return await monitorClient.GetMonitorData({
                      ...commonParams,
                      Namespace,
                      MetricName
                  });
              } catch (e) {
                  return null;
              }
          };

          const seriesFromResponse = (resp) => {
            try {
              const dps = resp?.Response?.DataPoints || resp?.DataPoints || [];
              if (!Array.isArray(dps) || dps.length === 0) return null;
              const first = dps[0];
              const timestamps = first.Timestamps || first.TimeStamps || first.Times || [];
              const values = first.Values || first.Value || first.Data || [];
              if (!Array.isArray(timestamps) || !Array.isArray(values)) return null;
              return { timestamps, values };
            } catch (e) {
              console.warn('解析监控返回失败:', e);
              return null;
            }
          };

          // 依次尝试不同命名空间与指标名组合
          const candidates = {
              in: [
                  ['QCE/COS', 'InternetTraffic'],
                  ['qce/cos', 'internet_traffic']
              ],
              out: [
                  ['QCE/COS', 'InternalTraffic'],
                  ['qce/cos', 'internal_traffic'],
                  // 备用：仅作为出站备选，不一定符合需求
                  ['QCE/COS', 'CdnOriginTraffic']
              ]
          };

          let inbound = null;
          for (const [ns, metric] of candidates.in) {
            const res = await tryGet(ns, metric);
            if (res) {
              const parsed = seriesFromResponse(res);
              if (parsed) {
                  inbound = parsed;
                  break;
              }
            }
          }

          let outbound = null;
          for (const [ns, metric] of candidates.out) {
            const res = await tryGet(ns, metric);
            if (res) {
              const parsed = seriesFromResponse(res);
              if (parsed) {
                  outbound = parsed;
                  break;
              }
            }
          }

          return {
              timestamps: inbound?.timestamps || outbound?.timestamps || [],
              inbound: inbound?.values || null,
              outbound: outbound?.values || null
          };
        } catch (err) {
          console.error('拉取 COS 流量监控失败:', err);
          return { timestamps: [], inbound: null, outbound: null };
        }
  };

  try {
    // --- 功能 1: 查询文件列表 ---
    if (action === 'list') {
        if (!userId) {
            throw new Error('Missing required parameter: userId');
        }
        
        console.log(`正在从数据库查询文件列表，userId: ${userId}`);

        // 直接从数据库查询
        const result = await db.collection('resource-game').where({
            userId: userId
        }).get();

        return {
            success: true,
            files: result.data,
            count: result.data.length
        };
    }

    // --- 新增功能: COS 统计（sites 目录体积、对象数量、桶流量时间序列） ---
    if (action === 'bucket_stats') {
        const { granularity = 'day', startTime, endTime } = event || {};
        try {
            const sites = await sumSites();
            const usage = await countUsageStats();
            const nowMs = Date.now();
            const defaultStart = granularity === 'hour'
              ? nowMs - 24 * 3600 * 1000
              : nowMs - 7 * 24 * 3600 * 1000;
            const startMs = startTime ? new Date(startTime).getTime() : defaultStart;
            const endMs = endTime ? new Date(endTime).getTime() : nowMs;
            const traffic = await fetchCosTraffic(granularity, startMs, endMs);
            return {
                success: true,
                sitesBytes: sites.bytes,
                sitesCount: sites.count,
                usersCount: usage.usersCount,
                projectsCount: usage.projectsCount,
                traffic
            };
        } catch (e) {
            return {
                success: false,
                message: `统计失败: ${e.message || String(e)}`
            };
        }
    }

    // --- 功能 3: 更新站点名称 ---
    /**
     * update_name
     * 根据文档 _id 更新 resource-game 记录的 name 字段，需验证归属 userId
     */
    if (action === 'update_name') {
        const { docId, name } = event || {};
        if (!docId || !userId || typeof name !== 'string') {
            throw new Error('Missing required parameter: docId/userId/name');
        }
        let newName = String(name || '').trim();
        if (!newName) {
            throw new Error('名称不能为空');
        }
        if (newName.length > 64) {
            newName = newName.slice(0, 64);
        }
        const docRes = await db.collection('resource-game').doc(docId).get();
        const doc = docRes.data && docRes.data[0];
        if (!doc) {
            throw new Error('记录不存在');
        }
        if (String(doc.userId) !== String(userId)) {
            throw new Error('无权限更新该记录');
        }
        await db.collection('resource-game').doc(docId).update({
            name: newName,
            updatedAt: db.serverDate()
        });
        return {
            success: true,
            message: '名称已更新',
            name: newName
        };
    }

    // --- 功能 2: 删除文件 ---
    if (action === 'delete') {
        // 支持直接传 key，或者通过 userId + websiteId + fileNameNoExt 拼接；若传入的是文档 _id，则尝试回查数据库
        let keyToDelete = event.key;
        let fileNameNoExt;
        let urlPrefix;
        let uidForUrl = userId;
        let wIdForUrl = websiteId;
        
        // 如果没有直接传 key，尝试构造 key
        // 注意：这里需要 websiteId 和 fileName (或者 fileNameNoExt)
        if (!keyToDelete && userId && websiteId && fileName) {
            fileNameNoExt = fileName.replace(/\.[^/.]+$/, "").toLowerCase();
            const normalized = /^[A-Z0-9]{8}$/.test(websiteId) ? websiteId : null;
            wIdForUrl = normalized || wIdForUrl;
            keyToDelete = `sites/${userId}/${normalized || websiteId}/${fileNameNoExt}`;
        } else if (keyToDelete) {
            const parts = keyToDelete.split('/');
            // keyToDelete 格式: sites/<userId>/<websiteId>/<fileNameNoExt>
            uidForUrl = parts[1];
            wIdForUrl = parts[2];
            fileNameNoExt = parts[3];
        }
        urlPrefix = (uidForUrl && wIdForUrl && fileNameNoExt) ? `sites-${uidForUrl}-${wIdForUrl}-${fileNameNoExt}` : undefined;

        // 如果仍然无法构造 key，可能传入的是文档 _id，尝试根据 _id 查询记录获取 path
        if (!keyToDelete && websiteId) {
            try {
                const docRes = await db.collection('resource-game').doc(websiteId).get();
                const doc = docRes.data && docRes.data[0];
                if (doc && doc.path) {
                    keyToDelete = doc.path;
                    const parts = keyToDelete.split('/');
                    uidForUrl = parts[1];
                    wIdForUrl = parts[2];
                    fileNameNoExt = parts[3];
                    urlPrefix = `sites-${uidForUrl}-${wIdForUrl}-${fileNameNoExt}`;
                }
            } catch (e) {
                console.warn('根据文档 _id 查询 path 失败:', e);
            }
        }
 
        if (!keyToDelete) {
            throw new Error('Missing required parameter: key or (userId + websiteId + fileName)');
        }
 
        console.log(`正在删除文件/目录: ${keyToDelete}`);
 
        /**
         * 删除指定前缀下的所有对象
         * @param {string} prefix 前缀路径
         * @returns {Promise<number>} 删除的对象数量
         */
        const deleteObjects = async (prefix) => {
            return new Promise((resolve, reject) => {
                cos.getBucket({
                    Bucket: hostingBucket,
                    Region: region,
                    Prefix: prefix
                }, (err, data) => {
                    if (err) return reject(err);
                    
                    if (!data.Contents || data.Contents.length === 0) {
                        return resolve(0);
                    }
 
                    const objects = data.Contents.map(item => ({ Key: item.Key }));
                    
                    cos.deleteMultipleObject({
                        Bucket: hostingBucket,
                        Region: region,
                        Objects: objects
                    }, (delErr, delData) => {
                        if (delErr) return reject(delErr);
                        resolve(objects.length);
                    });
                });
            });
        };
 
        const deletedCount = await deleteObjects(keyToDelete);
        console.log(`COS 删除完成，共删除对象数: ${deletedCount}`);
 
        // 额外删除与 urlPrefix 对应的目录（如存在）
        if (urlPrefix) {
            const extraPrefix = `${urlPrefix}/`;
            try {
                const extraDeleted = await deleteObjects(extraPrefix);
                console.log(`额外目录删除完成: ${extraPrefix}，删除对象数: ${extraDeleted}`);
            } catch (e) {
                console.warn(`删除额外目录失败: ${extraPrefix}`, e);
            }
        }
 
        // 2. 同步删除 resource-game 集合中的记录（使用前缀正则，确保整站记录清理）
        const reg = db.RegExp({ regexp: `^${keyToDelete}` });
        const dbResult = await db.collection('resource-game').where({
            path: reg
        }).remove();
 
        console.log(`DB 删除操作完成: KeyPrefix=${keyToDelete}, DB Deleted=${dbResult.deleted}`);
 
        return {
            success: true,
            message: '文件及对应记录删除成功',
            key: keyToDelete,
            deletedObjects: deletedCount,
            dbDeletedCount: dbResult.deleted
        };
    }

    // --- 功能 4: 同步 COS 数据到数据库 ---
    if (action === 'sync_cos_to_db') {
        console.log('开始同步 COS 数据到数据库...');
        
        // 辅助函数：列出目录
        const listDirs = async (prefix) => {
            return new Promise((resolve, reject) => {
                cos.getBucket({
                    Bucket: hostingBucket,
                    Region: region,
                    Prefix: prefix,
                    Delimiter: '/'
                }, (err, data) => {
                    if (err) return reject(err);
                    resolve(data.CommonPrefixes || []);
                });
            });
        };

        let totalSynced = 0;
        let errors = [];

        try {
            // 1. 获取所有用户目录 sites/userId/
            const userDirs = await listDirs('sites/');
            console.log(`发现 ${userDirs.length} 个用户目录`);

            for (const userDir of userDirs) {
                const userPrefix = userDir.Prefix; // e.g., sites/user1/
                const userId = userPrefix.split('/')[1];
                
                // 2. 获取该用户下的所有网站 sites/userId/websiteId/
                const webDirs = await listDirs(userPrefix);
                
                for (const webDir of webDirs) {
                    const webPrefix = webDir.Prefix; // e.g., sites/user1/web1/
                    const websiteId = webPrefix.split('/')[2];

                    // 3. 获取部署目录 sites/userId/websiteId/dist/
                    const distDirs = await listDirs(webPrefix);
                    
                    for (const distDir of distDirs) {
                        const distPrefix = distDir.Prefix; // e.g., sites/user1/web1/dist/
                        // 数据库中存储的 path 不包含结尾的斜杠
                        const path = distPrefix.slice(0, -1); 
                        const parts = path.split('/');
                        const fileNameNoExt = (parts[3] || '').toLowerCase();

                        // 构造 URL
                        const defaultDomain = process.env.DEFAULT_DOMAIN;
                        const urlPrefix = `sites-${userId}-${websiteId}-${fileNameNoExt}`;
                        const finalUrl = `https://${urlPrefix}.${defaultDomain}/index.html`;

                        // 检查数据库是否存在
                        const countRes = await db.collection('resource-game').where({ path: path }).count();
                        
                        if (countRes.total === 0) {
                            await db.collection('resource-game').add({
                                userId,
                                websiteId,
                                fileName: fileNameNoExt, // 近似值，丢失了扩展名
                                path: path,
                                url: finalUrl,
                                createdAt: db.serverDate(),
                                updatedAt: db.serverDate(),
                                syncedFromCos: true
                            });
                            console.log(`已同步: ${path}`);
                            totalSynced++;
                        }
                    }
                }
            }
        } catch (err) {
            console.error('同步过程中出错:', err);
            errors.push(err.message);
        }

        return {
            success: true,
            message: '同步完成',
            totalSynced,
            errors
        };
    }

    // 原 deploy 动作已移除

    // --- 新增功能 5: 前端直接上传内容并部署 (action === 'upload_and_deploy') ---
    if (action === 'upload_and_deploy') {
      const { cloudPath, fileContentBase64 } = event;
      if ((!fileContentBase64 && !fileId) || !userId || !websiteId || !fileName) {
        throw new Error('缺少必要参数: (fileContentBase64 或 fileId)/userId/websiteId/fileName');
      }

        console.log(`开始上传并部署: websiteId=${websiteId}, cloudPath=${cloudPath}, fileName=${fileName}, hasFileId=${!!fileId}`);
        
        const roleConfigForEnable2 = await getUserLimits(userId);
        if (roleConfigForEnable2 && roleConfigForEnable2.enabled === false) {
          return {
            success: false,
            message: '当前服务繁忙，请稍后再试，或联系开发者~'
          };
        }

        await updateProgress('unzipping');

        let zip;
        let tempFilePath = null;

        try {
            if (fileContentBase64) {
                const buffer = Buffer.from(String(fileContentBase64), 'base64');
                zip = new AdmZip(buffer);
            } else if (fileId) {
                console.log(`通过 fileId 部署: ${fileId}`);
                // 1. 获取下载链接
                const fileRes = await app.getTempFileURL({ fileList: [fileId] });
                if (!fileRes.fileList || fileRes.fileList.length === 0 || !fileRes.fileList[0].tempFileURL) {
                    throw new Error('无法获取文件下载链接');
                }
                const downloadUrl = fileRes.fileList[0].tempFileURL;
                
                // 2. 下载到临时文件
                tempFilePath = path.join(os.tmpdir(), `deploy_${Date.now()}.zip`);
                await new Promise((resolve, reject) => {
                    const file = fs.createWriteStream(tempFilePath);
                    https.get(downloadUrl, (res) => {
                        if (res.statusCode !== 200) {
                            reject(new Error(`下载失败: status ${res.statusCode}`));
                            return;
                        }
                        res.pipe(file);
                        file.on('finish', () => {
                            file.close(resolve);
                        });
                    }).on('error', (err) => {
                        fs.unlink(tempFilePath, () => {});
                        reject(err);
                    });
                });
                
                console.log(`文件已下载到: ${tempFilePath}`);
                // AdmZip 支持直接读取文件路径
                zip = new AdmZip(tempFilePath);
            } else {
                throw new Error('未提供文件内容或 fileId');
            }

            const zipEntries = zip.getEntries();
            console.log(`解压完成，包含 ${zipEntries.length} 个文件`);

            // Calculate valid files count for progress
            const validEntriesCount = zipEntries.filter(e => !e.isDirectory && !e.entryName.includes('..') && !e.entryName.includes('__MACOSX') && !e.entryName.includes('.DS_Store')).length;
            await updateProgress('uploading', { total: validEntriesCount, current: 0 });

            const existingPath = await resolveExistingPath(userId, websiteId);

        let targetPrefix, urlPrefix, effectiveFileNameNoExt, wId;
        if (existingPath) {
          const parts = existingPath.split('/');
          effectiveFileNameNoExt = (parts[3] || 'dist').toLowerCase();
          wId = parts[2] || normalizeWebsiteId(websiteId);
          targetPrefix = existingPath;
          urlPrefix = `sites-${userId}-${wId}-${effectiveFileNameNoExt}`;
        } else {
          effectiveFileNameNoExt = normalizeFileNameNoExt(fileName);
          wId = normalizeWebsiteId(websiteId);
          targetPrefix = `sites/${userId}/${wId}/${effectiveFileNameNoExt}`;
          urlPrefix = `sites-${userId}-${wId}-${effectiveFileNameNoExt}`;
        }

        // --- 检查文件数量限制和扩展名限制 ---
        const roleConfig = await getUserLimits(userId);
        
        if (roleConfig) {
          const validEntriesForCheck = zipEntries.filter(e => !e.isDirectory && !e.entryName.includes('..') && !e.entryName.includes('__MACOSX') && !e.entryName.includes('.DS_Store'));
          const limit = roleConfig.max_file_count;
          if (limit !== null && limit !== undefined) {
            if (validEntriesForCheck.length > limit) {
              return {
                success: false,
                message: `文件数量超出限制！当前上传包含 ${validEntriesForCheck.length} 个文件，您的角色限制为 ${limit} 个文件。`
              };
            }
          }
          if (roleConfig.allowed_extensions && Array.isArray(roleConfig.allowed_extensions)) {
            const invalidFiles = [];
            const allowedExts = roleConfig.allowed_extensions.map(ext => ext.toLowerCase());
            for (const entry of validEntriesForCheck) {
              const ext = (path.extname(entry.entryName) || '').toLowerCase();
              if (!allowedExts.includes(ext)) {
                invalidFiles.push(entry.entryName);
              }
            }
            if (invalidFiles.length > 0) {
              const showList = invalidFiles.slice(0, 5).join(', ');
              const more = invalidFiles.length > 5 ? ` 等 ${invalidFiles.length} 个文件` : '';
              return {
                success: false,
                message: `包含不支持的文件类型！仅允许: ${allowedExts.join(' ')}。发现非法文件: ${showList}${more}`
              };
            }
          }
        }

        let lastUpdateTime = 0;
        const throttledUpdate = async (count) => {
          const now = Date.now();
          // Update at most once per 500ms, or when finished
          if (now - lastUpdateTime > 500 || count === validEntriesCount) {
            lastUpdateTime = now;
            await updateProgress('uploading', { total: validEntriesCount, current: count });
          }
        };

        await deployZipToTarget(zipEntries, targetPrefix, throttledUpdate);

        // 4. 获取访问 URL
        const defaultDomain = process.env.DEFAULT_DOMAIN;
        const finalUrl = `https://${urlPrefix}.${defaultDomain}/index.html?v=${Date.now()}`;

        // 5. 写入/更新数据库（不保存 fileId，仅记录路径与 URL）
        try {
            const countRes = await db.collection('resource-game').where({ path: targetPrefix }).count();
            if (countRes.total > 0) {
                await db.collection('resource-game').where({ path: targetPrefix }).update({
                    userId,
                    websiteId,
                    fileName,
                    url: finalUrl,
                    updatedAt: db.serverDate()
                });
            } else {
                await db.collection('resource-game').add({
                    userId,
                    websiteId,
                    fileName,
                    path: targetPrefix,
                    url: finalUrl,
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate()
                });
            }
        } catch (dbError) {
            console.error('同步数据库失败:', dbError);
        }

        return {
            success: true,
            url: finalUrl,
            message: existingPath ? '重新部署成功' : '上传并部署成功',
            websitePath: urlPrefix
        };
    } finally {
        // 清理临时文件 (local fs)
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch(e) {}
        }
        
        // 清理云端临时文件
        if (fileId) {
            try {
                await app.deleteFile({
                    fileList: [fileId]
                });
                console.log(`Deleted temp cloud file: ${fileId}`);
            } catch (e) {
                console.warn(`Failed to delete temp cloud file: ${fileId}`, e);
            }
        }
    }
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error) {
    console.error('操作失败:', error);
    return {
      success: false,
      message: error.message || '操作过程中发生错误',
      error: error.toString()
    };
  }
};
