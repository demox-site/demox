# SCF 返回值（RetMsg）里的凭证和邮箱

## 现状（2026-10-09 15:20–16:10 SGT 线上日志抽查，只统计不看内容）

| 函数 | 调用数 | RetMsg 含 JWT/邮箱 |
| --- | --- | --- |
| demox-function-api（api.demox.site 入口，Event 函数） | 705 | 34 |
| demox-user-nodejs（运行 auth/website/mcp 平台函数） | 664 | 34（同一批响应，v13 加密还没上线） |
| demox-website-api / auth-api / mcp-api（旧独立函数） | 0 | 0 |

命中类型：`ownerEmail`（项目列表）15、其他邮箱 9、`access_token`+`refresh_token`（OAuth 刷新，第三方 MCP 客户端）5、`email`（登录/我的信息）5。

Event 函数的返回值会被 SCF 原样写进 CLS 日志（`Response RequestId:… RetMsg:…`），平台没有开关。日志主题 `SCF_logtopic_yorder` 保留 7 天，账号下所有能看 SCF/CLS 日志的人都能搜到。

## 方案比较

| 方案 | 能挡住 | 挡不住 / 代价 |
| --- | --- | --- |
| **A. api.demox.site 改用 Web 函数**（推荐） | 所有客户端的所有响应（Web 函数的响应体不自动进日志，腾讯云文档明确写了） | 要新建一个 HTTP 类型函数、复制环境变量、把自定义域名入口切过去；一次性运维操作 |
| B. 只用 Set-Cookie 下发凭证 | 无 | Event 函数的 RetMsg 包含 headers，Set-Cookie 一样被记；CLI/MCP 也不支持 Cookie |
| C. 客户端带一次性密钥、服务端加密响应 | 我们自己的控制台 | 第三方 MCP/OAuth 客户端改不了，OAuth refresh token 仍然明文；客户端要改 |
| D. 收紧 CLS（缩短保留、限制谁能查） | 降低暴露面 | 凭证照样写进日志，只是看的人少、留的时间短 |

## 推荐：A + 已有的 v13 运行时加密 + D 作兜底

1. **外层（api.demox.site → demox-function-api）改 Web 函数。** 本 PR 已完成代码部分：
   - `scf-code/function-api/web-server.js`：把 HTTP 请求转成现在的事件格式，交给同一个 `createPlatformHandler`，再写回响应。路由、业务代码、客户端都不用改。
   - 统一包根目录加 `scf_bootstrap`（监听 9000），同一个 zip 既能做 Event 函数也能做 Web 函数。
   - 定时触发器（统计聚合、证书续期）继续留在 Event 函数 `demox-function-api` 上。
2. **内层（路由 → demox-user-nodejs）**：v13 已写好返回值加密（`response-seal.js`），代码已在 master，只差把统一包发到两个函数上（v14 CI 的 `with_runtime`）。发完后 user-nodejs 的 RetMsg 只剩密文。
3. **兜底**：CLS 日志主题只给需要的人读权限；保留期维持 7 天或缩到 3 天。

客户端不受影响：接口地址、请求、响应格式都不变。

## 上线步骤（需要批准，见 /workspace/v14/PLAN.md）

1. 新建 Web 函数 `demox-api-web`（ap-guangzhou / demox，Nodejs18.15，类型 HTTP，512 MB / 300 s，VPC `vpc-bwtrj6fb` / `subnet-nzrl3bbq`，角色 `demox-runtime-role`），代码用统一包（COS）。环境变量和 `demox-function-api` 一致，在控制台复制（CI 不读不写环境变量）。
2. 发版本、建 `production` 别名，用函数自己的 URL 跑一遍健康检查（`/health` 200、`/` 401、OPTIONS 200）。
3. 把 `api.demox.site` 的入口逐条从 `demox-function-api` 切到 `demox-api-web:production`（先切 `/health`、再切其余）。回滚就是把入口改回去。
4. 观察 15 分钟：`demox-api-web` 的日志里不应该再有 `RetMsg`；`demox-function-api` 只剩定时器调用。
5. 旧的 `demox-website-api` / `auth-api` / `mcp-api` 已经没有流量，确认后关掉它们的 HTTP 触发器。
