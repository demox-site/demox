# 自定义域名

## 用户要加哪条记录（系统自动判断，用户不用选）
| 情况 | 记录 |
|---|---|
| 子域名（`www.example.cn`、`a.b.example.com.cn`） | `CNAME <子域名部分> → customers.demox.site` |
| 根域名，DNS 在 Cloudflare（NS 是 `*.ns.cloudflare.com`） | `CNAME @ → customers.demox.site`（Cloudflare 会在根域名上把 CNAME 拍平） |
| 其他根域名（`example.cn`、`example.com.cn`） | `A @ → 网关 IP`（当前是 119.91.123.2），卡片里会注明「推荐用 CNAME，根域名才用 A 记录」 |

- 根域名和子域名用公共后缀表区分（website-api 用 `psl`），所以 `.com.cn`、`.co.uk` 这类后缀也能判断对。
- 检测分三步：解析 → 证书 → 可访问。解析这一步，CNAME 链能到 `customers.demox.site`，或者所有 A 记录都是网关 IP，都算通过。
- 公网 A 记录落在 Cloudflare 网段，说明开着橙色云。这时提示用户把这条记录的橙色云点成灰色（仅 DNS）。以后会支持保持代理接入，方案见 TXT-PLAN。

## ⚠️ 换网关 IP 之前
用 A 记录接入的域名不会跟着我们改，**网关 IP 一换，这些域名就打不开了**。所以要先通知他们：

1. 在 aigc 上运行 `scripts/custom-domain-proxy/list-a-record-domains.sh`，列出看不到 CNAME、A 记录又指向网关的域名。
   - Cloudflare 根域名开灰色云时也会出现在列表里。它们其实是 CNAME 拍平，会自动跟着变，可以从通知名单里去掉（NS 是 Cloudflare 的就是这种）。
2. 提前通知这些用户：新 IP 是多少，什么时候切换。新旧 IP 并行一段时间，同时把两个 IP 都写进 `CUSTOM_DOMAIN_GATEWAY_IPS`。
3. 切换完成后，再从 `CUSTOM_DOMAIN_GATEWAY_IPS` 里去掉旧 IP。
