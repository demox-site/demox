# P0 · 未知子域名 404 误伤全站

- 日期：2026-09-14
- 级别：**P0**（主站 + 全部 `*.demox.site` 用户站点不可用）
- 状态：边缘函数两次改未知 host 都误伤已发布站点，均已回滚。未绑定子域名的品牌 404 改走 COS 静态网站已配置的根对象 `404.html`（`resource-game-1307257815`），**不要再为这件事改 `ef-1281msyw`。**
- 函数：EdgeOne `ef-1281msyw`（`edge-functions/subdomain-router.js`），规则 `rule-fxfyqmn5`，host=`*.demox.site`

## 发生了什么

为了让未绑定的官方子域名（例：`https://your-demo.demox.site/`）不再露出 COS `NoSuchKey` 页，把「resolve 不到 path」改成了返回 Demox 404 HTML，并立刻 `ModifyFunction` 上了生产。

上线后：

| 地址 | 期望 | 实际 |
|------|------|------|
| `https://your-demo.demox.site/` | 品牌 404 | 品牌 404（目标达成） |
| `https://www.demox.site/` | 主站 200 | **404「页面不存在」** |
| `https://coverage.demox.site/` 等已发布站点 | 200 | **404「页面不存在」** |

回滚：把 `ef-1281msyw` 的 Content 写回 git 里改动前的 `subdomain-router.js`。回滚后主站和用户站点恢复 200，未绑定子域名回到 COS `NoSuchKey`。

## 根因（必须记住）

`subdomain-router` 挂在 **整个** `*.demox.site` 上，包括 `www`。不是「只处理未绑定域名」的旁路。

这次把两件不同的事混在一起了：

1. **站点不存在**（`resolve-subdomain` 没有 path）→ 才可以考虑品牌 404。
2. **站点存在，回源这一跳 404**（缺文件、SPA fallback、www 文档路由）→ 必须走原来的 `rewriteOrigin`：已发布站点回 `index.html`，www 未知文档路径才用站点 404。

单元测试只覆盖了「未知 host 返回 404」，没有用 `handle()` 打：

- 已 resolve 的 `www.demox.site/`
- 已 resolve 的用户站点首页
- 已 resolve 但路径 404、需要 SPA fallback 的页面

生产验证也只 curl 了 `your-demo.demox.site`，看到「新 404 LIVE」就停了，直到用户站点一起 404。

## 禁令

以后再动这条链路，**不允许**再犯下面任何一条：

1. 禁止把「回源 404」当成「站点未发布」。
2. 禁止只凭未知 host 的 curl 成功就发布边缘函数。
3. 禁止在 `handle()` 里改 404 分支却不补「已 resolve 站点必须 200」的测试。
4. `ModifyFunction` 之后、结束对话之前，必须对生产做这三项核对，缺一项就回滚：
   - `https://www.demox.site/` → **200**，正文是主站，不是「页面不存在 / 站点未发布」
   - 至少一个真实用户站点（如 `https://coverage.demox.site/`）→ **200**
   - 目标未绑定 host（如 `https://your-demo.demox.site/`）才看 404
5. 核对失败立刻 `ModifyFunction` 回上一份 Content，不要继续改。

回滚命令见 `scf-code/deploy-edge-functions.sh`。
