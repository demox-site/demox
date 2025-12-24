const tcb = require('@cloudbase/node-sdk');
const AdmZip = require('adm-zip');
const COS = require('cos-nodejs-sdk-v5');

exports.main = async (event, context) => {
  const { fileId, userId, websiteId, fileName } = event;
  
  console.log(`开始部署: websiteId=${websiteId}, fileId=${fileId}`);
    
  // 初始化 COS
  // 优先从环境变量获取自定义配置(COS_SECRET_ID/KEY)，否则使用云函数临时密钥
  const cos = new COS({
    SecretId: process.env.COS_SECRET_ID || process.env.TENCENTCLOUD_SECRETID,
    SecretKey: process.env.COS_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: process.env.COS_SECRET_KEY ? undefined : process.env.TENCENTCLOUD_SESSIONTOKEN,
    UserAgent: 'CloudBase-Deploy-Function'
  });

  try {
    const app = tcb.init();

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

    // 3. 上传到静态网站托管
    // 静态网站托管 Bucket 名称
    const hostingBucket = 'resource-game-1307257815';
    const region = 'ap-chengdu'; // 修正为成都
    
    // 生成目标路径前缀
    const fileNameNoExt = fileName ? fileName.replace(/\.[^/.]+$/, "") : "dist";
    // 存储路径：使用斜杠分隔，例如 sites/userId/websiteId/dist
    const targetPrefix = `sites/${userId}/${websiteId}/${fileNameNoExt}`;
    // URL 路径：使用连字符分隔，例如 sites-userId-websiteId-dist
    const urlPrefix = `sites-${userId}-${websiteId}-${fileNameNoExt}`;
    
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
    // 使用用户配置的自定义域名
    const defaultDomain = 'ai-builder.aigc.sx.cn';
    
    // 由于我们剥离了顶层目录，且规定必须有 index.html，所以 URL 直接指向 urlPrefix/index.html
    // 如果实际没有 index.html，用户可能需要手动访问其他文件，但通常默认首页就是 index.html
    const finalUrl = `https://${defaultDomain}/${urlPrefix}/index.html`;

    console.log('网站部署成功:', {
      websiteId,
      userId,
      url: finalUrl,
      fileName,
      targetPrefix
    });

    return {
      success: true,
      url: finalUrl,
      message: '网站部署成功',
      websitePath: urlPrefix
    };

  } catch (error) {
    console.error('部署失败:', error);
    return {
      success: false,
      message: error.message || '部署过程中发生未知错误',
      error: error.toString()
    };
  }
};
