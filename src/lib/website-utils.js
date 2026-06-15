/**
 * website-utils
 * 站点相关的纯工具函数（无状态、无副作用），从 pages/home.jsx 抽离以便复用与测试。
 */

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
export const formatTimestamp = (ts) => {
  if (!ts) return "";
  // 兼容映射层的 { $date: number } 形态
  if (ts && typeof ts === "object" && "$date" in ts) {
    ts = ts.$date;
  }
  const d =
    ts instanceof Date
      ? ts
      : typeof ts === "number"
      ? new Date(ts)
      : new Date(String(ts));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
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
 * 返回站点的域名列表(最多 2 个):
 *   - 自定义前缀 <subdomain>.demox.site(可选，优先展示)
 *   - 默认域名 <websiteId 小写>.demox.site(始终存在)
 * 每项 { host, url, isDefault }。
 */
export const getSiteDomains = (w) => {
  if (!w) return [];
  const list = [];
  const sub = (w.subdomain || "").trim();
  if (sub && sub !== "undefined") {
    const host = `${sub}.demox.site`;
    list.push({ host, url: `https://${host}/`, isDefault: false });
  }
  const wid = (w.websiteId || "").trim();
  if (wid && wid !== "undefined") {
    const host = `${wid.toLowerCase()}.demox.site`;
    list.push({ host, url: `https://${host}/`, isDefault: true });
  }
  return list;
};
