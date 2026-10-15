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

1. 新建一个边缘函数，不要改 `ef-1281msyw`，不要改 `rule-fxfyqmn5`（`*.demox.site`）。
2. 只在这个测试函数上配置 `DEMOX_API_URL=https://api.demox.site`，以及和线上相同的 KID / 签名槽。值在控制台配，不要写进仓库或这条脚本。
3. 等该函数的默认域名生效（`<name>.eo-edgefunctions.com`，见 `scf-code/deploy-edge-functions.sh`）。触发规则留空。
4. 用下面的脚本打默认域名。脚本带真实 Host：`www.demox.site`、用户站、`sites.demox.site`，以及 `EO-Connecting-IP`、`CDN-Loop`、占位 Cookie。后端是测试函数环境里的真实 `api.demox.site`，延迟就是线上那一档。
5. 路由器看的是请求 URL 的 host，不是单独一个 Host 头。默认域名如果仍用自己的 URL，www 分支不会跑到。这时打开这个测试函数的 Web 调试（[文档](https://edgeone.ai/zh/document/63556)），把请求 URL 设成下面五个，请求头与脚本相同。不要在 `ef-1281msyw` 的编辑页点保存并部署。

| 请求 URL | 期望 |
| --- | --- |
| `https://www.demox.site/` | 200，`x-demox-route: origin-guard=internal`，不是 423 |
| `https://www.demox.site/pricing` | 200，`origin-guard=internal` |
| `https://www.demox.site/not-a-published-page` | 404（不在 SPA 名单里），`origin-guard=internal` |
| `https://sites.demox.site/sites/<uid>/<封禁 ID>/dist/index.html` | 403，`origin-guard=blocked` |
| `https://coverage.demox.site/` | 200 |

`origin-guard=internal` 只有这份代码自己处理 sites 重入时才会写上。测试函数去拉 `sites.demox.site` 时，zone 规则仍把子请求交给现在的生产函数（#78）。#78 不写 `origin-guard=internal`。这种情况下脚本用 `REQUIRE_INTERNAL=0`，423 和 `origin-guard=allow` 仍然算失败。`allow` 表示令牌没带上。不要为了看到 `internal` 去改 `rule-fxfyqmn5`。

冷的 www 应接近一次真实 API 往返（大约 1–1.5s），而不是 16 跳。

```bash
EDGE_ORIGIN=<测试函数默认域名> \
USER_HOST=coverage.demox.site \
BANNED_URL='https://sites.demox.site/sites/<uid>/<ID>/dist/index.html' \
bash scripts/origin-guard-www-verify.sh
```

## 回滚（30 秒，无密钥）

事故里回滚就是把 `ef-1281msyw` 的正文写回 #78（`3dea4e0`）。不要跑 `scripts/edge-router-rollback.sh drill`：drill 会先换成上一份，核对完再把刚才的线上正文写回去。

```bash
PREV=$(mktemp)
git show 3dea4e0:edge-functions/subdomain-router.js >"$PREV"
tccli teo ModifyFunction \
  --ZoneId zone-3kplfkbflnd6 \
  --FunctionId ef-1281msyw \
  --region ap-guangzhou \
  --Content "$(cat "$PREV")"
rm -f "$PREV"
curl -sS -D - -o /dev/null --max-time 15 https://www.demox.site/
curl -sS -D - -o /dev/null --max-time 15 https://coverage.demox.site/
```

www 不应再是 423，两个都要 200。若仍是 423，只重试这两条 curl，不要再换一份别的正文。
