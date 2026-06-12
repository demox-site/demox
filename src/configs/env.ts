export const siteConfig = {
  name: "Demox",
  version: "0.7.7",
  domain: "www.demox.site",
  url: "https://www.demox.site/"
};

// API配置 - SCF HTTP触发器URL
const config = {
  // Auth API (SCF HTTP触发器)
  authApiUrl: "https://1307257815-le6wrbbwdx.ap-guangzhou.tencentscf.com",
  // Website API (SCF HTTP触发器)
  websiteApiUrl: "https://1307257815-3empxtnzn9.ap-guangzhou.tencentscf.com",
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
