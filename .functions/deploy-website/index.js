const tcb = require('@cloudbase/node-sdk');
const AdmZip = require('adm-zip');
const COS = require('cos-nodejs-sdk-v5');

exports.main = async (event, context) => {
  const { action = 'deploy', fileId, userId, websiteId, fileName } = event;
  
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
            fileNameNoExt = fileName.replace(/\.[^/.]+$/, "");
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
                        const fileNameNoExt = parts[3];

                        // 构造 URL
                        const defaultDomain = 'ai-builder.aigc.sx.cn';
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

    // --- 功能 3: 原有部署逻辑 (action === 'deploy') ---
    if (action === 'deploy') {
      console.log(`开始部署: websiteId=${websiteId}, fileId=${fileId}`);
        
        // 1. 下载上传的文件
        console.log('正在下载文件...');
        const fileResult = await app.downloadFile({
          fileID: fileId
        });
        
        if (!fileResult.fileContent) {
            throw new Error('文件下载失败，内容为空');
        }
    
        // 2. 解压文件
        console.log('正在解压文件...');
        const zip = new AdmZip(fileResult.fileContent);
        const zipEntries = zip.getEntries();
        
        console.log(`解压完成，包含 ${zipEntries.length} 个文件`);
        
        // 生成目标路径前缀
        const fileNameNoExt = fileName ? fileName.replace(/\.[^/.]+$/, "") : "dist";
        const wId = normalizeWebsiteId(websiteId);
        // 存储路径：使用斜杠分隔，例如 sites/userId/websiteId/dist
        const targetPrefix = `sites/${userId}/${wId}/${fileNameNoExt}`;
        // URL 路径：使用连字符分隔，例如 sites-userId-websiteId-dist
        const urlPrefix = `sites-${userId}-${wId}-${fileNameNoExt}`;
        
        const uploadPromises = [];
        
        // 过滤出有效文件
        const validEntries = zipEntries.filter(entry => {
            if (entry.isDirectory) return false;
            const name = entry.entryName;
            if (name.includes('..')) return false;
            if (name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
            return true;
        });
    
        // 检测并剥离顶层目录
        let commonPrefix = '';
        if (validEntries.length > 0) {
            const firstEntry = validEntries[0];
            const parts = firstEntry.entryName.split('/');
            // 只有当有子目录时才检测
            if (parts.length > 1) {
                const potentialPrefix = parts[0] + '/';
                // 检查是否所有文件都以该目录开头
                const allMatch = validEntries.every(e => e.entryName.startsWith(potentialPrefix));
                if (allMatch) {
                    commonPrefix = potentialPrefix;
                    console.log(`检测到顶层目录 ${commonPrefix}，将自动剥离`);
                }
            }
        }
    
        // 遍历 zip 包中的文件
        for (const entry of validEntries) {
          let entryName = entry.entryName;
          
          // 剥离顶层目录
          if (commonPrefix && entryName.startsWith(commonPrefix)) {
              entryName = entryName.slice(commonPrefix.length);
          }
    
          const key = `${targetPrefix}/${entryName}`;
          
          // 添加上传任务
          uploadPromises.push(() => {
            return new Promise((resolve, reject) => {
                cos.putObject({
                    Bucket: hostingBucket,
                    Region: region,
                    Key: key,
                    Body: entry.getData()
                }, function(err, data) {
                    if (err) {
                        console.error(`上传文件失败: ${entryName}`, err);
                        reject(err);
                    } else {
                        resolve(data);
                    }
                });
            });
          });
        }
        
        // 并发执行上传
        console.log(`开始上传 ${uploadPromises.length} 个文件到 Bucket: ${hostingBucket}`);
        await Promise.all(uploadPromises.map(p => p()));
        console.log('所有文件上传完成');
    
        // 4. 获取访问 URL
        const defaultDomain = 'ai-builder.aigc.sx.cn';
        const finalUrl = `https://${urlPrefix}.${defaultDomain}/index.html`;
    
        console.log('网站部署成功:', {
          websiteId,
          userId,
          url: finalUrl,
          fileName,
          targetPrefix
        });

        // 5. 同步写入数据库
        try {
            console.log('正在同步部署信息到数据库...');
            const countRes = await db.collection('resource-game').where({ path: targetPrefix }).count();
            
            if (countRes.total > 0) {
                await db.collection('resource-game').where({ path: targetPrefix }).update({
                    userId, 
                    websiteId, 
                    fileName, 
                    url: finalUrl, 
                    updatedAt: db.serverDate(),
                    fileId
                });
                console.log('数据库记录更新成功');
            } else {
                await db.collection('resource-game').add({
                    userId,
                    websiteId,
                    fileName,
                    path: targetPrefix,
                    url: finalUrl,
                    createdAt: db.serverDate(),
                    updatedAt: db.serverDate(),
                    fileId
                });
                console.log('数据库记录创建成功');
            }
        } catch (dbError) {
            console.error('同步数据库失败:', dbError);
            // 部署已经成功，这里仅记录错误，不抛出异常影响主流程
        }
    
        return {
          success: true,
          url: finalUrl,
          message: '网站部署成功',
          websitePath: urlPrefix
        };
    }

    // --- 新增功能 5: 前端直接上传内容并部署 (action === 'upload_and_deploy') ---
    if (action === 'upload_and_deploy') {
      const { cloudPath, fileContentBase64 } = event;
      if (!fileContentBase64 || !userId || !websiteId || !fileName) {
        throw new Error('缺少必要参数: fileContentBase64/userId/websiteId/fileName');
      }

        console.log(`开始上传并部署: websiteId=${websiteId}, cloudPath=${cloudPath}, fileName=${fileName}`);

        // 将 Base64 转 Buffer
        const buffer = Buffer.from(String(fileContentBase64), 'base64');

        // 1. 直接解压文件（不进行中间云存储）
        console.log('正在解压文件...');
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        console.log(`解压完成，包含 ${zipEntries.length} 个文件`);

        // 生成目标路径前缀
        const fileNameNoExt = fileName ? fileName.replace(/\.[^/.]+$/, "") : "dist";
        const wId = normalizeWebsiteId(websiteId);
        const targetPrefix = `sites/${userId}/${wId}/${fileNameNoExt}`;
        const urlPrefix = `sites-${userId}-${wId}-${fileNameNoExt}`;

        const uploadTasks = [];

        // 过滤有效文件
        const validEntries = zipEntries.filter(entry => {
            if (entry.isDirectory) return false;
            const name = entry.entryName;
            if (name.includes('..')) return false;
            if (name.includes('__MACOSX') || name.includes('.DS_Store')) return false;
            return true;
        });

        // 检测并剥离顶层目录
        let commonPrefix = '';
        if (validEntries.length > 0) {
            const firstEntry = validEntries[0];
            const parts = firstEntry.entryName.split('/');
            if (parts.length > 1) {
                const potentialPrefix = parts[0] + '/';
                const allMatch = validEntries.every(e => e.entryName.startsWith(potentialPrefix));
                if (allMatch) {
                    commonPrefix = potentialPrefix;
                    console.log(`检测到顶层目录 ${commonPrefix}，将自动剥离`);
                }
            }
        }

        for (const entry of validEntries) {
            let entryName = entry.entryName;
            if (commonPrefix && entryName.startsWith(commonPrefix)) {
                entryName = entryName.slice(commonPrefix.length);
            }
            const key = `${targetPrefix}/${entryName}`;
            uploadTasks.push(() => {
                return new Promise((resolve, reject) => {
                    cos.putObject({
                        Bucket: hostingBucket,
                        Region: region,
                        Key: key,
                        Body: entry.getData()
                    }, function(err, data) {
                        if (err) {
                            console.error(`上传文件失败: ${entryName}`, err);
                            reject(err);
                        } else {
                            resolve(data);
                        }
                    });
                });
            });
        }

        console.log(`开始上传 ${uploadTasks.length} 个文件到 Bucket: ${hostingBucket}`);
        await Promise.all(uploadTasks.map(p => p()));
        console.log('所有文件上传完成');

        // 4. 获取访问 URL
        const defaultDomain = 'ai-builder.aigc.sx.cn';
        const finalUrl = `https://${urlPrefix}.${defaultDomain}/index.html`;

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
                console.log('数据库记录更新成功');
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
                console.log('数据库记录创建成功');
            }
        } catch (dbError) {
            console.error('同步数据库失败:', dbError);
        }

        return {
            success: true,
            url: finalUrl,
            message: '上传并部署成功',
            websitePath: urlPrefix
        };
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
