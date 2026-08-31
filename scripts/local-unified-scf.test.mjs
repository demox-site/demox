import test from "node:test";
import assert from "node:assert/strict";
import { startLocalUnifiedScf, toScfEvent } from "./local-unified-scf.mjs";

test("local HTTP adapter keeps path, method and JSON body", () => {
  const event = toScfEvent(
    {
      method: "POST",
      url: "/functions/fn_abcdefghij/invoke?x=1",
      headers: { host: "127.0.0.1:8788", "content-type": "application/json" }
    },
    Buffer.from('{"name":"本地"}')
  );
  assert.equal(event.httpMethod, "POST");
  assert.equal(event.path, "/functions/fn_abcdefghij/invoke");
  assert.deepEqual(event.body, { name: "本地" });
  assert.equal(event.queryStringParameters.x, "1");
});

test("local server can invoke the seeded hello function", async () => {
  const { server, hello } = await startLocalUnifiedScf({ listenHost: "127.0.0.1", listenPort: 0 });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/functions/${hello.functionId}/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "测试" })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, hello: "Demox", input: { name: "测试" } });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
