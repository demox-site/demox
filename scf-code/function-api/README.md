# Demox Functions（统一 SCF 入口）

这个包实现 Demox 的共享函数服务：控制面（路由、版本、函数环境变量、别名）和运行时是分开的。`demox-function-api` 只负责路由和元数据；用户 Node.js 代码在独立的 `demox-user-nodejs` 里执行，路由器按 `runtime` 选择运行时 SCF。Python / Go 预留同一种接入方式，当前未部署。

## 统一入口

`createPlatformHandler()` 是共享 SCF 的入口编排：

- 已发布的站点函数按 slug（`/api/{slug}`）、自定义路径或定时器名称**优先**匹配；可接管 `/auth`、`/website`、`/deploy` 等路径。
- 未匹配时，`/auth`、`/oauth`、`/website`、`/deploy`、`/mcp` 等仍从 `system-functions.json` 加载系统后端作为回退。
- 用户函数目前只支持 Node.js：路由器通过 SCF Invoke 交给 `demox-user-nodejs`，该函数不配置 JWT_SECRET / MYSQL_*。Python / Go 尚未上线。
- `Type=Timer` 的事件先找用户函数的 `timerName`，否则按系统清单分发。

本地可查看统一包清单（默认只读 dry-run）：

```bash
npm run package:unified-scf
```

只有明确传入 `--apply` 才会生成本地 `.artifacts/unified-scf/` 打包目录和 zip；存在缺失系统源码时，脚本默认拒绝生成包，`--allow-blocked` 仅用于检查不完整包，不能视为可发布迁移。
打包清单会记录 zip 的 SHA-256 和投递方式；如果包含 `geoip-lite` 数据后超过 SCF 内联包上限，清单会标记为 `cos-upload-or-layer`，不能直接按小包方式发布。

迁移前的环境、VPC、路径和定时触发检查：

```bash
npm run report:unified-scf
```

报告只输出环境变量名称，不输出任何线上密钥值。`live-config.json` 已记录统一函数建议：VPC `vpc-bwtrj6fb` / `subnet-nzrl3bbq`，512 MB，300 秒，以及四个线上函数的环境变量名并集。真实 staging 绑定、调用对照和 `api.demox.site` 切换仍未做。

## 怎么发布用户函数

不要把用户后端部署成腾讯云 SCF。创建站点后用 CLI：

```bash
demox deploy ./dist --name my-site
demox functions push ./api/hello --id WEBSITE_ID --slug hello
demox env set --id WEBSITE_ID --slug hello --from .env
demox functions alias set --id WEBSITE_ID --slug hello production --version 2
demox functions invoke --id WEBSITE_ID --slug hello --body '{"ping":true}'
```

平台自己的 Auth / Website / MCP / 证书同样走 `demox functions push --id EPX2UU43`。只有改本包的路由或 `demox-user-nodejs` 运行时，才用 `scripts/deploy-function-api.mjs --unified --apply`。

## 函数代码合约

上传 `index.js`，导出一个函数：

```js
module.exports = async function handler(request, env) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: request.method,
      name: env.NAME || process.env.NAME || "world",
      input: request.body
    })
  };
};
```

也兼容 `export default async function (request, env) { ... }`。`request` 包含 `method`、`url`、`path`、`query`、小写 `headers` 和已按 `content-type` 解析的 `body`；`env` 与 `process.env` 都是**当前函数**的环境变量，不含路由器上的平台密钥。可 `require('mysql2')`、`require('jsonwebtoken')` 以及 `demox-auth` / `demox-website` / `demox-mcp` / `demox-cert-renew`。

每个函数有自己的别名。首次成功上传 v1 时，默认创建 `production` 和 `develop`，都指向 v1。之后再上传新版本不会移动别名，需要 `demox functions alias set` 或控制台主动改指向。

每分钟配额目前是单个 SCF 实例内的滑动窗口，调用记录异步写入 MySQL；正式多实例限流和计费前还需要接入 Redis/TDMQ 等共享计数器，不能把这版内存计数当成全局配额。

## HTTP 接口

管理接口需要 `Authorization: Bearer <Demox JWT>`：

```text
POST /functions                         创建函数
GET  /functions                         列出当前用户函数
POST /functions/:functionId/versions    上传一个版本（v1 会创建默认别名）
GET  /functions/:functionId/versions    列出版本
GET  /functions/:functionId/env         读取该函数环境变量
POST /functions/:functionId/env         覆盖写入该函数环境变量
GET  /functions/:functionId/aliases     列出别名
POST /functions/:functionId/aliases/:alias  把别名指向 { version }
DELETE /functions/:functionId/aliases/:alias  删除自定义别名（不能删 production/develop）
POST /functions/:functionId/publish     兼容接口：把 production 指向指定 version
```

公开调用按别名解析版本：

```text
GET|POST /{websiteId}/{alias}/api/{slug}
POST|GET /functions/:functionId/invoke
```

站点域名上的 `/api/{slug}` 走 `production` 别名。上传失败的版本会标为 `failed`，不能被别名引用。

## 接入现有 Demox

1. 在确认表结构和资源标签后，单独执行 `migrations/001_create_function_tables.sql`。
2. 用现有 `website-api/shared/db.js` 的 `query`、`transaction` 创建 `createMysqlFunctionRepository`。
3. 用 `CosBundleStore` 指向统一函数代码桶；建议 COS 前缀固定为 `functions/{functionId}/{version}/bundle.mjs`。
4. 以独立 SCF 函数部署 `index.js`，将 `JWT_SECRET`、COS/CAM 角色和 `FUNCTION_PUBLIC_BASE_URL` 作为环境配置。

生产工厂读取 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`FUNCTIONS_COS_BUCKET` 和 `FUNCTIONS_COS_REGION`。没有这些配置时默认入口返回 `503 FUNCTION_SERVICE_NOT_CONFIGURED`，不会悄悄把数据写入内存；本地测试请显式使用 `createFunctionHttpHandler()` 或设置 `FUNCTIONS_LOCAL_MODE=true`。

本地测试默认使用内存仓库和内存代码存储。未配置真实隔离运行环境、COS、MySQL 或 SCF 之前，不应把本地运行器当作线上发布证明。
