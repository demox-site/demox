#!/usr/bin/env python3
"""Demox MySQL protocol gateway for project logical tables.

Listens on TCP (default 0.0.0.0:3306). Username = project_key; password from
project_db_credentials (same as HTTP Basic). Never exposes platform tables.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any, Optional, Sequence

from mysql_mimic import MysqlServer, Session
from mysql_mimic.auth import IdentityProvider, NativePasswordAuthPlugin, User
from mysql_mimic.errors import ErrorCode, MysqlError
from sqlglot import exp
from sqlglot.executor import execute

import crypto_util
import store

LOG = logging.getLogger("demox-mysql-gateway")


class ProjectIdentityProvider(IdentityProvider):
    def get_plugins(self) -> Sequence:
        return [NativePasswordAuthPlugin()]

    async def get_user(self, username: str) -> Optional[User]:
        try:
            info = store.resolve_project(username)
            if not info:
                return None
            plain = crypto_util.decrypt(info["password_enc"])
            if not plain:
                return None
            auth_string = NativePasswordAuthPlugin.create_auth_string(plain)
            return User(
                name=info["project_key"],
                auth_string=auth_string,
                auth_plugin=NativePasswordAuthPlugin.name,
            )
        except Exception:
            LOG.exception("auth lookup failed for user")
            return None


class ProjectSession(Session):
    def __init__(self) -> None:
        super().__init__()
        self.project_id: int | None = None
        self.project_key: str | None = None

    async def init(self, connection) -> None:  # type: ignore[override]
        await super().init(connection)
        username = self.username or ""
        info = store.resolve_project(username)
        if not info:
            raise MysqlError("Access denied", code=ErrorCode.ACCESS_DENIED_ERROR)
        self.project_id = info["project_id"]
        self.project_key = info["project_key"]
        # Default database = project_key so clients can omit USE.
        self.database = self.project_key

    async def schema(self) -> dict:
        assert self.project_id is not None and self.project_key is not None
        return store.schema_for_project(self.project_id, self.project_key)

    async def query(self, expression, sql, attrs):  # type: ignore[override]
        assert self.project_id is not None and self.project_key is not None
        pid = self.project_id
        try:
            if isinstance(expression, exp.Select) or isinstance(expression, exp.Union):
                return await self._select(expression)
            if isinstance(expression, exp.Insert):
                return await self._insert(expression)
            if isinstance(expression, exp.Update):
                return await self._update(expression)
            if isinstance(expression, exp.Delete):
                return await self._delete(expression)
            if isinstance(expression, exp.Command):
                # COM_PING etc. already handled; ignore unknown commands.
                return [], []
            raise MysqlError(
                f"Unsupported statement: {expression.key}",
                code=ErrorCode.NOT_SUPPORTED_YET,
            )
        except KeyError as err:
            raise MysqlError(f"Table '{err.args[0]}' doesn't exist", code=ErrorCode.UNKNOWN_ERROR) from err
        except ValueError as err:
            raise MysqlError(str(err), code=ErrorCode.UNKNOWN_ERROR) from err

    async def _select(self, expression: exp.Expression):
        assert self.project_id is not None
        tables: dict[str, list[dict[str, Any]]] = {}
        for meta in store.list_table_meta(self.project_id):
            _names, rows = store.load_table_rows(self.project_id, meta["name"])
            tables[meta["name"]] = rows
        # Also expose under db.table for qualified names
        result = execute(expression, tables=tables)
        return result.rows, result.columns

    def _table_name(self, expression: exp.Expression) -> str:
        table = expression.find(exp.Table)
        if not table:
            raise ValueError("missing table")
        name = table.name
        # Strip database qualifier if it matches project_key / demox
        return name

    def _literal_value(self, node: exp.Expression | None) -> Any:
        if node is None:
            return None
        if isinstance(node, exp.Null):
            return None
        if isinstance(node, exp.Boolean):
            return bool(node.this)
        if isinstance(node, exp.Literal):
            if node.is_string:
                return node.this
            text = node.this
            try:
                if "." in str(text):
                    return float(text)
                return int(text)
            except Exception:
                return text
        return expression_to_python(node)

    async def _insert(self, expression: exp.Insert):
        assert self.project_id is not None
        table_name = self._table_name(expression)
        columns_expr = expression.args.get("columns") or []
        col_names = [c.name for c in columns_expr] if columns_expr else None
        values_expr = expression.expression
        rows_to_write: list[dict[str, Any]] = []
        if isinstance(values_expr, exp.Values):
            for tuple_expr in values_expr.expressions:
                vals = [self._literal_value(v) for v in tuple_expr.expressions]
                if col_names:
                    if len(col_names) != len(vals):
                        raise ValueError("column count mismatch")
                    rows_to_write.append(dict(zip(col_names, vals)))
                else:
                    meta = store.get_table(self.project_id, table_name)
                    names = [c["name"] for c in meta["columns"]]
                    if len(names) != len(vals):
                        raise ValueError("column count mismatch")
                    rows_to_write.append(dict(zip(names, vals)))
        elif isinstance(values_expr, exp.Select):
            raise MysqlError("INSERT ... SELECT is not supported", code=ErrorCode.NOT_SUPPORTED_YET)
        else:
            raise MysqlError("Unsupported INSERT form", code=ErrorCode.NOT_SUPPORTED_YET)
        for row in rows_to_write:
            store.put_row(self.project_id, table_name, row)
        return [], []

    async def _update(self, expression: exp.Update):
        assert self.project_id is not None
        table_name = self._table_name(expression)
        meta = store.get_table(self.project_id, table_name)
        pk_name = store.primary_column(meta["columns"])
        where = expression.args.get("where")
        pk_value = self._extract_pk_eq(where, pk_name)
        if pk_value is None:
            raise MysqlError(
                f"UPDATE requires WHERE {pk_name} = ... (primary key)",
                code=ErrorCode.NOT_SUPPORTED_YET,
            )
        _names, rows = store.load_table_rows(self.project_id, table_name)
        current = next((r for r in rows if str(r.get(pk_name)) == str(pk_value)), None)
        if current is None:
            return [], []
        updated = dict(current)
        for assignment in expression.expressions:
            if not isinstance(assignment, exp.EQ):
                continue
            col = assignment.left.name if isinstance(assignment.left, exp.Column) else None
            if not col:
                continue
            updated[col] = self._literal_value(assignment.right)
        updated[pk_name] = pk_value
        store.put_row(self.project_id, table_name, updated)
        return [], []

    async def _delete(self, expression: exp.Delete):
        assert self.project_id is not None
        table_name = self._table_name(expression)
        meta = store.get_table(self.project_id, table_name)
        pk_name = store.primary_column(meta["columns"])
        where = expression.args.get("where")
        pk_value = self._extract_pk_eq(where, pk_name)
        if pk_value is None:
            raise MysqlError(
                f"DELETE requires WHERE {pk_name} = ... (primary key)",
                code=ErrorCode.NOT_SUPPORTED_YET,
            )
        store.delete_row(self.project_id, table_name, str(pk_value))
        return [], []

    def _extract_pk_eq(self, where: exp.Expression | None, pk_name: str) -> Any:
        if where is None:
            return None
        node = where.this if isinstance(where, exp.Where) else where
        if isinstance(node, exp.EQ):
            left, right = node.left, node.right
            if isinstance(left, exp.Column) and left.name == pk_name:
                return self._literal_value(right)
            if isinstance(right, exp.Column) and right.name == pk_name:
                return self._literal_value(left)
        return None


def expression_to_python(node: exp.Expression) -> Any:
    if isinstance(node, exp.Literal):
        return node.this
    return str(node)


async def main() -> None:
    host = os.environ.get("DEMOX_MYSQL_GATEWAY_HOST", "0.0.0.0")
    port = int(os.environ.get("DEMOX_MYSQL_GATEWAY_PORT") or 3306)
    for required in (
        "MYSQL_HOST",
        "MYSQL_USER",
        "MYSQL_PASSWORD",
        "MYSQL_DATABASE",
        "ENCRYPTION_KEY",
    ):
        if not os.environ.get(required):
            LOG.error("missing env %s", required)
            sys.exit(1)
    server = MysqlServer(
        session_factory=ProjectSession,
        identity_provider=ProjectIdentityProvider(),
        host=host,
        port=port,
    )
    LOG.info("listening on %s:%s (logical tables only)", host, port)
    await server.serve_forever()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    asyncio.run(main())
