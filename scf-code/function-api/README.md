# Demox Functions（统一 SCF 入口）

这个包实现 Demox 的共享函数服务：所有用户函数代码可以放在同一个 COS 桶里，由一个公共 SCF 入口按 `functionId` 路由；同一个入口也会按固定清单转发 Demox 自有的 auth、website、MCP 系统函数。它解决“用户写代码、发布版本、拿到 URL、别人调用”的闭环，不创建线上资源，也不会自动执行数据库迁移。

## 统一入口

`createPlatformHandler()` 是共享 SCF 的入口编排：

- `/auth...`、`/oauth...`、`/website...`、`/deploy`、`/websites...`、`/mcp...` 只从 `system-functions.json` 加载固定的受信任 Node.js 后端。
- `/functions...` 走 QuickJS/WASM 用户函数运行时，用户请求不能选择或切换到受信任运行时。
- `Type=Timer` 的事件按 `TriggerName` 分发；`analytics-rollup-5m` 接入 website API，`monthly-renew` 接入 `scf-code/cert-renew`。该源码从线上 `$LATEST` 回收后做了可测试重构，不是线上字节副本。

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

## 函数代码合约

上传一个 `index.mjs`，导出一个函数：

```js
export default async function handler(request, env) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: request.method,
      name: env.NAME || "world",
      input: request.body
    })
  };
}
```

也兼容 `module.exports = async function (request, env) { ... }`。`request` 包含 `method`、`url`、`path`、`query`、小写 `headers` 和已按 `content-type` 解析的 `body`；`env` 只包含函数配置的普通字符串环境变量。

当前运行时明确不提供 Node.js、文件系统、进程、外部网络和 npm 模块导入。代码在 QuickJS/WASM 独立运行时中执行，并设置 CPU 中断、内存、请求体、响应体和代码大小上限。这样 COS 只负责存储，不能越权读取其他租户数据。

每分钟配额目前是单个 SCF 实例内的滑动窗口，调用记录异步写入 MySQL；正式多实例限流和计费前还需要接入 Redis/TDMQ 等共享计数器，不能把这版内存计数当成全局配额。

## HTTP 接口

管理接口需要 `Authorization: Bearer <Demox JWT>`：

```text
POST /functions                         创建函数
GET  /functions                         列出当前用户函数
POST /functions/:functionId/versions    上传一个草稿版本
GET  /functions/:functionId/versions    列出版本
POST /functions/:functionId/publish     发布指定 version
```

发布后公开调用地址为：

```text
POST|GET /functions/:functionId/invoke
```

创建、上传、发布均为幂等边界之外的独立步骤：上传失败的版本会标为 `failed`，只有校验过 COS 内容和 SHA-256 后才能发布。

## 接入现有 Demox

1. 在确认表结构和资源标签后，单独执行 `migrations/001_create_function_tables.sql`。
2. 用现有 `website-api/shared/db.js` 的 `query`、`transaction` 创建 `createMysqlFunctionRepository`。
3. 用 `CosBundleStore` 指向统一函数代码桶；建议 COS 前缀固定为 `functions/{functionId}/{version}/bundle.mjs`。
4. 以独立 SCF 函数部署 `index.js`，将 `JWT_SECRET`、COS/CAM 角色和 `FUNCTION_PUBLIC_BASE_URL` 作为环境配置。

生产工厂读取 `MYSQL_HOST`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`、`FUNCTIONS_COS_BUCKET` 和 `FUNCTIONS_COS_REGION`。没有这些配置时默认入口返回 `503 FUNCTION_SERVICE_NOT_CONFIGURED`，不会悄悄把数据写入内存；本地测试请显式使用 `createFunctionHttpHandler()` 或设置 `FUNCTIONS_LOCAL_MODE=true`。

本地测试默认使用内存仓库和内存代码存储。未配置真实隔离运行环境、COS、MySQL 或 SCF 之前，不应把本地运行器当作线上发布证明。
