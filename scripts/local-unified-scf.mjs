#!/usr/bin/env node

import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createPlatformHandler, createFunctionHttpHandler } = require("../scf-code/function-api/index.js");

const host = process.env.LOCAL_FUNCTIONS_HOST || "127.0.0.1";
const port = Number(process.env.LOCAL_FUNCTIONS_PORT || 8788);
const publicBaseUrl = `http://${host}:${port}`;

const userHandler = createFunctionHttpHandler({
  authenticate: () => ({ userId: "local-dev" }),
  publicBaseUrl,
  logger: {
    error(...args) {
      if (process.env.LOCAL_FUNCTIONS_QUIET === "1") return;
      console.error(...args);
    },
    log(...args) {
      console.log(...args);
    }
  }
});
const handler = createPlatformHandler({ userHandler });

export function toScfEvent(request, bodyBuffer) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  let body = bodyBuffer.length ? bodyBuffer.toString("utf8") : "";
  const contentType = String(request.headers["content-type"] || "");
  if (body && contentType.includes("application/json")) {
    try {
      body = JSON.parse(body);
    } catch {
      // Keep the raw string; the function handler already tolerates invalid JSON.
    }
  }
  return {
    httpMethod: String(request.method || "GET").toUpperCase(),
    path: url.pathname,
    rawPath: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value])),
    body,
    isBase64Encoded: false
  };
}

export function playgroundPage({ hello } = {}) {
  const invokeUrl = hello?.invokeUrl || `${publicBaseUrl}/functions`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Demox 本地云函数</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #111; color: #eee; }
    main { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    p, label { color: #bbb; line-height: 1.5; }
    code, textarea, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    textarea, pre { width: 100%; box-sizing: border-box; background: #1b1b1b; color: #f3f3f3; border: 1px solid #333; border-radius: 10px; padding: 12px; }
    textarea { min-height: 220px; }
    pre { min-height: 80px; white-space: pre-wrap; }
    button { background: #f2c14e; color: #111; border: 0; border-radius: 999px; padding: 10px 18px; font-weight: 700; cursor: pointer; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 16px 0; }
    .ok { color: #9ad27a; }
  </style>
</head>
<body>
  <main>
    <h1>本地云函数试运行</h1>
    <p>这个页面只连本机内存仓库，不会写腾讯云、不会动生产。管理接口在本地默认按 <code>local-dev</code> 用户处理。</p>
    <p class="ok">已预置函数：<code id="fn">${hello?.functionId || ""}</code></p>
    <p>调用地址：<code id="url">${invokeUrl}</code></p>
    <label for="payload">请求 JSON</label>
    <textarea id="payload">{ "name": "本地" }</textarea>
    <div class="row">
      <button id="run" type="button">调用预置函数</button>
      <span id="status"></span>
    </div>
    <pre id="out">等待调用…</pre>
  </main>
  <script>
    const button = document.getElementById("run");
    const out = document.getElementById("out");
    const status = document.getElementById("status");
    button.addEventListener("click", async () => {
      status.textContent = "调用中…";
      let payload = document.getElementById("payload").value;
      try { payload = JSON.parse(payload); } catch (error) {
        status.textContent = "JSON 无效";
        out.textContent = error.message;
        return;
      }
      try {
        const response = await fetch(${JSON.stringify(hello?.invokeUrl || "")}, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        const text = await response.text();
        status.textContent = "HTTP " + response.status;
        out.textContent = text;
      } catch (error) {
        status.textContent = "请求失败";
        out.textContent = error.message;
      }
    });
  </script>
</body>
</html>`;
}

async function seedHello(platformHandler) {
  const created = await platformHandler({
    httpMethod: "POST",
    path: "/functions",
    body: { websiteId: "local-demo", name: "Hello", slug: "hello", env: { NAME: "Demox" } }
  });
  const createdBody = JSON.parse(created.body);
  const functionId = createdBody.function.functionId;
  const source = `export default async function handler(request, env) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      hello: env.NAME || "world",
      input: request.body
    })
  };
}`;
  await platformHandler({ httpMethod: "POST", path: `/functions/${functionId}/versions`, body: { source } });
  const published = await platformHandler({ httpMethod: "POST", path: `/functions/${functionId}/publish`, body: { version: 1 } });
  return JSON.parse(published.body).function;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function send(response, result) {
  const headers = { ...(result.headers || {}) };
  if (!headers["access-control-allow-origin"]) headers["access-control-allow-origin"] = "*";
  response.writeHead(result.statusCode || 200, headers);
  response.end(result.body ?? "");
}

export async function startLocalUnifiedScf({ listenHost = host, listenPort = port } = {}) {
  const hello = await seedHello(handler);
  const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", publicBaseUrl);
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/playground")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(playgroundPage({ hello }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      send(response, {
        statusCode: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: true, mode: "local-memory", hello })
      });
      return;
    }
    const event = toScfEvent(request, await readBody(request));
    send(response, await handler(event, {}));
  } catch (error) {
    send(response, {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ success: false, error: "LOCAL_SERVER_ERROR", message: error.message })
    });
  }
});

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, resolve);
  });
  return { server, hello, url: `http://${listenHost}:${listenPort}` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { hello, url } = await startLocalUnifiedScf();
  console.log(`Demox local functions: ${url}`);
  console.log(`Playground: ${url}/`);
  console.log(`Seeded invoke: ${hello.invokeUrl}`);
  console.log("This process uses an in-memory store. /auth /website /deploy will load real backend code and need a database.");
}
