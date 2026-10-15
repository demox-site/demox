# analytics-rollup-5m 水位与周报「暂定」

`analytics-rollup-5m` 把 COS 上的 `analytics/raw/date=…/hour=…/*.ndjson` 汇总进 `site_*_daily_stats` / `site_access_logs`。周报的 WAU 读这些计数器。本文件只说明怎么判断某一周的数是不是完整的，不改周报页面。

迁移：`scf-code/website-api/migrations/024_add_analytics_rollup_watermark.sql`。函数入口里有同一份两句 `CREATE TABLE IF NOT EXISTS`。公开 API 走打进统一包的 `index.js`，不会单独执行这个 SQL 文件。

合并到 master **不会**自动发布。仓库变量 `FUNCTION_API_AUTO_DEPLOY` 没有设置；`Deploy function-api` 的 push 触发因此不会跑。上线是手动的：`stage`（只打包上传 COS）→ `deploy-develop`（只切 develop）→ 在 develop 上验证 → `promote`（只切 production）。

数据库用户需要当前库的 `CREATE`（运行时会执行那两句 `CREATE TABLE IF NOT EXISTS`），以及对 `site_analytics_rollup_watermark` 和 `site_analytics_rollup_gaps` 的 `SELECT`、`INSERT`、`UPDATE`。`INSERT ... ON DUPLICATE KEY UPDATE` 用到 UPDATE。

`ALERT analytics-rollup-5m` 的试打（包括 `STALE_WATERMARK` 和 `CONFIG_MISSING`）只在 **develop** 上做。不要打 production，也不要打 `api.demox.site`。

## 水位

`site_analytics_rollup_watermark` 只有一行（`id = 1`）。

- `watermark_ms` 是 UTC epoch 毫秒，对齐到 5 分钟。早于这个时刻的窗口已经结清：事件进了计数器，或者记成了永久缺口。
- `initial_ms` 是第一次开始汇总时的扫描起点（通常是当时的 `now - 48h`，对齐到 5 分钟）。只在插入时写一次，之后不改。比它更早的周没有原始汇总，周报标 **暂定**。

写入端先 `ts = Date.now()`，再查库、再上传 COS。水位因此停在 `now` 之前约 2 分钟，不会把「刚刚结束、对象可能还没落地」的窗口结清。列表还会多扫水位前的一个小时（`rollupHourPrefixes(scanStart - 3600000, now)`）：盖在某小时最后几秒（例如 `HH:59:58`）的对象，可能要 6 分钟甚至 20 分钟才出现在存储里，那时水位已经进了下一小时，只扫 `scanStart` 会把它丢掉。`ts` 早于水位但还没入库的对象仍然计入，并打一行 `code=LATE_OBJECT`。`object_key` 主键保证重复跑不会计两次。水位不会因为这种对象往回退。比这再早一个小时以上的对象不在扫描范围内。

每次触发从水位往后扫，最多 48 小时。没有水位时从 48 小时前开始，`initial_ms` 记下这个起点。手动请求里的 `days` / `hours` 是空操作，不会改变扫描范围。`limit` 最大 2000。单轮还有约 240 秒的时间预算（函数超时 300 秒）；到点就停，水位留在最后一个已经结清的窗口，并打一行 `code=TIME_BUDGET`。没读完的对象不会被当成已结清。

重叠的两轮用 `GET_LOCK('demox_analytics_rollup_5m', 0)`。拿不到锁就跳过（`skipped: true`），不打 ALERT，也不去释放别人持有的锁。

已入库的对象（`site_analytics_ingested_events`）先剔掉，再套每轮 2000 的上限。超过上限就按时间顺序处理这一批，水位只前进到已经结清的窗口，并打一行积压告警。下一轮继续。

## 永久缺口

`site_analytics_rollup_gaps`。`gap_start` / `gap_end` 是 UTC（数据库会话 `time_zone = '+00:00'`）。查询参数必须是 UTC 字符串，例如 `'2026-10-04 16:00:00.000'`。不要传 UTC+8 的墙上时间。

| reason | 含义 |
|---|---|
| `over_48h` | 水位比现在早 48 小时以上。`[gap_start, gap_end)` 不再补，对象不会进 WAU |
| `object_too_large` | 单个对象超过 256KB，不读内容。`object_key` 是对象键，区间是它所在的 5 分钟窗口 |

