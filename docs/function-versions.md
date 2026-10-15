# 平台函数的 app / runtime 版本

Demox 自己的后端按三条轨道记账。这份清单只覆盖前两条里的平台函数。

| 轨道 | 是什么 | 在哪 |
|---|---|---|
| app | 平台函数的业务代码 | `functions.json` 的 `appVersion`，代码在 `codePaths` |
| runtime | 腾讯云 SCF 基底：打包、层、内存、超时、入口、环境变量**名**、触发器 | `runtimeVersion` 和 `runtime`。指纹不含变量值 |
| user | 用户在自己站点上发布的函数 | **不进** `functions.json` |

`demox-user-nodejs` 是平台的 Node 运行时池，不是用户函数，所以它在清单里，并且 `releaseVia` 是 `none`（这条 CI 不发布它）。旧的 `demox-website-api`、`demox-auth-api`、`demox-mcp-api`、`demox-cert-renew` 只作回滚，也不在清单里。

账号只写环境变量名 `TENCENTCLOUD_ACCOUNT_UIN`。清单里没有账号数字。

## 占位版本

`demox-function-api` 的 `appVersion` 是 `0.1.5`，`runtimeVersion` 仍是 `0.1.0`。`demox-user-nodejs` 的 app / runtime 仍是 `0.1.0`。线上 `develop` / `production` 已有 `demox-release`；统一包代码 sha256 变了就必须升 app，不能停在同一个 app 版本。`0.1.2` 把已经在 master 上的 website 公共后缀拒绝打进这份统一包：公开 API 跑的是包内的 website，不是单独 push 的 website 函数版本。`0.1.3` 带上 cert-renew 的 DNS-01 重试，以及定时器失败时让调用失败。`0.1.4` 把 DNS-01 重试的默认传播等待从 90s 降到 60s（`DNS_RETRY_PROPAGATION_MS` 仍可覆盖），让最坏情况落在现有 300s 超时内。`0.1.5` 给 analytics-rollup-5m 加水位和永久缺口（迁移 024）；合并 master 会走统一包发布，上线前仍要先有这两张表（函数里也有同一份 CREATE TABLE IF NOT EXISTS）。

`deploy-develop` 和 `deploy` 看到占位版本（`0.0.0-placeholder`）就停，不会打云 API。

`seed: true` 只在清单第一次出现时放开「同一次 diff 里改了代码却没升版本」。清单进了 base 之后就去掉 seed 和 seedNote，再改代码就必须升版本。占位期间如果只修正 `environmentNames`（入口、内存、超时、层、触发器都不动），版本保持 `0.0.0-placeholder`。

`scf-code/website-api/**`（测试和 markdown 除外）要给 `demox-function-api` 升 app。公开的 `https://api.demox.site` 不执行 `demox functions push` 出去的 website 版本：默认不设 `FUNCTIONS_PLATFORM_SITE_MODE=user-runtime` 时，平台站点函数在 function-api 进程内执行，入口是打进统一包的 `scf-code/website-api/index.js`。只推 website 函数、不升 function-api 的 app，公开路径仍是上一份统一包里的旧代码；app 版本不变而包 sha256 变了，发布会因 code-drift 停住。`scf-code/function-api/**` 的代码变更同样要升 app。runtime 仍是 `0.1.0`。

## 第一次发布

`develop` 和 `production` 都存在、都不指向 `$LATEST`，并且两个别名指向的版本描述都解析不出 `demox-release` 时，`deploy-develop` 允许做**一次** bootstrap（原因 `bootstrap-metadata`）。用同一份 COS 包走 `UpdateFunctionCode`，`PublishVersion` 时把 `demox-release` 写进新版本 Description，再把 develop 指过去。

允许的条件：

- 清单里的 app / runtime 是真实 semver，不是 placeholder。
- git 是 40 位小写十六进制，代码 sha256 是 64 位小写十六进制。
- 配置指纹能从清单入口算出来（入口、环境变量名、层、内存、超时、触发器）。算不出来就停。
- 不调用 `UpdateFunctionConfiguration`，不改环境变量值、入口、内存、超时、层、触发器，也不改包内容。
- 不切换 production。`action=deploy` 在两边都没有元数据时仍停，避免顺带切 production。production 只走原来的 `promote`。

这一次之后，缺元数据重新变成硬停：

- 只有一个别名有 `demox-release`、另一个没有：`missing-metadata`，停，不覆盖。
- 两个别名都有元数据：回到原来的升级规则（本地 app 必须更高；相同版本但 sha256 不同则失败；配置指纹必须相同；runtime 不能在这里变）。
- 目标版本描述里没有元数据时，`promote` 也不切 production。

## 发布怎么接 #67

`.github/workflows/deploy-function-api.yml` 的 `deploy-develop`（`cos_key` + `expected_sha256`，只切 develop）和 `promote`（`version=N`，要过 `function-api-production`）还是原来的命令。门禁加在它们前面：

1. 两个别名都还没有 `demox-release` 时，只允许上面的一次 bootstrap。两边都有元数据之后：本地 app 必须高于线上 app。相等但代码 sha256 不同，失败。本地更低，失败（CI 不降级）。
2. app 发布必须让配置指纹保持不变。runtime 版本或指纹变了，停在这里，不自动改内存、超时、层、环境变量或触发器。
3. 通过之后才走原来的动作：校验 COS 包 sha256，`UpdateFunctionCode`，`PublishVersion`，develop 健康检查。production 不动。
4. Chief 在 `function-api-production` 里批准后，`promote` 把 production 指到**同一个**版本，并追加一条发布记录。版本描述里没有元数据时，promote 也不切。

版本描述只有一行，例如：

```text
demox-release app=0.2.0 runtime=0.1.0 git=<40位> sha256=<64位> cfg=<64位>
```

`cfg` 是入口、环境变量名、层、内存、超时、触发器的 sha256。没有变量值。

发布记录在 `RELEASE_LOG`（workflow 里是 `docs/function-releases.jsonl`）追加一行：app、runtime、SCF 版本号、commit、sha256、配置指纹、批准人、时间。批准人用 `github.actor`（job 要等 environment 批准才会开始）。这个文件不会由本 PR 自动推回 master。

`runtime-plan` 只按清单重算指纹并打印。它不读线上配置，也不部署。真正的 runtime 变更要云架构复核和 Chief 批准，不在这条 CI 里自动做。

`--with-runtime` 会直接拒绝，避免顺带更新 `demox-user-nodejs`。

回滚仍是手动的 `action=rollback`：只把别名指回旧版本（app），不改 runtime 配置。清理旧版本是另一个手动流程，这里没有删除命令。

## 打包

`scripts/package-unified-scf.mjs` 用 `scripts/ci/unified-scf-package-lock.json` 做 `npm ci`，zip 按路径排序、mtime 固定在纪元、权限只留 `0644` / `0755`。同一棵目录树打两次，sha256 相同。改这份 lock 或打包脚本是 runtime 变更。

## 本地检查

```bash
npm ci --prefix scripts/ci --ignore-scripts --no-audit --no-fund
node scripts/ci/check-function-versions.cjs --base origin/master
node --test scripts/ci/scf-function-api.test.cjs
node --test scripts/ci/function-versions.test.cjs scripts/ci/reproducible-zip.test.mjs
node scripts/ci/scf-function-api.cjs runtime-plan
```

`npm ci --prefix scripts/ci` 只装打 zip 测试用的 archiver，不装主站依赖。

PR 上的 `Function versions` workflow 会跑前三条。`scf-function-api.test.cjs` 里包含 #67 的 deploy-develop / promote 单测。
