import test from "node:test";
import assert from "node:assert/strict";
import {
  beginFeishuOAuthFlow,
  consumeFeishuOAuthFlow,
  derivePkceChallenge,
  FEISHU_OAUTH_FLOW_TTL_MS
} from "./feishu-oauth.js";

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

test("derives the RFC 7636 S256 challenge", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(
    await derivePkceChallenge(verifier),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  );
});

test("keeps concurrent OAuth verifier pairs isolated by state", async () => {
  const storage = new MemoryStorage();
  const first = await beginFeishuOAuthFlow("login", storage, globalThis.crypto, 1_000);
  const second = await beginFeishuOAuthFlow("bind", storage, globalThis.crypto, 2_000);

  assert.notEqual(first.state, second.state);
  assert.notEqual(first.verifier, second.verifier);
  assert.equal(first.verifier.length, 43);
  assert.equal(second.verifier.length, 43);
  assert.equal(await derivePkceChallenge(first.verifier), first.challenge);
  assert.equal(await derivePkceChallenge(second.verifier), second.challenge);
  assert.deepEqual(consumeFeishuOAuthFlow(first.state, storage, 3_000), {
    mode: "login",
    verifier: first.verifier,
    challenge: first.challenge,
    createdAt: 1_000
  });
  assert.deepEqual(consumeFeishuOAuthFlow(second.state, storage, 3_000), {
    mode: "bind",
    verifier: second.verifier,
    challenge: second.challenge,
    createdAt: 2_000
  });
  assert.equal(consumeFeishuOAuthFlow(first.state, storage, 3_000), null);
});

test("rejects an expired OAuth flow", async () => {
  const storage = new MemoryStorage();
  const flow = await beginFeishuOAuthFlow("login", storage, globalThis.crypto, 1_000);
  assert.equal(
    consumeFeishuOAuthFlow(flow.state, storage, 1_001 + FEISHU_OAUTH_FLOW_TTL_MS),
    null
  );
});

test("keeps state protection when a confidential client does not use PKCE", async () => {
  const storage = new MemoryStorage();
  const flow = await beginFeishuOAuthFlow(
    "login",
    storage,
    globalThis.crypto,
    1_000,
    false
  );
  assert.equal(flow.verifier, null);
  assert.equal(flow.challenge, null);
  assert.deepEqual(consumeFeishuOAuthFlow(flow.state, storage, 2_000), {
    mode: "login",
    verifier: null,
    challenge: null,
    createdAt: 1_000
  });
});
