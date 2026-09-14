# 腾讯云资源与计费约定

账号 UIN `100021031865` / AppId `1307257815`。地域默认 `ap-guangzhou`（COS 默认桶在 `ap-chengdu`）。

整理日期：2026-08-25。之后新增 Demox 专属资源必须同时满足下面两条。

## 必须遵守

1. **计费标签**：`codename=demox`（账号里计费标签键只有 `codename`）。
2. **SCF 命名空间**：`demox`。不要再往 `default` 部署或创建 Demox 函数。
3. **对外 API**：只使用 `https://api.demox.site`。旧的 `*.tencentscf.com` 函数 URL 已失效。

`UpdateFunctionCode` / `UpdateFunctionConfiguration` / `GetFunction` / `Invoke` 都必须带 `--Namespace demox`。漏掉会打到已删除的 `default` 副本。

## 云函数

| 函数 | 命名空间 | 作用 | live 源 | 触发器 |
|------|----------|------|---------|--------|
| `demox-function-api` | `demox` | 统一入口：路由 + 平台控制面 | `scf-code/function-api/` | HTTP `api.demox.site`；定时 `analytics-rollup-5m`、`monthly-renew` |
| `demox-user-nodejs` | `demox` | 用户 / 平台站点 Node 运行时 | `scf-code/function-api/runtime-nodejs*.js` | 仅内网 HTTP，由路由器调用 |
| `demox-website-api` | `demox` | **回滚用**，不要再更新 | `scf-code/website-api/` | HTTP；定时器应关闭 |
| `demox-auth-api` | `demox` | **回滚用**，不要再更新 | `scf-deploy-packages/auth-api/` | HTTP |
| `demox-mcp-api` | `demox` | **回滚用**，不要再更新 | `scf-code/mcp-api/` | HTTP |
| `demox-cert-renew` | `demox` | **回滚用**，不要再更新 | `scf-code/cert-renew/` | 定时器应关闭 |

`demox-function-api` 绑定运行角色 `demox-runtime-role`，VPC `vpc-bwtrj6fb` / 子网 `subnet-nzrl3bbq`，内存 512 MB，超时 300 秒。`demox-user-nodejs` 在同一 VPC，无平台密钥。完整环境变量名清单见 `scf-code/function-api/live-config.json`（不含值）。

### 业务代码怎么发

Auth / Website / MCP / 证书续期是平台站点 `EPX2UU43` 上的 Demox 云函数，**不要**再对旧的四支 SCF 做 `UpdateFunctionCode`。改入口文件后：

```bash
demox functions push ./scf-deploy-packages/auth-api --id EPX2UU43 --slug auth
demox functions push ./scf-code/website-api --id EPX2UU43 --slug website
demox functions push ./scf-code/mcp-api --id EPX2UU43 --slug mcp
demox functions push ./scf-code/cert-renew --id EPX2UU43 --slug cert-renew
```

主站静态资源：`demox deploy ./dist --id EPX2UU43`。

只有改路由器、运行时、内网 hop 或 `/deploy` 协议时，才用 `scripts/package-unified-scf.mjs --apply` 和 `scripts/deploy-function-api.mjs --unified --apply`。旧四支函数仍保留作回滚，定时器保持关闭。

`api.demox.site` 是 SCF 自定义域名，路径全部指到 `demox-function-api`。前端环境变量 `VITE_DEMOX_API_URL=https://api.demox.site`。

### 部署运行时（只改发布能力本身）

大包不要走命令行 base64。JSON 里必须带 `"Namespace": "demox"`。改环境变量是全量覆盖：先 `GetFunction` 读出全部变量再合并。详见 `AGENTS.md`。

```bash
tccli scf GetFunction --FunctionName demox-function-api --Namespace demox --region ap-guangzhou
```

## 已打 `codename=demox` 的专属资源

| 产品 | 资源 |
|------|------|
| SCF | 命名空间 `demox`；`demox-function-api`、`demox-user-nodejs` 及四支回滚函数；自定义域名 `api.demox.site` |
| EdgeOne | zone `demox.site`（`zone-3kplfkbflnd6`） |
| COS | `resource-game-1307257815`（站点默认回源桶，成都）；`demox-analytics-raw-1307257815` |
| CI | `resource-game-1307257815` 数据万象 |
| SES | 发信域名 `mail.demox.site`（香港） |
| SSL | `*.demox.site` 泛域名证书；`api.demox.site` 所用证书 |
| DNSPod | 域名 `demox.site` |
| CDN | 历史域名 `demox.aigc.sx.cn`、`*.demox.aigc.sx.cn` |
| CAM | 角色 `demox-runtime-role` |

## 不要整实例改标签

| 资源 | 当前标签 | 原因 |
|------|----------|------|
| MySQL `cdb-fg5tqemn` | `codename=phosa` | 共享实例，库里还有 jipulse / casdoor 等，不只 `demox` |

## HTTPS

EdgeOne 站点 `zone-3kplfkbflnd6`（`demox.site` / `*.demox.site`）开启强制 HTTPS：HTTP 请求 301 到同 URL 的 HTTPS，并下发 HSTS（`max-age=31536000; includeSubDomains`，不开 preload）。`api.demox.site` 是 SCF 自定义域名，本身已 301 到 HTTPS。不要把 HTTP→HTTPS 写进 `subdomain-router`（该函数挂全站，见 P0 禁令）。

## P0 事故

- 2026-09-14：未知子域名 404 误伤 `www` 和全部用户站点。边缘函数 `ef-1281msyw` 已回滚。禁令与核对清单见 [incidents/2026-09-14-p0-unknown-subdomain-404-outage.md](incidents/2026-09-14-p0-unknown-subdomain-404-outage.md) 和 `AGENTS.md`。

## 已知未改项

- 根域名 `demox.site` 与 `*.demox.site` 共用同一张 Let's Encrypt 证书（SAN 含 apex）。`demox-cert-renew` 绑定时必须同时写入这两个主机，否则 apex HTTPS 会回落到 `*.cdn.myqcloud.com`。对外主站仍建议走 `https://www.demox.site`。
- 前端主站发布走 `git push origin master`，GitHub Action 执行 `demox deploy ./dist --id EPX2UU43`，不会自动更新业务云函数；业务云函数走 `demox functions push`。
