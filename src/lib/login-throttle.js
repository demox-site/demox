// 登录限速（后端 429 LOGIN_THROTTLED）前端共用逻辑：剩余时间换算与提示文案。

/** 剩余时间：1 分钟以上按分钟向上取整，不到 1 分钟按秒（至少 1 秒）。 */
export function throttleWaitParts(msLeft) {
  const s = Math.max(1, Math.ceil(msLeft / 1000));
  return s >= 60 ? [Math.ceil(s / 60), "m"] : [s, "s"];
}

const MESSAGES = {
  zh: (n, unit) => `登录尝试次数过多，请 ${n} ${unit === "m" ? "分钟" : "秒"}后再试。`,
  en: (n, unit) => {
    const word = unit === "m" ? (n === 1 ? "minute" : "minutes") : n === 1 ? "second" : "seconds";
    return `Too many sign-in attempts. Try again in ${n} ${word}.`;
  }
};

export function throttleMessage(msLeft, lang = "zh") {
  const [n, unit] = throttleWaitParts(msLeft);
  return (MESSAGES[lang] || MESSAGES.zh)(n, unit);
}
