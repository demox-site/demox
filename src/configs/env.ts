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

const apiUrl = readEnv("VITE_DEMOX_API_URL").replace(/\/+$/, "");
const authApiUrl = (readEnv("VITE_DEMOX_AUTH_API_URL") || apiUrl).replace(/\/+$/, "");
const websiteApiUrl = (readEnv("VITE_DEMOX_WEBSITE_API_URL") || apiUrl).replace(/\/+$/, "");
if (!authApiUrl || !websiteApiUrl) {
  throw new Error("Missing required environment variable: VITE_DEMOX_API_URL");
}
const siteUrl = readEnv("VITE_DEMOX_SITE_URL") || currentOrigin();

export const siteConfig = {
  name: "Demox",
  version: "0.9.1",
  domain: readEnv("VITE_DEMOX_SITE_DOMAIN") || (typeof window !== "undefined" ? window.location.hostname : ""),
  url: withTrailingSlash(siteUrl)
};

// API endpoints are configured by environment variables so rollbacks only change env.
const config = {
  authApiUrl,
  websiteApiUrl,
  // GitHub OAuth - client_id 为公开值；client_secret 仅在 SCF 后端环境变量中
  github: {
    clientId: "Ov23liHBClIIlop9S6mP",
    // 回调走真实路径（非 hash），由 index.html 启动脚本改写成 hash 路由
    redirectUri: `${siteConfig.url.replace(/\/$/, "")}/github-callback`,
    scope: "read:user user:email"
  },
  site: siteConfig
};

export default config;
