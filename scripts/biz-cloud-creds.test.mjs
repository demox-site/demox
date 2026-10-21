import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "scf-code/website-api/index.js",
  "scf-code/website-api/shared/buckets.js",
  "scf-code/cert-renew/index.js",
  "scf-deploy-packages/auth-api/index.cjs"
];
const blockOf = (p) => {
  const s = readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const m = s.match(/\/\/ <biz-cloud-creds>[\s\S]*?\/\/ <\/biz-cloud-creds>\n/);
  assert.ok(m, `${p} 缺少 biz-cloud-creds 块`);
  return m[0];
};
const BLOCK = blockOf(FILES[0]);
const { readBizCloudCreds, requireBizCloudCreds } = new Function("process", `${BLOCK}; return { readBizCloudCreds, requireBizCloudCreds };`)({ env: {} });

test("biz-cloud-creds block is byte-identical in every business entry", () => {
  for (const p of FILES.slice(1)) assert.equal(blockOf(p), BLOCK, p);
});

test("business code no longer reads TENCENTCLOUD_* outside the block", () => {
  for (const p of FILES) {
    const s = readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(BLOCK, "");
    assert.equal(/process\.env\.TENCENTCLOUD_SECRET/.test(s), false, p);
  }
});

test("prefers the business function's own DEMOX_BIZ_TC_* creds", () => {
  const c = readBizCloudCreds({ DEMOX_BIZ_TC_SECRET_ID: "bid", DEMOX_BIZ_TC_SECRET_KEY: "bkey", TENCENTCLOUD_SECRETID: "gw", TENCENTCLOUD_SECRETKEY: "gwk", TENCENTCLOUD_SESSIONTOKEN: "t" });
  assert.deepEqual(c, { secretId: "bid", secretKey: "bkey", token: "", source: "biz" });
});

test("STRICT never falls back to the gateway runtime-role creds", () => {
  const env = { DEMOX_BIZ_CREDS_STRICT: "1", TENCENTCLOUD_SECRETID: "gw", TENCENTCLOUD_SECRETKEY: "gwk", TENCENTCLOUD_SESSIONTOKEN: "t" };
  assert.equal(readBizCloudCreds(env), null);
  assert.throws(() => requireBizCloudCreds(env), /STRICT/);
});

test("non-strict keeps today's legacy behaviour (zero change for live v19/v3)", () => {
  const c = readBizCloudCreds({ TENCENTCLOUD_SECRETID: "gw", TENCENTCLOUD_SECRETKEY: "gwk", TENCENTCLOUD_SESSIONTOKEN: "t" });
  assert.equal(c.source, "legacy");
  assert.equal(c.token, "t");
});

test("half-configured business creds is an error, not a silent fallback", () => {
  assert.throws(() => readBizCloudCreds({ DEMOX_BIZ_TC_SECRET_ID: "x", TENCENTCLOUD_SECRETID: "gw", TENCENTCLOUD_SECRETKEY: "gwk" }), /同时配置/);
});
