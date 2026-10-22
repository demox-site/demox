import assert from "node:assert/strict";
import test from "node:test";
import {
  EMBEDDED_LOGIN_MODE_KEY,
  LOGIN_FORM_SINK_NAME,
  keepEmbeddedLoginModeOnSubmit,
  loginFormSubmitTarget,
  loginFormTargetKeepsDocument,
  readEmbeddedLoginMode,
  writeEmbeddedLoginMode
} from "./embedded-login-mode.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

test("embedded login defaults to verification-code mode", () => {
  assert.equal(readEmbeddedLoginMode(null), "code");
  assert.equal(readEmbeddedLoginMode(memoryStorage()), "code");
});

test("password mode survives a remount the way the embedded gate reloads", () => {
  const storage = memoryStorage();
  assert.equal(readEmbeddedLoginMode(storage), "code");

  writeEmbeddedLoginMode(storage, "password");
  // 登录门把 iframe 文档换掉之后，新的 AuthDialog 只能从 sessionStorage 读回模式。
  assert.equal(readEmbeddedLoginMode(storage), "password");
  assert.equal(storage.getItem(EMBEDDED_LOGIN_MODE_KEY), "password");
});

test("switching back to verification code forgets the password choice", () => {
  const storage = memoryStorage();
  writeEmbeddedLoginMode(storage, "password");
  writeEmbeddedLoginMode(storage, "code");
  assert.equal(readEmbeddedLoginMode(storage), "code");
  assert.equal(storage.getItem(EMBEDDED_LOGIN_MODE_KEY), null);
});

test("the first password submit keeps password mode instead of clearing it", () => {
  const storage = memoryStorage();
  writeEmbeddedLoginMode(storage, "password");
  assert.equal(keepEmbeddedLoginModeOnSubmit(storage, "password"), "password");
  assert.equal(readEmbeddedLoginMode(storage), "password");
});

test("login form cannot navigate the embedded auth document", () => {
  const props = loginFormSubmitTarget();
  assert.equal(loginFormTargetKeepsDocument(props.target, props.action), true);
  assert.equal(props.method, "post");
  assert.equal(props.target, LOGIN_FORM_SINK_NAME);

  assert.equal(loginFormTargetKeepsDocument("", "about:blank"), false);
  assert.equal(loginFormTargetKeepsDocument("_self", "about:blank"), false);
  assert.equal(loginFormTargetKeepsDocument("_top", "about:blank"), false);
  assert.equal(loginFormTargetKeepsDocument("_parent", "about:blank"), false);
  assert.equal(loginFormTargetKeepsDocument(LOGIN_FORM_SINK_NAME, ""), false);
  assert.equal(loginFormTargetKeepsDocument(LOGIN_FORM_SINK_NAME, undefined), false);
});

test("a storage that throws does not break mode reads or writes", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    }
  };
  assert.equal(readEmbeddedLoginMode(broken), "code");
  assert.doesNotThrow(() => writeEmbeddedLoginMode(broken, "password"));
  assert.equal(keepEmbeddedLoginModeOnSubmit(broken, "password"), "code");
});
