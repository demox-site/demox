export const siteConfig = {
  name: "Demox",
  version: "0.7.7",
  domain: "demox.site",
  url: "https://demox.site/"
};

// API配置 - SCF HTTP触发器URL
const config = {
  // Auth API (SCF HTTP触发器)
  authApiUrl: "https://1307257815-le6wrbbwdx.ap-guangzhou.tencentscf.com",
  // Website API (SCF HTTP触发器)
  websiteApiUrl: "https://1307257815-3empxtnzn9.ap-guangzhou.tencentscf.com",
  site: siteConfig
};

export default config;
