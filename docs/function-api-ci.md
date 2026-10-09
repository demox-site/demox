# function-api 走 GitHub Actions 发布

`demox-function-api`（统一 SCF 路由，ap-guangzhou，namespace `demox`）由 `.github/workflows/deploy-function-api.yml` 发布，脚本是 `scripts/ci/scf-function-api.cjs`。不再用 `scripts/deploy-function-api.mjs`，那个脚本依赖 phosa Mac 上的工具，而且会**覆盖函数环境变量**。

## 发布做什么

1. `node scripts/package-unified-scf.mjs --apply` 打统一包（约 55 MB，超过 SCF 内联 50 MB 上限，所以走 COS）。
2. 上传到 `cos://demox-analytics-raw-1307257815/scf-deploy/ci/demox-unified-scf-<commit>-<sha>.zip`（ap-chengdu）。
3. `UpdateFunctionCode`：**只换代码**。不调用 `UpdateFunctionConfiguration`，不传环境变量、内存、超时、VPC。前后比对环境变量摘要（只比哈希，不读出值），变了就停。
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
2. 建别名：`tccli scf CreateAlias ... --Name production --FunctionVersion B`，`--Name develop --FunctionVersion B`。
3. 把 `api.demox.site` 所有 `FunctionName=demox-function-api` 的入口 `Qualifier` 从 `$LATEST` 改成 `production`（`GetCustomDomain` 取出 `EndpointsConfig`，只改 Qualifier，原样 `UpdateCustomDomain`，证书和协议保持不变）。
4. 定时触发器 `analytics-rollup-5m`（`0 */5 * * * * *`）和 `monthly-renew`（`0 17 3 1 * * *`）改为绑定 `production`：在两次 5 分钟触发之间删除后用同名、同 cron、`Qualifier=production` 重建。
5. HTTP 触发器 `3imzoal5x9`（`$LATEST`）：api.demox.site 不走它；确认没有调用方后可以保留（脚本只给警告）或改到别名上。
6. 在 GitHub 配 secrets `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY`（可选 `TENCENTCLOUD_REGION`），用只有 Demox SCF 权限的子账号，见 CAM 方案。
7. 手动跑一次 `action=plan`，全绿后再 `action=deploy`。
