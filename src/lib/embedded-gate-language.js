/**
 * 嵌入式私有站点登录门（/site-auth?embedded=1）整页只用一种语言。
 *
 * 登录门 iframe 由边缘函数拼出来，目前没有语言参数，页内标题又写死中文，
 * 表单却跟着 localStorage / 浏览器，中英会混在同一屏。
 * `lang=zh|en` 或 `/zh/site-auth` 定死这一页的语言，并且盖过 www 上记住的 app_language。
 * 边缘函数要在 iframe 地址上带上 lang；这一侧先认这个参数。
 */

/**
 * @param {{ pathname?: string, search?: string, stored?: string | null, navigatorLanguage?: string }} input
 * @returns {"zh" | "en"}
 */
export function readPageLanguage({
  pathname = "",
  search = "",
  stored = null,
  navigatorLanguage = ""
} = {}) {
  const query = readLangParam(search);
  if (query) return query;
  if (pathname === "/zh" || pathname.startsWith("/zh/")) return "zh";
  if (stored === "zh" || stored === "en") return stored;
  if (String(navigatorLanguage || "").toLowerCase().startsWith("zh")) return "zh";
  return "en";
}

/**
 * `lang` 查询参数是这一页的显式语言。不要写回 app_language，
 * 否则看一次私有站点会把 www 的语言偏好改掉。
 * @param {string} search
 */
export function pageLanguageIsExplicit(search) {
  return readLangParam(search) !== null;
}

/**
 * @param {string} search
 * @returns {"zh" | "en" | null}
 */
function readLangParam(search) {
  const raw = String(search || "");
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  const lang = new URLSearchParams(query).get("lang");
  if (lang === "zh" || lang === "en") return lang;
  return null;
}

const COPY = {
  zh: {
    title: "登录后查看私有项目",
    description: (host) => `登录 Demox 以继续访问 ${host}`,
    pill: (host) => `${host} 是私有项目`,
    email: "邮箱",
    code: "验证码",
    codePlaceholder: "6位验证码",
    sendCode: "发送验证码",
    password: "密码",
    passwordPlaceholder: "请输入密码",
    agreePrefix: "我已阅读并同意",
    terms: "《服务条款》",
    and: "和",
    privacy: "《隐私政策》",
    loginOrSignup: "登录 / 注册",
    login: "登录",
    or: "或",
    github: "使用 GitHub 继续",
    feishu: "使用飞书继续",
    usePassword: "用密码登录",
    useCode: "用验证码登录"
  },
  en: {
    title: "Sign in to view this private project",
    description: (host) => `Sign in to Demox to continue to ${host}`,
    pill: (host) => `${host} is a private project`,
    email: "Email",
    code: "Verification code",
    codePlaceholder: "6-digit code",
    sendCode: "Send code",
    password: "Password",
    passwordPlaceholder: "Enter your password",
    agreePrefix: "I have read and agree to the",
    terms: "Terms of Service",
    and: "and",
    privacy: "Privacy Policy",
    loginOrSignup: "Log in / Sign up",
    login: "Log in",
    or: "or",
    github: "Continue with GitHub",
    feishu: "Continue with Feishu",
    usePassword: "Log in with password",
    useCode: "Log in with a verification code"
  }
};

/**
 * @param {string} language
 */
export function embeddedGateCopy(language) {
  return language === "en" ? COPY.en : COPY.zh;
}

/** 表单文案。标题和顶栏带 host，不进 AuthDialog 的字符串表。 */
export function embeddedGateFormCopy(copy) {
  return {
    email: copy.email,
    code: copy.code,
    codePlaceholder: copy.codePlaceholder,
    sendCode: copy.sendCode,
    password: copy.password,
    passwordPlaceholder: copy.passwordPlaceholder,
    agreePrefix: copy.agreePrefix,
    terms: copy.terms,
    and: copy.and,
    privacy: copy.privacy,
    loginOrSignup: copy.loginOrSignup,
    login: copy.login,
    or: copy.or,
    github: copy.github,
    feishu: copy.feishu,
    usePassword: copy.usePassword,
    useCode: copy.useCode
  };
}

/** 中文同意文案中间不插空格，英文则要空格。 */
export function embeddedGateAgreement(language) {
  const copy = embeddedGateCopy(language);
  if (language === "en") {
    return `${copy.agreePrefix} ${copy.terms} ${copy.and} ${copy.privacy}`;
  }
  return `${copy.agreePrefix}${copy.terms}${copy.and}${copy.privacy}`;
}
