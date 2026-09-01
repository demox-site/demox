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
| `demox-website-api` | `demox` | 站点/项目/存储桶/审核等业务 | `scf-code/website-api/` | HTTP + 定时 `analytics-rollup-5m`（每 5 分钟） |
| `demox-auth-api` | `demox` | 登录、OAuth | `scf-deploy-packages/auth-api/` | HTTP |
| `demox-mcp-api` | `demox` | CLI / MCP / `/deploy` | `scf-code/mcp-api/` | HTTP |
| `demox-cert-renew` | `demox` | `*.demox.site` Let's Encrypt 续期 | `scf-code/cert-renew/` | 定时 `monthly-renew`（每月 1 号 03:17） |
| `demox-function-api` | `demox` | 统一入口：系统函数 + 用户云函数 | `scf-code/function-api/` | HTTP `api.demox.site`；定时 `analytics-rollup-5m`、`monthly-renew` |

四个函数都绑定运行角色 `demox-runtime-role`，Handler 均为 `index.main`。`demox-website-api` 和 `demox-auth-api` 绑定 VPC `vpc-bwtrj6fb` / 子网 `subnet-nzrl3bbq`。统一入口若要承接这两套后端，必须沿用同一 VPC，内存至少 512 MB，超时至少 300 秒。完整环境变量名清单见 `scf-code/function-api/live-config.json`（不含值）。

### 统一入口迁移（开发中）

`scf-code/function-api/index.js` 已提供一个共享入口：固定清单中的 auth、website、MCP 路径先由受信任系统函数处理，`/functions/:functionId/invoke` 再进入 QuickJS/WASM 用户函数运行时。MCP 在统一包内通过进程内回源调用 Auth/Website，不再走 `*.tencentscf.com` HTTP。`scripts/package-unified-scf.mjs` 默认只生成迁移清单，只有 `--apply` 才生成本地 SCF 包。`api.demox.site` 与两个定时器已经切到 `demox-function-api`；旧四个函数仍保留作回滚，其定时器应保持关闭。

`demox-cert-renew` 的 live `$LATEST` 已从腾讯云回收并写入 `scf-code/cert-renew/`。本地入口是可测试的重构，不是线上字节副本；哈希与差异见 `scf-code/cert-renew/SOURCE.md` 和 `scf-code/function-api/live-parity.json`。`demox-website-api`、`demox-auth-api`、`demox-mcp-api` 的入口在 2026-08-31 与 live `$LATEST` 字节一致。VPC、环境变量合并、staging 调用和回滚尚未验证，因此不能视为已替换线上四个函数。

`api.demox.site` 是 SCF 自定义域名，路径已全部指到命名空间 `demox`（`/auth`、`/website`、`/deploy` 等）。前端环境变量 `VITE_DEMOX_API_URL=https://api.demox.site`。

### 部署代码（只改代码、不改环境变量）

大包不要走命令行 base64，用 `--cli-input-json`。JSON 里必须带 `"Namespace": "demox"`。

```bash
tccli scf GetFunction --FunctionName demox-website-api --Namespace demox --region ap-guangzhou
```

改环境变量是全量覆盖：先 `GetFunction` 读出全部变量再合并。详见仓库内 Agent 部署记忆与 `AGENTS.md`。

## 已打 `codename=demox` 的专属资源

| 产品 | 资源 |
|------|------|
| SCF | 命名空间 `demox`；上述 4 个函数；自定义域名 `api.demox.site` |
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

## 已知未改项

- 根域名 `demox.site` 与 `*.demox.site` 共用同一张 Let's Encrypt 证书（SAN 含 apex）。`demox-cert-renew` 绑定时必须同时写入这两个主机，否则 apex HTTPS 会回落到 `*.cdn.myqcloud.com`。对外主站仍建议走 `https://www.demox.site`。
- 前端主站发布仍走 GitHub Actions → Demox `/deploy`，不会自动更新上述云函数。
