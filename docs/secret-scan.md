# 密钥扫描（gitleaks）

结论：仓库里不允许出现任何 token / 密钥，**包括测试用的假 JWT**。CI 和本地提交都会拦。

## 会拦什么
- gitleaks 默认规则（云密钥、GitHub token、私钥、JWT 等）
- 额外规则 `jwt-shaped`：任何 `eyJ…` 开头的三段式字符串，哪怕是假的

配置：`.gitleaks.toml`。历史里已确认的误报：提交 f78c530 整条放行（测试假 JWT，GitGuardian 已按误报结案）；
另外两条历史占位按指纹写在 `.gitleaksignore`。不改写历史。

## CI
`.github/workflows/secret-scan.yml`：每个 PR 和 master push 都跑，扫全部历史 + 当前文件，发现就让构建失败。

## 本地提交前
```sh
brew install gitleaks            # 或从 GitHub releases 下载
git config core.hooksPath .githooks   # npm install 时 prepare 脚本会自动设
```
之后每次 `git commit` 会先扫暂存区；没装 gitleaks 也会拒绝提交。手动全量扫：`npm run scan:secrets`。

## 测试里需要 JWT 怎么办
用 `scripts/test-jwt.cjs`：
```js
const { randomTestSecret, signTestJwt } = require('../../scripts/test-jwt.cjs');
process.env.JWT_SECRET = randomTestSecret();          // 每次运行随机
const token = signTestJwt({ userId: 'u-1' });         // 运行时签发，源码里没有字面量
```
不要把 token 字符串直接写进源码、文档或注释。
