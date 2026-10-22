# 自动发布

push 到 `master` 的目标是自动发布。每一段在切换之后都跑同一套双账号冒烟。冒烟失败：调用方把上一版切回去（function-api / website 切别名，边缘把上一份代码写回去），job 变红，并开一条带 `release-failure` 标签的 GitHub issue，正文 @启明。

本文件不创建云资源，也不改 GitHub environment。

## 冒烟

脚本 `scripts/ci/release-smoke.cjs`，可复用 workflow `.github/workflows/release-smoke.yml`。

两个账号都跑：

| 账号 | 地址 |
|---|---|
| 易点（主） | `DEMOX_SMOKE_EK_BASE`，空则 `https://api.demox.site` |
| 磷（备） | `DEMOX_SMOKE_LIN_BASE`，必填。这是磷自己的 production 入口，不是会被 EdgeOne 优先转到易点的前门 |

每一边：

1. `GET /health` 为 200。
2. `https://www.demox.site/` 为 200，HTML 里引用的 `assets/*.js` 也是 200。`EXPECT_BUNDLE` 有值时，HTML 必须带上这个文件名。`DEMOX_SMOKE_WWW_MIRROR_URL` 有值时，sites.demox.site 那一路同样核对。
3. 用非管理员测试账号 `POST /auth/login`，再 `POST /deploy` 重新发布 `DEMOX_SMOKE_WEBSITE_ID`，然后抓这个站点，正文里要有本次运行的标记。`POST /list-user-roles` 必须是 403。返回 200 且 `success=true` 时，冒烟直接失败，不会用管理员账号发布。

develop 阶段把两个 base 换成 `FUNCTION_API_DEVELOP_URL_EK` 和 `FUNCTION_API_DEVELOP_URL`。production 阶段用上面的易点 / 磷地址。

### 云帆要放到 GitHub 上的名字

这些值不进仓库。

Secrets（建议放在会跑冒烟的 environment 上：`function-api-production`、`website-function-production`、`edge-production`、`www`）：

- `DEMOX_SMOKE_EMAIL`
- `DEMOX_SMOKE_PASSWORD`

这是一个非管理员测试账号。易点和磷共用用户库，所以同一对凭证两边都要能登录。

Variables：

- `DEMOX_SMOKE_LIN_BASE`：磷 production 的 https 根地址。
- `DEMOX_SMOKE_WEBSITE_ID`：这个测试账号已经拥有的站点 ID。冒烟每次覆盖发布它，避免把部署额度打满。
- `DEMOX_SMOKE_EK_BASE`：可选。
- `DEMOX_SMOKE_WWW_MIRROR_URL`：可选，sites.demox.site 上 www 的 index。

失败 issue 使用 job 自带的 `GITHUB_TOKEN`（`issues: write`）。标签 `release-failure` 由脚本在第一次失败时创建。不需要单独的 issue token。
