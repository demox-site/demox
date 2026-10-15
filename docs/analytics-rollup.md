# analytics-rollup-5m 水位与暂定周分类

`analytics-rollup-5m` 把 COS 上的 `analytics/raw/date=…/hour=…/*.ndjson` 汇总进 `site_*_daily_stats` / `site_access_logs`。某一周的 WAU 能不能当最终值，用下面的分类和 SQL 判断。

迁移文件：`scf-code/website-api/migrations/024_add_analytics_rollup_watermark.sql`。运行时不执行这个文件，也不执行任何 CREATE。公开 API 走打进统一包的 `index.js`。

合并到 master **不会**自动发布。仓库变量 `FUNCTION_API_AUTO_DEPLOY` 没有设置；`Deploy function-api` 的 push 触发因此不会跑。上线是手动的：`stage`（只打包上传 COS）→ `deploy-develop`（只切 develop）→ 在 develop 上验证 → `promote`（只切 production）。

云帆在每个环境发布之前，用临时授权在对应的库上跑 024：先 develop 库（在 `deploy-develop` 之前），再 production 库（在 `promote` 之前）。顺序是授权 → 执行 → 撤权，权限 diff 为 0。024 在某个库上跑完，才能把函数发到那个环境。

运行时账号只要 `site_analytics_rollup_watermark` 和 `site_analytics_rollup_gaps` 的 `SELECT`、`INSERT`、`UPDATE`。`INSERT ... ON DUPLICATE KEY UPDATE` 用到 UPDATE。运行时不建表，也不删行。

`promote` 到 production 之前确认该环境 `ANALYTICS_RAW_ENABLED=1`，并且 `ANALYTICS_RAW_BUCKET_ID` 已配置。否则每 5 分钟会打一次 high：`ALERT analytics-rollup-5m step=config window=- code=CONFIG_MISSING`。

`ALERT analytics-rollup-5m` 的试打（包括 `STALE_WATERMARK` 和 `CONFIG_MISSING`）只在 **develop** 上做。不要打 production，也不要打 `api.demox.site`。试打写进缺口表的行用 `reason='test_fire'`、`object_key='test-fire:<YYYYMMDD>-<n>'`，结束后只作废：

```sql
UPDATE site_analytics_rollup_gaps
SET status = 'void'
WHERE reason = 'test_fire' AND object_key = 'test-fire:<YYYYMMDD>-<n>';
```

## 水位

`site_analytics_rollup_watermark` 只有一行（`id = 1`）。

- `watermark_ms` 是 UTC epoch 毫秒，对齐到 5 分钟。早于这个时刻的窗口已经结清：事件进了计数器，或者记成了永久缺口。
- `initial_ms` 是第一次开始汇总时的扫描起点（通常是当时的 `now - 48h`，对齐到 5 分钟）。只在插入时写一次，之后不改。`weekStart` 早于它的周分类为暂定周（`before_watermark`）。

写入端先 `ts = Date.now()`，再查库、再上传 COS。水位因此停在 `now` 之前约 2 分钟，不会把「刚刚结束、对象可能还没落地」的窗口结清。列表还会多扫水位前的一个小时（`rollupHourPrefixes(scanStart - 3600000, now)`）：盖在某小时最后几秒（例如 `HH:59:58`）的对象，可能要 6 分钟甚至 20 分钟才出现在存储里，那时水位已经进了下一小时，只扫 `scanStart` 会把它丢掉。`ts` 早于水位但还没入库的对象仍然计入，并打一行 `INFO analytics-rollup-5m step=ingest … code=LATE_OBJECT`。`object_key` 主键保证重复跑不会计两次。水位不会因为这种对象往回退。比这再早一个小时以上的对象不在扫描范围内。

每次触发从水位往后扫，最多 48 小时。没有水位时从 48 小时前开始，`initial_ms` 记下这个起点。手动请求里的 `days` / `hours` 是空操作，不会改变扫描范围。`limit` 最大 2000。单轮还有约 240 秒的时间预算（函数超时 300 秒）；到点就停，水位留在最后一个已经结清的窗口，并打一行 `code=TIME_BUDGET`。没读完的对象不会被当成已结清。

重叠的两轮用 `GET_LOCK('demox_analytics_rollup_5m', 0)`。拿不到锁就跳过（`skipped: true`），不打 ALERT，也不去释放别人持有的锁，也不打 HEARTBEAT。

已入库的对象（`site_analytics_ingested_events`）先剔掉，再套每轮 2000 的上限。超过上限就按时间顺序处理这一批，水位只前进到已经结清的窗口，并打一行积压告警。下一轮继续。

开跑时对两张表各做 `SELECT 1 FROM <table> LIMIT 0`。任一表不存在（`ER_NO_SUCH_TABLE` / errno 1146）就打一行然后停止：

```text
ALERT analytics-rollup-5m step=tables window=- code=CONFIG_MISSING
```

两张表都缺也只打这一行。不 list、不写水位、不打 `HEARTBEAT`。其它数据库错误仍按失败打 `ALERT`，`code` 用错误码。

## 永久缺口

