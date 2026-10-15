# 源站守卫慢后端本地模拟

本地 HTTP mock（`127.0.0.1`）驱动 `edge-functions/subdomain-router.js`。没有访问生产。

- 命令：`node scripts/origin-guard-latency-sim.mjs --delay 1500`
- 守卫单次尝试：4000ms
- 守卫总预算：6000ms
- 解析缓存：进程内 Cache API shim。延迟来自真实的本地 HTTP 往返。
- 生成时间：2026-10-15T11:59:47.594Z

## 无签名（行为与现在的 by-ID 路径一致）

没有配置签名槽。www 回源会再次进入守卫，走 by-ID。

| 请求 | 状态 | x-demox-route | 耗时 ms | 本次后端次数 |
| --- | ---: | --- | ---: | ---: |
| www / | 200 | `origin-guard=allow` | 3035 | 2 |
| www /pricing | 200 | `origin-guard=allow` | 2 | 0 |
| sites public index | 200 | `origin-guard=allow` | 1506 | 1 |
| sites public asset | 200 | `origin-guard=allow` | 0 | 0 |
| sites banned | 403 | `origin-guard=blocked` | 1502 | 1 |
| sites banned again | 403 | `origin-guard=blocked` | 0 | 0 |
| sites private | 403 | `origin-guard=blocked` | 1504 | 1 |
| sites private again | 403 | `origin-guard=blocked` | 1 | 0 |

www 首页冷请求打两次后端（label 解析，然后重入后的 by-ID）。`/pricing` 和同一个公开对象的第二次请求在 15s 缓存里，后端次数为 0。

## 有签名的 www 冷请求门禁

KID=A，测试用占位密钥（不写入本文）。入站 `Headers.set/append/delete` 会抛，和边缘运行时一样。每个样本之间清空解析缓存。后端延迟在 1000–1400ms 均匀随机，15 个样本。分位数用 nearest-rank：`ceil(p * n)`。

线上 www 基线 median 2090ms、p90 2454ms。门禁是端到端 median ≤ 2400ms（+15%）且 p90 ≤ 3070ms（+25%）。模拟没有真实源站延迟，所以端到端只含 label 解析的后端延迟和路由器自己的开销。

**门禁：PASS。** 端到端 median 1166ms，p90 1358ms。路由器额外耗时 median 4ms，p90 7ms。by-ID 次数合计 0。

| # | 后端延迟 ms | 端到端 ms | 路由器额外 ms | by-ID | 状态 | x-demox-route |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 1154 | 1163 | 9 | 0 | 200 | `origin-guard=internal` |
| 2 | 1361 | 1367 | 6 | 0 | 200 | `origin-guard=internal` |
| 3 | 1238 | 1241 | 3 | 0 | 200 | `origin-guard=internal` |
| 4 | 1041 | 1047 | 6 | 0 | 200 | `origin-guard=internal` |
| 5 | 1108 | 1115 | 7 | 0 | 200 | `origin-guard=internal` |
| 6 | 1120 | 1124 | 4 | 0 | 200 | `origin-guard=internal` |
| 7 | 1343 | 1348 | 5 | 0 | 200 | `origin-guard=internal` |
| 8 | 1064 | 1068 | 4 | 0 | 200 | `origin-guard=internal` |
| 9 | 1354 | 1358 | 4 | 0 | 200 | `origin-guard=internal` |
| 10 | 1258 | 1263 | 5 | 0 | 200 | `origin-guard=internal` |
| 11 | 1077 | 1081 | 4 | 0 | 200 | `origin-guard=internal` |
| 12 | 1162 | 1166 | 4 | 0 | 200 | `origin-guard=internal` |
| 13 | 1010 | 1013 | 3 | 0 | 200 | `origin-guard=internal` |
| 14 | 1301 | 1306 | 5 | 0 | 200 | `origin-guard=internal` |
| 15 | 1304 | 1308 | 4 | 0 | 200 | `origin-guard=internal` |

#78 没有源站守卫。对照把对象 fetch 当成没有源站延迟的本地 200，不重入本函数。同一组 1.0–1.4s 延迟、同样每次清缓存。路由器额外耗时 = 端到端 − 这次请求里 mock 实际 sleep 的总和。

| 版本 | 端到端 median ms | 端到端 p90 ms | 路由器额外 median ms | 路由器额外 p90 ms |
| --- | ---: | ---: | ---: | ---: |
| 当前（有签名，internal） | 1166 | 1358 | 4 | 7 |
| #78 `3dea4e0` | 1165 | 1358 | 3 | 5 |
| 当前 − #78 | 1 | 0 | 1 | 2 |
