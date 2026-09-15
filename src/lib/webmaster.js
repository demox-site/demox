/**
 * 站长联系入口。公开页面只说欢迎联系，不解释套餐和收款。
 */

export const WEBMASTER_EMAIL = "phosa@qq.com";

export function webmasterAccountFromUser(user) {
  if (!user || typeof user !== "object") return { email: "", userId: "" };
  return {
    email: String(user.email || "").trim(),
    userId: String(user.userId || user.openId || user.id || "").trim()
  };
}

export function webmasterMailto({
  language = "zh",
  email = "",
  userId = "",
  user = null
} = {}) {
  const account = webmasterAccountFromUser(user);
  const mail = String(email || account.email || "").trim();
  const uid = String(userId || account.userId || "").trim();
  const zh = language !== "en";
  const subject = zh ? "Demox 技术支持" : "Demox technical support";
  const lines = zh
    ? ["你好，需要一些技术支持。"]
    : ["Hi, I could use some technical support."];
  if (mail) lines.push(zh ? `登录邮箱：${mail}` : `Account email: ${mail}`);
  if (uid) lines.push(zh ? `用户 ID：${uid}` : `User ID: ${uid}`);
  return `mailto:${WEBMASTER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

export function openWebmasterMail(options) {
  const href = webmasterMailto(options);
  if (typeof window !== "undefined") window.location.href = href;
  return href;
}
