/**
 * Demox API 服务 - 连接SCF HTTP触发器
 */
import config from "./configs/env";
import { OFFICIAL_DOMAINS, normalizeOfficialDomain } from "./lib/official-domains";

const AUTH_API_URL = config.authApiUrl;
const WEBSITE_API_URL = config.websiteApiUrl;

// Token管理
const TOKEN_KEY = "demox_token";
const USER_KEY = "demox_user";
const AUTH_COOKIE_KEY = "demox_access";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function getCookieDomainAttr(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname.toLowerCase();
  const officialDomain = OFFICIAL_DOMAINS.find((domain) => host === domain || host.endsWith(`.${domain}`));
  if (officialDomain) {
    return `Domain=.${officialDomain}; `;
  }
  return "";
}

function setAuthCookie(token: string) {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "Secure; " : "";
  document.cookie =
    `${AUTH_COOKIE_KEY}=${encodeURIComponent(token)}; ` +
    `Max-Age=${AUTH_COOKIE_MAX_AGE}; Path=/; ${getCookieDomainAttr()}SameSite=Lax; ${secure}`;
}

function clearAuthCookie() {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "Secure; " : "";
  document.cookie = `${AUTH_COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax; ${secure}`;
  document.cookie = `${AUTH_COOKIE_KEY}=; Max-Age=0; Path=/; ${getCookieDomainAttr()}SameSite=Lax; ${secure}`;
}

