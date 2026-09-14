---
name: demox-node-backend-cli
description: Deploy a Node.js frontend plus backend to Demox using only the CLI. Use when a user wants to migrate a Node site to Demox cloud functions, create a site with demox deploy, push functions, set env, and invoke — no console.
---

# Demox Node 后端：全程 CLI

朋友的站点如果是静态前端 + Node 接口，只走 CLI，不要打开控制台，不要跑 `deploy-function-api.mjs`。

## 后端必须改成的样子

不是 Express `app.listen`。每个接口一个函数，导出：

```js
module.exports = async function handler(request, env) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, input: request.body })
  };
};
```

- 入口文件名：`index.js` / `index.cjs` / `index.mjs`
- 密钥只从 `env` 或 `process.env` 读，由 `demox env set --slug` 注入到**当前函数**
- 禁止 `child_process` / `cluster` / `worker_threads`
- 当前运行时是 Node.js；不要用 Python/Go
- 页面里调用：`fetch('/api/{slug}')`（站点域名会转到这个函数）

## 用哪条 CLI

用 npm 全局 CLI，需要 **1.1.6 及以上**（含 `functions` / `env` / `alias`）：

```bash
npm install -g @demox-site/cli@latest
demox --version
DEMOX=demox
$DEMOX login
```

## 命令顺序

必须先 push 出函数，再设环境变量。函数还不存在时 `env set --slug` 会失败。

```bash
$DEMOX login
$DEMOX deploy ./dist --name 站点名
# 记下输出的网站 ID

$DEMOX functions push ./api/hello --id WEBSITE_ID --slug hello
# 首次创建 v1，production 和 develop 都指向 v1。

$DEMOX env set --id WEBSITE_ID --slug hello DATABASE_URL=... JWT_SECRET=...
# 或 $DEMOX env set --id WEBSITE_ID --slug hello --from .env

$DEMOX functions invoke --id WEBSITE_ID --slug hello --body '{"ping":true}'
```

更新代码再 push。要用新版本对外服务，显式改别名：

```bash
$DEMOX functions push ./api/hello --id WEBSITE_ID --slug hello
$DEMOX functions alias set --id WEBSITE_ID --slug hello production --version 2
```

## 不要做的事

- 不要为用户站点去更新腾讯云 `demox-*-api`
- 不要让后端继续监听端口
- 不要把密钥写进前端或函数源码
