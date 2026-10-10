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

## 第二次：17:52–17:53（500284c，#50）→ 带 cookie 的用户站点 400
- 17:52:28 ef-1281msyw → 500284c（RequestId 45f92712-40e2-46f3-8809-7b33f4cb802a）。p0:edge 第 1 轮：带 cookie 时 www 200、函数 200 且看不到 demox_access，但 coverage / uv0fkz31 的 GET 和 POST 都是 **400**（`origin=ok`，也就是源站回的 400）。17:53:23 回滚到 680e783（RequestId 6ca4128c-e9ab-488f-88e1-a11aed4db522）。
- 根因（源站 curl 已复现）：普通 init 原样复制了入站头，包括 `Host: <用户站点>`。用户站点源站是 `site-3.demox.site` → CNAME `demox-sites-1490780430.cos-website.ap-guangzhou.myqcloud.com`，COS 按 Host 找桶；`Host: uv0fkz31.demox.site` / `coverage.demox.site` → **400 UserCnameInvalid**，`Host: site-3.demox.site` → 200。`Content-Length: 0`、`Connection`、`Keep-Alive`、`TE`、`Upgrade` 单独加上都还是 200。
- 修复：普通 init 去掉 host 和逐跳头（host、content-length、connection、keep-alive、proxy-connection、transfer-encoding、te、trailer、upgrade、proxy-authorization、proxy-authenticate），由 fetch 按目标 URL 自己填。测试模型改成「入站 Request 当 init 时 EdgeOne 改写 Host；普通 init 的头原样发出」，并断言：任何上游 fetch 都不带入站 Host；带和不带 demox_access 发到源站的头完全一样，只差 Cookie。

## 第三次：18:04–18:05（de48527，#52）→ 带 cookie POST 静态页 405；改方案
- 18:04:32 ef-1281msyw → de48527（RequestId 4efcf20e-6df5-436f-a72e-11fc43292275）。第 1 轮：19 项里 18 项 PASS（site-3 三个站点 200，正文和不带 cookie 时一样；函数看不到 demox_access），唯一的 FAIL：带 cookie POST uv0fkz31 页面 → 405。18:05:27 回滚（RequestId cb751440-b658-4257-a56a-fdd949d298f6）。
- 证据（生产 680e783，不带 cookie）：POST / PUT / DELETE / PATCH 用户站点页面都是 200，正文就是源站对象（字节、ETag 都等于直接 GET 源站，没有水印注入——水印只在 GET 时注入）；直接对源站 POST 是 405。所以 EdgeOne 在「入站 Request 当 init」时是用 GET 回源的；普通 init 原样发 POST → 405。
- 决定（Chief + 云架构，18:07）：静态 / 源站 / 透传路径**完全恢复 #49 之前的转发方式**（`fetch(req)` / `fetch(url, req)`，不重建、不改头、不剥 cookie）；只在 `/api/*` 函数转发上剥离 demox_access；只要入站请求带 demox_access，响应上就追加两条过期 Set-Cookie（`Domain=.demox.site` 一条、host-only 一条，`Max-Age=0` 加上过去的 `Expires`），用 `new Response(resp.body, resp)` 包一层再 append，源站自己的 Set-Cookie 保留。静态源站（COS）不执行代码，收到这个 cookie 也不会用。
- 发布核对：发布前在旧代码上记录 baseline（`npm run p0:edge:baseline -- OUT.json`：GET/HEAD/POST/PUT/OPTIONS × www、coverage、uv0fkz31、letters-from-the-hill、函数，每个请求只带站点自己的 cookie），发布后 `BASELINE=OUT.json npm run p0:edge`：带 demox_access 逐项比状态码 + 正文 sha256，并检查两条过期 Set-Cookie，函数正文必须和 baseline 一样（也就是看不到 demox_access）。
