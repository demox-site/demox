---
name: demox-edge-router
description: Mandatory guard for Demox EdgeOne subdomain-router. Use when editing edge-functions/subdomain-router.js, deploying ef-1281msyw, changing hosted 404 pages, unknown subdomains, your-demo.demox.site, or any *.demox.site edge routing.
---

# Demox 边缘路由（P0）

先读事故：[docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md](../../docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md)。`AGENTS.md` 里的禁令优先于本文件。

`subdomain-router` 挂整个 `*.demox.site`，包括 `www`。改 404 等于改全网入口。

## 两件不同的事

| 情况 | 判断 | 允许的处理 |
|------|------|------------|
| 站点不存在 | `resolve-subdomain` 没有 `path` | 才可以考虑未绑定 host 的品牌 404 |
| 站点存在，这一跳回源 404 | 已经有 `path` | 必须走 `rewriteOrigin`（SPA fallback / 站点自己的 404.html） |

禁止把回源 404 收成「站点未发布」或全局「页面不存在」。

未绑定官方子域名的品牌 404 已经走 COS 静态网站 ErrorDocument：桶 `resource-game-1307257815` 根对象 `404.html`，源文件 `edge-functions/cos-root-404.html`。改文案就更新这个文件并上传，不要改 `ef-1281msyw`。

## 上线前

1. `npm run test:edge-router` 必须包含：已 resolve 的 `www` 首页 200、已 resolve 的用户站点首页 200。
2. `ModifyFunction` 写 `ef-1281msyw` 之后立刻核对，缺一项就回滚：
   - `https://www.demox.site/` → 200，正文是主站
   - 至少一个真实用户站点（如 `https://coverage.demox.site/`）→ 200
   - 然后才看未绑定 host
3. 核对失败：用上一份 `subdomain-router.js` 再 `ModifyFunction`，不要继续改。

## 回滚演练

发布路径只有 `scf-code/deploy-edge-functions.sh` 里的那条 `tccli teo ModifyFunction`（`ef-1281msyw`，zone `zone-3kplfkbflnd6`，region `ap-guangzhou`）。回滚用同一条，不另开发布入口。

`scripts/edge-router-rollback.sh`：

1. `plan` 只打印函数、zone、两边内容的 sha256，以及将要执行的 tccli 形状。不写云，不打印函数正文。
2. `PREVIOUS=<文件或 git rev> APPLY=1 scripts/edge-router-rollback.sh drill` 才写：
   - `DescribeFunctions` 把**当前线上正文**存到临时文件（这是「再发回去」的那一版）
   - `ModifyFunction` 换成 `PREVIOUS`（上一份已发布内容）
   - 跑 `scripts/edge-p0-check.sh`：`www` 200、一个真实用户站点 200，带和不带假的 `demox_access` 各一遍
   - `ModifyFunction` 写回刚才存下的线上正文
   - 再跑一遍同样的核对
3. 上一份核对失败也会先写回线上正文，再以非 0 退出。
4. `scripts/edge-router-rollback.sh self-test` 用假的 tccli 走完来回，不接触云。CI 跑的是这一档。

`PREVIOUS` 指向上一次发布时的 `edge-functions/subdomain-router.js`（git rev 或当时留下的文件）。两边 sha256 相同就停，避免空转。

## D2：OPTIONS 列

下面四类 host 的 OPTIONS 是边缘本地 **204**，不查库、不回源。已解析站点（www、用户站、函数）的 OPTIONS 仍回源；P0 矩阵那一列继续和 baseline 比状态码和正文。

| host | OPTIONS |
| --- | --- |
| `static.demox.site` | 本地 204 |
| `cdn.demox.site` | 本地 204 |
| 未知官方子域名 | 本地 204 |
| 未绑定自定义域 | 本地 204 |