export const tokenManager = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    setAuthCookie(token);
  },
  remove: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    clearAuthCookie();
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
    const data = await request<{ success: boolean; token: string; userId: string; email: string; nickname?: string }>(
      AUTH_API_URL,
      "/auth/register",
      { method: "POST", body: { email, password } }
    );

    if (data.success && data.token) {
      tokenManager.set(data.token);
      userManager.set({ userId: data.userId, email: data.email, nickname: data.nickname || "", roles: ["user"] });
    }

    return data;
  },

  // 密码登录
  login: async (email: string, password: string) => {
    const data = await request<{ success: boolean; token: string; userId: string; email: string; nickname?: string }>(
      AUTH_API_URL,
      "/auth/login",
      { method: "POST", body: { email, password } }
    );

    if (data.success && data.token) {
      tokenManager.set(data.token);
      // 管理员邮箱列表 - 与数据库中的 user_roles 表保持同步
      const adminEmails = ["phosa@qq.com"];
      const roles = adminEmails.includes(email) ? ["admin", "user"] : ["user"];
      userManager.set({ userId: data.userId, email: data.email, nickname: data.nickname || "", roles });
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
    const data = await request<{ success: boolean; token: string; userId: string; email: string; nickname?: string; isNewUser?: boolean }>(
      AUTH_API_URL,
      "/auth/login-code",
      { method: "POST", body: { email, code } }
    );

    if (data.success && data.token) {
      tokenManager.set(data.token);
      const adminEmails = ["phosa@qq.com"];
      const roles = adminEmails.includes(email) ? ["admin", "user"] : ["user"];
      userManager.set({ userId: data.userId, email: data.email, nickname: data.nickname || "", roles });
    }

    return data;
  },

  // 发起 GitHub 授权：跳转到 GitHub 授权页
  // mode='bind' 时用于已登录用户绑定（回调页据此决定后续跳转）
  startGithubLogin: (mode: "login" | "bind" = "login") => {
    const { clientId, redirectUri, scope } = config.github;
    // 随机 state 防 CSRF，存 sessionStorage 供回调校验
    const state = `${mode}.${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sessionStorage.setItem("github_oauth_state", state);
    const url =
      "https://github.com/login/oauth/authorize" +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${encodeURIComponent(state)}`;
    window.location.href = url;
  },

  // GitHub 回调：用 code 换取结果。
  // 三种返回：①回头客/绑定 → 带 token，存登录态；②needsChoice → 不存 token，
  // 透传 ticket/matchedAccount 给前端引导用户选择。
  githubLogin: async (code: string) => {
    const data = await request<{
      success: boolean;
      token?: string;
      userId?: string;
      email?: string;
      nickname?: string;
      isNewUser?: boolean;
      bound?: boolean;
      needsChoice?: boolean;
      githubTicket?: string;
      githubEmail?: string | null;
      matchedAccount?: { exists: boolean; emailMasked: string | null };
    }>(AUTH_API_URL, "/auth/github", { method: "POST", body: { code } });

    // 需要用户选择时不写登录态，原样透传
    if (data.success && data.token && !data.needsChoice) {
      tokenManager.set(data.token);
      const adminEmails = ["phosa@qq.com"];
      const roles = adminEmails.includes(data.email || "")
        ? ["admin", "user"]
        : ["user"];
      userManager.set({ userId: data.userId, email: data.email, nickname: data.nickname || "", roles });
    }

    return data;
  },

  // 完成 GitHub 关联选择：create=建新号 / link=绑到当前已登录账号
  // link 模式下 request 会自动带上 Authorization(原账号 token)
  githubFinalize: async (ticket: string, choice: "create" | "link") => {
    const data = await request<{
      success: boolean;
      token: string;
      userId: string;
      email: string;
      nickname?: string;
      isNewUser?: boolean;
      bound?: boolean;
    }>(AUTH_API_URL, "/auth/github/finalize", {
      method: "POST",
      body: { ticket, choice }
    });

    if (data.success && data.token) {
      tokenManager.set(data.token);
      const adminEmails = ["phosa@qq.com"];
      const roles = adminEmails.includes(data.email)
        ? ["admin", "user"]
        : ["user"];
      userManager.set({ userId: data.userId, email: data.email, nickname: data.nickname || "", roles });
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

  // 更新当前用户资料
  updateProfile: async (data: { nickname: string }) => {
    return request<{ success: boolean; user: any; nickname?: string; message?: string }>(
      AUTH_API_URL,
      "/auth/update-profile",
      { method: "POST", body: data }
    );
  },

  // 验证Token
  verifyToken: async () => {
    return request<{ valid: boolean; userId: string }>(AUTH_API_URL, "/auth/verify");
  }
};

// 网站API
export const websiteApi = {
  uploadAndDeploy: async (params: {
    fileContentBase64: string;
    fileName: string;
    websiteId?: string;
    projectId?: string | number | null;
  }) => {
    return request<{ success: boolean; url?: string; websiteId?: string; projectId?: string | number | null; path?: string; message?: string }>(
      WEBSITE_API_URL,
      "/upload",
      { method: "POST", body: { action: "upload_and_deploy", ...params } }
    );
  },

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

  // 更新站点访问级别
  updateVisibility: async (data: { docId?: string; websiteId?: string; visibility: "public" | "private" }) => {
    return request<{ success: boolean; visibility?: "public" | "private"; message?: string }>(
      WEBSITE_API_URL,
      "/website/update-visibility",
      { method: "POST", body: { action: "update_visibility", ...data } }
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
  },

  // 设置自定义子域名前缀
  setSubdomain: async (data: { docId?: string; websiteId?: string; subdomain: string; domain?: string }) => {
    return request<{ success: boolean; subdomain?: string; subdomainDomain?: string; subdomain_domain?: string; url?: string; code?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/set-subdomain",
      { method: "POST", body: { action: "set_subdomain", ...data } }
    );
  },

  // 实时检测前缀是否可用
  checkSubdomain: async (data: { docId?: string; websiteId?: string; subdomain: string; domain?: string }) => {
    return request<{ success: boolean; available: boolean; domain?: string; reason?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/check-subdomain",
      { method: "POST", body: { action: "check_subdomain", ...data } }
    );
  },

  // 清除自定义子域名前缀
  clearSubdomain: async (data: { docId?: string; websiteId?: string }) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/clear-subdomain",
      { method: "POST", body: { action: "clear_subdomain", ...data } }
    );
  },

  // 按角色 id/name 列表获取限额(home.jsx 计算有效限额用)
  getRoleLimits: async (roles: string[]) => {
    return request<{ code: number; data: any[]; message?: string }>(
      WEBSITE_API_URL,
      "/website/get-role-limits",
      { method: "POST", body: { action: "get_role_limits", roles } }
    );
  },

  // 解析 userId -> email(管理员站点列表用)
  resolveUserEmails: async (userIds: string[]) => {
    return request<{ success: boolean; users: { userId: string; email: string }[] }>(
      WEBSITE_API_URL,
      "/website/resolve-user-emails",
      { method: "POST", body: { action: "resolve_user_emails", userIds } }
    );
  },


  // 获取单个站点统计
  getSiteStats: async (data: { websiteId: string; days?: number }) => {
    return request<{
      success: boolean;
      websiteId?: string;
      rangeDays?: number;
      totals?: { views: number; badgeClicks: number };
      daily?: { date: string; views: number; badgeClicks: number }[];
      referrers?: { host: string; views: number }[];
      paths?: { path: string; views: number }[];
      countries?: { country: string; views: number }[];
      provinces?: { country: string; province: string; views: number }[];
      message?: string;
    }>(
      WEBSITE_API_URL,
      "/website/site-stats",
      { method: "POST", body: { action: "get_site_stats", ...data } }
    );
  },

  // 获取站点真实访问日志（授权用户可见，IP 后端从私有桶解密返回）
  getSiteAccessLogs: async (data: { websiteId: string; days?: number; limit?: number }) => {
    return request<{
      success: boolean;
      websiteId?: string;
      rangeDays?: number;
      logs?: {
        ts: number | null;
        type: string;
        host: string;
        path: string;
        referrer: string;
        referrerHost: string;
        country: string;
        province: string;
        ip: string;
        userAgent: string;
      }[];
      message?: string;
    }>(
      WEBSITE_API_URL,
      "/website/site-access-logs",
      { method: "POST", body: { action: "get_site_access_logs", ...data } }
    );
  },

  // 大盘统计
  bucketStats: async (data: { granularity?: string; startTime?: string; endTime?: string }) => {
    return request<any>(
      WEBSITE_API_URL,
      "/website/bucket-stats",
      { method: "POST", body: { action: "bucket_stats", ...data } }
    );
  },

  // 项目列表
  listProjects: async (data: { includeArchived?: boolean; includeAll?: boolean } = {}) => {
    return request<{ success: boolean; projects: any[]; count: number; message?: string }>(
      WEBSITE_API_URL,
      "/website/list-projects",
      { method: "POST", body: { action: "list_projects", ...data } }
    );
  },

  // 创建项目
  createProject: async (data: { name: string; description?: string; color?: string; icon?: string }) => {
    return request<{ success: boolean; project?: any; message?: string }>(
      WEBSITE_API_URL,
      "/website/create-project",
      { method: "POST", body: { action: "create_project", ...data } }
    );
  },

  // 更新项目
  updateProject: async (data: { id: string | number; name?: string; description?: string; color?: string; icon?: string }) => {
    return request<{ success: boolean; project?: any; message?: string }>(
      WEBSITE_API_URL,
      "/website/update-project",
      { method: "POST", body: { action: "update_project", ...data } }
    );
  },

  // 归档/恢复项目
  archiveProject: async (data: { id: string | number; archived: boolean }) => {
    return request<{ success: boolean; archived?: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/archive-project",
      { method: "POST", body: { action: "archive_project", ...data } }
    );
  },

  // 移动站点到项目
  setWebsiteProject: async (data: { docId?: string | number; websiteId?: string; projectId?: string | number | null }) => {
    return request<{ success: boolean; project?: any; websiteId?: string; docId?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/set-website-project",
      { method: "POST", body: { action: "set_website_project", ...data } }
    );
  },

  // 项目成员列表
  listProjectMembers: async (projectId: string | number) => {
    return request<{ success: boolean; project?: any; role?: string; members: any[]; invitations: any[]; message?: string }>(
      WEBSITE_API_URL,
      "/website/list-project-members",
      { method: "POST", body: { action: "list_project_members", projectId } }
    );
  },

  // 邀请项目成员
  inviteProjectMember: async (data: { projectId: string | number; email: string; role: "admin" | "member" }) => {
    return request<{ success: boolean; member?: any; invitation?: any; message?: string }>(
      WEBSITE_API_URL,
      "/website/invite-project-member",
      { method: "POST", body: { action: "invite_project_member", ...data } }
    );
  },

  // 更新项目成员角色
  updateProjectMemberRole: async (data: { projectId: string | number; userId: string; role: "admin" | "member" }) => {
    return request<{ success: boolean; member?: any; message?: string }>(
      WEBSITE_API_URL,
      "/website/update-project-member-role",
      { method: "POST", body: { action: "update_project_member_role", ...data } }
    );
  },

  // 移除项目成员
  removeProjectMember: async (data: { projectId: string | number; userId: string }) => {
    return request<{ success: boolean; removedUserId?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/remove-project-member",
      { method: "POST", body: { action: "remove_project_member", ...data } }
    );
  }
};

// 管理员 API（角色与限额配置）
export const adminApi = {
  listUserRoles: async () => {
    return request<{ success: boolean; data: any[] }>(
      WEBSITE_API_URL,
      "/website/list-user-roles",
      { method: "POST", body: { action: "list_user_roles" } }
    );
  },
  setUserRole: async (uid: string, role: string[]) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/set-user-role",
      { method: "POST", body: { action: "set_user_role", uid, role } }
    );
  },
  deleteUserRole: async (uid: string) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/delete-user-role",
      { method: "POST", body: { action: "delete_user_role", uid } }
    );
  },
  listRoleLimits: async () => {
    return request<{ success: boolean; data: any[] }>(
      WEBSITE_API_URL,
      "/website/list-role-limits",
      { method: "POST", body: { action: "list_role_limits" } }
    );
  },
  setRoleLimit: async (doc: any) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/set-role-limit",
      { method: "POST", body: { action: "set_role_limit", ...doc } }
    );
  },
  deleteRoleLimit: async (idOrName: string) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/delete-role-limit",
      { method: "POST", body: { action: "delete_role_limit", id: idOrName, name: idOrName } }
    );
  },
  // 多云存储桶注册制
  listBuckets: async () => {
    return request<{ success: boolean; data: any[]; message?: string }>(
      WEBSITE_API_URL,
      "/website/list-buckets",
      { method: "POST", body: { action: "list_buckets" } }
    );
  },
  registerBucket: async (doc: any) => {
    return request<{ success: boolean; id?: number; message?: string }>(
      WEBSITE_API_URL,
      "/website/register-bucket",
      { method: "POST", body: { action: "register_bucket", ...doc } }
    );
  },
  updateBucket: async (doc: any) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/update-bucket",
      { method: "POST", body: { action: "update_bucket", ...doc } }
    );
  },
  deleteBucket: async (id: number) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/delete-bucket",
      { method: "POST", body: { action: "delete_bucket", id } }
    );
  },
  setDefaultBucket: async (id: number) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/set-default-bucket",
      { method: "POST", body: { action: "set_default_bucket", id } }
    );
  }
};

