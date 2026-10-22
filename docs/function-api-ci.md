# function-api 走 GitHub Actions 发布

app / runtime 版本线、占位 semver，以及「线上没有 `demox-release` 元数据就停止、不覆盖」见 [function-versions.md](function-versions.md)。`deploy-develop` / `promote` 仍是下面这条流程，门禁加在写操作前面。本文件不授权发布。

`demox-function-api`（统一 SCF 路由，ap-guangzhou，namespace `demox`）由 `.github/workflows/deploy-function-api.yml` 发布，脚本是 `scripts/ci/scf-function-api.cjs`。不再用 `scripts/deploy-function-api.mjs`，那个脚本依赖 phosa Mac 上的工具，而且会**覆盖函数环境变量**。

## 凭证：GitHub OIDC → CAM 角色（没有长期密钥）

- workflow 不读任何腾讯云 secret。job 带 `permissions: id-token: write` 和 `issues: write`，并且在 GitHub environment **`function-api-production`** 里（只允许 `master`，没有 required reviewers），脚本用 GitHub OIDC token 调 `sts:AssumeRoleWithWebIdentity` 扮演 `qcs::cam::uin/100021031865:roleName/demox-ci-deploy`，拿 1 小时临时密钥，只留在进程内存里。本仓库不改这个 environment。
- CAM 身份提供商 `github-actions`（`https://token.actions.githubusercontent.com`，客户端 ID `sts.tencentcloudapi.com`，公钥自动轮转）。
- 角色信任条件：`oidc:sub = repo:demox-site/demox:environment:function-api-production`。不在这个 environment 里的 job（别的分支、PR）都换不到密钥。
- 权限策略 `demox-ci-deploy-policy`：只允许对带标签 `codename=demox` 的函数 `UpdateFunctionCode` / `PublishVersion` / `UpdateAlias` / 只读列表接口、读 `api.demox.site` 域名配置、往 `scf-deploy/ci/*` 上传包；显式 Deny `scf:Invoke`、`tag:*`、`GetFunction`、`UpdateFunctionConfiguration`、`UpdateFunction`、`scf:Create*` / `scf:Delete*`、触发器、域名修改、`cam:*`、`sts:*`。
- `scf:Invoke` 是操作级接口，标签条件管不住（实测对无标签函数也能调用），所以策略 v2 去掉了 Invoke 并显式 Deny；健康检查只走公网 HTTPS。策略 v1（含 Invoke）保留为非默认版本，可 `SetDefaultPolicyVersion --VersionId 1` 恢复。
- 三条发布路径的凭证现状、角色实际调用面、keep / 收窄清单见 [ci-cam-inventory.md](ci-cam-inventory.md)（2026-10-17 盘点）。该文不授权发布。

## 发布做什么

1. `node scripts/package-unified-scf.mjs --apply` 打统一包（约 55 MB，超过 SCF 内联 50 MB 上限，所以走 COS）。
2. 上传到 `cos://demox-analytics-raw-1307257815/scf-deploy/ci/demox-unified-scf-<commit>-<sha>.zip`（ap-chengdu）。
   - 桶 / 地域可用仓库变量 `DEMOX_COS_BUCKET` / `DEMOX_COS_REGION`（或手动触发的 `cos_bucket` / `cos_region`）改到其它桶。
   - `DEMOX_COS_ACCELERATE=true`（或手动触发 `cos_accelerate=true`）时，上传改走 COS 全球加速域名 `<bucket>.cos.accelerate.myqcloud.com`（SDK 选项 `UseAccelerate: true`），用于美国 runner → 国内桶跨境上传超时。默认关；开之前桶必须先开启全球加速。只影响上传：对象 key、sha256、分片 / 看门狗 / 重试都不变，`UpdateFunctionCode` 仍用原地域的桶。
3. `UpdateFunctionCode`：**只换代码**（Handler 固定 `index.main`）。不调用 `UpdateFunctionConfiguration`，不传环境变量、内存、超时、VPC。CI 也不调用 `GetFunction`（它会返回环境变量明文）：状态用 `ListVersionByFunction`，触发器用 `ListTriggers`。这两个接口在 CI 角色上都是显式 Deny，所以“环境变量不被读、不被改”由权限保证。
4. `PublishVersion` → 新版本 N。
5. 别名 `develop` 指向 N，经 develop 的公网 HTTPS 地址（仓库变量 `FUNCTION_API_DEVELOP_URL`）检查：`GET /health` 200、`GET /` 401、`OPTIONS /auth/login` 200/204（最多 4 轮，间隔 10 秒）。任一失败就把 develop 切回原版本并停，**production 不动**。不调用 `scf:Invoke`。
6. `production` 别名指向 N。
7. 公网复查 `https://api.demox.site/health`（必须 200）、`/`（必须 401）。每个探测最多 3 次，间隔 5 秒，单次超时 15 秒；任何一次状态码命中原期望即通过，三次都失败才把 production 切回发布前的版本。不读返回体，不把 522、其它状态码或超时当成通过。
8. 可选 `with_runtime`：同一个包更新 `demox-user-nodejs`。它没有别名（路由用 `$LATEST` 触发器地址调用），所以先发一个快照版本作为回滚点，更新后公网复查，失败就把快照版本的代码装回去。

