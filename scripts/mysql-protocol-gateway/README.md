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

## Account data quotas

All projects owned by an account share **50 MiB** for ordinary users or **500 MiB**
for active pro/admin users. Membership expiry and disabled roles fall back to the
ordinary allowance. Archived projects count; collaborators use the owner's allowance.
The measured payload is `OCTET_LENGTH(CAST(doc AS CHAR CHARACTER SET utf8mb4))`,
not physical disk allocation. Existing over-limit data remains readable/deletable;
non-growing updates remain allowed. A multi-row INSERT commits or rolls back as a unit.

`quota.py` and website-api share `project-data-quota.json` and lock the same `users`
row in a READ COMMITTED transaction. The deployment script copies that contract
from website-api. Both runtimes must be upgraded; rolling either one back removes
the hard guarantee. No schema migration or historical data deletion is needed.

The first growing write in each transaction scans the owner's rows to calculate
usage. This is a correctness-first implementation; measure latency on larger
accounts before increasing caps. Database/query/lock failures reject the write.

### Local quota verification

Use an isolated MySQL 8 instance, never production credentials. For example:

```bash
docker run --detach --name demox-quota-test \
  --publish 127.0.0.1:13387:3306 \
  --env MYSQL_ALLOW_EMPTY_PASSWORD=yes --env MYSQL_DATABASE=demox_quota_test mysql:8.4
# After MySQL is ready, from repository root; requires mysql2 and Python pymysql.
DEMOX_QUOTA_TEST_MYSQL_PORT=13387 node --test \
  scf-code/website-api/project-data.test.cjs \
  scf-code/website-api/project-data-quota.integration.test.cjs
docker rm -f -v demox-quota-test
```

The integration test recreates only fixture tables in `demox_quota_test` on
127.0.0.1. It checks cross-project usage, UTF-8, exact boundaries, expiry,
disabled/missing roles, shrinking/deletion, batch rollback and concurrent Node/Python
writes. It uses smaller injected test caps; production constants are checked separately.

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
