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

列类型仅 `text` / `number` / `boolean`；表名与列名须小写；须有一个 **text** 主键。默认用量上限约每项目 100MB（以 `get_project_db_usage` / `demox db usage` 为准）。

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
