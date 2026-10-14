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

`appVersion` / `runtimeVersion` 现在是 `0.0.0-placeholder`。这不是线上版本。线上 SCF 版本描述里还没有 `demox-release` 元数据。

在第一次经过批准的发布把元数据写进版本描述之前：

- `deploy-develop` 和 `deploy` 看到占位版本就停，不会打云 API。
- 就算清单改成了真实 semver，只要别名 `develop` / `production` 指向的版本描述里没有 `demox-release`，也会停下来告警，**不会覆盖**线上代码或配置。
- 本变更不部署、不切别名、不改线上配置。

`seed: true` 只在清单第一次出现时放开「同一次 diff 里改了代码却没升版本」。清单进了 base 之后，再改代码就必须升版本。

## 发布怎么接 #67

`.github/workflows/deploy-function-api.yml` 的 `deploy-develop`（`cos_key` + `expected_sha256`，只切 develop）和 `promote`（`version=N`，要过 `function-api-production`）还是原来的命令。门禁加在它们前面：

1. 本地 app 必须高于线上 app。相等但代码 sha256 不同，失败。本地更低，失败（CI 不降级）。
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
