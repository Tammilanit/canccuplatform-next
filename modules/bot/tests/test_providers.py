"""A provider's bearer secret per event (contracts/bot.md, Provider secrets): set and cleared by
the event-admin role itself, sealed and bound to the event and the provider, never shown, logged
or audited with its value."""

from __future__ import annotations

from conftest import Env

from canccu_bot.providers import bearer, secret_aad

PATH = "/api/bot/providers/finals/secret"


async def test_the_event_admin_sets_a_secret_that_is_kept_sealed(env: Env) -> None:
    async with env.client() as c:
        r = await c.put(PATH, json={"secret": "finals-bearer"}, headers=env.admin())
    assert (r.status_code, r.content) == (204, b"")
    [row] = await env.fetch("ev-a", "SELECT provider, secret FROM bot_provider_secrets")
    assert row["provider"] == "finals" and "finals-bearer" not in row["secret"]
    assert (
        env.deps.secrets.open_text(row["secret"], secret_aad("ev-a", "finals")) == "finals-bearer"
    )
    assert await bearer(env.deps, "ev-a", "finals") == "finals-bearer"
    assert await bearer(env.deps, "ev-b", "finals") is None
    [entry] = env.audit.entries
    assert entry["action"] == "bot.provider_secret.set"
    assert "finals-bearer" not in repr(entry)


async def test_a_secret_copied_to_another_event_does_not_open(env: Env) -> None:
    sealed = env.deps.secrets.seal("finals-bearer", secret_aad("ev-a", "finals"))
    await env.sql(
        "ev-b",
        "INSERT INTO bot_provider_secrets (provider, secret, updated_at)"
        " VALUES ('finals', $1, now())",
        sealed,
    )
    assert await bearer(env.deps, "ev-b", "finals") is None


async def test_clearing_removes_it_and_audits_once(env: Env) -> None:
    async with env.client() as c:
        await c.put(PATH, json={"secret": "finals-bearer"}, headers=env.admin())
        r = await c.delete(PATH, headers=env.admin())
        again = await c.delete(PATH, headers=env.admin())
    assert (r.status_code, again.status_code) == (204, 204)
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_provider_secrets") == []
    assert [e["action"] for e in env.audit.entries] == [
        "bot.provider_secret.set",
        "bot.provider_secret.cleared",
    ]


async def test_only_the_event_admin_with_a_good_secret_and_name(env: Env) -> None:
    async with env.client() as c:
        crew = await c.put(PATH, json={"secret": "x"}, headers=env.reader())
        empty = await c.put(PATH, json={"secret": "  "}, headers=env.admin())
        long = await c.put(PATH, json={"secret": "x" * 513}, headers=env.admin())
        name = await c.put(
            "/api/bot/providers/Bad-Name/secret", json={"secret": "x"}, headers=env.admin()
        )
    assert [crew.status_code, empty.status_code, long.status_code, name.status_code] == [
        403,
        400,
        400,
        404,
    ]
    assert await env.fetch("ev-a", "SELECT 1 FROM bot_provider_secrets") == []


async def test_an_archived_event_clears_but_does_not_set(env: Env) -> None:
    env.contexts["ev-a"]["status"] = "archived"
    async with env.client() as c:
        put = await c.put(PATH, json={"secret": "x"}, headers=env.admin())
        delete = await c.delete(PATH, headers=env.admin())
    assert (put.status_code, put.json()["error"]["code"]) == (409, "event_archived")
    assert delete.status_code == 204