push 到 master 且路径命中时，`scripts/ci/function-api-release.cjs` 自动走完：`stage`（只打包上传 COS）→ `deploy-develop`（只切 develop）→ 双账号 develop 冒烟 → `promote`（只切 production）→ 双账号 production 冒烟。没有 `FUNCTION_API_AUTO_DEPLOY` 开关。`workflow_dispatch` 只保留回滚。`concurrency: deploy-function-api`，同一时间只跑一个，不取消正在跑的发布。失败时，已经动过的别名切回去，job 变红，并开一条 `release-failure` issue（正文 @启明）。标题按版本门禁拒绝、部署失败、冒烟已回滚或冒烟回滚失败来写，正文带阶段和运行链接。详见 [release-automation.md](release-automation.md)。`ALERT analytics-rollup-5m` 的试打（含 `STALE_WATERMARK`、`CONFIG_MISSING`）只打 develop，不要打 production 或 `api.demox.site`。analytics-rollup 的迁移 024 由云帆用临时授权执行，跑完撤权，权限 diff 为 0。自动发布在同一个 job 里从 develop 切到 production，所以 024 要在这次推送之前已经在 develop 库和 production 库都跑完。运行时账号只加这两张表的 SELECT、INSERT、UPDATE。推送之前确认该环境 `ANALYTICS_RAW_ENABLED=1` 且 `ANALYTICS_RAW_BUCKET_ID` 已配置，否则 `CONFIG_MISSING` 会每 5 分钟打一次 high。

## 回滚

- Actions → **Deploy function-api** → Run workflow → 填磷的 `version` 和易点的 `version_ek`。手动入口只做回滚。脚本先把 develop 指向目标版本、经 develop 地址做健康检查，通过后再切 production。磷跳过 `api.demox.site` 复查。
- 应急（不经 CI）：`tccli scf UpdateAlias --region ap-guangzhou --Namespace demox --FunctionName demox-function-api --Name production --FunctionVersion <N>`。
- 环境变量从不被 CI 改动，所以回滚只涉及代码版本。

## 一次性迁移（启用 CI 前，需要批准后人工做一次）

现在 `api.demox.site` 的 24 个入口和两个定时触发器都指向 `$LATEST`：直接更新代码就等于切流量。脚本的 `plan` 会报错并拒绝发布，直到完成下面几步：

1. 把当前线上代码固定成版本：`tccli scf PublishVersion --region ap-guangzhou --Namespace demox --FunctionName demox-function-api --Description "baseline before CI"` → 记下版本号 B。
2. 建别名：`tccli scf CreateAlias ... --Name production --FunctionVersion B`，`--Name develop --FunctionVersion B`。CI 角色不能建别名（`scf:Create*` 被 Deny），`production` 不存在时脚本直接报错；`develop` 不存在只警告并跳过。
3. 把 `api.demox.site` 所有 `FunctionName=demox-function-api` 的入口 `Qualifier` 从 `$LATEST` 改成 `production`（`GetCustomDomain` 取出 `EndpointsConfig`，只改 Qualifier，原样 `UpdateCustomDomain`，证书和协议保持不变）。
4. 定时触发器 `analytics-rollup-5m`（`0 */5 * * * * *`）和 `monthly-renew`（`0 17 3 1 * * *`）改为绑定 `production`：在两次 5 分钟触发之间删除后用同名、同 cron、`Qualifier=production` 重建。
5. 给别名 `develop` 一个公网 HTTPS 地址，写进仓库变量 `FUNCTION_API_DEVELOP_URL`（不能是 api.demox.site 本身）：例如建一个绑定 `Qualifier=develop` 的 HTTP 触发器（函数 URL），或单独的自定义域名把 `/*` 指向 develop。没配置时 `plan` 报错，脚本不做任何写操作。
6. HTTP 触发器 `3imzoal5x9`（`$LATEST`，曾用 `https://1307257815-3imzoal5x9.ap-guangzhou.tencentscf.com`）是正在拆除的旁路：平台不能把 HTTP 触发器的 Qualifier 从 `$LATEST` 改走，因此只 `DeleteTrigger`，不重建、不改绑到别名。`https://api.demox.site` 与 production HTTP `3y2j2hgctz` 都不依赖它。已停用的 `scripts/deploy-function-api.mjs` 里 `fallbackPublicBaseUrl` 改为 `https://api.demox.site`。本步骤不执行删除。
7. 不需要配腾讯云 secrets（OIDC，见上）。`demox-function-api`、`demox-user-nodejs` 必须带标签 `codename=demox`（已带）。
8. 手动跑一次 `action=plan`（同样要在 environment 里批准），全绿后再 `action=deploy`。第一次 plan 也是 OIDC 正向验证：日志里应出现“已通过 OIDC 扮演 …demox-ci-deploy”。

