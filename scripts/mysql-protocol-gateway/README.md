# Demox MySQL protocol gateway

Public MySQL wire endpoint for project **logical tables** (`project_tables` / `project_rows`).

## What it is

| | |
|--|--|
| Host | `db.demox.site` |
| Port | `3306` |
| Username | project public id (`project_key`) |
| Password | from console「连接」/ `get_project_db_connection` |
| Storage | Shared platform MySQL; **not** a per-project physical schema |

Clients speak MySQL protocol. The gateway authenticates with `project_db_credentials` (same secret as HTTP Basic) and only serves that project's logical tables. Platform tables are never exposed.

## Supported SQL (MVP)

- `SHOW DATABASES` / `SHOW TABLES` / `DESCRIBE` / `USE`
- `SELECT …` (in-memory sqlglot over the project's rows)
- `INSERT INTO t (…) VALUES (…)`
- `UPDATE t SET … WHERE <pk> = …`
- `DELETE FROM t WHERE <pk> = …`

Unsupported: joins across projects, DDL via MySQL, `INSERT … SELECT`, bulk `UPDATE`/`DELETE` without primary key.

## Deploy (aigc / `119.91.123.2`)

Same VPC as CDB (`10.0.100.9`). Reuses `/opt/demox-customer-proxy/.env` for `MYSQL_*`; needs `ENCRYPTION_KEY` (same as website-api).

```bash
# from repo
ENCRYPTION_KEY='…' ./scripts/mysql-protocol-gateway/deploy.sh root@119.91.123.2
# then on host: append ENCRYPTION_KEY to /opt/demox-mysql-gateway/.env if deploy noted it
sudo systemctl restart demox-mysql-gateway
```

Open security group `sg-h3tqzh7z` TCP 3306. DNS: `db` A → `119.91.123.2` on `demox.site` (overrides `*` EdgeOne CNAME).

## Rollback

1. `systemctl stop demox-mysql-gateway && systemctl disable demox-mysql-gateway`
2. Remove DNS `db` A record (falls back to EdgeOne `*` → 3306 refused again)
3. Optionally delete SG ingress TCP 3306

Do **not** point `db.demox.site` at CDB WAN (`gz-cdb-fg5tqemn.sql.tencentcdb.com:63279`) — that is the shared platform instance.

## Smoke

```bash
mysql -h db.demox.site -P 3306 -u '<project_key>' -p -e 'SHOW TABLES; SELECT * FROM smoke_notes;'
```
