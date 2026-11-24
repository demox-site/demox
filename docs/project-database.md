# 项目数据库

每个 Demox 项目有一份托管的**逻辑表**存储（站点和云函数共用）。数据落在平台共享 MySQL 的 `project_tables` / `project_rows` 上，按项目隔离；**不会**为你新建独立物理库或 schema。

## 怎么用

| 方式 | 说明 |
|------|------|
| 控制台 | 项目 → **数据库**：建表、改行、看连接信息 |
| MySQL 协议 | `db.demox.site:3306`，用户名=项目对外 ID，密码见「连接」 |
| CLI | `demox db tables|rows|put|… -p <projectId>`（OAuth，走 HTTPS API） |
| HTTP API | `https://api.demox.site` 上的 `list_project_*` / `put_project_row` 等动作 |
| MCP | 与 CLI 同名的一组 project table/row 工具 |

列类型仅 `text` / `number` / `boolean`；表名与列名须小写；须有一个 **text** 主键。

## 数据容量额度

| 项目所有者的账号类型 | 所有项目合计容量 |
|---|---:|
| 普通用户 | 50 MiB（52,428,800 字节） |
| 有效专业会员、管理员 | 500 MiB（524,288,000 字节） |

额度归属项目所有者，成员代写、归档项目及不同项目的表数据都合并计算；新建项目不会获得额外容量。会员到期或角色停用后执行普通额度。所有者没有角色记录时也按普通额度处理。

计量值是 MySQL 将每行 `doc` JSON 转为 `utf8mb4` 文本后的字节数之和（包含 JSON 字段名和格式字符）。这是数据内容额度，不是磁盘账单；不含索引、表结构、数据库页及备份。两个入口由同一份 `project-data-quota.json` 定义 SQL 和额度，避免 JavaScript/Python JSON 序列化差异。

达到额度后拒绝增加用量，HTTP 返回 `code: quota`，MySQL 返回额度错误。已有数据不会被删除，仍可读取、删除、等量替换或缩小（同时遵守入口原有的单行限制）；删除行、表、项目后实际用量会释放。MySQL 多行 INSERT 在任一行失败时整批回滚。HTTP 单行最多 32 KiB、每页最多 100 行，每项目最多 64 张表、每表最多 32 列。

实现使用 READ COMMITTED 事务和项目所有者行锁，在同一连接内检查和写入，覆盖 HTTP/CLI/MCP 与 MySQL 网关。首版在每个增量写事务中汇总一次账号现有数据，无迁移或历史计数回填；较大的账号会增加写入延迟，后续可用事务计数表优化。批量写入复用本事务的统计值，并发删除可能让一次写入保守拒绝，重试后重新统计。

**发布必须同时更新 website-api 和 MySQL 网关**，任一旧写入入口仍在线都会绕过额度。此说明描述代码行为，线上生效以两个入口发布后的验证为准。发布检查与本地测试见 [网关说明](../scripts/mysql-protocol-gateway/README.md)。

## MySQL 协议（已开放）

```bash
mysql -h db.demox.site -P 3306 -u 'YOUR_PROJECT_ID' -p
# 库名与用户名相同（项目对外 ID）；也可先 USE
SHOW TABLES;
SELECT * FROM notes LIMIT 50;
```

| | |
|--|--|
| Host | `db.demox.site` |
| Port | `3306` |
| Username | 项目对外 ID（`project_key`） |
| Password | 写权限在控制台「连接」查看，或 `get_project_db_connection` |
| 鉴权 | 与 HTTP **Basic** 同一套 `project_db_credentials` |

网关只暴露**当前项目**的逻辑表，不是共享 CDB 账号。MVP 支持：`SHOW` / `DESCRIBE` / `SELECT` / `INSERT` / `UPDATE`/`DELETE`（后两者需 `WHERE <主键> = …`）。不支持跨项目、任意 DDL、`INSERT … SELECT`。

运维与回滚见 `scripts/mysql-protocol-gateway/README.md`。

### API / CLI 鉴权（仍可用）

1. **`Authorization: Bearer <访问令牌>`**
2. **`Authorization: Basic base64(用户名:密码)`**（须与 body 里 `projectId` 同项目）

```bash
curl -X POST 'https://api.demox.site/website/list-project-rows' \
  -H 'Authorization: Bearer $DEMOX_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"action":"list_project_rows","projectId":"YOUR_PROJECT_ID","table":"notes","limit":50}'
```

```bash
demox db tables -p YOUR_PROJECT_ID
demox db create-table -p YOUR_PROJECT_ID -n notes \
  -c '[{"name":"id","type":"text","primary":true},{"name":"title","type":"text"}]'
demox db put -p YOUR_PROJECT_ID -t notes -v '{"id":"1","title":"hello"}'
```

若你需要自有 MySQL/Postgres：在函数环境变量里配置自己的连接串，与本「数据库」菜单无关。
