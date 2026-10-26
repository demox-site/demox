"""Logical-table store: project_tables / project_rows only, always scoped by project_id."""

from __future__ import annotations

import json
import os
import re
from contextlib import contextmanager
from typing import Any

import pymysql

NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
TYPE_MAP = {"text": "TEXT", "number": "DOUBLE", "boolean": "TINYINT"}


def connect():
    return pymysql.connect(
        host=os.environ["MYSQL_HOST"],
        port=int(os.environ.get("MYSQL_PORT") or 3306),
        user=os.environ["MYSQL_USER"],
        password=os.environ["MYSQL_PASSWORD"],
        database=os.environ["MYSQL_DATABASE"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


@contextmanager
def cursor():
    conn = connect()
    try:
        with conn.cursor() as cur:
            yield cur
    finally:
        conn.close()


def resolve_project(username: str) -> dict[str, Any] | None:
    key = (username or "").strip()
    if not key:
        return None
    with cursor() as cur:
        cur.execute(
            "SELECT id, project_key FROM projects WHERE project_key = %s LIMIT 1",
            (key,),
        )
        row = cur.fetchone()
        if not row:
            return None
        cur.execute(
            "SELECT password_enc FROM project_db_credentials WHERE project_id = %s LIMIT 1",
            (row["id"],),
        )
        cred = cur.fetchone()
        if not cred:
            return None
        return {
            "project_id": int(row["id"]),
            "project_key": str(row["project_key"]),
            "password_enc": cred["password_enc"],
        }


def list_table_meta(project_id: int) -> list[dict[str, Any]]:
    with cursor() as cur:
        cur.execute(
            "SELECT id, name, columns_json FROM project_tables WHERE project_id = %s ORDER BY name",
            (project_id,),
        )
        rows = cur.fetchall()
    out = []
    for row in rows:
        cols = row["columns_json"]
        if isinstance(cols, str):
            cols = json.loads(cols)
        out.append({"id": int(row["id"]), "name": row["name"], "columns": cols or []})
    return out


def schema_for_project(project_id: int, project_key: str) -> dict:
    tables = {}
    for meta in list_table_meta(project_id):
        colmap = {}
        for col in meta["columns"]:
            colmap[col["name"]] = TYPE_MAP.get(col.get("type"), "TEXT")
        tables[meta["name"]] = colmap
    return {project_key: tables}


def load_table_rows(project_id: int, table_name: str) -> tuple[list[str], list[dict]]:
    with cursor() as cur:
        cur.execute(
            "SELECT id, columns_json FROM project_tables WHERE project_id = %s AND name = %s LIMIT 1",
            (project_id, table_name),
        )
        table = cur.fetchone()
        if not table:
            raise KeyError(table_name)
        cols = table["columns_json"]
        if isinstance(cols, str):
            cols = json.loads(cols)
        names = [c["name"] for c in cols]
        cur.execute(
            "SELECT pk, doc FROM project_rows WHERE project_id = %s AND table_id = %s ORDER BY pk",
            (project_id, table["id"]),
        )
        rows = []
        for row in cur.fetchall():
            doc = row["doc"]
            if isinstance(doc, str):
                doc = json.loads(doc)
            item = {name: doc.get(name) for name in names}
            rows.append(item)
    return names, rows


def get_table(project_id: int, table_name: str) -> dict[str, Any]:
    if not NAME_RE.match(table_name or ""):
        raise KeyError(table_name)
    with cursor() as cur:
        cur.execute(
            "SELECT id, name, columns_json FROM project_tables WHERE project_id = %s AND name = %s LIMIT 1",
            (project_id, table_name),
        )
        table = cur.fetchone()
        if not table:
            raise KeyError(table_name)
        cols = table["columns_json"]
        if isinstance(cols, str):
            cols = json.loads(cols)
        return {"id": int(table["id"]), "name": table["name"], "columns": cols}


def primary_column(columns: list[dict]) -> str:
    for col in columns:
        if col.get("primary"):
            return col["name"]
    raise ValueError("no primary key")


def put_row(project_id: int, table_name: str, values: dict[str, Any]) -> None:
    table = get_table(project_id, table_name)
    columns = table["columns"]
    known = {c["name"] for c in columns}
    for key in values:
        if key not in known:
            raise ValueError(f"unknown column {key}")
    pk_name = primary_column(columns)
    pk = values.get(pk_name)
    if pk is None or str(pk).strip() == "":
        raise ValueError("primary key required")
    pk = str(pk)
    doc = {}
    for col in columns:
        name = col["name"]
        val = values.get(name)
        if col["type"] == "number" and val is not None and val != "":
            val = float(val) if not isinstance(val, (int, float)) else val
        elif col["type"] == "boolean" and val is not None and not isinstance(val, bool):
            if str(val).lower() in ("1", "true"):
                val = True
            elif str(val).lower() in ("0", "false"):
                val = False
        doc[name] = val
    with cursor() as cur:
        cur.execute(
            "SELECT pk FROM project_rows WHERE project_id = %s AND table_id = %s AND pk = %s LIMIT 1",
            (project_id, table["id"], pk),
        )
        if cur.fetchone():
            cur.execute(
                "UPDATE project_rows SET doc = %s WHERE project_id = %s AND table_id = %s AND pk = %s",
                (json.dumps(doc, ensure_ascii=False), project_id, table["id"], pk),
            )
        else:
            cur.execute(
                "INSERT INTO project_rows (project_id, table_id, pk, doc) VALUES (%s, %s, %s, %s)",
                (project_id, table["id"], pk, json.dumps(doc, ensure_ascii=False)),
            )


def delete_row(project_id: int, table_name: str, pk: str) -> int:
    table = get_table(project_id, table_name)
    with cursor() as cur:
        affected = cur.execute(
            "DELETE FROM project_rows WHERE project_id = %s AND table_id = %s AND pk = %s",
            (project_id, table["id"], str(pk)),
        )
        return int(affected or 0)
