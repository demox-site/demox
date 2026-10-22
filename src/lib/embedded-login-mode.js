/**
 * 嵌入式私有站点登录门（/site-auth?embedded=1）的密码/验证码模式。
 *
 * AuthDialog 的 loginMode 默认是 "code"，只活在这次挂载里。
 * 登录表单如果按浏览器默认方式提交（GET 当前地址），会把 iframe 里的
 * 登录文档换成新的一页，组件重新挂上，模式被打回验证码；第一次密码提交
 * 因此登不进去，用户再交一次才成功。
 * 交接成功后若顶层又回到登录门，同样是一次整页重挂。
 * 把用户选过的模式放进本页 sessionStorage，重挂后仍是密码登录。
 */

export const EMBEDDED_LOGIN_MODE_KEY = "demox_embedded_login_mode";

/** 登录表单的原生提交打进这个隐藏 iframe，不能替换当前登录文档。 */
export const LOGIN_FORM_SINK_NAME = "demox-login-sink";

/**
 * @param {Pick<Storage, "getItem"> | null | undefined} storage
 * @returns {"password" | "code"}
 */
export function readEmbeddedLoginMode(storage) {
  if (!storage) return "code";
  try {
    return storage.getItem(EMBEDDED_LOGIN_MODE_KEY) === "password" ? "password" : "code";
  } catch {
    return "code";
  }
}

/**
 * @param {Pick<Storage, "setItem" | "removeItem"> | null | undefined} storage
 * @param {"password" | "code"} mode
 */
export function writeEmbeddedLoginMode(storage, mode) {
  if (!storage) return;
  try {
    if (mode === "password") storage.setItem(EMBEDDED_LOGIN_MODE_KEY, "password");
    else storage.removeItem(EMBEDDED_LOGIN_MODE_KEY);
  } catch {
    // 隐私模式写不进 sessionStorage 时，至少这次挂载里的 state 还在。
  }
}

/**
 * 提交本身不能把已记住的密码模式清掉。
 * 清掉的话，登录门被重挂时又会回到验证码。
 * @param {Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined} storage
 * @param {"password" | "code"} mode
 * @returns {"password" | "code"}
 */
export function keepEmbeddedLoginModeOnSubmit(storage, mode) {
  writeEmbeddedLoginMode(storage, mode);
  return readEmbeddedLoginMode(storage);
}

/**
 * 登录表单的 method/action/target。
 * action 留空时浏览器会 GET 当前 /site-auth 地址，iframe 整页重载。
 * 指向 _self / _top / _parent 也会换掉登录文档或外层私有站点。
 * @returns {{ method: "post", action: "about:blank", target: string }}
 */
export function loginFormSubmitTarget() {
  return {
    method: "post",
    action: "about:blank",
    target: LOGIN_FORM_SINK_NAME
  };
}

/**
 * @param {string | null | undefined} target
 * @param {string | null | undefined} action
 */
export function loginFormTargetKeepsDocument(target, action) {
  if (action !== "about:blank") return false;
  if (!target || target === "_self" || target === "_top" || target === "_parent") return false;
  return target === LOGIN_FORM_SINK_NAME;
}
