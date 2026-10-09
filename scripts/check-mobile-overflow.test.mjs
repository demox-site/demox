// 手机 375px 宽度下，控制台页面不能横向溢出（document.scrollWidth ≤ 视口宽度）。
// 设计审 v13 时发现：站点分析页撑到 984px、用户列表撑到 1109px，右侧文字被截断。
//
// 做法：用示例数据预览构建（VITE_CONSOLE_DEMO=1，接口全部本地应答，不连线上），
// 起一个本地静态服务，用无头 Chrome（DevTools 协议，不需要额外依赖）按 375×812 打开页面量 scrollWidth。
// 运行：npm run test:mobile-overflow   （需要 Chrome；找不到 Chrome 时跳过）
// 环境变量：CHROME_BIN 指定 Chrome；CONSOLE_DEMO_DIST 指定已构建好的预览目录（不再重新构建）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const VIEWPORT = { width: 375, height: 812 };
const PAGES = [
  { name: "site analytics", route: "/console/projects/p-demo/sites/DEMO0001/analytics", ready: "DEMO0001" },
  { name: "admin roles", route: "/console/admin/roles", ready: "lin@example.com" },
  { name: "admin dashboard", route: "/console/admin/dashboard", ready: "[data-kpi=\"reports\"]", selector: true },
  { name: "admin buckets", route: "/console/admin/buckets", ready: "demo-backup" },
  { name: "admin reports", route: "/console/admin/reports", ready: "demo0002.example.com" },
  { name: "tokens", route: "/console/tokens", ready: "dmx_demo2" }
];

const chrome = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
const hasWebSocket = typeof globalThis.WebSocket === "function";

function buildDemo() {
  if (process.env.CONSOLE_DEMO_DIST) return process.env.CONSOLE_DEMO_DIST;
  const out = mkdtempSync(join(tmpdir(), "console-demo-"));
  const r = spawnSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
    cwd: ROOT,
    env: { ...process.env, VITE_CONSOLE_DEMO: "1", VITE_DEMOX_API_URL: "https://demo-api.invalid" },
    stdio: "inherit"
  });
  assert.equal(r.status, 0, "预览构建失败");
  return out;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
function serve(dir) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let file = join(dir, path);
      if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function launchChrome() {
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(join(tmpdir(), "chrome-"))}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Chrome 没有启动")), 30000);
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });
  return { proc, wsUrl };
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}, sessionId) => ready.then(() => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
  }));
  return { send, close: () => ws.close() };
}

const skip = !chrome ? "没有找到 Chrome（设置 CHROME_BIN）" : !hasWebSocket ? "需要 node --experimental-websocket" : false;

test("console pages do not overflow horizontally at 375px (zh + en)", { skip, timeout: 600000 }, async () => {
  const dist = buildDemo();
  const server = await serve(dist);
  const base = `http://127.0.0.1:${server.address().port}`;
  const { proc, wsUrl } = await launchChrome();
  const client = cdp(wsUrl);
  const failures = [];
  try {
    for (const lang of ["zh", "en"]) {
      for (const page of PAGES) {
        const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
        await client.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 2, mobile: true }, sessionId);
        await client.send("Runtime.enable", {}, sessionId);
        await client.send("Page.navigate", { url: `${base}/?route=${encodeURIComponent(page.route)}&lang=${lang}&theme=dark` }, sessionId);
        const check = page.selector
          ? `!!document.querySelector(${JSON.stringify(page.ready)})`
          : `document.body.innerText.includes(${JSON.stringify(page.ready)})`;
        let ok = false;
        for (let i = 0; i < 150 && !ok; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const r = await client.send("Runtime.evaluate", { expression: check, returnByValue: true }, sessionId).catch(() => null);
          ok = Boolean(r?.result?.value);
        }
        assert.ok(ok, `${lang} ${page.name}: 页面 30 秒内没有渲染出来`);
        await new Promise((r) => setTimeout(r, 1200));
        const { result } = await client.send("Runtime.evaluate", {
          expression: "({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth })",
          returnByValue: true
        }, sessionId);
        const { sw, vw } = result.value;
        if (sw > vw) failures.push(`${lang} ${page.name}: scrollWidth ${sw} > ${vw}`);
        await client.send("Target.closeTarget", { targetId });
      }
    }
  } finally {
    client.close();
    proc.kill();
    server.close();
  }
  assert.deepEqual(failures, [], "375px 下页面横向溢出");
});
