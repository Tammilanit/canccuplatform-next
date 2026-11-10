"""Cross-tenant leak tests: one event never reads another's configuration or notifications."""

from __future__ import annotations

from canccu_kit.testing import assert_tenant_isolation
from conftest import Env


async def test_rls_keeps_every_table_apart(env: Env) -> None:
    class Probe:
        seed = staticmethod(lambda t, m: _seed(t, m))
        read = staticmethod(lambda t: _read(t))

    async def _seed(tenant: str, marker: str) -> None:
        async with env.db.tenant(tenant) as conn:
            await conn.execute("INSERT INTO notify_topic_config (key) VALUES ($1)", marker)
            await conn.execute("INSERT INTO notify_dedupe (key) VALUES ($1)", marker)
            await conn.execute("INSERT INTO notify_event_state (time_zone) VALUES ($1)", marker)
            await conn.execute(
                "INSERT INTO notify_custom_topics (key, based_on, title, conditions)"
                " VALUES ($1, 'schedule', 't', '[]')",
                f"custom_{marker}",
            )
            await conn.execute(
                "INSERT INTO notify_check_in_keys (sealed, created_at) VALUES ($1, $2)",
                marker,
                env.clock[0],
            )
            await conn.execute(
                "INSERT INTO notify_check_ins (id, user_id, purpose, checked_in_at)"
                " VALUES ($1, 'u', 'arrival', $2)",
                marker,
                env.clock[0],
            )
            await conn.execute(
                "INSERT INTO notify_notifications (id, topic, part, audience, title, body,"
                " channels, source_event_id, created_at, expires_at) VALUES ($1, 't', 'event',"
                " 'public', 't', 'b', '{push}', 'e', $2, $2)",
                marker,
                env.clock[0],
            )
            await conn.execute("INSERT INTO notify_outbox (event) VALUES ($1)", marker)

    async def _read(tenant: str) -> set[str]:
        async with env.db.tenant(tenant) as conn:
            found = set()
            for sql in (
                "SELECT key AS v FROM notify_topic_config",
                "SELECT key AS v FROM notify_dedupe",
                "SELECT time_zone AS v FROM notify_event_state",
                "SELECT sealed AS v FROM notify_check_in_keys",
                "SELECT id AS v FROM notify_check_ins",
                "SELECT substr(key, 8) AS v FROM notify_custom_topics",
                "SELECT id AS v FROM notify_notifications",
                "SELECT event AS v FROM notify_outbox",
            ):
                found |= {r["v"] for r in await conn.fetch(sql)}
        return found

    await assert_tenant_isolation(Probe())
