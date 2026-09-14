import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizationCodeCallback,
  buildMcpLoginUrl,
  buildOAuthErrorCallback,
  completeMcpAuthorization,
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
