export const MCP_OAUTH_CLIENT_ID = "demox-mcp-client";
export const MCP_OAUTH_RESPONSE_TYPE = "code";
export const MCP_OAUTH_CHALLENGE_METHOD = "S256";
export const MCP_OAUTH_SCOPES = Object.freeze([
  "website:deploy",
  "website:list",
  "website:delete",
  "website:update"
]);
export const MCP_OAUTH_REDIRECT_URIS = Object.freeze([
  "http://localhost:39897/callback",
  "http://localhost:*/callback"
]);

// Third-party clients (e.g. Funx: funx-console) are registered in the auth-api oauth_clients table.
// The page only does a shape check here; the client name, redirect URI whitelist and scopes are
// verified by the server (/oauth/client) before anything is shown or any redirect happens.
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const SCOPE_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

const STATE_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function readOAuthSearchParams(locationLike) {
  const search = locationLike?.search || "";
  if (search.length > 1) return new URLSearchParams(search);
  const hash = locationLike?.hash || "";
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

function single(params, name) {
  const values = params.getAll(name);
  if (values.length > 1) return { error: `OAuth 参数 ${name} 不能重复` };
  return { value: values[0] || "" };
}

export function redirectUriAllowed(redirectUri, patterns = MCP_OAUTH_REDIRECT_URIS) {
  const value = String(redirectUri || "");
  return patterns.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return regex.test(value);
    }
    return pattern === value;
  });
}

export function parseMcpOAuthRequest(params) {
  const fields = ["client_id", "redirect_uri", "response_type", "state", "scope", "code_challenge", "code_challenge_method"];
  const values = {};
  for (const name of fields) {
    const result = single(params, name);
    if (result.error) return { ok: false, error: result.error };
    values[name] = result.value;
  }

  if (!values.client_id || !values.redirect_uri || !values.state) {
    return { ok: false, error: "缺少必需的 OAuth 参数" };
  }
  const official = values.client_id === MCP_OAUTH_CLIENT_ID;
  if (!official && !CLIENT_ID_PATTERN.test(values.client_id)) {
    return { ok: false, error: "无效的客户端 ID" };
  }
  if (official ? !redirectUriAllowed(values.redirect_uri) : !isHttpsUrl(values.redirect_uri)) {
    return { ok: false, error: "无效的回调地址", redirectSafe: false };
  }
  // Until the server has confirmed a third-party redirect URI, never send the browser there.
  const redirectSafe = official;
  if (values.response_type && values.response_type !== MCP_OAUTH_RESPONSE_TYPE) {
    return { ok: false, error: "仅支持 authorization code", redirectUri: values.redirect_uri, state: values.state, redirectSafe };
  }
  if (!STATE_PATTERN.test(values.state)) {
    return { ok: false, error: "OAuth state 格式无效", redirectUri: values.redirect_uri, redirectSafe };
  }
  const scopes = [...new Set(values.scope.split(/\s+/).filter(Boolean))];
  if (!scopes.length && official) scopes.push(...MCP_OAUTH_SCOPES);
  const scopeOk = official ? scopes.every((scope) => MCP_OAUTH_SCOPES.includes(scope)) : scopes.length > 0 && scopes.every((scope) => SCOPE_PATTERN.test(scope));
  if (!scopeOk) {
    return { ok: false, error: "OAuth scope 无效", redirectUri: values.redirect_uri, state: values.state, redirectSafe };
  }
  // PKCE S256 is required for every client, official or not.
  if (!PKCE_CHALLENGE_PATTERN.test(values.code_challenge) || values.code_challenge_method !== MCP_OAUTH_CHALLENGE_METHOD) {
    return { ok: false, error: "缺少有效的 OAuth PKCE 参数", redirectUri: values.redirect_uri, state: values.state, redirectSafe };
  }

  return {
    ok: true,
    request: {
      clientId: values.client_id,
      redirectUri: values.redirect_uri,
      responseType: MCP_OAUTH_RESPONSE_TYPE,
      state: values.state,
      scope: scopes.join(" "),
      codeChallenge: values.code_challenge,
      codeChallengeMethod: MCP_OAUTH_CHALLENGE_METHOD,
      official
    }
  };
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Third-party clients: ask auth-api for the client name. The server checks client_id, the exact
 * redirect URI and the scopes; on any failure the caller shows an error and does not redirect.
 */
export async function loadThirdPartyClient(request, fetchClient) {
  const info = await fetchClient({ client_id: request.clientId, redirect_uri: request.redirectUri, scope: request.scope });
  if (!info || info.success !== true || info.client_id !== request.clientId || typeof info.client_name !== "string") {
    throw new Error("invalid_client");
  }
  return { name: info.client_name, scopes: Array.isArray(info.scopes) ? info.scopes : [] };
}

export function toOAuthAuthorizePayload(request) {
  return {
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: request.responseType,
    state: request.state,
    scope: request.scope,
    code_challenge: request.codeChallenge,
    code_challenge_method: request.codeChallengeMethod
  };
}

export function buildMcpLoginUrl(origin, request) {
  const url = new URL("/mcp-login", origin);
  const payload = toOAuthAuthorizePayload(request);
  for (const [key, value] of Object.entries(payload)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function buildAuthorizationCodeCallback(redirectUri, { code, state }) {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function buildOAuthErrorCallback(redirectUri, error, description, state) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export async function completeMcpAuthorization(request, issueCode) {
  const data = await issueCode(toOAuthAuthorizePayload(request));
  const code = data?.code;
  if (!code) throw new Error("授权码发放失败");
  return buildAuthorizationCodeCallback(request.redirectUri, { code, state: request.state });
}
