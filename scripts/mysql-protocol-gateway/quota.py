"""Account quota shared with website-api; lock/measure/write use one transaction."""

import json
from contextlib import contextmanager
from pathlib import Path

_policy_path = Path(__file__).with_name('project-data-quota.json')
if not _policy_path.exists():
    _policy_path = Path(__file__).resolve().parents[2] / 'scf-code/website-api/project-data-quota.json'
POLICY = json.loads(_policy_path.read_text())


class QuotaExceeded(ValueError):
    pass


def sql(key):
    return POLICY[key].replace('?', '%s')


@contextmanager
def quota_transaction(connect, project_id, limits=None):
    limits = POLICY if limits is None else limits
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED')
            conn.begin()
            cur.execute(sql('ownerSql'), (project_id,))
            project = cur.fetchone()
            if not project:
                raise ValueError('Project does not exist')
            owner = project['user_id']
            cur.execute(sql('lockOwnerSql'), (owner,))
            if not cur.fetchone():
                raise ValueError('Project owner does not exist')
            cur.execute(sql('lockProjectSql'), (project_id,))
            locked = cur.fetchone()
            if not locked or locked['user_id'] != owner:
                raise ValueError('Project ownership changed; retry')
            cur.execute(sql('planSql'), (owner,))
            limit = limits['proBytes'] if cur.fetchone()['is_pro'] else limits['userBytes']
            used_bytes = None

            def check_row(table_id, pk, doc):
                nonlocal used_bytes
                cur.execute(sql('rowSql'), (project_id, table_id, pk))
                existing = cur.fetchone()
                cur.execute(sql('sizeSql'), (doc,))
                delta = int(cur.fetchone()['row_bytes']) - (int(existing['row_bytes']) if existing else 0)
                if delta > 0:
                    if used_bytes is None:
                        cur.execute(sql('usageSql'), (owner,))
                        used_bytes = int(cur.fetchone()['used_bytes'])
                    if used_bytes + delta > limit:
                        raise QuotaExceeded(f'Account project database quota exceeded ({limit // 1048576} MiB); delete data or upgrade membership')
                if used_bytes is not None:
                    used_bytes += delta
                return existing is not None

            yield cur, check_row
            conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()
