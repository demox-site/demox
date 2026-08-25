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

四个函数都绑定运行角色 `demox-runtime-role`，Handler 均为 `index.main`。

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

- 根域名 `demox.site` 证书不覆盖 apex（泛证书只覆盖 `*.demox.site`）。对外主站走 `https://www.demox.site`。
- 前端主站发布仍走 GitHub Actions → Demox `/deploy`，不会自动更新上述云函数。
