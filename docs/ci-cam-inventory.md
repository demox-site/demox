# CI 凭证与 CAM 角色盘点

盘点日期：2026-10-17。范围：仓库内全部 GitHub Actions workflow，以及 `scripts/ci/scf-function-api.cjs`。

**方法说明**：本文的结论来自仓库代码与 `docs/` 现有文档，**没有直接读取云端 CAM 策略本体**（盘点时没有 CAM 只读凭证）。凡标注「待核」的条目，都需要持有 CAM 只读权限的人用 `GetPolicy` / `GetRole` 复核一次再定稿。本文不授权任何发布。

## 1. 三条发布路径，两种凭证

| 路径 | workflow | 触发 | 凭证 | 人工闸门 |
|------|----------|------|------|----------|
| 主站 www 静态资源 | `deploy.yml` | push master（`src/**`、`public/**` 等 paths）+ 手动 | 仓库级 secret `DEMOX_TOKEN`（**站点所有者令牌，长期**） | **无 environment 审批** |
| 平台站点 website 函数 | `deploy-website-function.yml` | 仅手动，限 master | 仓库级 secret `DEMOX_TOKEN`（同上） | environment `website-function-production` 需批准 |
| 统一 SCF `demox-function-api` | `deploy-function-api.yml` | push（须 `FUNCTION_API_AUTO_DEPLOY=true`，当前未设）+ 手动 | **GitHub OIDC → CAM 角色 `demox-ci-deploy`**，1 小时临时密钥 | environment `function-api-production` 需批准 + 只允许 master |

**结论**：三条路径里只有一条完成 OIDC 化。另两条仍是长期令牌，且 `deploy.yml` 是唯一「merge 即上线」的路径——没有 environment 审批。

`deploy-website-function.yml` 文件头已经自己写了留办事项：

> TODO：团队有了自己的部署令牌后，存成 environment `website-function-production` 的 secret，并删除仓库级 `DEMOX_TOKEN`。

## 2. `demox-ci-deploy` 实际调用面

从 `scripts/ci/scf-function-api.cjs` 提取，当前可达代码路径上实际发起的调用：

| 类别 | 调用 | 用途 |
|------|------|------|
| SCF 读 | `ListVersionByFunction` | 查版本与 `demox-release` 元数据（不用 `GetFunction`，它会返回环境变量明文） |
| SCF 读 | `ListTriggers` | 前置检查触发器绑定 |
| SCF 读 | `ListAliases` | 读 develop / production 当前指向 |
| SCF 读 | `GetCustomDomain` | 读 `api.demox.site` 入口配置 |
| SCF 写 | `UpdateFunctionCode` | 换代码（Handler 固定，不动环境变量 / 内存 / 超时 / VPC） |
| SCF 写 | `PublishVersion` | 发版本 |
| SCF 写 | `UpdateAlias` | 切 develop / production |
| COS 写 | `putObject` + 分片 `Init` / `Upload` / `Complete` / `Abort` | 上传部署包到 `scf-deploy/ci/*` |
| COS 读 | `getObject` | `deploy-develop` 下载已有包校验 sha256 |

桶是 `demox-analytics-raw-1307257815`（ap-chengdu），对象前缀限定 `scf-deploy/ci/`。

**没有被调用的**：`GetFunction`、`UpdateFunctionConfiguration`、`UpdateFunction`、`Invoke`、任何 `Create*` / `Delete*`、`tag:*`、触发器写、域名写、`cam:*`。这与 `docs/function-api-ci.md` 写的「显式 Deny」一致。

## 3. 与文档宣称的差异（3 处）

### 3.1 `GetFunctionAddress` 已经用不到

`docs/function-api-ci.md` 列的允许清单里没有它，但代码在 `with_runtime` 分支调用过。该分支现在在 CLI 入口直接拒绝：

```js
if (argv.includes('--with-runtime')) {
  throw new Error('runtime 不会在这里自动发布。…');
}
```

所以这条权限**当前不可达**。若策略里为它留了口子，可以撤掉。**待核**：策略是否含 `GetFunctionAddress`。

### 3.2 COS 只说了「上传」，实际还要「读」

