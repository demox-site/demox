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
