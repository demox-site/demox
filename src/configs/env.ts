function readEnv(name: string): string {
  const value = import.meta.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function currentOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin.replace(/\/+$/, "");
}

function withTrailingSlash(value: string): string {
  const clean = value.trim().replace(/\/+$/, "");
  return clean ? `${clean}/` : "/";
}

const apiRoot = readEnv("VITE_DEMOX_API_URL").replace(/\/+$/, "");
const siteId = readEnv("VITE_DEMOX_SITE_ID");
const functionEnv = readEnv("VITE_DEMOX_FUNCTION_ENV") || "production";
const apiUrl = siteId ? `${apiRoot}/${siteId}/${functionEnv}` : apiRoot;
const authApiUrl = (readEnv("VITE_DEMOX_AUTH_API_URL") || apiUrl).replace(/\/+$/, "");
const websiteApiUrl = (readEnv("VITE_DEMOX_WEBSITE_API_URL") || apiUrl).replace(/\/+$/, "");
const functionsApiUrl = (() => {
  const raw = (readEnv("VITE_DEMOX_FUNCTIONS_URL") || apiRoot).replace(/\/+$/, "");
  try {
    return new URL(raw).origin;
  } catch {
    return apiRoot;
  }
})();
if (!authApiUrl || !websiteApiUrl) {
  throw new Error("Missing required environment variable: VITE_DEMOX_API_URL");
}
const siteUrl = readEnv("VITE_DEMOX_SITE_URL") || currentOrigin();
const feishuRedirectUri = readEnv("VITE_FEISHU_REDIRECT_URI");

export const siteConfig = {
  name: "Demox",
  version: "0.9.2",
  domain: readEnv("VITE_DEMOX_SITE_DOMAIN") || (typeof window !== "undefined" ? window.location.hostname : ""),
  url: withTrailingSlash(siteUrl)
};

// API endpoints are configured by environment variables so rollbacks only change env.
const config = {
  authApiUrl,
  websiteApiUrl,
  functionsApiUrl,
  functionEnv,
  // GitHub OAuth - client_id 为公开值；client_secret 仅在 SCF 后端环境变量中
  github: {
    clientId: "Ov23liHBClIIlop9S6mP",
    // 回调走真实路径（非 hash），由 index.html 启动脚本改写成 hash 路由
    redirectUri: `${siteConfig.url.replace(/\/$/, "")}/github-callback`,
    scope: "read:user user:email"
  },
  feishu: {
    clientId: readEnv("VITE_FEISHU_APP_ID"),
    // Feishu custom apps are confidential clients; token exchange is protected by App Secret.
    usePkce: false,
    redirectUri:
      feishuRedirectUri || `${siteConfig.url.replace(/\/$/, "")}/feishu-callback`
  },
  site: siteConfig
};

export default config;
