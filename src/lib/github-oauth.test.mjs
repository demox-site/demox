import test from "node:test";
import assert from "node:assert/strict";
import {
  beginGithubOAuthFlow,
  clearOAuthCallbackSearch,
  consumeGithubOAuthFlow,
  describeGithubLoginError,
  GITHUB_OAUTH_FLOW_TTL_MS,
  getTopAwareSessionStorage
} from "./github-oauth.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  get length() {
    return this.values.size;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key) {
    this.values.delete(key);
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

test("keeps concurrent GitHub OAuth flows isolated by state", () => {
  const storage = new MemoryStorage();
  const first = beginGithubOAuthFlow("login", storage, globalThis.crypto, 1_000);
  const second = beginGithubOAuthFlow("bind", storage, globalThis.crypto, 2_000);

  assert.notEqual(first.state, second.state);
  assert.match(first.state, /^login\.[A-Za-z0-9_-]{32}$/);
  assert.match(second.state, /^bind\.[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(consumeGithubOAuthFlow(first.state, storage, 3_000), {
    mode: "login",
    createdAt: 1_000
  });
  assert.deepEqual(consumeGithubOAuthFlow(second.state, storage, 3_000), {
    mode: "bind",
    createdAt: 2_000
  });
  assert.equal(consumeGithubOAuthFlow(first.state, storage, 3_000), null);
});

test("rejects an expired GitHub OAuth flow", () => {
  const storage = new MemoryStorage();
  const flow = beginGithubOAuthFlow("login", storage, globalThis.crypto, 1_000);
  assert.equal(
    consumeGithubOAuthFlow(flow.state, storage, 1_001 + GITHUB_OAUTH_FLOW_TTL_MS),
    null
  );
});

test("purges the legacy single-key state on begin", () => {
  const storage = new MemoryStorage();
  storage.setItem("github_oauth_state", "login.stale");
  beginGithubOAuthFlow("login", storage, globalThis.crypto, 1_000);
  assert.equal(storage.getItem("github_oauth_state"), null);
});

test("describeGithubLoginError explains reused authorization codes", () => {
  assert.match(
    describeGithubLoginError(new Error("GitHub 授权失败: bad_verification_code")),
    /授权码已失效/
  );
  assert.equal(describeGithubLoginError(new Error("该 GitHub 账号已绑定到其他用户")), "该 GitHub 账号已绑定到其他用户");
});

test("getTopAwareSessionStorage prefers same-origin top storage", () => {
  const topStorage = new MemoryStorage();
  const frameStorage = new MemoryStorage();
  const top = { sessionStorage: topStorage };
  const frame = { top, sessionStorage: frameStorage };
  top.top = top;

  assert.equal(getTopAwareSessionStorage(frame), topStorage);
  assert.equal(getTopAwareSessionStorage(top), topStorage);
});

test("clearOAuthCallbackSearch strips query params from the callback URL", () => {
  const original = globalThis.window;
  const calls = [];
  globalThis.window = {
    location: {
      href: "https://www.demox.site/github-callback?code=abc&state=login.xxx",
      pathname: "/github-callback",
      search: "?code=abc&state=login.xxx",
      hash: ""
    },
    history: {
      replaceState(_state, _title, url) {
        calls.push(url);
      }
    }
  };

  try {
    clearOAuthCallbackSearch();
    assert.deepEqual(calls, ["/github-callback"]);
  } finally {
    globalThis.window = original;
  }
});
