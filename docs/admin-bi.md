# 管理后台 BI 看板（get_admin_bi）

## 组成

- 后端：`scf-code/website-api/index.js`
  - `get_admin_bi`：仅管理员（和其它 admin action 一样走 `requireAdmin`）。纯 SELECT，不跑任何 `ensure*` / backfill，全部参数化；`range` 只允许 7 / 30 / 90，其它值按 30 处理；按 range 做 60 秒进程内缓存。某张表读不到时该项返回 `null`，并在 `warnings` 里写明，不让整个接口失败。
  - `statTime` / `adminBiLib` 直接内联在 index.js 里：线上 `demox functions push` 只上传 index.js，`shared/` 来自已部署的统一 worker 包，新增 shared 文件不会跟着发布（有单测守着）。
- 前端：`src/pages/admin/bi/`
  - `AdminBiOverview`：首屏 8 张 KPI 卡（加载即完整显示，没有进场动画；数据未到时是固定高度骨架）。
  - `BiSections`：首屏以下 增长 / 使用 / 流量 / 健康 4 个区块，recharts 图表都在这个分包里，滚动进入视口时淡入。
  - 管理后台（`AdminDashboard`）和站点分析页（`SiteAnalyticsPage`）改为按需加载，recharts 不再进 www 主包。
  - 预览演示：`VITE_ADMIN_BI_DEMO=1` 构建时，`main.tsx` 只挂载演示页（「示例数据」，`fixtures.ts`），不挂载 App，不请求任何接口。正式构建里这段代码被摇掉。

## 指标口径

| KPI | 来源 |
|---|---|
| 新注册用户 | `users.created_at` |
| 活跃部署者（7 天） | 服务端 `deploy_success` 的 userId ∪ `deploy_upload_sessions`（COMPLETED）∪ 7 天内新建站点的 user_id |
| 部署次数 / 成功率 | `product_events` 里服务端写的 `deploy_success` / `deploy_fail`（`page` 以 `server:` 开头）。同一个分块上传（uploadId）多次失败只算一次，后来成功了就不算失败 |
| 新站点 / 站点总数 | `websites` |
| PV | `site_path_daily_stats`，去掉扫描器路径（与旧概览一致） |
| UV | `site_access_logs` 按（脱敏 IP, UA）去重，**近似值** |
| 首页转化 | `landing_view` → `deploy_click` → 服务端 `deploy_success`（同一 visitor_id），访客去重 |
| 专业会员 | `user_roles`，含 30 天内到期、永久 |
| 待处理举报 | `site_reports.status = 'open'` |

## 埋点修复

1. 服务端白名单 `PRODUCT_EVENT_NAMES` 补上 `intent_guide_click`。单测会扫描 `src/` 里所有 `track("...")`，新加前端事件没进白名单就会失败。
2. `deploy_success` / `deploy_fail` 改为服务端记录：所有部署渠道都会经过 `upload_and_deploy` 或 `complete_deploy_upload`，在这两处各记一次。
   - 渠道 `props.source`：`web`（控制台上传，前端显式带 `deploySource`）、`mcp`（mcp-api 代理显式带）、`token`（PAT，目前主要是 GitHub Actions 的 DEMOX_TOKEN）、`cli`（OAuth 登录的 CLI）、`github`（客户端声明 `X-Demox-Client: github-actions`，CLI 1.1.6 还不会发）、`api`（其他）。只用于统计，不参与鉴权。
   - 网页上传会带上浏览器的 visitorId，首页漏斗才能串起来。
   - 前端不再上报这两个事件，服务端白名单也去掉了它们：旧版前端缓存里发来的会被丢弃，不会重复计数。
   - 并发锁冲突（`DEPLOY_IN_PROGRESS`，部署没真正开始）不记。
3. 统计日期统一按 **Asia/Shanghai（UTC+8）**：
   - 为什么：管理员和主要用户都在 UTC+8，按 UTC 切日会把早上 8 点前的访问算到前一天，看板和直觉对不上。
   - 数据库会话时区仍是 UTC（`shared/db.js` 不动），SQL 里用 `CONVERT_TZ(col, '+00:00', '+08:00')`（数字偏移，不依赖 MySQL 时区表），JS 里加 8 小时切日。
   - 访问汇总（rollup）写入的 `stat_date` 从发布起按 UTC+8；**历史行不回写**，发布当天会混合两种口径。
   - 原始访问日志在 COS 上的分区（`analytics/raw/date=…/hour=…`）仍按 UTC，只是存储路径，不影响统计。

## 发布（需要批准）

当前：website 函数 production → v11，develop → v9。master 上 website-api 还带着未发布的 #7 purge 改动和 020 迁移（`CREATE TABLE IF NOT EXISTS`，表已存在），发 v12 会一起带上。

1. 先发后端，再合前端（前端先上的话，看板会显示“加载失败”直到后端就位）。
2. 后端：
   ```bash
   demox functions push ./scf-code/website-api --id EPX2UU43 --slug website        # 生成 v12，别名不动
   demox functions alias set develop --id EPX2UU43 --slug website --version=12
   # develop 上验证：管理员 get_admin_bi 返回 success、warnings 为空；非管理员 403；
   # 用自己的测试站部署一次，product_events 多一条 page=server:cli 的 deploy_success；
   # track_product_event intent_guide_click 返回 code 0
   demox functions alias set production --id EPX2UU43 --slug website --version=12
   # P0：www 和真实站点 200；用测试站再部署一次
   ```
   可选：`demox functions push ./scf-code/mcp-api --id EPX2UU43 --slug mcp` 后切别名（不发的话，经 MCP 代理的部署会被记成 cli/token）。
3. 前端：合并 PR，CI 自动部署 www；确认主包体积和管理后台「数据概览」。

## 回滚

- 后端：`demox functions alias set production --id EPX2UU43 --slug website --version=11`（mcp 同理切回发布前的版本号，先记下来）。回滚后已写入的服务端部署事件留在表里，不影响旧版本。
- 前端：revert 合并提交，CI 重新部署 www。
