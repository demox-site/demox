/**
 * CloudBase 兼容层 - 提供过渡期的 API 兼容
 * 注意：此文件仅用于过渡期，后续会完全移除 CloudBase 依赖
 */
import { authApi, websiteApi, userManager, tokenManager } from "./api";
import config from "./configs/env";

// 临时文件存储 - 用于在 uploadFile 和 callFunction 之间传递文件内容
const pendingUploads: Map<string, { base64: string; fileName: string }> = new Map();

/**
 * 将 MySQL 字段名映射为 NoSQL 字段名
 * home.jsx 期望的字段名：_id, websiteId, fileName, name, path, url, tags, userId, createdAt, updatedAt
 * MySQL 返回的字段名：id, website_id, file_name, name, path, url, tags, user_id, created_at, updated_at
 */
function mapMySQLToNoSQL(row: any): any {
  return {
    _id: String(row.id),
    websiteId: row.website_id,
    fileName: row.file_name,
    name: row.name || row.file_name,
    path: row.path,
    url: row.url,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
    userId: row.user_id,
    subdomain: row.subdomain || null,
    createdAt: row.created_at ? { $date: new Date(row.created_at).getTime() } : undefined,
    updatedAt: row.updated_at ? { $date: new Date(row.updated_at).getTime() } : undefined
  };
}

/**
 * 调用部署 API - 通过 SCF 部署
 */
async function callDeployApi(data: any): Promise<any> {
  const token = tokenManager.get();
  if (!token) {
    throw new Error("未登录，请先登录");
  }

  // 检查是否有待上传的文件
  const taskId = data.taskId;
  const pendingFile = pendingUploads.get(taskId);

  if (!pendingFile) {
    throw new Error("找不到上传的文件，请重新上传");
  }

  try {
    // 调用 SCF website-api 的部署接口
    const response = await fetch(`${config.websiteApiUrl}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        action: "upload_and_deploy",
        fileContentBase64: pendingFile.base64,
        fileName: pendingFile.fileName || data.fileName,
        websiteId: data.websiteId
      })
    });

    // 清理临时存储
    pendingUploads.delete(taskId);

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || result.message || "部署失败");
    }

    // 处理 SCF 返回的格式 { statusCode, body }
    if (result.statusCode && result.body) {
      const body = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
      if (!body.success) {
        throw new Error(body.message || "部署失败");
      }
      return body;
    }

    if (!result.success) {
      throw new Error(result.message || "部署失败");
    }

    return result;
  } catch (error) {
    // 清理临时存储
    pendingUploads.delete(taskId);
    throw error;
  }
}

// 模拟的 app 对象
const app = {
  callFunction: async ({ name, data }: { name: string; data: any }) => {
    console.log(`[CloudBase Stub] callFunction: ${name}`, data);

    // 根据函数名路由到对应的 HTTP API
    if (name === "deploy-website" || name === "website-api") {
      const token = tokenManager.get();

      // 处理不同的 action
      switch (data?.action) {
        case "upload_and_deploy":
          // 部署网站 - 使用存储的文件内容
          const deployResult = await callDeployApi(data);
          return {
            result: deployResult
          };
        case "list":
          const listResult = await websiteApi.list();
          // 兼容 home.jsx 期望的 files 字段和 NoSQL 字段名
          return {
            result: {
              ...listResult,
              files: (listResult.websites || []).map(mapMySQLToNoSQL)
            }
          };
        case "list_all":
          const listAllResult = await websiteApi.listAll();
          // 兼容 home.jsx 期望的 files 字段和 NoSQL 字段名
          return {
            result: {
              ...listAllResult,
              files: (listAllResult.websites || []).map(mapMySQLToNoSQL)
            }
          };
        case "get":
          return {
            result: await websiteApi.get(data.websiteId)
          };
        case "add":
        case "create":
          return {
            result: await websiteApi.add(data)
          };
        case "update":
          return {
            result: await websiteApi.update(data)
          };
        case "update_name":
          return {
            result: await websiteApi.updateName(data.docId, data.name)
          };
        case "update_tags":
          return {
            result: await websiteApi.updateTags(data.docId, data.tags)
          };
        case "delete":
          return {
            result: await websiteApi.delete(data.id || data.websiteId)
          };
        case "set_subdomain":
          return {
            result: await websiteApi.setSubdomain({
              docId: data.docId,
              websiteId: data.websiteId,
              subdomain: data.subdomain
            })
          };
        case "clear_subdomain":
          return {
            result: await websiteApi.clearSubdomain({
              docId: data.docId,
              websiteId: data.websiteId
            })
          };
        default:
          return {
            result: { success: false, message: `Unknown action: ${data?.action}` }
          };
      }
    }

    if (name === "getRoleLimits") {
      // 获取用户角色
      const currentUser = userManager.get();
      const userRoles = (currentUser as any)?.roles || ["user"];
      const isAdmin = userRoles.includes("admin");

      // 返回角色配置
      if (isAdmin) {
        return {
          result: {
            code: 0,
            data: [{
              name: "admin",
              priority: 100,
              max_file_size: 500 * 1024 * 1024, // 500MB
              max_file_count: 10000,
              deployment_limit: null, // 无限制
              enabled: true
            }]
          }
        };
      }

      return {
        result: {
          code: 0,
          data: [{
            name: "user",
            priority: 0,
            max_file_size: 50 * 1024 * 1024, // 50MB
            deployment_limit: 100,
            max_file_count: 1000,
            enabled: true
          }]
        }
      };
    }

    return {
      result: { success: false, message: `Unknown function: ${name}` }
    };
  },

  uploadFile: async ({ cloudPath, filePath, onUploadProgress }: any) => {
    console.log(`[CloudBase Stub] uploadFile: ${cloudPath}`);

    // 从 cloudPath 提取 taskId (格式: tmp_uploads/{userId}/{taskId}.zip)
    const pathParts = cloudPath.split('/');
    const taskId = pathParts[pathParts.length - 1].replace('.zip', '');

    // filePath 是 File 对象
    const file = filePath as File;

    // 读取文件并转换为 base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ""
      )
    );

    // 模拟上传进度
    if (onUploadProgress) {
      const total = file.size;
      let loaded = 0;
      const chunk = total / 10;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        loaded = Math.min(loaded + chunk, total);
        onUploadProgress({ loaded, total });
      }
    }

    // 存储文件内容，供后续 callFunction 使用
    pendingUploads.set(taskId, {
      base64,
      fileName: file.name
    });

    // 返回模拟的 fileID
    return {
      fileID: cloudPath
    };
  },

  // 部署网站 - 接收 ZIP 文件并部署
  deployWebsite: async ({ websiteId, file, fileName, onProgress }: {
    websiteId?: string;
    file: File | Blob;
    fileName: string;
    onProgress?: (progress: number) => void;
  }) => {
    console.log(`[CloudBase Stub] deployWebsite: ${fileName}`);

    const token = tokenManager.get();
    if (!token) {
      throw new Error("未登录，请先登录");
    }

    // 读取文件并转换为 base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ""
      )
    );

    // 调用 website-api 的 upload_and_deploy 接口
    const response = await fetch(`${config.websiteApiUrl}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        action: "upload_and_deploy",
        fileContentBase64: base64,
        fileName: fileName,
        websiteId: websiteId
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || result.message || "部署失败");
    }

    if (!result.success) {
      throw new Error(result.message || "部署失败");
    }

    return {
      result: result
    };
  }
};