// 检查登录状态
export function isLoggedIn(): boolean {
  return !!tokenManager.get();
}

/**
 * 将 MySQL 行映射为 home.jsx 期望的字段名(_id, websiteId, fileName, ... 时间为 {$date})
 */
export function mapWebsiteRow(row: any): any {
  return {
    _id: String(row.id),
    websiteId: row.website_id,
    fileName: row.file_name,
    name: row.name || row.file_name,
    path: row.path,
    url: row.url,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags || []),
    userId: row.user_id,
    userNickname: row.user_nickname || row.userNickname || "",
    projectId: row.projectKey || row.project_key || row.project_id ? String(row.projectKey || row.project_key || row.project_id) : null,
    projectInternalId: row.projectInternalId || row.project_internal_id || null,
    projectKey: row.projectKey || row.project_key || null,
    projectName: row.project_name || row.projectName || null,
    projectSlug: row.project_slug || row.projectSlug || null,
    projectRole: row.project_role || row.projectRole || null,
    subdomain: row.subdomain || null,
    subdomainDomain: normalizeOfficialDomain(row.subdomain_domain || row.subdomainDomain),
    visibility: row.visibility === "private" ? "private" : "public",
    createdAt: row.created_at ? { $date: new Date(row.created_at).getTime() } : undefined,
    updatedAt: row.updated_at ? { $date: new Date(row.updated_at).getTime() } : undefined
  };
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
