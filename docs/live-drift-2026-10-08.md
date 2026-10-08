# 线上与 master 的漂移记录（2026-10-08）

2026-10-08 上线平台修复前做的只读核对（UTC+8 约 11:00）。结论：线上有三处代码不在 master，也不在任何分支或 PR 里。

## 1. 站点函数 website（EPX2UU43 / slug `website` / `fn_NvQ52xeoTUwRkA`）

- 线上 production、develop 别名都指向 **v9**（2026-09-20 16:52 发布）。master 的 `scf-code/website-api/index.js` 停在 2026-09-16（634dee1）。
- v9 比 master 多约 346 行：
  - 站点举报：`report_site`、`list_site_reports`、`update_site_report`，`site_reports` 表由代码自建，概览里有 `reportsOpen`。
  - 新增可见性 `disabled`：`update_visibility` 接受 `disabled`，`check_site_access` 对禁用站点返回 `allowed:false`。`websites.disable_reason` / `disabled_at` 两列由代码自建。
  - 站点被禁用时通过 SES 给站主发邮件（`sendSesEmail`）。
  - `isProtectedOfficialSite`：保护 EPX2UU43 / `www`。
- **本分支已把 v9 原样提交为 `scf-code/website-api/index.js`**（sha256 `3d71c281…3de2`）。

## 2. 边缘函数 `ef-1281msyw`（subdomain-router）

- 线上内容最后更新于 2026-10-01 09:14，备注是「P0 rollback: unknown-host 404 again took down live sites」。也就是说 10-01 又回滚过一次，仓库里没有这次的事故记录。
- 比 master 多约 229 行：
  - 禁用站点页 `disabledSitePage()`。
  - 页面里注入的举报按钮和举报表单。
  - 大页面流式返回：`streamSiteResponse`、`htmlContentLength`。
  - 剥掉 COS 强制下载头。
- **本分支已把线上 Content 原样提交为 `edge-functions/subdomain-router.js`**，与线上逐字节一致。

## 3. 主站前端 www（EPX2UU43 静态资源）——源码已找回

- 线上 `www.demox.site` 的 bundle（`/assets/index-DRfpVgvc.js`，Last-Modified 2026-09-20 16:53）包含后台「站点举报」管理界面。它会调用 `/website/list-site-reports`（`list_site_reports`）和 `updateSiteReport`，另外还有禁用站点相关的 UI。
- 源码在 phosa 本机仓库 `demox-site/demox`（master 3526f48）未提交的改动里：`src/api.ts`、`src/layouts/ConsoleLayout.tsx`、`src/pages/AdminDashboard.tsx`。同一份工作区里的 website-api `index.js` 与线上 v9 逐字节一致，边缘函数与线上一致。**本分支已原样提交这三个文件。**
- 验证（2026-10-08）：用本分支的 `src/` 以线上同样的环境变量（`VITE_DEMOX_API_URL=https://api.demox.site`、`VITE_DEMOX_SITE_ID=EPX2UU43`、`VITE_DEMOX_FUNCTION_ENV=production`、`VITE_DEMOX_SITE_URL=https://www.demox.site`）跑 `vite build` + `scripts/generate-seo-pages.mjs`，产物与线上**逐字节一致**：`index-DRfpVgvc.js`（sha256 `fd4480a7…dd48`）、`index-2JOqasvv.css`、`mammoth.browser-BbbDp1Io.js`、`index.html`，另外抽查的 13 个页面（pricing、doc、privacy、llms.txt、sitemap.xml、404.html 等）也一致。
- 本机 stash `wip-before-pro-seo-release`（2026-08-24）是旧的 WIP：其中已上线的部分 master 里都有（SEO 页面、PKCE、专业版功能等以另一种实现合入），其余部分（workers 策略、`@demox-site/sdk` 重构、后台改版）线上没有，不需要找回。
- `site_reports` 表的迁移以 `020_add_site_reports.sql` 提交（本地原号 018 与部署锁迁移冲突，019 是画廊）。线上这张表早已由代码自建，迁移是幂等的。

## 其他

- SCF `demox-website-api` 实际是 `lam-lfjopvn0`（旧注释写的 `lam-ixkn6jpq`），只作回滚，不要更新。
- 回滚资料（只在发布机上）：`/workspace/release-2026-10-08/rollback/`。
