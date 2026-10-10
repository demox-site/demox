# 2026-10-10 17:18–17:23（UTC+8）：#49 的 edge 让带 demox_access 的请求 503 / 404

## 经过
- 17:18:05 `ef-1281msyw` 换成 master 3050f5d（#49）的 `subdomain-router.js`（ModifyFunction RequestId faa0d404-7eae-4fa5-81c8-4ed544d82fbf）。
- 17:18–17:20 P0 核对（www 200、coverage 200、your-demo 404）全部通过，但**请求都没带 cookie**。
- 17:22 用探针站 `uv0fkz31.demox.site` 带假 `demox_access` 验证时发现：
  - 公开站点（探针、coverage）→ 503「暂时无法访问」，`x-demox-route: …; origin=error`
  - `www.demox.site` → 404
  - 不带 cookie 的同一请求一切正常；`/api/*` 函数转发正常，并且已经剥掉了 `demox_access`
- 17:23:15 ModifyFunction 回滚到 680e783（RequestId f2ba1222-51b8-4d55-92a2-953e00396c3b）。回滚后带和不带 cookie 都正常。
- 影响：约 5 分钟里，浏览器还留着父域 `demox_access` 的用户（以前在 www 登录过的人）打开任何公开 `*.demox.site` 站点都是 503，打开 www 是 404。这些响应同时带了过期 Set-Cookie，刷新一次应该就恢复了（没有在生产上验证）。

## 根因（推测，等 EdgeOne 预发验证）
#49 新增的 `withoutAuthCookie(req)` 用 `new Request(req, { headers })` 重建入站请求，然后用于
`fetch(url, 重建的Request)`（回源）和 `fetch(重建的Request)`（透传 / 异常兜底）。只有带 `demox_access` 时才会走到这里。
EdgeOne 运行时很可能不支持「用 Request 构造 Request」（或者不接受重建的 Request 当 init），
所以抛错：用户站点走加固回源 → 映射成 503 `origin=error`；www 不走加固 → 异常 → passThroughOnException → 404。
Node 单测用的是 Node 的 Request/fetch，没有这个限制，所以全部通过。
`/api/*` 函数转发一直是 `new Request(字符串URL, 普通init)`，事故期间带 cookie 也正常，可以印证这一点。

## 修复
- 带 `demox_access` 时用普通 init 对象 `{ method, headers: 剥掉后的头, redirect, body+duplex(非 GET/HEAD) }` 去 fetch；
  不带时保持 #49 之前的写法（`fetch(url, req)` / `fetch(req)`），这条路径线上一直在用。
- 新增模拟 EdgeOne 的单测：`Request(Request, …)` 抛错，重建的 Request 当 init 也抛错；每个场景（公开站点 GET/POST、www GET、函数 GET/POST、未知 host 透传）带和不带 cookie 各测一遍。旧代码在这组测试下会失败（复现了事故）。
- `scripts/edge-p0-check.sh`（`npm run p0:edge`）：每项核对都带和不带 cookie 各跑一遍。

## 上线前必须
1. 预发：单独的测试边缘函数只绑一个测试 host，GET/POST × 带和不带 cookie 全部通过，才能动 `ef-1281msyw`。
2. 上线后 `npm run p0:edge`，必须包含探针站 `UV0FKZ31`（`https://uv0fkz31.demox.site/` 和 `/api/cookies`），带 cookie 那一遍全部 PASS。
