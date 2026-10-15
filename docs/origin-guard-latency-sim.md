# 源站守卫慢后端本地模拟

本地 HTTP mock（`127.0.0.1`，延迟 1500ms）驱动 `edge-functions/subdomain-router.js`。没有访问生产，也没有配置签名密钥。www 回源到 `sites.demox.site` 时会再次进入守卫，走 by-ID 解析。

- 命令：`node scripts/origin-guard-latency-sim.mjs --delay 1500`
- 守卫单次尝试：4000ms
- 守卫总预算：6000ms
- 解析缓存：进程内 Cache API shim（与单测相同的 `match` / `put` 合约）。延迟本身来自真实的本地 HTTP 往返。
- 生成时间：2026-10-15T11:22:39.792Z

| 请求 | 状态 | x-demox-route | 耗时 ms | 本次后端次数 |
| --- | ---: | --- | ---: | ---: |
| www / | 200 | `origin-guard=allow` | 3030 | 2 |
| www /pricing | 200 | `origin-guard=allow` | 2 | 0 |
| sites public index | 200 | `origin-guard=allow` | 1505 | 1 |
| sites public asset | 200 | `origin-guard=allow` | 0 | 0 |
| sites banned | 403 | `origin-guard=blocked` | 1502 | 1 |
| sites banned again | 403 | `origin-guard=blocked` | 1 | 0 |
| sites private | 403 | `origin-guard=blocked` | 1504 | 1 |
| sites private again | 403 | `origin-guard=blocked` | 1 | 0 |

www 首页冷请求打两次后端（label 解析，然后重入后的 by-ID）。`/pricing` 和同一个公开对象的第二次请求在 15s 缓存里，后端次数为 0。封禁（`allow:false`）和私有（`allow:true` 但仍带 `visibility:private`）都是 403，没有把对象取回来。这些响应都不是 `origin-guard=error`。
