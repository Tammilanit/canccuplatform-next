import os
import secrets
from typing import Any
from urllib.parse import urlsplit

import asyncpg
import pytest

from canccu_kit.testing import require_test_database, require_test_database_url


class ConnectedTo:
    """A connection to `name`, as Postgres answers current_database()."""

    def __init__(self, name: str | None) -> None:
        self.name = name
        self.asked: list[str] = []

    async def fetchval(self, query: str, *args: Any) -> Any:
        self.asked.append(query)
        return self.name


async def test_passes_a_database_whose_name_ends_in_test_asking_the_server() -> None:
    conn = ConnectedTo("canccu_test")
    await require_test_database(conn)
    assert conn.asked == ["SELECT current_database()"]


@pytest.mark.parametrize(
    "name", ["canccu", "postgres", "test_canccu", "canccu_test_old", "canccu_TEST"]
)
async def test_refuses_any_other_name(name: str) -> None:
    with pytest.raises(RuntimeError, match=f'"{name}".*ends in _test'):
        await require_test_database(ConnectedTo(name))


async def test_refuses_when_the_server_names_no_database() -> None:
    with pytest.raises(RuntimeError, match='""'):
        await require_test_database(ConnectedTo(None))


URL = os.environ.get("CANCCU_DATABASE_URL", "")


@pytest.mark.skipif(not URL, reason="CANCCU_DATABASE_URL is not set")
async def test_url_guard_passes_the_test_database() -> None:
    await require_test_database_url(URL)


@pytest.mark.skipif(not URL, reason="CANCCU_DATABASE_URL is not set")
async def test_url_guard_refuses_another_database_before_anything_runs_on_it() -> None:
    name = f"kitpy_guard_{secrets.token_hex(4)}"
    admin = await asyncpg.connect(URL)
    await admin.execute(f"CREATE DATABASE {name}")
    try:
        other = urlsplit(URL)._replace(path=f"/{name}").geturl()
        with pytest.raises(RuntimeError, match=f'"{name}"'):
            await require_test_database_url(other)
        conn = await asyncpg.connect(other)
        try:
            assert (
                await conn.fetchval("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
                == 0
            )
        finally:
            await conn.close()
    finally:
        await admin.execute(f"DROP DATABASE {name}")
        await admin.close()
