import { supportedOfficialBinding } from "./official-domains";

/**
 * website-utils
 * 站点相关的纯工具函数（无状态、无副作用），从 pages/home.jsx 抽离以便复用与测试。
 */

const PRO_AND_ABOVE_ROLES = new Set(["pro", "admin"]);

/**
 * hasProOrAboveRole
 * 专业用户及以上（pro / admin）才开放站点分析、隐藏水印、SEO 等能力。
 */
export const hasProOrAboveRole = (roles) =>
  Array.isArray(roles) &&
  roles.some((role) => PRO_AND_ABOVE_ROLES.has(String(role || "").trim().toLowerCase()));

/**
 * isTokenExpiredError
 * 判断错误是否为凭证过期相关（ACCESS_TOKEN_EXPIRED / invalid_grant 4026）
 */
export const isTokenExpiredError = (error) => {
  const code = error?.code || error?.error_code;
  const msg = error?.message || error?.msg || error?.error_description || "";
  return (
    code === "ACCESS_TOKEN_EXPIRED" ||
    code === 4026 ||
    String(msg).includes("ACCESS_TOKEN_EXPIRED") ||
    String(msg).includes("invalid_grant") ||
    String(msg).includes("invalid refresh token")
  );
};

/**
 * sanitizeFileName
 * 对文件名进行安全清洗，替换云存储不支持的字符，避免上传失败
 */
export const sanitizeFileName = (name) =>
  String(name).replace(/[^0-9a-zA-Z/_\-\.\s一-龥]/g, "_");

/**
 * parseTags
 * 解析逗号分隔（中英文逗号）的标签字符串为去重后的标签数组
 */
export const parseTags = (str) => {
  if (!str) return [];
  const arr = String(str)
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Array.from(new Set(arr));
};

/**
 * joinTags
 * 将标签数组拼接为逗号分隔的字符串
 */
export const joinTags = (tags) => (Array.isArray(tags) ? tags : []).join(", ");


/**
 * generateWebsiteId
 * 生成 8 位由大写字母与数字组成的随机字符串，满足域名片段要求
 */
export const generateWebsiteId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
};

/**
 * formatTimestamp
 * 将时间戳或日期对象格式化为精确到秒的本地时间字符串
 */
export const toMillis = (ts) => {
  if (!ts && ts !== 0) return 0;
  let value = ts;
  if (value && typeof value === "object" && "$date" in value) {
    value = value.$date;
  }
  const d =
    value instanceof Date
      ? value
      : typeof value === "number"
      ? new Date(value)
      : new Date(String(value));
  const ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

export const formatTimestamp = (ts) => {
  const ms = toMillis(ts);
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
};

export const formatRelativeTime = (ts, lang = "zh", now = Date.now()) => {
  const ms = toMillis(ts);
  if (!ms) return "";
  const delta = Math.max(0, now - ms);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const zh = lang === "zh";
  if (delta < minute) return zh ? "刚刚" : "just now";
  if (delta < hour) {
    const n = Math.floor(delta / minute);
    return zh ? `${n} 分钟前` : `${n}m ago`;
  }
  if (delta < day) {
    const n = Math.floor(delta / hour);
    return zh ? `${n} 小时前` : `${n}h ago`;
  }
  if (delta < 7 * day) {
    const n = Math.floor(delta / day);
    return zh ? `${n} 天前` : `${n}d ago`;
  }
  return new Date(ms).toLocaleDateString(zh ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
};

/**
 * getComparableTimestamp
 * 提取用于排序的时间戳（优先使用 updatedAt，其次 createdAt）
 */
export const getComparableTimestamp = (w) => {
  let v = w?.updatedAt || w?.createdAt || 0;
  // 兼容映射层的 { $date: number } 形态
  if (v && typeof v === "object" && "$date" in v) {
    v = v.$date;
  }
  const d =
    v instanceof Date
      ? v
      : typeof v === "number"
      ? new Date(v)
      : new Date(String(v));
  return Number(d.getTime() || 0);
};

/**
 * getDisplayName
 * 站点显示名称：优先 name（部署时已写入 <title> 或文件名）；
 * 其次文件名；都没有则“未命名网站”。websiteId 不再作为名称回退——它单独以小字显示。
 */
export const getDisplayName = (w) => {
  if (!w) return "";
  const n = (w.name || "").trim();
  if (n && n !== "undefined") return n;
  const fn = (w.fileName || "").trim();
  if (fn && fn !== "undefined") return fn;
  return "未命名网站";
};

/**
 * getSiteDomains
 * 返回站点的域名列表:
 *   - 项目自定义域名(优先)
 *   - 官方前缀 <subdomain>.<official-domain>
 *   - 默认域名 <websiteId 小写>.demox.site
 * 每项 { host, url, isDefault }。
 */
export const getSiteDomains = (w) => {
  if (!w) return [];
  const list = [];
  const seen = new Set();
  const push = (host, isDefault) => {
    const clean = String(host || "").trim().toLowerCase().replace(/\/+$/, "");
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    list.push({ host: clean, url: `https://${clean}/`, isDefault });
  };
  const customHosts = w.customHosts || w.custom_hosts || [];
  (Array.isArray(customHosts) ? customHosts : []).forEach((host) => push(host, false));
  const binding = supportedOfficialBinding(w.subdomain, w.subdomainDomain || w.subdomain_domain);
  if (binding.subdomain) {
    push(`${binding.subdomain}.${binding.subdomainDomain}`, false);
  }
  const wid = (w.websiteId || "").trim();
  if (wid && wid !== "undefined") {
    push(`${wid.toLowerCase()}.demox.site`, true);
  }
  return list;
};

export const getPrimaryDomain = (w) => getSiteDomains(w)[0] || null;

export const isSiteBusy = (website, deploying = {}) =>
  Boolean(
    website &&
      (website.status === "processing" || deploying[website._id] || deploying[website.websiteId])
  );
