# 自定义域名

## 用户要加哪条记录（一律 CNAME，用户不用选）
| 情况 | 记录 |
|---|---|
| 子域名（`www.example.cn`、`a.b.example.com.cn`） | `CNAME <子域名部分> → customers.demox.site` |
| 根域名（`example.cn`、`example.com.cn`） | `CNAME @ → customers.demox.site` |

- 根域名下面多一行灰色小字「根域名写不了 CNAME？」，默认收起，点开才显示备用：「如果 DNS 服务商不支持根域名写 CNAME，或根域名配了企业邮箱（MX 记录），改用 A 记录 @ → 网关 IP」（当前是 119.91.123.2）。根域名 CNAME 会和 MX 记录冲突，配了企业邮箱的要用 A 记录。DNS 在 Cloudflare（NS 是 `*.ns.cloudflare.com`）的根域名不显示这行，Cloudflare 会把根域名 CNAME 拍平。
- 子域名不显示 A 记录。
- 根域名和子域名用公共后缀表区分（website-api 用 `psl`），所以 `.com.cn`、`.co.uk` 这类后缀也能判断对。
- 主机本身是公共后缀（`github.io`、`co.uk`、`blogspot.com`、`s3.amazonaws.com`）不能绑定。`psl.parse` 没有 registrable domain 时不再退回「最后两段」，避免把公共后缀当成根域名。

## 私有站点登录 cookie

- `*.demox.site` 上的私有站点不认账号 cookie。未登录时边缘显示登录门，不回源。登录成功后 website-api 签发一张一小时、绑主机和站点的 `demox_site` 票据，边缘只把它写成 **host-only** cookie（不写 `Domain=`）。票据不能当账号会话。自定义域不走这张票据。
- 自定义域名上的私有站点仍走登录门。登录成功只写 **host-only** 的 `demox_access`（HttpOnly、Secure、SameSite=Lax），**不写 `Domain=`**。`www.example.co.uk` 的登录态不会带到 `example.co.uk` 或其它子域。
- `check-site-access` 对自定义域返回 `cookieScope`：`host-only` 或 `refuse`。公共后缀是 `refuse`，边缘不写 cookie。边缘单文件带不了公共后缀表，所以这道拒绝在 website-api。
- `/api/*` 转发用户函数前会去掉 `demox_access`。静态回源保持原来的 `fetch(req)`，不改头。

## 线上核对（公共后缀拒绝）

`https://api.demox.site` 走 `demox-function-api` 进程内打进统一包的 website 代码。`demox functions push` 切 website 别名不会改变这条路径。function-api 的 production 别名指向含 app `0.1.2` 的版本之后，再对 `github.io`、`co.uk`、`com.cn` 各打一次。

`POST /check-site-access`，body：`{"action":"check_site_access","host":"github.io"}`（`co.uk`、`com.cn` 同样）。必须是 `allowed: false`、`cookieScope: "refuse"`、`reason: "public_suffix"`。

`POST /add-project-custom-domain`（要登录）绑定这三个主机名。必须是 `success: false`、`reason: "public_suffix"`。

`foo.github.io`、`example.co.uk`、`example.com.cn` 不是公共后缀，不应返回 `public_suffix`。develop 冒烟打 develop 的公网地址，同一组路径和 body；通过后再 promote，然后对 `https://api.demox.site` 复测。
- 检测分三步：解析 → 证书 → 可访问。解析这一步，CNAME 链能到 `customers.demox.site`，或者所有 A 记录都是网关 IP，都算通过。已经用 A 记录接入的老域名照常生效，不用改。
- 公网 A 记录落在 Cloudflare 网段，说明开着橙色云。这时提示用户把这条记录的橙色云点成灰色（仅 DNS）。以后会支持保持代理接入，方案见 TXT-PLAN。

## ⚠️ 换网关 IP 之前
用 A 记录接入的域名（老域名，或按备用说明改了 A 记录的根域名）不会跟着我们改，**网关 IP 一换，这些域名就打不开了**。所以要先通知他们：

1. 在 aigc 上运行 `scripts/custom-domain-proxy/list-a-record-domains.sh`，列出看不到 CNAME、A 记录又指向网关的域名。
   - Cloudflare 根域名开灰色云时也会出现在列表里。它们其实是 CNAME 拍平，会自动跟着变，可以从通知名单里去掉（NS 是 Cloudflare 的就是这种）。
2. 提前通知这些用户：新 IP 是多少，什么时候切换。新旧 IP 并行一段时间，同时把两个 IP 都写进 `CUSTOM_DOMAIN_GATEWAY_IPS`。
3. 切换完成后，再从 `CUSTOM_DOMAIN_GATEWAY_IPS` 里去掉旧 IP。
