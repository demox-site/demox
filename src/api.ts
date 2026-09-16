/**
 * Demox API 服务 - 连接SCF HTTP触发器
 */
import config from "./configs/env";
import { OFFICIAL_DOMAINS, supportedOfficialBinding } from "./lib/official-domains";
import {
  assertFeishuPkceSupport,
  beginFeishuOAuthFlow
} from "./lib/feishu-oauth";
import { beginGithubOAuthFlow } from "./lib/github-oauth";
import { getTopAwareSessionStorage } from "./lib/top-aware-session-storage";

const AUTH_API_URL = config.authApiUrl;
const WEBSITE_API_URL = config.websiteApiUrl;
const FUNCTIONS_API_URL = config.functionsApiUrl;
const FUNCTION_ENV = config.functionEnv || "production";

function scopedFunctionPath(websiteId: string, suffix = "/functions") {
  const rest = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/${encodeURIComponent(websiteId)}/${encodeURIComponent(FUNCTION_ENV)}${rest}`;
}
const DEPLOY_API_PATH = "/deploy";

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

type RequestOptions = RequestInit & {
  /** login 场景忽略本地残留 token，避免误走绑定逻辑 */
  skipAuth?: boolean;
};

// API请求封装
async function request<T>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuth, headers: optionHeaders, body, ...rest } = options;
  const token = skipAuth ? null : tokenManager.get();

  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...optionHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.message || data.error || "请求失败");
  }

  return data;
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const stride = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + stride)));
  }
  return btoa(parts.join(""));
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function retryUploadRequest<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

type DeployUploadResult = {
  success: boolean;
  url?: string;
  websiteId?: string;
  projectId?: string | number | null;
  path?: string;
  message?: string;
  code?: string;
  retryable?: boolean;
  retryAfterMs?: number;
};

export type ProjectCustomDomainRoute = {
  id: string;
  label: string;
  hostname: string;
  url?: string;
  isDefault?: boolean;
  websiteId?: string | null;
  websiteName?: string;
};

export type ProjectCustomDomain = {
  id: string;
  hostname: string;
  status: "pending" | "active";
  cnameTarget: string;
  cnameHost?: string;
  wildcardHost?: string;
  url?: string;
  defaultWebsiteId?: string | null;
  defaultWebsiteName?: string;
  routes?: ProjectCustomDomainRoute[];
  verifiedAt?: string | null;
  createdAt?: string | null;
  cnameChain?: string[];
};

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
    const data = await request<{ success: boolean; token: string; userId: string; email: string; nickname?: string; isNewUser?: boolean; hasPassword?: boolean }>(
      AUTH_API_URL,
      "/auth/login-code",
      { method: "POST", body: { email, code } }
    );

    if (data.success && data.token) {
      tokenManager.set(data.token);
      const adminEmails = ["phosa@qq.com"];
      const roles = adminEmails.includes(email) ? ["admin", "user"] : ["user"];
      userManager.set({
        userId: data.userId,
        email: data.email,
        nickname: data.nickname || "",
        roles,
        ...(typeof data.hasPassword === "boolean" ? { hasPassword: data.hasPassword } : {})
      });
    }

    return data;
  },

  // 发起 GitHub 授权：跳转到 GitHub 授权页
  // mode='bind' 时用于已登录用户绑定（回调页据此决定后续跳转）
  // 每次按 state 隔离写入 sessionStorage（含 iframe→_top 场景），避免旧缓存串线。
  startGithubLogin: (
    mode: "login" | "bind" = "login",
    navigationTarget: "_self" | "_top" = "_self"
  ) => {
    const { clientId, redirectUri, scope } = config.github;
    const storage = getTopAwareSessionStorage();
    if (!storage) {
      throw new Error("无法保存 GitHub 登录状态，请检查浏览器隐私设置后重试");
    }
    const { state } = beginGithubOAuthFlow(mode, storage);
    const url =
      "https://github.com/login/oauth/authorize" +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${encodeURIComponent(state)}`;
    if (navigationTarget === "_top" && window.top) {
      window.top.location.href = url;
      return;
    }
    window.location.href = url;
  },

  // GitHub 回调：用 code 换取结果。
  // 三种返回：①回头客/绑定 → 带 token，存登录态；②needsChoice → 不存 token，
  // 透传 ticket/matchedAccount 给前端引导用户选择。
  // mode='login' 时不带本地残留 Authorization，避免旧缓存 token 误走绑定。
  githubLogin: async (code: string, mode: "login" | "bind" = "login") => {
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
    }>(AUTH_API_URL, "/auth/github", {
      method: "POST",
      body: { code },
      skipAuth: mode === "login"
    });

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

  isFeishuConfigured: () => Boolean(config.feishu.clientId),

  prepareFeishuLogin: async () => {
    if (!config.feishu.clientId) throw new Error("飞书登录尚未配置");
    assertFeishuPkceSupport();
  },

  // 每次发起授权都生成独立 PKCE，并按 state 隔离，避免并发或旧回调串线。
  startFeishuLogin: async (
    mode: "login" | "bind" = "login",
    navigationTarget: "_self" | "_top" = "_self"
  ) => {
    const { clientId, redirectUri } = config.feishu;
    if (!clientId) {
      throw new Error("飞书登录尚未配置");
    }
    const storage = getTopAwareSessionStorage();
    if (!storage) {
      throw new Error("无法保存飞书登录状态，请检查浏览器隐私设置后重试");
    }
    const { state, challenge } = await beginFeishuOAuthFlow(
      mode,
      storage,
      globalThis.crypto,
      Date.now(),
      config.feishu.usePkce
    );

    const url = new URL("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    if (challenge) {
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    if (navigationTarget === "_top" && window.top) {
      window.top.location.href = url.toString();
      return;
    }
    window.location.href = url.toString();
  },

  feishuLogin: async (
    code: string,
    codeVerifier?: string | null,
    codeChallenge?: string | null
  ) => {
    const data = await request<{
      success: boolean;
      token?: string;
      userId?: string;
      email?: string;
      nickname?: string;
      isNewUser?: boolean;
      bound?: boolean;
      needsChoice?: boolean;
      feishuTicket?: string;
      feishuName?: string;
    }>(AUTH_API_URL, "/auth/feishu", {
      method: "POST",
      body: {
        code,
        ...(codeVerifier && codeChallenge ? { codeVerifier, codeChallenge } : {})
      }
    });

    if (data.success && data.token && !data.needsChoice) {
      tokenManager.set(data.token);
      const roles = data.email === "phosa@qq.com" ? ["admin", "user"] : ["user"];
      userManager.set({
        userId: data.userId,
        email: data.email,
        nickname: data.nickname || "",
        roles
      });
    }

    return data;
  },

  feishuFinalize: async (ticket: string, choice: "create" | "link") => {
    const data = await request<{
      success: boolean;
      token: string;
      userId: string;
      email: string;
      nickname?: string;
      isNewUser?: boolean;
      bound?: boolean;
    }>(AUTH_API_URL, "/auth/feishu/finalize", {
      method: "POST",
      body: { ticket, choice }
    });

    if (data.success && data.token) {
      tokenManager.set(data.token);
      const roles = data.email === "phosa@qq.com" ? ["admin", "user"] : ["user"];
      userManager.set({
        userId: data.userId,
        email: data.email,
        nickname: data.nickname || "",
        roles
      });
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

  // 修改或首次设置当前用户密码。尚未设密时可不传 currentPassword。
  changePassword: async (data: { currentPassword?: string; newPassword: string }) => {
    return request<{ success: boolean; message?: string }>(
      AUTH_API_URL,
      "/auth/change-password",
      { method: "POST", body: data }
    );
  },

  // 解绑当前用户的 GitHub 账号
  unbindGithub: async () => {
    return request<{ success: boolean; message?: string }>(
      AUTH_API_URL,
      "/auth/unbind-github",
      { method: "POST", body: {} }
    );
  },

  // 解绑当前用户的飞书账号
  unbindFeishu: async () => {
    return request<{ success: boolean; message?: string }>(
      AUTH_API_URL,
      "/auth/unbind-feishu",
      { method: "POST", body: {} }
    );
  },

  // 验证Token
  verifyToken: async () => {
    return request<{ valid: boolean; userId: string }>(AUTH_API_URL, "/auth/verify");
  },

  oauthAuthorize: async (payload: {
    client_id: string;
    redirect_uri: string;
    response_type?: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }) => {
    return request<{ success: boolean; code: string; redirect_uri?: string }>(
      AUTH_API_URL,
      "/oauth/authorize",
      { method: "POST", body: payload }
    );
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

  uploadFileAndDeploy: async (
    file: File,
    params: { fileName: string; websiteId?: string; projectId?: string | number | null },
    onProgress?: (percent: number, uploadedBytes: number) => void
  ): Promise<DeployUploadResult> => {
    const wholeFileSha256 = await sha256Hex(await file.arrayBuffer());
    const requestId = crypto.randomUUID();
    const init = await retryUploadRequest(() => request<{
      success: boolean;
      uploadId?: string;
      websiteId?: string;
      chunkSize?: number;
      totalChunks?: number;
      message?: string;
      code?: string;
    }>(WEBSITE_API_URL, DEPLOY_API_PATH, {
      method: "POST",
      body: {
        action: "init_deploy_upload",
        requestId,
        fileName: params.fileName,
        websiteId: params.websiteId,
        projectId: params.projectId,
        totalSize: file.size,
        sha256: wholeFileSha256
      }
    }));
    if (!init.success || !init.uploadId || !init.chunkSize || !init.totalChunks) {
      throw new Error(init.message || "初始化上传失败");
    }

    let completionStarted = false;
    try {
      onProgress?.(0, 0);
      for (let index = 0; index < init.totalChunks; index++) {
        const start = index * init.chunkSize;
        const end = Math.min(start + init.chunkSize, file.size);
        const chunkBuffer = await file.slice(start, end).arrayBuffer();
        const chunkBytes = new Uint8Array(chunkBuffer);
        const chunkSha256 = await sha256Hex(chunkBuffer);
        const chunkResult = await retryUploadRequest(() =>
          request<{ success: boolean; message?: string }>(WEBSITE_API_URL, DEPLOY_API_PATH, {
            method: "POST",
            body: {
              action: "upload_deploy_chunk",
              uploadId: init.uploadId,
              chunkIndex: index,
              chunkSha256,
              chunkBase64: bytesToBase64(chunkBytes)
            }
          })
        );
        if (!chunkResult.success) throw new Error(chunkResult.message || `上传分块 ${index + 1} 失败`);
        onProgress?.(Math.round((end * 100) / file.size), end);
      }

      completionStarted = true;
      for (let attempt = 0; attempt < 40; attempt++) {
        const result = await retryUploadRequest(
          () => request<DeployUploadResult>(WEBSITE_API_URL, DEPLOY_API_PATH, {
            method: "POST",
            body: { action: "complete_deploy_upload", uploadId: init.uploadId }
          }),
          3
        );
        if (result.success) return result;
        if (result.code !== "UPLOAD_COMPLETING") {
          throw new Error(result.message || "部署失败");
        }
        await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs || 1500));
      }
      throw new Error("部署完成等待超时，可重新提交以查询最终结果");
    } catch (error) {
      if (!completionStarted) {
        await request(WEBSITE_API_URL, DEPLOY_API_PATH, {
          method: "POST",
          body: { action: "abort_deploy_upload", uploadId: init.uploadId }
        }).catch(() => {});
      }
      throw error;
    }
  },

  // 获取网站列表
  list: async (data: { projectId?: string | number } = {}) => {
    return request<{ success: boolean; websites: any[]; count: number }>(
      WEBSITE_API_URL,
      "/website/list",
      { method: "POST", body: { action: "list", ...data } }
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

  // Pro/admin site watermark preference
  updateWatermark: async (data: { docId?: string; websiteId?: string; hideWatermark: boolean }) => {
    return request<{ success: boolean; hideWatermark?: boolean; code?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/update-watermark",
      { method: "POST", body: { action: "update_watermark", ...data } }
    );
  },

  // 更新站点 SEO 元信息
  updateSeo: async (data: {
    docId?: string;
    websiteId?: string;
    seoTitle?: string;
    seoDescription?: string;
    ogImage?: string;
  }) => {
    return request<{
      success: boolean;
      seo?: { title: string | null; description: string | null; ogImage: string | null };
      message?: string;
    }>(WEBSITE_API_URL, "/website/update-seo", {
      method: "POST",
      body: { action: "update_seo", ...data }
    });
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

  listProjectCustomDomains: async (projectId: string | number) => {
    return request<{
      success: boolean;
      cnameTarget?: string;
      canManage?: boolean;
      domains?: ProjectCustomDomain[];
      count?: number;
      message?: string;
    }>(WEBSITE_API_URL, "/website/list-project-custom-domains", {
      method: "POST",
      body: { action: "list_project_custom_domains", projectId }
    });
  },

  addProjectCustomDomain: async (data: {
    projectId: string | number;
    hostname: string;
    websiteId: string;
  }) => {
    return request<{
      success: boolean;
      domain?: ProjectCustomDomain;
      cnameTarget?: string;
      code?: string;
      message?: string;
    }>(WEBSITE_API_URL, "/website/add-project-custom-domain", {
      method: "POST",
      body: { action: "add_project_custom_domain", ...data }
    });
  },

  setProjectCustomDomainRoute: async (data: {
    projectId: string | number;
    domainId: string | number;
    label?: string;
    websiteId: string;
  }) => {
    return request<{
      success: boolean;
      domain?: ProjectCustomDomain;
      route?: ProjectCustomDomainRoute | null;
      message?: string;
    }>(WEBSITE_API_URL, "/website/set-project-custom-domain-route", {
      method: "POST",
      body: { action: "set_project_custom_domain_route", ...data }
    });
  },

  removeProjectCustomDomainRoute: async (data: {
    projectId: string | number;
    domainId: string | number;
    routeId?: string | number;
    label?: string;
  }) => {
    return request<{ success: boolean; domain?: ProjectCustomDomain; message?: string }>(
      WEBSITE_API_URL,
      "/website/remove-project-custom-domain-route",
      { method: "POST", body: { action: "remove_project_custom_domain_route", ...data } }
    );
  },

  removeProjectCustomDomain: async (data: {
    projectId: string | number;
    domainId?: string | number;
    hostname?: string;
  }) => {
    return request<{ success: boolean; hostname?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/remove-project-custom-domain",
      { method: "POST", body: { action: "remove_project_custom_domain", ...data } }
    );
  },

  verifyProjectCustomDomain: async (data: {
    projectId: string | number;
    domainId?: string | number;
    hostname?: string;
  }) => {
    return request<{
      success: boolean;
      domain?: ProjectCustomDomain;
      cnameTarget?: string;
      message?: string;
    }>(WEBSITE_API_URL, "/website/verify-project-custom-domain", {
      method: "POST",
      body: { action: "verify_project_custom_domain", ...data }
    });
  },

  listBlockedPhrases: async () => {
    return request<{
      success: boolean;
      docs?: string;
      skill?: string;
      method?: string;
      updatedAt?: string;
      count?: number;
      phrases?: string[];
      groups?: Array<{ category: string; label: string; labelEn?: string; phrases: string[] }>;
      imageReview?: { provider?: string; billed?: boolean; note?: string };
    }>(WEBSITE_API_URL, "/website/content-scan/phrases", {
      method: "GET",
      skipAuth: true
    });
  },

  // 按角色 id/name 列表获取限额(home.jsx 计算有效限额用)
  getRoleLimits: async (roles: string[]) => {
    return request<{ code: number; data: any[]; message?: string }>(
      WEBSITE_API_URL,
      "/website/get-role-limits",
      { method: "POST", body: { action: "get_role_limits", roles } }
    );
  },

  // 获取当前用户真实用量与套餐限额（用量与套餐页）
  getUsage: async () => {
    return request<{
      code: number;
      data?: {
        role: { name: string; priority: number };
        usage: { deployments: number; files: number; storage: number };
        maxSite: { fileCount: number; storageSize: number };
        limits: {
          deployment_limit: number | null;
          max_file_count: number | null;
          max_file_size: number | null;
        };
      };
      message?: string;
    }>(
      WEBSITE_API_URL,
      "/website/get-usage",
      { method: "POST", body: { action: "get_usage" } }
    );
  },

  // 创建个人访问令牌（明文 token 仅此次返回）
  createToken: async (name: string) => {
    return request<{
      code: number;
      data?: {
        id: string;
        token: string;
        name: string;
        prefix: string;
        createdAt: number;
      };
      message?: string;
    }>(
      WEBSITE_API_URL,
      "/website/create-token",
      { method: "POST", body: { action: "create_token", name } }
    );
  },

  // 列出当前用户令牌
  listTokens: async () => {
    return request<{
      code: number;
      data?: Array<{
        id: string;
        name: string;
        prefix: string;
        createdAt: number | null;
        lastUsedAt: number | null;
        expiresAt: number | null;
        revoked: boolean;
      }>;
      message?: string;
    }>(
      WEBSITE_API_URL,
      "/website/list-tokens",
      { method: "POST", body: { action: "list_tokens" } }
    );
  },

  // 吊销令牌
  revokeToken: async (id: string) => {
    return request<{ code: number; data?: { revoked: boolean }; message?: string }>(
      WEBSITE_API_URL,
      "/website/revoke-token",
      { method: "POST", body: { action: "revoke_token", id } }
    );
  },

  // 匿名产品事件埋点（无需鉴权，fire-and-forget）
  trackProductEvent: async (
    eventName: string,
    visitorId: string,
    page: string,
    props?: Record<string, unknown>
  ) => {
    return request<{ code: number; data?: { tracked: boolean } }>(
      WEBSITE_API_URL,
      "/website/track-product-event",
      { method: "POST", body: { action: "track_product_event", eventName, visitorId, page, props } }
    );
  },

  // 管理员：查询产品漏斗
  getProductFunnel: async (days = 14) => {
    return request<{
      code: number;
      data?: {
        days: number;
        totals: Record<string, number>;
        daily: Array<{ event: string; date: string; count: number }>;
      };
      message?: string;
    }>(
      WEBSITE_API_URL,
      "/website/get-product-funnel",
      { method: "POST", body: { action: "get_product_funnel", days } }
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

  // 获取站点访问日志展示索引（授权用户可见，IP 仅返回脱敏值）
  getSiteAccessLogs: async (data: { websiteId: string; days?: number; page?: number; pageSize?: number; page_size?: number; limit?: number }) => {
    return request<{
      success: boolean;
      websiteId?: string;
      rangeDays?: number;
      page?: number;
      pageSize?: number;
      total?: number;
      totalPages?: number;
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

  // 永久删除空项目
  deleteProject: async (data: { id: string | number }) => {
    return request<{ success: boolean; deleted?: boolean; code?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/delete-project",
      { method: "POST", body: { action: "delete_project", ...data } }
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
    return request<{ success: boolean; project?: any; role?: string; members: any[]; invitations: any[]; feishuGrants?: any[]; githubGrants?: any[]; currentFeishuIdentity?: any; currentGithubIdentity?: any; message?: string }>(
      WEBSITE_API_URL,
      "/website/list-project-members",
      { method: "POST", body: { action: "list_project_members", projectId } }
    );
  },

  // 邀请项目成员
  searchProjectInviteUsers: async (data: { projectId: string | number; query: string }) => {
    return request<{ success: boolean; users?: Array<{ userId: string; email: string; nickname?: string }>; message?: string }>(
      WEBSITE_API_URL,
      "/website/search-project-invite-users",
      { method: "POST", body: { action: "search_project_invite_users", ...data } }
    );
  },

  inviteProjectMember: async (data: { projectId: string | number; email: string; role: "admin" | "member" }) => {
    return request<{ success: boolean; member?: any; invitation?: any; message?: string }>(
      WEBSITE_API_URL,
      "/website/invite-project-member",
      { method: "POST", body: { action: "invite_project_member", ...data } }
    );
  },

  searchFeishuProjectPrincipals: async (data: {
    projectId: string | number;
    principalType: "user" | "department";
    query: string;
  }) => {
    return request<{ success: boolean; principals?: any[]; message?: string; errorCode?: string | number }>(
      WEBSITE_API_URL,
      "/website/search-feishu-project-principals",
      { method: "POST", body: { action: "search_feishu_project_principals", ...data } }
    );
  },

  grantProjectToFeishu: async (data: {
    projectId: string | number;
    principalType: "user" | "department";
    principalKey: string;
    role: "admin" | "member";
  }) => {
    return request<{ success: boolean; grant?: any; message?: string }>(
      WEBSITE_API_URL,
      "/website/grant-project-to-feishu",
      { method: "POST", body: { action: "grant_project_to_feishu", ...data } }
    );
  },

  removeProjectFeishuGrant: async (data: { projectId: string | number; grantId: string | number }) => {
    return request<{ success: boolean; removedGrantId?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/remove-project-feishu-grant",
      { method: "POST", body: { action: "remove_project_feishu_grant", ...data } }
    );
  },

  searchGithubProjectPrincipals: async (data: { projectId: string | number; query: string }) => {
    return request<{ success: boolean; principals?: any[]; message?: string; errorCode?: string | number }>(
      WEBSITE_API_URL,
      "/website/search-github-project-principals",
      { method: "POST", body: { action: "search_github_project_principals", ...data } }
    );
  },

  grantProjectToGithub: async (data: {
    projectId: string | number;
    principalKey: string;
    githubLogin?: string;
    role: "admin" | "member";
  }) => {
    return request<{ success: boolean; grant?: any; member?: any; message?: string }>(
      WEBSITE_API_URL,
      "/website/grant-project-to-github",
      { method: "POST", body: { action: "grant_project_to_github", ...data } }
    );
  },

  removeProjectGithubGrant: async (data: { projectId: string | number; grantId: string | number }) => {
    return request<{ success: boolean; removedGrantId?: string; message?: string }>(
      WEBSITE_API_URL,
      "/website/remove-project-github-grant",
      { method: "POST", body: { action: "remove_project_github_grant", ...data } }
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
  getPlatformOverview: async () => {
    return request<{
      success: boolean;
      message?: string;
      counts?: {
        users?: number;
        usersWithSites?: number;
        users7d?: number;
        sites?: number;
        sites7d?: number;
        projects?: number;
        archivedProjects?: number;
        storage?: number;
        storageObjects?: number;
        bucketStorage?: number | null;
        bucketObjects?: number | null;
        admins?: number;
        proActive?: number;
        proExpired?: number;
      };
      traffic?: { views7d?: number; views30d?: number; viewsAll?: number; daily?: Array<{ date: string; views: number }> };
      topSites?: Array<{ websiteId: string; name: string; url?: string; owner?: string; views30d?: number; storage?: number }>;
    }>(
      WEBSITE_API_URL,
      "/website/get-platform-overview",
      { method: "POST", body: { action: "get_platform_overview" } }
    );
  },
  getUserOverview: async (uid: string) => {
    return request<{
      success: boolean;
      message?: string;
      user?: any;
      counts?: any;
      usage?: any;
      traffic?: any;
      projects?: any[];
      sites?: any[];
      ungroupedSites?: any[];
    }>(
      WEBSITE_API_URL,
      "/website/get-user-overview",
      { method: "POST", body: { action: "get_user_overview", uid } }
    );
  },
  setUserRole: async (
    uid: string,
    role: string[],
    options: { proDays?: number; proLifetime?: boolean } = {}
  ) => {
    return request<{ success: boolean; message?: string }>(
      WEBSITE_API_URL,
      "/website/set-user-role",
      {
        method: "POST",
        body: {
          action: "set_user_role",
          uid,
          role,
          ...(options.proDays != null ? { proDays: options.proDays } : {}),
          ...(options.proLifetime ? { proLifetime: true } : {})
        }
      }
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
  const binding = supportedOfficialBinding(row.subdomain, row.subdomain_domain || row.subdomainDomain);
  const customHosts = (row.customHosts || row.custom_hosts || [])
    .map((host: string) => String(host || "").trim().toLowerCase())
    .filter(Boolean);
  return {
    _id: String(row.id),
    websiteId: row.website_id,
    fileName: row.file_name,
    name: row.name || row.file_name,
    path: row.path,
    url: customHosts[0] ? `https://${customHosts[0]}/` : row.url,
    customHosts,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags || []),
    userId: row.user_id,
    userNickname: row.user_nickname || row.userNickname || "",
    projectId: row.projectKey || row.project_key || row.project_id ? String(row.projectKey || row.project_key || row.project_id) : null,
    projectInternalId: row.projectInternalId || row.project_internal_id || null,
    projectKey: row.projectKey || row.project_key || null,
    projectName: row.project_name || row.projectName || null,
    projectSlug: row.project_slug || row.projectSlug || null,
    projectRole: row.project_role || row.projectRole || null,
    subdomain: binding.subdomain,
    subdomainDomain: binding.subdomainDomain,
    visibility: row.visibility === "private" ? "private" : "public",
    hideWatermark: row.hideWatermark === true || row.hide_watermark === true || Number(row.hide_watermark) === 1,
    seoTitle: row.seoTitle || row.seo_title || "",
    seoDescription: row.seoDescription || row.seo_description || "",
    ogImage: row.ogImage || row.og_image || "",
    deployedSize: Number(row.deployedSize ?? row.deployed_size ?? row.storage_size ?? 0),
    createdAt: row.created_at ? { $date: new Date(row.created_at).getTime() } : undefined,
    updatedAt: row.updated_at ? { $date: new Date(row.updated_at).getTime() } : undefined
  };
}

export type SiteFunction = {
  functionId: string;
  kind?: "user" | "system" | "site";
  runtime?: string;
  websiteId?: string | null;
  name: string;
  slug: string;
  status?: string;
  publishedVersion: number | null;
  invokeUrl: string | null;
  routes?: string[];
  triggers?: string[];
  timerName?: string | null;
  editable?: boolean;
  createdAt?: string;
  updatedAt?: string;
  aliases?: Array<{ alias: string; version: number }>;
  env?: string;
  limits?: {
    timeoutMs?: number;
    memoryLimitBytes?: number;
    maxBodyBytes?: number;
    maxResponseBytes?: number;
    maxCodeBytes?: number;
    maxInvocationsPerMinute?: number;
  };
};

export const functionsApi = {
  baseUrl: FUNCTIONS_API_URL,
  list: (websiteId: string, init?: RequestOptions) => request<{ success: boolean; functions: SiteFunction[]; websiteId: string }>(
    FUNCTIONS_API_URL,
    scopedFunctionPath(websiteId, "/functions"),
    { method: "GET", ...init }
  ),
  listSystem: (host: string) => request<{ success: boolean; functions: SiteFunction[] }>(
    FUNCTIONS_API_URL,
    `/functions?kind=system&host=${encodeURIComponent(host)}`,
    { method: "GET" }
  ),
  create: (websiteId: string, name: string, slug: string, options?: {
    runtime?: string;
    routes?: string[];
    triggers?: string[];
    timerName?: string;
    limits?: SiteFunction["limits"];
  }) => request<{ success: boolean; function: SiteFunction }>(
    FUNCTIONS_API_URL,
    scopedFunctionPath(websiteId, "/functions"),
    { method: "POST", body: { websiteId, name, slug, ...options } }
  ),
  getEnv: (websiteId: string) => request<{ success: boolean; websiteId: string; env: Record<string, string> }>(
    FUNCTIONS_API_URL,
    scopedFunctionPath(websiteId, "/env"),
    { method: "GET" }
  ),
  putEnv: (websiteId: string, env: Record<string, string>) => request<{ success: boolean; websiteId: string; env: Record<string, string> }>(
    FUNCTIONS_API_URL,
    scopedFunctionPath(websiteId, "/env"),
    { method: "POST", body: { env } }
  ),
  getFunctionEnv: (functionId: string) => request<{ success: boolean; functionId: string; env: Record<string, string> }>(
    FUNCTIONS_API_URL,
    `/functions/${functionId}/env`,
    { method: "GET" }
  ),
  putFunctionEnv: (functionId: string, env: Record<string, string>) => request<{ success: boolean; functionId: string; env: Record<string, string> }>(
    FUNCTIONS_API_URL,
    `/functions/${functionId}/env`,
    { method: "POST", body: { env } }
  ),
  listAliases: (functionId: string) => request<{ success: boolean; aliases: Array<{ alias: string; version: number }> }>(
    FUNCTIONS_API_URL,
    `/functions/${functionId}/aliases`,
    { method: "GET" }
  ),
  setAlias: (functionId: string, alias: string, version: number) => request<{ success: boolean; alias: { alias: string; version: number } }>(
    FUNCTIONS_API_URL,
    `/functions/${functionId}/aliases/${encodeURIComponent(alias)}`,
    { method: "POST", body: { version } }
  ),
  deleteAlias: (functionId: string, alias: string) => request<{ success: boolean; alias: string; deleted: boolean }>(
    FUNCTIONS_API_URL,
    `/functions/${functionId}/aliases/${encodeURIComponent(alias)}`,
    { method: "DELETE" }
  ),
  listVersions: (functionId: string) => request<{ success: boolean; versions: Array<{
    version: number;
    status: string;
    sha256?: string;
    sizeBytes?: number;
    createdAt?: string;
  }> }>(FUNCTIONS_API_URL, `/functions/${functionId}/versions`, { method: "GET" }),
  createVersion: (functionId: string, source: string) => request<{ success: boolean; version: {
    version: number;
    status: string;
  } }>(FUNCTIONS_API_URL, `/functions/${functionId}/versions`, { method: "POST", body: { source } }),
  publish: (functionId: string, version: number) => request<{ success: boolean; function: {
    functionId: string;
    publishedVersion: number | null;
    invokeUrl: string;
  } }>(FUNCTIONS_API_URL, `/functions/${functionId}/publish`, { method: "POST", body: { version } }),
  getSource: (functionId: string, version?: number) => request<{
    success: boolean;
    functionId: string;
    version: number;
    source: string;
  }>(
    FUNCTIONS_API_URL,
    `/functions/${functionId}/source${version ? `?version=${encodeURIComponent(String(version))}` : ""}`,
    { method: "GET" }
  ),
  invoke: async (functionId: string, payload: unknown) => {
    const token = tokenManager.get();
    const response = await fetch(`${FUNCTIONS_API_URL}/functions/${functionId}/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload ?? {})
    });
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: text };
    }
  }
};

// 获取当前用户
export function getCurrentUser() {
  return userManager.get();
}

export default {
  auth: authApi,
  website: websiteApi,
  functions: functionsApi,
  token: tokenManager,
  user: userManager,
  isLoggedIn,
  getCurrentUser
};