临时积压不写这张表。开始追踪之前的时间也不写这张表，用 `initial_ms` 判断。

## 周报怎么标「暂定」

统计周从 **周一 00:00 UTC+8** 开始，到下一周同一时刻结束（结束不含）。这和 `stat_date` 的切日一致：周一 00:00 UTC+8 = 周日 16:00Z。

2026-10-05（周一）那一周：

| | UTC | UTC+8 |
|---|---|---|
| `weekStart` | `2026-10-04 16:00:00.000` | 2026-10-05 00:00 |
| `weekEnd`（不含） | `2026-10-11 16:00:00.000` | 2026-10-12 00:00 |

```sql
SELECT watermark_ms, initial_ms
FROM site_analytics_rollup_watermark
WHERE id = 1;

SELECT gap_start, gap_end, reason, object_key
FROM site_analytics_rollup_gaps
WHERE gap_end > '2026-10-04 16:00:00.000'
  AND gap_start < '2026-10-11 16:00:00.000';
```

- 没有 `initial_ms`，或 `weekStart < initial_ms`：这周在开始追踪之前 → **暂定**（`before_watermark`）。
- 没有水位，或 `watermark_ms < weekEnd`：本周还没汇总完 → **暂定**。
- 上面的缺口查询有任意一行 → **暂定**（缺的是原始日志，再跑也不会补回来）。
- `initial_ms <= weekStart`，水位已经 `>= weekEnd`，且没有重叠缺口 → WAU 可以当最终值。

同一判断在 `analyticsRollupCoverage`（`index.js`，测试出口 `_analyticsRollupForTest.coverage`）。周界在 `_analyticsRollupForTest.weekWindow`。传入的 `gaps` 用毫秒：`{ gapStartMs, gapEndMs, reason, objectKey }`。`initialMs` 用毫秒。

## CLS

失败、超过 48 小时的缺口、单轮积压、超大对象、迟到对象、时间预算、开跑时水位落后，以及原始日志没配好，各打一行日志，都以 `ALERT analytics-rollup-5m` 开头，并带 `step=`、`window=`、`code=`。数据库错误可以再带 `errno=`（0–999999 的整数）和 `sqlState=`（5 位数字或大写字母）。不要把错误原文、对象内容或密钥打进日志。函数仍返回 `success: false`，不抛错，定时器的 `RetryNum` 保持 0。拿不到 `GET_LOCK` 时不打 ALERT，也不打 HEARTBEAT。

| code | 什么时候 |
|---|---|
| `STALE_WATERMARK` | 开跑时表里的 `watermark_ms` 比 `now` 早 **超过** 30 分钟。正好 30 分钟不打。这一轮仍会继续补 |
| `CONFIG_MISSING` | `ANALYTICS_RAW_ENABLED` 不是 `1`，或者 `ANALYTICS_RAW_BUCKET_ID` 不是正整数。以前这种情况下静默返回 |

COS `get` 返回 `NoSuchKey`（`code` / `Code` / `name`，大小写不敏感）时，不当错误：不打 `ALERT`，不打 `code=ERROR`，打一行 `SKIP analytics-rollup-5m step=read code=NOSUCHKEY`。该对象不入库，所在窗口也不结清，下一轮再试。错误原文不进日志。其它读失败仍然是 `ALERT`，整轮 `success: false`。

成功结束的一轮打一行心跳，不是告警：

```text
HEARTBEAT analytics-rollup-5m watermark=<ms> windows=<n> processed=<n> late=<n> duration=<bucket>
```

字段只有这五个，多出来的键会被丢掉：

| 字段 | 含义 |
|---|---|
| `watermark` | 这一轮结束时的水位（UTC epoch ms） |
| `windows` | 这一轮水位向前结清了几个 5 分钟窗口 |
| `processed` | 新计入的事件数 |
| `late` | 其中 `LATE_OBJECT` 的对象数 |
| `duration` | 耗时档：`lt1s`、`1to10s`、`10to60s`、`1to4m`、`gt4m` |

没有错误原文，没有用户数据，没有对象键。CLS 可以用这一行缺席来发现静默停止。试打告警只在 develop 上做。

给架构师配 CLS 告警的关键字：`ALERT analytics-rollup-5m`。
