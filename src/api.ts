/**
 * Demox API 服务 - 连接SCF HTTP触发器
 */
import config from "./configs/env";

const AUTH_API_URL = config.authApiUrl;
const WEBSITE_API_URL = config.websiteApiUrl;

// Token管理
const TOKEN_KEY = "demox_token";
const USER_KEY = "demox_user";

export const tokenManager = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  remove: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
};

export const userManager = {
  get: () => {
    const user = localStorage.getItem(USER_KEY);
    return user ? JSON.parse(user) : null;
  },
  set: (user: any) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
  remove: () => localStorage.removeItem(USER_KEY)
};

// API请求封装
async function request<T>(baseUrl: string, path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenManager.get();

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }

  return data;
}

// 认证API
export const authApi = {
  // 注册
  register: async (email: string, password: string) => {
    const data = await request<{ success: boolean; token: string; userId: string; email: string }>(
      AUTH_API_URL,
      "/auth/register",
      { method: "POST", body: { email, password } }
    );

    if (data.success && data.token) {
      tokenManager.set(data.token);
      userManager.set({ userId: data.userId, email: data.email, roles: ["user"] });
    }

    return data;
  },

  // 密码登录
  login: async (email: string, password: string) => {
    const data = await request<{ success: boolean; token: string; userId: string; email: string }>(
      AUTH_API_URL,
      "/auth/login",
      { method: "POST", body: { email, password } }
    );

    if (data.success && data.token) {
      tokenManager.set(data.token);
      // 管理员邮箱列表 - 与数据库中的 user_roles 表保持同步
      const adminEmails = ["phosa@qq.com"];
      const roles = adminEmails.includes(email) ? ["admin", "user"] : ["user"];
      userManager.set({ userId: data.userId, email: data.email, roles });
    }

    return data;
  },

  // 发送验证码
  sendCode: async (email: string, type: 'login' | 'register' | 'reset' = 'login') => {
    return request<{ success: boolean; message: string }>(
      AUTH_API_URL,
      "/auth/send-code",
      { method: "POST", body: { email, type } }
    );
  },

  // 验证码登录
  loginWithCode: async (email: string, code: string) => {
    const data = await request<{ success: boolean; token: string; userId: string; email: string; isNewUser?: boolean }>(
      AUTH_API_URL,
      "/auth/login-code",
      { method: "POST", body: { email, code } }
    );

    if (data.success && data.token) {
      tokenManager.set(data.token);
      const adminEmails = ["phosa@qq.com"];
      const roles = adminEmails.includes(email) ? ["admin", "user"] : ["user"];
      userManager.set({ userId: data.userId, email: data.email, roles });
    }

    return data;
  },

  // 登出
  logout: () => {
    tokenManager.remove();
    userManager.remove();
  },

  // 获取当前用户
  getCurrentUser: async () => {
    return request<{ success: boolean; user: any }>(AUTH_API_URL, "/auth/me");
  },

  // 验证Token
  verifyToken: async () => {
    return request<{ valid: boolean; userId: string }>(AUTH_API_URL, "/auth/verify");
  }
};

// 网站API
export const websiteApi = {
  // 获取网站列表
  list: async () => {
    return request<{ success: boolean; websites: any[]; count: number }>(
      WEBSITE_API_URL,
      "/website/list",
      { method: "POST", body: { action: "list" } }
    );
  },

  // 获取所有网站列表（管理员）
  listAll: async () => {
    return request<{ success: boolean; websites: any[]; count: number }>(
      WEBSITE_API_URL,
      "/websites/list-all",
      { method: "POST", body: { action: "list_all" } }
    );
  },

  // 获取单个网站
  get: async (websiteId: string) => {
    return request<{ success: boolean; website: any }>(
      WEBSITE_API_URL,
      "/website/get",
      { method: "POST", body: { action: "get", websiteId } }
    );
  },

  // 创建网站
  create: async (data: { name: string; fileName?: string }) => {
    return request<{ success: boolean; website: any }>(
      WEBSITE_API_URL,
      "/website/create",
      { method: "POST", body: { action: "create", ...data } }
    );
  },

  // 添加网站
  add: async (data: { websiteId: string; fileName: string; name?: string; path?: string; url?: string; tags?: string[] }) => {
    return request<{ success: boolean; message: string }>(
      WEBSITE_API_URL,
      "/website/add",
      { method: "POST", body: { action: "add", ...data } }
    );
  },

  // 更新网站
  update: async (data: { id?: string; websiteId?: string; fileName?: string; name?: string; url?: string; tags?: string[] }) => {
    return request<{ success: boolean; message: string }>(
      WEBSITE_API_URL,
      "/website/update",
      { method: "POST", body: { action: "update", ...data } }
    );
  },

  // 更新网站名称
  updateName: async (docId: string, name: string) => {
    return request<{ success: boolean; message: string; name: string }>(
      WEBSITE_API_URL,
      "/websites/update-name",
      { method: "POST", body: { action: "update_name", docId, name } }
    );
  },

  // 更新网站标签
  updateTags: async (docId: string, tags: string[]) => {
    return request<{ success: boolean; message: string; tags: string[] }>(
      WEBSITE_API_URL,
      "/websites/update-tags",
      { method: "POST", body: { action: "update_tags", docId, tags } }
    );
  },

  // 删除网站
  delete: async (websiteId: string) => {
    return request<{ success: boolean; message: string; deletedCount: number }>(
      WEBSITE_API_URL,
      "/website/delete",
      { method: "POST", body: { action: "delete", websiteId } }
    );
  },

  // 部署网站
  deploy: async (websiteId: string, zipFile: string) => {
    return request<{ success: boolean; deployment: any }>(
      WEBSITE_API_URL,
      "/website/deploy",
      { method: "POST", body: { action: "deploy", websiteId, zipFile } }
    );
  }
};

// 检查登录状态
export function isLoggedIn(): boolean {
  return !!tokenManager.get();
}

// 获取当前用户
export function getCurrentUser() {
  return userManager.get();
}

export default {
  auth: authApi,
  website: websiteApi,
  token: tokenManager,
  user: userManager,
  isLoggedIn,
  getCurrentUser
};
