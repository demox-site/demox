import assert from "node:assert/strict";
import test from "node:test";
import {
  embeddedGateAgreement,
  embeddedGateCopy,
  pageLanguageIsExplicit,
  readPageLanguage
} from "./embedded-gate-language.js";

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

test("lang query picks one language and beats a saved preference", () => {
  assert.equal(readPageLanguage({ search: "?embedded=1&lang=zh", stored: "en", navigatorLanguage: "en-US" }), "zh");
  assert.equal(readPageLanguage({ search: "lang=en", stored: "zh", navigatorLanguage: "zh-CN" }), "en");
  assert.equal(pageLanguageIsExplicit("?lang=zh"), true);
  assert.equal(pageLanguageIsExplicit("?embedded=1"), false);
  assert.equal(readPageLanguage({ search: "?lang=fr", stored: "en" }), "en");
});

test("/zh/site-auth is Chinese even without a lang query", () => {
  assert.equal(readPageLanguage({
    pathname: "/zh/site-auth",
    search: "?embedded=1",
    stored: "en",
    navigatorLanguage: "en-US"
  }), "zh");
});

test("without an explicit language, one fallback is used for the whole page", () => {
  assert.equal(readPageLanguage({ stored: "zh", navigatorLanguage: "en-US" }), "zh");
  assert.equal(readPageLanguage({ stored: null, navigatorLanguage: "zh-CN" }), "zh");
  assert.equal(readPageLanguage({ stored: null, navigatorLanguage: "en-US" }), "en");
});

test("Chinese embedded gate uses the review copy and does not mix in English labels", () => {
  const copy = embeddedGateCopy("zh");
  assert.equal(copy.email, "邮箱");
  assert.equal(copy.code, "验证码");
  assert.equal(copy.sendCode, "发送验证码");
  assert.equal(copy.loginOrSignup, "登录 / 注册");
  assert.equal(copy.or, "或");
  assert.equal(copy.github, "使用 GitHub 继续");
  assert.equal(copy.feishu, "使用飞书继续");
  assert.equal(copy.usePassword, "用密码登录");
  assert.equal(embeddedGateAgreement("zh"), "我已阅读并同意《服务条款》和《隐私政策》");
  assert.equal(copy.pill("jbagdduf.demox.site"), "jbagdduf.demox.site 是私有项目");
  assert.match(copy.description("jbagdduf.demox.site"), /^登录 Demox 以继续访问 /);
});

test("English embedded gate has no Chinese", () => {
  const copy = embeddedGateCopy("en");
  const texts = Object.values(copy).map((value) => (typeof value === "function" ? value("jbagdduf.demox.site") : value));
  texts.push(embeddedGateAgreement("en"));
  for (const text of texts) {
    assert.equal(CJK.test(text), false, text);
  }
  assert.equal(copy.github, "Continue with GitHub");
  assert.equal(copy.feishu, "Continue with Feishu");
  assert.equal(copy.pill("jbagdduf.demox.site"), "jbagdduf.demox.site is a private project");
});
