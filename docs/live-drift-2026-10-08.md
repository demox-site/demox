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

## 3. 主站前端 www（EPX2UU43 静态资源）——源码缺失

- 线上 `www.demox.site` 的 bundle（`/assets/index-DRfpVgvc.js`，Last-Modified 2026-09-20 16:53）包含后台「站点举报」管理界面。它会调用 `/website/list-site-reports`（`list_site_reports`）和 `updateSiteReport`，另外还有禁用站点相关的 UI。
- master 的 `src/` 里没有这些代码。我们手里只有构建产物，**没有源码，所以这里不提交 bundle**。
- **在任何 www 发布之前**（包括合并到 master 触发 Actions 的 `demox deploy ./dist --id EPX2UU43`），必须先由当初写这部分的人把前端源码找回来，合进 master。否则发布会把举报 / 禁用管理界面从线上删掉。

## 其他

- SCF `demox-website-api` 实际是 `lam-lfjopvn0`（旧注释写的 `lam-ixkn6jpq`），只作回滚，不要更新。
- 回滚资料（只在发布机上）：`/workspace/release-2026-10-08/rollback/`。