## 双账号发布（REQ-7 双发，2026-10-20）

api.demox.site 走 EdgeOne 源站组：**易点**（UIN 100052992193，主源站 og-3wbc6x4y03bk，入口是 demox-function-api 的 HTTP 触发器）
和 **磷**（UIN 100021031865，备源站 og-3wbc6yrrll1l，入口是 SCF 自定义域名）。之前 CI 只发 磷，主源站代码会漂移。

- 开关：仓库变量 `DEMOX_EK_ENABLED` 必须是 `true`。自动发布缺这个值就失败，不会只发磷。
- 易点 变量（都不是密钥）：`DEMOX_EK_ROLE_ARN`（qcs::cam::uin/100052992193:roleName/demox-ci-deploy）、
  `DEMOX_EK_COS_BUCKET`（demox-deploy-gz-1490780430）、`DEMOX_EK_COS_REGION`（ap-guangzhou）、
  `DEMOX_EK_COS_ACCELERATE`（桶开了全球加速后再设 true）、`FUNCTION_API_DEVELOP_URL_EK`（易点 develop 别名的 HTTP 触发器地址）。
- 易点 角色 demox-ci-deploy：信任同一 GitHub OIDC（sub=repo:demox-site/demox:environment:function-api-production），
  权限与 磷 289081060 v4 相同（只限 namespace/demox/function/demox-function-api，要求 codename=demox 标签；COS 只限 scf-deploy/ci/*）。
- 顺序：磷（备）先、易点（主）后。stage 把同一个包（同一 key、同一 sha256）传到两边的桶；deploy-develop 两边各发一个版本（版本号各自独立，磷可复用已发布的同一包）。develop 冒烟打 `FUNCTION_API_DEVELOP_URL_EK` 和 `FUNCTION_API_DEVELOP_URL`。通过后 promote：磷先切（`DEMOX_SKIP_PUBLIC_CHECK=1`，不写发布记录）→ 易点切（写 `docs/function-releases.jsonl`）→ 再对 `https://api.demox.site` 和 `DEMOX_SMOKE_LIN_BASE` 做双账号冒烟。develop 冒烟失败只把两边 develop 切回，production 不动。promote 或 production 冒烟失败把两边 production 切回上一版。手动回滚仍要磷的 `version` 和易点的 `version_ek`。push 不再调用单账号 `action=deploy`：`scripts/ci/function-api-release.cjs` 在同一次任务里走完 stage → develop 冒烟 → promote → production 冒烟。

### 易点一次性迁移（开 DEMOX_EK_ENABLED 之前必须做；CI 角色不能做，Create* 显式 Deny）

现状（2026-10-20）：易点 demox-function-api 只有 $LATEST，HTTP 触发器 bbo9o057mh 在 $LATEST 上，EO 主源站直连它。
不迁移就发布 = UpdateFunctionCode 立即切主源站流量，所以脚本在 http-trigger 模式下会拒绝。

1. PublishVersion（当前 $LATEST，即 磷 v17 同一个包）→ 建别名 production、develop 指向它。
2. 在别名 production 上建 HTTP 触发器（EO 源站用），在 develop 上建 HTTP 触发器（健康检查用，写进 FUNCTION_API_DEVELOP_URL_EK）。
3. 把 EO 源站组 og-3wbc6x4y03bk 的源站地址改成 production 别名触发器域名（只改地址，**不改主备顺序**），验证后删掉 $LATEST 上的触发器。
4. 定时触发器（monthly-renew / analytics-rollup-5m，目前 Enable=0）保持关闭或改到 production；不要两边同时开。
5. 打开 DEMOX_EK_ENABLED，跑 action=plan 两边都应通过。