`site_analytics_rollup_gaps`。`gap_start` / `gap_end` 是 UTC（数据库会话 `time_zone = '+00:00'`）。查询参数必须是 UTC 字符串，例如 `'2026-10-04 16:00:00.000'`。不要传 UTC+8 的墙上时间。

| reason | 含义 |
|---|---|
| `over_48h` | 水位比现在早 48 小时以上。`[gap_start, gap_end)` 不再补，对象不会进 WAU |
| `object_too_large` | 单个对象超过 256KB，不读内容。`object_key` 是对象键，区间是它所在的 5 分钟窗口 |
| `test_fire` | 只在 develop 上试打告警时写入。`object_key` 为 `test-fire:<YYYYMMDD>-<n>`。不计入暂定周分类 |

`status` 是 `VARCHAR(16)`，取值 `active` 或 `void`，默认 `active`。运行时插入的 `over_48h` / `object_too_large` 行显式写 `status='active'`。超大对象的去重查询也只看 `status = 'active'`。作废只做 `UPDATE … SET status = 'void'`，不删行。

临时积压不写这张表。开始追踪之前的时间也不写这张表，用 `initial_ms` 判断。

## 暂定周分类

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
  AND gap_start < '2026-10-11 16:00:00.000'
  AND status = 'active'
  AND reason <> 'test_fire';
```

- 没有 `initial_ms`，或 `weekStart < initial_ms`：这周在开始追踪之前 → 暂定周（`before_watermark`）。
- 没有水位，或 `watermark_ms < weekEnd`：本周还没汇总完 → 暂定周。
- 上面的缺口查询有任意一行 → 暂定周（缺的是原始日志，再跑也不会补回来）。
- `initial_ms <= weekStart`，水位已经 `>= weekEnd`，且没有重叠的有效缺口 → WAU 可以当最终值。

同一判断在 `analyticsRollupCoverage`（`index.js`，测试出口 `_analyticsRollupForTest.coverage`）。周界在 `_analyticsRollupForTest.weekWindow`。传入的 `gaps` 用毫秒：`{ gapStartMs, gapEndMs, reason, objectKey, status }`。缺省 `status` 按 `active`。`reason` 为 `test_fire` 或 `status` 不是 `active` 的行不计数。`initialMs` 用毫秒。

## CLS

失败、超过 48 小时的缺口、单轮积压、超大对象、时间预算、开跑时水位落后，以及配置或表缺失，各打一行，都以 `ALERT analytics-rollup-5m` 开头，并带 `step=`、`window=`、`code=`。数据库错误可以再带 `errno=`（0–999999 的整数）和 `sqlState=`（5 位数字或大写字母）。不要把错误原文、对象内容或密钥打进日志。函数仍返回 `success: false`（水位落后和业务缺口除外：那两轮仍会继续并在成功结束时打心跳），不抛错，定时器的 `RetryNum` 保持 0。拿不到 `GET_LOCK` 时不打 ALERT，也不打 HEARTBEAT。

| code | 等级 | 什么时候 |
|---|---|---|
| `STALE_WATERMARK` | high，`ALERT` | 开跑时表里的 `watermark_ms` 比 `now` 早 **超过** 30 分钟。正好 30 分钟不打。这一轮仍会继续补 |
| `CONFIG_MISSING` | high，`ALERT` | `step=config`：`ANALYTICS_RAW_ENABLED` 不是 `1`，或 `ANALYTICS_RAW_BUCKET_ID` 不是正整数。`step=tables`：两张汇总表有缺。缺表时停，不推进水位，不打心跳 |
| `GAP_OVER_48H` | high，`ALERT` | 水位比 now 早 48 小时以上，已写入永久缺口 |
| `OBJECT_TOO_LARGE` | high，`ALERT` | 单个对象超过 256KB，不读内容 |
| `BACKLOG_OVER_CAP` | high，`ALERT` | 这一轮超过 2000 个未处理对象 |
| `TIME_BUDGET` | high，`ALERT` | 接近函数超时，这一轮停下 |
| 其它失败码 | high，`ALERT` | 例如死锁 `ER_LOCK_DEADLOCK`、读失败 `ECONNRESET`。`step` 是失败点 |
| `LATE_OBJECT` | info | `INFO analytics-rollup-5m step=ingest window=… code=LATE_OBJECT key=…`。不进 `alerts`，不用 `ALERT` 前缀 |
| `NOSUCHKEY` | 不告警 | `SKIP analytics-rollup-5m step=read window=… code=NOSUCHKEY key=…`。对象不入库，窗口不结清，下一轮再试 |

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
| `late` | 其中迟到对象的个数 |
| `duration` | 耗时档：`lt1s`、`1to10s`、`10to60s`、`1to4m`、`gt4m` |

没有错误原文，没有用户数据，没有对象键。CLS 用这一行缺席来发现静默停止：15 分钟内没有 `HEARTBEAT analytics-rollup-5m` 就报。试打告警只在 develop 上做。

给架构师配 CLS：

- 高等级关键字：`ALERT analytics-rollup-5m`。`LATE_OBJECT` 已经不在这个前缀下。
- 配置或表缺失单独一条：`code=CONFIG_MISSING`。
- 心跳缺席：15 分钟内没有 `HEARTBEAT analytics-rollup-5m`。
- `INFO` 和 `SKIP` 只检索，不告警。
