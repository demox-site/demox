# 项目数据库

每个 Demox 项目有一份托管的**逻辑表**存储（站点和云函数共用）。数据落在平台共享 MySQL 的 `project_tables` / `project_rows` 上，按项目隔离；**不会**为你新建独立物理库或 schema。

## 怎么用

| 方式 | 说明 |
|------|------|
| 控制台 | 项目 → **数据库**：建表、改行、看连接信息 |
| CLI | `demox db tables|rows|put|… -p <projectId>`（OAuth，走 HTTPS API） |
| HTTP API | `https://api.demox.site` 上的 `list_project_*` / `put_project_row` 等动作 |
| MCP | 与 CLI 同名的一组 project table/row 工具 |

列类型仅 `text` / `number` / `boolean`；表名与列名须小写；须有一个 **text** 主键。默认用量上限约每项目 100MB（以 `get_project_db_usage` / `demox db usage` 为准）。

### API 鉴权

任选其一：

1. **`Authorization: Bearer <访问令牌>`**（控制台「访问令牌」，或 CLI/`demox login` 的 token）
2. **`Authorization: Basic base64(用户名:密码)`**  
   - 用户名 = 项目对外 ID  
   - 密码由写权限成员在控制台「连接」里查看，或由 `get_project_db_connection` 签发  
   - Basic 身份必须与请求体里的 `projectId` 为同一项目

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

## MySQL 协议（`mysql` 客户端）连不上

**公网不能**用 MySQL 协议连接项目库。

历史上控制台曾展示 `db.demox.site:3306` 与 `mysql -h …` 示例。该域名目前指向 EdgeOne，**TCP 3306 被拒绝**；仓库里也没有面向租户的 MySQL 协议网关。实现注释写明：逻辑表「不对外开放数据库端口」。

因此：

- 不要配置 JDBC / `mysql` CLI / ORM 去连 `db.demox.site:3306`
- 项目库用户名/密码用于 **HTTPS Basic Auth**（或改用 Bearer），不是给 CDB 登录
- 平台内部 VPC（例如运维侧私网 VIP）只服务 Demox 自身函数，**不是**租户产品能力

若你需要自有 MySQL/Postgres：在函数环境变量里配置自己的连接串，与本「数据库」菜单无关。

## 此前为何文档没写清

产品侧**刻意不开放**公网 MySQL 端口（协议网关未上线），但控制台曾按「主机直连」形态展示连接串，而 README 又未说明「只能走 HTTP / `demox db`」——属于未上线能力被 UI 提前露出叠加文档疏漏。本文与控制台文案已按现网可达性对齐。