文档写的是「往 `scf-deploy/ci/*` 上传包」，但 `deploy-develop` 会 `getObject` 下载已有包校验 sha256。策略必须同时含该前缀的读权限，否则 `deploy-develop` 会在下载阶段失败。**待核**：策略里 `scf-deploy/ci/*` 的 action 集合是否同时含 Put 与 Get。

### 3.3 资源条件是标签，不是函数名

策略按计费标签 `codename=demox` 限定，而不是按 `FunctionName`。当前该标签下有两支函数：

- `demox-function-api` — CI 正常发布
- `demox-user-nodejs` — runtime 发布路径已禁用，但**角色对它仍有 `UpdateFunctionCode` / `PublishVersion` 能力**

含义：今后任何新打上 `codename=demox` 标签的函数，CI 角色自动获得改写代码的能力。这是标签条件的固有扩散面，不是当前配置的错误，但值得收窄。

另：`sts:*` 在策略里是显式 Deny，但不影响换密钥——`AssumeRoleWithWebIdentity` 是不签名接口，不走 CAM 授权。这不是缺陷，避免以后误读。

## 4. keep / 收窄

### keep（部署所需的最小集，不需要动）

- SCF 读：`ListVersionByFunction`、`ListTriggers`、`ListAliases`、`GetCustomDomain`
- SCF 写：`UpdateFunctionCode`、`PublishVersion`、`UpdateAlias`
- COS：`scf-deploy/ci/*` 的 Put / 分片 / Get
- OIDC 信任：`sub = repo:demox-site/demox:environment:function-api-production`，配合 environment 只允许 master + 人工批准
- 密钥有效期 1 小时、只留进程内存、不落盘

### 收窄（按优先级）

| # | 项 | 现状 | 建议 | 需谁定 |
|---|----|------|------|--------|
| 1 | 仓库级 `DEMOX_TOKEN` | 被 `deploy.yml` 与 `deploy-website-function.yml` 共用，仓库级 secret 对所有 workflow 可见 | 先建两个 environment 各自的同名 secret，删仓库级；再评估 www 走 OIDC | 直接做（第一步）；www OIDC 需 phosa |
| 2 | `deploy.yml` 无审批 | merge 到 master 即上线 www | 加 environment（如 `www-production`），保留 push 自动但要求批准 | 需 phosa（改变发布节奏） |
| 3 | `GetFunctionAddress` | 路径已禁用 | 从策略撤除 | 直接做（撤权限前先核策略是否有） |
| 4 | 角色资源按标签 | 对 `demox-user-nodejs` 也可写 | 资源条件加 `FunctionName ∈ {demox-function-api}`；若将来要恢复 runtime 发布再加回 | 需 phosa（涉及未来路线） |

## 5. 「稳」四条里这一项的判定

「稳」四条原文：触发器离 `$LATEST`；OIDC/角色落地；#49 有结论；#25/TLS（11/15）有结论或明确排期。

**判定：部分满足，不能勾掉。**

- 已满足：`demox-function-api` 这条路径完成了 OIDC 化，权限收到最小集，两条写操作都要过 environment 人工批准，且分两步（develop → promote），production 有自动回滚。
- 未满足：另外两条发布路径（www 静态、website 函数）仍是长期站点所有者令牌，其中 www 还是 merge 即上线。令牌无法限权、无法限时、无法按 environment 隔离。

按「三条路径全部无长期令牌」作为这一项的完成口径，当前是 **1/3**。

## 6. 复现方式

```bash
# 看三条路径各自的凭证
grep -n "DEMOX_TOKEN\|id-token\|TENCENTCLOUD_ROLE_ARN" \
  .github/workflows/deploy.yml \
  .github/workflows/deploy-website-function.yml \
  .github/workflows/deploy-function-api.yml

# 看 CI 实际调用了哪些 SCF 接口
grep -oE "scf\.[A-Z][A-Za-z]+\(" scripts/ci/scf-function-api.cjs | sort -u

# 看 COS 用到的操作与前缀
grep -nE "cosCall\('|cosPrefix" scripts/ci/scf-function-api.cjs
```
