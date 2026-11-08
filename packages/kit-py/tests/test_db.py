from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Any

import pytest

from canccu_kit.db import (
    CURRENT_TENANT_SQL,
    TENANT_COLUMN_SQL,
    RlsBypassed,
    check_app_role,
    rls_sql,
    tenant_transaction,
)
from canccu_kit.tenant import NoTenant, current_tenant, tenant_scope


class FakeConnection:
    """Records statements and transaction boundaries the way asyncpg would run them."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.row: dict[str, Any] | None = None
        self.fail_on: str | None = None

    async def execute(self, query: str, *args: Any) -> str:
        self.calls.append((query, args))
        if self.fail_on is not None and self.fail_on in query:
            raise RuntimeError("boom")
        return "OK"

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        self.calls.append((query, args))
        return self.row

    def transaction(self) -> AbstractAsyncContextManager[None]:
        @asynccontextmanager
        async def tx() -> AsyncIterator[None]:
            self.calls.append(("BEGIN", ()))
            try:
                yield
            except BaseException:
                self.calls.append(("ROLLBACK", ()))
                raise
            self.calls.append(("COMMIT", ()))

        return tx()


async def test_sets_the_tenant_with_set_local_semantics_inside_one_transaction() -> None:
    conn = FakeConnection()
    async with tenant_transaction(conn, "demo") as c:
        await c.execute("SELECT 1")
        seen = current_tenant()
    assert seen == "demo"
    assert current_tenant() is None
    assert conn.calls == [
        ("BEGIN", ()),
        ("SELECT set_config('canccu.tenant', $1, true)", ("demo",)),
        ("SELECT 1", ()),
        ("COMMIT", ()),
    ]


async def test_takes_the_tenant_from_the_context_when_none_is_given() -> None:
    conn = FakeConnection()
    with tenant_scope("demo"):
        async with tenant_transaction(conn):
            pass
    assert conn.calls[1][1] == ("demo",)


async def test_refuses_to_start_without_a_tenant() -> None:
    conn = FakeConnection()
    with pytest.raises(NoTenant):
        async with tenant_transaction(conn):
            pass
    assert conn.calls == []


async def test_rolls_back_and_reraises_when_the_work_fails() -> None:
    conn = FakeConnection()
    conn.fail_on = "INSERT"
    with pytest.raises(RuntimeError, match="boom"):
        async with tenant_transaction(conn, "demo") as c:
            await c.execute("INSERT x")
    assert [q for q, _ in conn.calls][-1:] == ["ROLLBACK"]


def test_column_defaults_to_the_setting_and_treats_an_empty_setting_as_none() -> None:
    assert CURRENT_TENANT_SQL == "NULLIF(current_setting('canccu.tenant', true), '')"
    assert TENANT_COLUMN_SQL == f"tenant_id text NOT NULL DEFAULT {CURRENT_TENANT_SQL}"


def test_rls_sql_enables_forces_and_adds_the_tenant_policy() -> None:
    assert rls_sql("pizza_orders") == "\n".join(
        [
            "ALTER TABLE pizza_orders ENABLE ROW LEVEL SECURITY;",
            "ALTER TABLE pizza_orders FORCE ROW LEVEL SECURITY;",
            f"CREATE POLICY canccu_tenant ON pizza_orders USING (tenant_id = {CURRENT_TENANT_SQL})"
            f" WITH CHECK (tenant_id = {CURRENT_TENANT_SQL});",
        ]
    )
    assert rls_sql("pizza.orders").startswith("ALTER TABLE pizza.orders ")


def test_rls_sql_refuses_a_table_name_that_is_not_a_plain_identifier() -> None:
    for bad in ["x; DROP TABLE y", "orders\n"]:
        with pytest.raises(ValueError, match="table"):
            rls_sql(bad)


async def test_check_app_role_passes_a_role_that_is_subject_to_rls() -> None:
    conn = FakeConnection()
    conn.row = {"rolname": "app", "rolsuper": False, "rolbypassrls": False}
    await check_app_role(conn)


async def test_check_app_role_refuses_a_superuser_or_a_bypassrls_role() -> None:
    conn = FakeConnection()
    conn.row = {"rolname": "canccu", "rolsuper": True, "rolbypassrls": False}
    with pytest.raises(RlsBypassed):
        await check_app_role(conn)
    conn.row = {"rolname": "app", "rolsuper": False, "rolbypassrls": True}
    with pytest.raises(RlsBypassed, match="bypasses"):
        await check_app_role(conn)
    conn.row = None
    with pytest.raises(RlsBypassed):
        await check_app_role(conn)


async def test_refuses_a_tenant_transaction_nested_on_the_same_connection() -> None:
    conn = FakeConnection()
    with pytest.raises(RuntimeError, match="already"):
        async with tenant_transaction(conn, "acme"), tenant_transaction(conn, "beta"):
            pass
    assert [q for q, _ in conn.calls] == [
        "BEGIN",
        "SELECT set_config('canccu.tenant', $1, true)",
        "ROLLBACK",
    ]
    async with tenant_transaction(conn, "acme"):
        pass


async def test_refuses_to_start_inside_a_callers_plain_transaction() -> None:
    # A nested transaction is a savepoint; SET LOCAL there would outlive the block.
    conn = FakeConnection()
    conn.is_in_transaction = lambda: True  # type: ignore[attr-defined]
    with pytest.raises(RuntimeError, match="already in a transaction"):
        async with tenant_transaction(conn, "acme"):
            pass
    assert conn.calls == []


@pytest.mark.parametrize(
    ("row", "safe"),
    [
        ({"rolname": "canccu_app", "rolsuper": False, "rolbypassrls": False, "owns": False}, True),
        ({"rolname": "canccu", "rolsuper": True, "rolbypassrls": False, "owns": False}, False),
        ({"rolname": "x", "rolsuper": False, "rolbypassrls": True, "owns": False}, False),
        (
            {"rolname": "canccu_migrator", "rolsuper": False, "rolbypassrls": False, "owns": True},
            False,
        ),
        (None, False),
    ],
)
async def test_check_login_role_wants_a_plain_role_that_owns_nothing(
    row: dict[str, Any] | None, safe: bool
) -> None:
    from canccu_kit.db import check_login_role

    conn = FakeConnection()
    conn.row = row
    if safe:
        await check_login_role(conn)
    else:
        with pytest.raises(RlsBypassed):
            await check_login_role(conn)


def test_quote_ident_doubles_quotes() -> None:
    from canccu_kit.db import quote_ident

    assert quote_ident("canccu_app") == '"canccu_app"'
    assert quote_ident('a"b') == '"a""b"'
