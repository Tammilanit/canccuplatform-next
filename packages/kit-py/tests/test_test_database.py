from typing import Any

import pytest

from canccu_kit.testing import require_test_database


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
