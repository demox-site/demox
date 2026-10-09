# function-api 走 GitHub Actions 发布

`demox-function-api`（统一 SCF 路由，ap-guangzhou，namespace `demox`）由 `.github/workflows/deploy-function-api.yml` 发布，脚本是 `scripts/ci/scf-function-api.cjs`。不再用 `scripts/deploy-function-api.mjs`，那个脚本依赖 phosa Mac 上的工具，而且会**覆盖函数环境变量**。

## 凭证：GitHub OIDC → CAM 角色（没有长期密钥）

- workflow 不读任何腾讯云 secret。job 带 `permissions: id-token: write`，并且在 GitHub environment **`function-api-production`** 里（只允许 `master`，需要 PhosAQy 批准），脚本用 GitHub OIDC token 调 `sts:AssumeRoleWithWebIdentity` 扮演 `qcs::cam::uin/100021031865:roleName/demox-ci-deploy`，拿 1 小时临时密钥，只留在进程内存里。
- CAM 身份提供商 `github-actions`（`https://token.actions.githubusercontent.com`，客户端 ID `sts.tencentcloudapi.com`，公钥自动轮转）。
- 角色信任条件：`oidc:sub = repo:demox-site/demox:environment:function-api-production`。不在这个 environment 里的 job（别的分支、PR、没批准的 run）都换不到密钥。
- 权限策略 `demox-ci-deploy-policy`：只允许对带标签 `codename=demox` 的函数 `UpdateFunctionCode` / `PublishVersion` / `UpdateAlias` / `Invoke` / 只读列表接口、读 `api.demox.site` 域名配置、往 `scf-deploy/ci/*` 上传包；显式 Deny `tag:*`、`GetFunction`、`UpdateFunctionConfiguration`、`UpdateFunction`、`scf:Create*` / `scf:Delete*`、触发器、域名修改、`cam:*`、`sts:*`。
- 已知限制：`scf:Invoke` 是操作级接口，标签条件管不住，角色能调用账号里任意函数（实测对无标签函数 Invoke 成功）。不能改代码、不能读配置，但能触发执行。

## 发布做什么

1. `node scripts/package-unified-scf.mjs --apply` 打统一包（约 55 MB，超过 SCF 内联 50 MB 上限，所以走 COS）。
2. 上传到 `cos://demox-analytics-raw-1307257815/scf-deploy/ci/demox-unified-scf-<commit>-<sha>.zip`（ap-chengdu）。
3. `UpdateFunctionCode`：**只换代码**（Handler 固定 `index.main`）。不调用 `UpdateFunctionConfiguration`，不传环境变量、内存、超时、VPC。CI 也不调用 `GetFunction`（它会返回环境变量明文）：状态用 `ListVersionByFunction`，触发器用 `ListTriggers`。这两个接口在 CI 角色上都是显式 Deny，所以“环境变量不被读、不被改”由权限保证。
4. `PublishVersion` → 新版本 N。
5. 对 N 直接 `Invoke`：`GET /health` 200、`GET /` 401、`OPTIONS /auth/login` 200/204。任一失败就停，**production 不动**。
6. `develop`、`production` 别名指向 N。
7. 公网复查 `https://api.demox.site/health`、`/`（3 轮，间隔 20 秒）。失败自动把 production 切回发布前的版本。
8. 可选 `with_runtime`：同一个包更新 `demox-user-nodejs`。它没有别名（路由用 `$LATEST` 触发器地址调用），所以先发一个快照版本作为回滚点，更新后公网复查，失败就把快照版本的代码装回去。

push 到 master（相关目录有改动）只有在仓库变量 `FUNCTION_API_AUTO_DEPLOY=true` 时才自动发布；手动触发（`plan` / `deploy` / `rollback`）随时可用。`concurrency: deploy-function-api`，同一时间只跑一个，不取消正在跑的发布。

## 回滚

- Actions → **Deploy function-api** → Run workflow → `action=rollback`，`version=<上一个版本号>`。每次发布的 Summary 里写着上一个版本号。脚本会先对目标版本做健康检查再切。
- 应急（不经 CI）：`tccli scf UpdateAlias --region ap-guangzhou --Namespace demox --FunctionName demox-function-api --Name production --FunctionVersion <N>`。
- 环境变量从不被 CI 改动，所以回滚只涉及代码版本。

## 一次性迁移（启用 CI 前，需要批准后人工做一次）

现在 `api.demox.site` 的 24 个入口和两个定时触发器都指向 `$LATEST`：直接更新代码就等于切流量。脚本的 `plan` 会报错并拒绝发布，直到完成下面几步：

1. 把当前线上代码固定成版本：`tccli scf PublishVersion --region ap-guangzhou --Namespace demox --FunctionName demox-function-api --Description "baseline before CI"` → 记下版本号 B。
2. 建别名：`tccli scf CreateAlias ... --Name production --FunctionVersion B`，`--Name develop --FunctionVersion B`。CI 角色不能建别名（`scf:Create*` 被 Deny），`production` 不存在时脚本直接报错；`develop` 不存在只警告并跳过。
3. 把 `api.demox.site` 所有 `FunctionName=demox-function-api` 的入口 `Qualifier` 从 `$LATEST` 改成 `production`（`GetCustomDomain` 取出 `EndpointsConfig`，只改 Qualifier，原样 `UpdateCustomDomain`，证书和协议保持不变）。
4. 定时触发器 `analytics-rollup-5m`（`0 */5 * * * * *`）和 `monthly-renew`（`0 17 3 1 * * *`）改为绑定 `production`：在两次 5 分钟触发之间删除后用同名、同 cron、`Qualifier=production` 重建。
5. HTTP 触发器 `3imzoal5x9`（`$LATEST`）：api.demox.site 不走它；确认没有调用方后可以保留（脚本只给警告）或改到别名上。
6. 不需要配腾讯云 secrets（OIDC，见上）。`demox-function-api`、`demox-user-nodejs` 必须带标签 `codename=demox`（已带）。
7. 手动跑一次 `action=plan`（同样要在 environment 里批准），全绿后再 `action=deploy`。第一次 plan 也是 OIDC 正向验证：日志里应出现“已通过 OIDC 扮演 …demox-ci-deploy”。
