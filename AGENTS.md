# AGENTS.md

本文件给 AI coding agent 使用，优先级高于面向用户的 README。修改、发布本项目时请先阅读。

## P0 禁令：边缘路由 404 不得误伤全站

2026-09-14 把未绑定子域名改成 Demox 404 时，`www.demox.site` 和全部已发布 `*.demox.site` 一起变成 404。事故全文：[docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md](docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md)。

`edge-functions/subdomain-router.js`（EdgeOne `ef-1281msyw`）挂在整个 `*.demox.site` 上，包括主站。改它等于改全网入口。

- 「站点不存在」和「站点存在但这一跳回源 404」不是同一件事。禁止把回源 404 收成全局「页面不存在 / 站点未发布」。
- 改 404 / 未知 host 必须先有 `handle()` 测试：已 resolve 的 `www` 首页、已 resolve 的用户站点首页，都必须是 200。
- `ModifyFunction` 之后立刻核对，缺一项就回滚，禁止只看未知域名：
  1. `https://www.demox.site/` → 200，且是主站页面
  2. 至少一个真实用户站点 → 200
  3. 这才去看未绑定 host 的 404
- 核对失败：把上一份 `subdomain-router.js` 写回 `ef-1281msyw`，不要继续改。
- 未绑定子域名的品牌 404：更新 COS 桶 `resource-game-1307257815` 根对象 `404.html`（源文件 `edge-functions/cos-root-404.html`）。**不要为这件事改边缘函数。**

## 发布方式

Demox 自己也是平台上的一个站点（`EPX2UU43`）。功能更新走 Demox CLI，不要为了改登录、站点、部署业务或主站页面去动腾讯云函数脚本。

前端（控制台、主站页面）正式发布走 GitHub：

```bash
git push origin master
```

Actions 会 `npm run build`，再执行 `demox deploy ./dist --id EPX2UU43`。本地同一条 CLI 只用于紧急核对；发完仍要推到 `origin/master`，让远程和线上一致。

后端业务云函数（Auth / Website / MCP / 证书续期）已经挂在同一站点上，用函数推送：

```bash
demox functions list --id EPX2UU43
demox functions push ./scf-deploy-packages/auth-api --id EPX2UU43 --slug auth
demox functions push ./scf-code/website-api --id EPX2UU43 --slug website
demox functions push ./scf-code/mcp-api --id EPX2UU43 --slug mcp
demox functions push ./scf-code/cert-renew --id EPX2UU43 --slug cert-renew
```

仓库里的 CLI 在 `../cli`（`node dist/cli.js`）。npm `@demox-site/cli@1.1.6` 已含 `functions` / `env` / `alias`。平台自己发函数仍用仓库 CLI。

用户站点（朋友的 Node 前后端）同样只走仓库 CLI，不要打开控制台：

```bash
DEMOX="node ../cli/dist/cli.js"
$DEMOX deploy ./dist --name 站点名
$DEMOX functions push ./api/hello --id WEBSITE_ID --slug hello
$DEMOX env set --id WEBSITE_ID --slug hello --from .env
$DEMOX functions alias set --id WEBSITE_ID --slug hello production --version 2
$DEMOX functions invoke --id WEBSITE_ID --slug hello --body '{}'
```

后端必须是 `module.exports = async function handler(request, env)`，不是 Express listen。详见 `skills/node-backend-cli/SKILL.md`。

主站前端的正式路径是 `git push origin master` → GitHub Actions → `demox deploy ./dist --id EPX2UU43`。不要用 Cycor，不要改 Actions 里的目标站点，不要把 `DEMOX_TOKEN` 写进代码或文档。

## 什么时候才能动腾讯云函数

只有改「发布能力本身」时才部署统一 SCF：路由、`demox-user-nodejs` 运行时、内网 hop、`/deploy` 协议、函数平台。这时：

```bash
node scripts/package-unified-scf.mjs --apply
node scripts/deploy-function-api.mjs --unified --apply
```

线上入口是命名空间 **`demox`** 里的 `demox-function-api`（路由器）和 `demox-user-nodejs`（用户 Node 运行时）。对外 API 只用 `https://api.demox.site`。

不要更新、也不要删除旧的四支回滚函数：`demox-website-api`、`demox-auth-api`、`demox-mcp-api`、`demox-cert-renew`。它们的定时器应保持关闭。所有 tccli / SDK 调用必须带 `Namespace=demox`。腾讯云 Demox 专属资源必须打计费标签 **`codename=demox`**。共享 MySQL 不要改成 demox。完整清单见 [docs/tencent-cloud.md](docs/tencent-cloud.md)。

## 给 Agent 的发布提醒

- 用户说「发布吧」「上线吧」时：主站页面走 `git push origin master`（Actions 里 `demox deploy`）。业务云函数走 `demox functions push`。不要默认跑 `deploy-function-api.mjs`。
- 只改 `index.js` / `index.cjs` 入口即可用 CLI 推送。`shared/` 和运行时 `node_modules` 仍在统一包里；改这些附属文件等于改运行时，才走统一 SCF 部署。
- 统一部署后的种子只会在函数不存在或仍是旧包装源码时写入，不会盖掉 CLI 已发布的版本。
- 不要临时改 `.github/workflows/deploy.yml` 中的目标站点，除非用户明确要求。
- 发布前建议至少执行 `npm run build`（前端）或对应包的测试（后端）。
- 改 `edge-functions/subdomain-router.js` 或对 `ef-1281msyw` 做 `ModifyFunction`：先读本文 P0 禁令，跑 `npm run test:edge-router`，上线后立刻核对 `www` 和一个真实用户站点仍是 200。详见 [docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md](docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md)。
