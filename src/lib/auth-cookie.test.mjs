// 2026-10-10：账号令牌不再写 cookie（旧版本写在 Domain=.demox.site，所有用户子域都能读）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../api.ts", import.meta.url), "utf8");

test("api.ts never writes demox_access with a value", () => {
  const writes = [...api.matchAll(/document\.cookie\s*=\s*`([^`]*)`/g)].map((m) => m[1]);
  assert.ok(writes.length >= 2);
  for (const w of writes) {
    assert.match(w, /^\$\{AUTH_COOKIE_KEY\}=; Max-Age=0; Path=\//, w);
  }
  assert.doesNotMatch(api, /setAuthCookie|encodeURIComponent\(token\)/);
});

test("api.ts expires both the parent-domain and host-only cookie, at startup and in login/logout", () => {
  assert.match(api, /Max-Age=0; Path=\/; Domain=\.\$\{domain\}\$\{secure\}; SameSite=Lax/);
  assert.match(api, /Max-Age=0; Path=\/\$\{secure\}; SameSite=Lax/);
  assert.match(api, /^clearLegacyAuthCookie\(\);$/m);
  const tm = api.slice(api.indexOf("export const tokenManager"), api.indexOf("export const userManager"));
  assert.equal((tm.match(/clearLegacyAuthCookie\(\)/g) || []).length, 2);
  assert.match(tm, /localStorage\.setItem\(TOKEN_KEY, token\)/);
});

test("simulated browser: startup clears the legacy cookie in both scopes", async () => {
  const writes = [];
  const fn = new Function("document", "window", "OFFICIAL_DOMAINS", `
    const AUTH_COOKIE_KEY = "demox_access";
    ${api.slice(api.indexOf("function getCookieDomain"), api.indexOf("// 启动时清一次")).replace("export function", "function").replace(/: string/g, "")}
    clearLegacyAuthCookie();`);
  fn({ set cookie(v) { writes.push(v); } }, { location: { hostname: "www.demox.site", protocol: "https:" } }, ["demox.site"]);
  assert.deepEqual(writes, [
    "demox_access=; Max-Age=0; Path=/; Domain=.demox.site; Secure; SameSite=Lax",
    "demox_access=; Max-Age=0; Path=/; Secure; SameSite=Lax"
  ]);
});
