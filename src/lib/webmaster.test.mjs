import assert from "node:assert/strict";
import test from "node:test";
import { WEBMASTER_EMAIL, webmasterMailto, webmasterAccountFromUser } from "./webmaster.js";

function decodeMailto(href) {
  const query = href.slice(href.indexOf("?") + 1);
  const params = new URLSearchParams(query);
  return {
    subject: params.get("subject") || "",
    body: params.get("body") || ""
  };
}

test("mailto is a simple support request and omits payment talk", () => {
  const href = webmasterMailto({
    language: "zh",
    email: "a@b.com",
    userId: "user_1"
  });
  assert.equal(href.startsWith(`mailto:${WEBMASTER_EMAIL}?`), true);
  const { subject, body } = decodeMailto(href);
  assert.equal(subject, "Demox 技术支持");
  assert.match(body, /技术支持/);
  assert.match(body, /a@b\.com/);
  assert.match(body, /user_1/);
  assert.doesNotMatch(`${subject}\n${body}`, /转账|微信|支付宝|\d+\s*元|checkout|price|配额|水印|SEO/i);
});

test("english mailto uses the same address", () => {
  const href = webmasterMailto({ language: "en", user: { email: "dev@example.com" } });
  const { subject, body } = decodeMailto(href);
  assert.equal(subject, "Demox technical support");
  assert.match(body, /dev@example.com/);
});

test("webmasterAccountFromUser reads userId aliases", () => {
  assert.deepEqual(webmasterAccountFromUser({ email: "x@y.z", openId: "abc" }), {
    email: "x@y.z",
    userId: "abc"
  });
  assert.deepEqual(webmasterAccountFromUser(null), { email: "", userId: "" });
});
