import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizationCodeCallback,
  buildMcpLoginUrl,
  buildOAuthErrorCallback,
  completeMcpAuthorization,
  loadThirdPartyClient,
  parseMcpOAuthRequest,
  readOAuthSearchParams,
  redirectUriAllowed,
  toOAuthAuthorizePayload
} from "./mcp-oauth.js";

const request = {
  client_id: "demox-mcp-client",
  redirect_uri: "http://localhost:39897/callback",
  response_type: "code",
  state: "state-with-at-least-16",
  scope: "website:deploy website:list",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256"
};

function params(overrides = {}) {
  return new URLSearchParams({ ...request, ...overrides });
}

test("parses hash and search OAuth requests and keeps PKCE on the login URL", () => {
  const fromSearch = parseMcpOAuthRequest(readOAuthSearchParams({ search: `?${new URLSearchParams(request)}`, hash: "" }));
  const fromHash = parseMcpOAuthRequest(readOAuthSearchParams({ search: "", hash: `#/mcp-authorize?${new URLSearchParams(request)}` }));
  assert.equal(fromSearch.ok, true);
  assert.deepEqual(fromSearch, fromHash);
  const loginUrl = new URL(buildMcpLoginUrl("https://www.demox.site", fromSearch.request));
  assert.equal(loginUrl.pathname, "/mcp-login");
  assert.equal(loginUrl.searchParams.get("code_challenge"), request.code_challenge);
  assert.equal(loginUrl.searchParams.get("response_type"), "code");
});

test("rejects implicit token response types and unknown redirect hosts", () => {
  const implicit = parseMcpOAuthRequest(params({ response_type: "token" }));
  assert.equal(implicit.ok, false);
  assert.match(implicit.error, /authorization code/);
  assert.equal(implicit.redirectUri, request.redirect_uri);

  const evil = parseMcpOAuthRequest(params({ redirect_uri: "http://evil.example/callback" }));
  assert.equal(evil.ok, false);
  assert.equal(evil.redirectSafe, false);
  assert.equal(redirectUriAllowed("http://localhost:39999/callback"), true);
});

test("authorization completion only redirects with a code", async () => {
  const parsed = parseMcpOAuthRequest(params());
  const callback = await completeMcpAuthorization(parsed.request, async (payload) => {
    assert.deepEqual(payload, toOAuthAuthorizePayload(parsed.request));
    assert.equal("access_token" in payload, false);
    return { code: "one-time-code" };
  });
  const url = new URL(callback);
  assert.equal(url.origin, "http://localhost:39897");
  assert.equal(url.searchParams.get("code"), "one-time-code");
  assert.equal(url.searchParams.get("state"), request.state);
  assert.equal(url.searchParams.get("access_token"), null);
  assert.match(
    buildOAuthErrorCallback(request.redirect_uri, "invalid_request", "缺少有效的 OAuth PKCE 参数", request.state),
    /error=invalid_request/
  );
});


// ---------- third-party clients (funx-console) ----------

const funx = {
  client_id: "funx-console",
  redirect_uri: "https://funx.site/console/auth/demox/callback",
  response_type: "code",
  state: "funx-state-0123456789",
  scope: "identity",
  code_challenge: "b".repeat(43),
  code_challenge_method: "S256"
};

test("third-party client parses without a hardcoded client id, but is never redirect-safe before the server check", () => {
  const parsed = parseMcpOAuthRequest(new URLSearchParams(funx));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.request.official, false);
  assert.equal(parsed.request.clientId, "funx-console");
  assert.equal(parsed.request.scope, "identity");
  const official = parseMcpOAuthRequest(params());
  assert.equal(official.request.official, true);
  const badState = parseMcpOAuthRequest(new URLSearchParams({ ...funx, state: "short" }));
  assert.equal(badState.ok, false);
  assert.equal(badState.redirectSafe, false);
});

test("third-party client still needs PKCE S256, https redirect and an explicit scope", () => {
  for (const o of [{ code_challenge: "" }, { code_challenge_method: "plain" }, { redirect_uri: "http://funx.site/cb" }, { redirect_uri: "https://funx.site/cb#x" }, { scope: "" }, { client_id: "bad id!" }]) {
    assert.equal(parseMcpOAuthRequest(new URLSearchParams({ ...funx, ...o })).ok, false, JSON.stringify(o));
  }
});

test("loadThirdPartyClient returns the server's client name and rejects mismatches", async () => {
  const { request: r } = parseMcpOAuthRequest(new URLSearchParams(funx));
  let sent;
  const info = await loadThirdPartyClient(r, async (p) => { sent = p; return { success: true, client_id: "funx-console", client_name: "Funx", scopes: ["identity"] }; });
  assert.deepEqual(sent, { client_id: "funx-console", redirect_uri: funx.redirect_uri, scope: "identity" });
  assert.equal(info.name, "Funx");
  await assert.rejects(loadThirdPartyClient(r, async () => ({ success: true, client_id: "other", client_name: "X" })));
  await assert.rejects(loadThirdPartyClient(r, async () => { throw new Error("400"); }));
});
