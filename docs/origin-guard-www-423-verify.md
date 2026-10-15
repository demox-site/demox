# www 签名子请求 423：原因和上线前核对

2026-10-15 20:19:36 SGT，master `5e0b617`（#89 在 `f3758f0` 的 squash）写上 EdgeOne。之后 `www.demox.site` 返回 HTTP 423，没有 `x-demox-route`。20:21:56 回滚到 #78（`3dea4e0`）。`sites.demox.site` 的公开对象和用户站保持 `origin-guard=allow`、hop `guard`。423 之前仅有的一次 www 200 是 `origin-guard=allow`，不是 `internal`。

函数里没有 423。EdgeOne 在 `CDN-Loop` 的 loops ≥ 16 时由节点直接回 423。

## 根因

`f3758f0` 的 `copyRequestHeaders` 把入站头整份抄进新的 `Headers`，再 `fetch(sitesUrl, { method, headers })`。入站 `Host` 是 `www.demox.site`，URL host 是 `sites.demox.site`。EdgeOne 按 Host 把这条子请求送回 www，函数再签一次、再送回 www。`CDN-Loop` 加到 16，节点回 423，不跑函数，所以没有 `x-demox-route`。

#78 的 www 回源是 `fetch(url, req)`，`req` 是入站 Request，没有另建一份带 `Host: www.demox.site` 的头。Fetch 里从 URL 造出来的 Request，`headers.get('host')` 是空的，线上 Host 跟 URL 走，也就是 `sites.demox.site`。子请求在 sites 上再次进入函数（守卫或 #78 的普通回源），不会送回 www，所以 `CDN-Loop` 到不了 16。

本机 undici（EdgeOne 文档对照的同一套 Fetch）上：`Headers.append('host', ...)` 成功；`new Request(sitesUrl, request)` 会保留已经写进头列表的 `Host`，可以和 URL host 不一致。`f3758f0` 就是这条路。#78 不把 Host 写进一份新的头列表。

EdgeOne 写明的「子请求走节点缓存 / 回源、而不是按另一个 host 重新路由」要同时满足：`request.url` 的 host 和客户端 URL host 相同，并且 `request.headers.host` 也和客户端 Host 相同（[Fetch](https://edgeone.ai/document/52687)）。www → sites 两条都不等于客户端的 www，所以不会走那条捷径。显式 `Host: www` 配上 sites URL，网关按 Host 送回 www。

423 的节点行为：[4xx/5xx 排查](https://edgeone.ai/document/67228) 写 HTTP 423 是请求回环；[回源默认头](https://edgeone.ai/document/54211) 写 `CDN-Loop: TencentEdgeOne; loops=N`，loops ≥ 16 时节点拒绝并回 423。

那一次 200 `origin-guard=allow`：签发槽是空的时候 `signedWwwInit` 返回 null，调用方退回 `fetch(url, req)`（#78 的形状）。sites 重入没有令牌，by-ID 成功就是 `origin-guard=allow`，这个头带到 www 的响应上。槽为空的条件是 KID 不是 A/B，或 `DEMOX_ORIGIN_GUARD_SECRET_A` 读不到、或短于 32 字节。Secret 类型的环境变量在冷 isolate 上还没注入时就是这样。密钥可读之后每条 www 都走抄 Host 的路径，变成 423。`allow` 说明重入请求上没有有效令牌；签成功的内部回源应是 `origin-guard=internal`。

## 修复

www 的页面、SPA `index.html`、www 的 `404.html` 只从白名单抄头：`accept`、`accept-encoding`、`accept-language`、`range`、`if-none-match`、`if-modified-since`、`user-agent`，再加上 `x-demox-origin-token`。不带 Host、Cookie、Authorization、Proxy-Authorization、逐跳头（`connection`、`keep-alive`、`te`、`trailer`、`transfer-encoding`、`upgrade`、`proxy-*`）、`eo-*`、`x-forwarded-*`、`cdn-loop`。没有签名槽时仍把原来的 `req` 交给 `originFetch`。不按 Host 免裁决。15s TTL 和 503 超时响应不动。

## 上线前核对（不要动 ef-1281msyw）

测试函数和将要发布的文件必须是同一份字节。`DEMOX_TEST_HOST_MAP` 只配在 `ef-k2test` 上。生产不设这个变量。触发规则只匹配 `k2t-www`、`k2t-sites`、`k2t-apex`、`k2t-pub`、`k2t-ban`，并且排在 `rule-fxfyqmn5` 前面。不要改 `ef-1281msyw`。

内层那一跳打的是 `k2t-sites`，仍然进这份测试代码，所以 www 的 `/`、`/pricing` 和未知路径必须是 `origin-guard=internal`。`REQUIRE_INTERNAL=1` 是强制的，脚本拒绝把它关掉。

脚本只发公开 GET，带的 Host 和 URL host 相同。不保存正文、IP 或 Cookie。每个响应都要有 `x-demox-env: nonprod`。出现 423、503、5xx、599 或 `origin-guard=error` 即失败。

| 请求 URL | 期望 |
| --- | --- |
| `https://k2t-www.demox.site/` | 200，`origin-guard=internal`，`x-demox-env: nonprod` |
| `https://k2t-www.demox.site/pricing` | 200，`origin-guard=internal` |
| `https://k2t-www.demox.site/k2t-nope-<rand>` | 404，`origin-guard=internal` |
| `https://k2t-sites.demox.site/sites/1985655011013808129/EPX2UU43/dist/index.html` | 200，`origin-guard=allow` |
| `https://k2t-sites.demox.site/sites/<uid>/<封禁 ID>/…` | 403，`origin-guard=blocked`，no-store；再请求一次仍是 403 |
| `https://k2t-ban.demox.site/` | 403 |
| `https://k2t-sites.demox.site/sites/<uid>/<私有 ID>/…` | 403，`origin-guard=blocked` |
| `https://k2t-pub.demox.site/` | 200 |

```bash
BANNED_PATH='/sites/<uid>/<ID>/dist/index.html' \
PRIVATE_PATH='/sites/<uid>/<私有 ID>/dist/index.html' \
bash scripts/origin-guard-www-verify.sh
```

## 回滚

上线前先保存当时线上的函数正文，并核对哈希。回滚时 restore the saved, hash-verified pre-release live copy，然后做下面两条 curl。不要用 `git show` 取一份历史文件。不要跑 `scripts/edge-router-rollback.sh drill`。

```bash
curl -sS -D - -o /dev/null --max-time 15 https://www.demox.site/
curl -sS -D - -o /dev/null --max-time 15 https://coverage.demox.site/
```

www 不应是 423，两个都要 200。若仍是 423，只重试这两条 curl，不要再换一份别的正文。