// 模拟的 auth 对象
const auth = {
  getLoginState: async () => {
    const user = userManager.get();
    const token = tokenManager.get();
    if (user && token) {
      // 获取存储的角色或默认角色
      const roles = (user as any).roles || ["user"];
      return {
        user: {
          uid: user.userId,
          nickName: user.email?.split("@")[0] || "User",
          email: user.email,
          roles: roles
        }
      };
    }
    return null;
  },

  getAccessToken: async () => {
    const token = tokenManager.get();
    return token || null;
  },

  getUserInfo: async () => {
    const user = userManager.get();
    if (user) {
      return {
        uid: user.userId,
        nickName: user.email?.split("@")[0] || "User",
        email: user.email,
        roles: (user as any).roles || ["user"]
      };
    }
    return null;
  },

  signInWithEmailAndPassword: async (email: string, password: string) => {
    return await authApi.login(email, password);
  },

  signUpWithEmailAndPassword: async (email: string, password: string) => {
    return await authApi.register(email, password);
  },

  signOut: async () => {
    authApi.logout();
  }
};

// 模拟的 db 对象
const db = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      get: async () => {
        console.log(`[CloudBase Stub] db.collection(${name}).doc(${id}).get()`);

        // 返回用户角色
        if (name === "ai_builder_user_roles") {
          const currentUser = userManager.get();
          if (currentUser && (currentUser as any).roles) {
            return {
              data: [{
                _id: id,
                role: (currentUser as any).roles
              }]
            };
          }
          // 默认返回普通用户角色
          return {
            data: [{
              _id: id,
              role: ["user"]
            }]
          };
        }

        return { data: [] };
      },
      set: async (data: any) => {
        console.log(`[CloudBase Stub] db.collection(${name}).doc(${id}).set()`, data);
        return { success: true };
      },
      remove: async () => {
        console.log(`[CloudBase Stub] db.collection(${name}).doc(${id}).remove()`);
        return { success: true };
      },
      watch: (options: any) => {
        console.log(`[CloudBase Stub] db.collection(${name}).doc(${id}).watch()`);

        // 模拟部署进度更新
        if (name === "ai_builder_task_progress") {
          let closed = false;
          let currentStatus = "unzipping";
          let currentFile = 0;
          const totalFiles = 10; // 模拟的总文件数

          // 模拟进度更新
          const interval = setInterval(() => {
            if (closed) {
              clearInterval(interval);
              return;
            }

            if (currentStatus === "unzipping") {
              // 解压阶段
              if (options.onChange) {
                options.onChange({
                  docs: [{
                    status: "unzipping"
                  }]
                });
              }
              currentStatus = "uploading";
            } else if (currentStatus === "uploading") {
              // 上传阶段
              if (currentFile < totalFiles) {
                if (options.onChange) {
                  options.onChange({
                    docs: [{
                      status: "uploading",
                      current: currentFile + 1,
                      total: totalFiles
                    }]
                  });
                }
                currentFile++;
              }
            }
          }, 200); // 每200ms更新一次

          return {
            close: () => {
              closed = true;
              clearInterval(interval);
            }
          };
        }

        return {
          close: () => {}
        };
      }
    }),
    get: async () => {
      console.log(`[CloudBase Stub] db.collection(${name}).get()`);
      return { data: [] };
    },
    where: (condition: any) => ({
      get: async () => {
        console.log(`[CloudBase Stub] db.collection(${name}).where().get()`);
        return { data: [] };
      }
    })
  })
};

export { app, auth, db };
