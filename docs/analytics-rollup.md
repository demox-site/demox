# analytics-rollup-5m 水位与周报「暂定」

`analytics-rollup-5m` 把 COS 上的 `analytics/raw/date=…/hour=…/*.ndjson` 汇总进 `site_*_daily_stats` / `site_access_logs`。周报的 WAU 读这些计数器。本文件只说明怎么判断某一周的数是不是完整的，不改周报页面。

迁移：`scf-code/website-api/migrations/024_add_analytics_rollup_watermark.sql`。函数入口里有同一份 `CREATE TABLE IF NOT EXISTS`（公开 API 走统一包，合并 master 不会单独执行这个 SQL 文件）。

## 水位

`site_analytics_rollup_watermark` 只有一行（`id = 1`）。`watermark_ms` 是 UTC epoch 毫秒，对齐到 5 分钟。早于这个时刻的窗口已经结清：事件进了计数器，或者记成了永久缺口。

每次触发从水位往后扫，最多 48 小时。当前这一个 5 分钟窗口还在收事件，水位停在它的起点。没有水位时从 48 小时前开始，不把更早的时间记成缺口。

已入库的对象（`site_analytics_ingested_events`）先剔掉，再套每轮 2000 的上限。超过上限就按时间顺序处理这一批，水位只前进到已经结清的窗口，并打一行积压告警。下一轮继续。

## 永久缺口

`site_analytics_rollup_gaps`：

| reason | 含义 |
|---|---|
| `over_48h` | 水位比现在早 48 小时以上。`[gap_start, gap_end)` 不再补，对象不会进 WAU |
| `object_too_large` | 单个对象超过 256KB，不读内容。`object_key` 是对象键，区间是它所在的 5 分钟窗口 |

临时积压不写这张表。

## 周报怎么标「暂定」

统计周的 UTC 起止记为 `weekStart`、`weekEnd`（`weekEnd` 不含）。

```sql
SELECT watermark_ms FROM site_analytics_rollup_watermark WHERE id = 1;

SELECT gap_start, gap_end, reason, object_key
FROM site_analytics_rollup_gaps
WHERE gap_end > ? AND gap_start < ?;   -- weekStart, weekEnd
```

- 没有水位，或 `watermark_ms < weekEnd`：本周还没汇总完 → **暂定**。
- 上面的缺口查询有任意一行 → **暂定**（缺的是原始日志，再跑也不会补回来）。
- 水位已经 `>= weekEnd`，且没有重叠缺口 → WAU 可以当最终值。

同一判断在 `analyticsRollupCoverage`（`index.js`，测试出口 `_analyticsRollupForTest.coverage`）。传入的 `gaps` 用毫秒：`{ gapStartMs, gapEndMs, reason, objectKey }`。

## CLS

失败、超过 48 小时的缺口、单轮积压、超大对象，各打一行日志，都以 `ALERT analytics-rollup-5m` 开头，并带 `step=`、`window=`、`code=`。不要把对象内容或密钥打进日志。函数仍返回 `success: false`，不抛错，定时器的 `RetryNum` 保持 0。

给架构师配 CLS 告警的关键字：`ALERT analytics-rollup-5m`。
