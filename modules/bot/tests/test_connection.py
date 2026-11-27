"""`GET /api/bot/connection` (contracts/bot.md, The event's connection): the event's mode, the
client serving it as any container sees it, never a credential."""

from __future__ import annotations

from typing import Any

from canccu_kit.testing import assert_tenant_isolation
from conftest import SHARED_ID, Env

OWN = "100000000000000003"
READY = {"status": "ready", "error_code": None, "since": "2026-11-27T10:00:00Z"}


async def get(env: Env, headers: dict[str, str], host: str = "a.example.test") -> Any:
    async with env.client(host) as c:
        return await c.get("/api/bot/connection", headers=headers)


async def test_signed_out_is_401(env: Env) -> None:
    r = await get(env, {})
    assert (r.status_code, r.json()["error"]["code"]) == (401, "not_signed_in")


async def test_without_the_right_is_403(env: Env) -> None:
    r = await get(env, env.rights.sign_in("u_x", "agenda.items.write"))
    assert (r.status_code, r.json()["error"]["code"]) == (403, "missing_right")


async def test_an_event_starts_on_the_shared_bot(env: Env) -> None:
    await env.deps.board.publish(SHARED_ID, READY, {"id": "100000000000000004", "name": "Demo Bot"})
    r = await get(env, env.reader())
    assert r.status_code == 200
    assert r.json() == {
        "mode": "shared",
        "application_id": SHARED_ID,
        "bot_user": {"id": "100000000000000004", "name": "Demo Bot"},
        "credentials": None,
        "client": READY,
        "guild": None,
        "revision": 0,
    }


async def test_a_client_no_container_reports_is_connecting(env: Env) -> None:
    body = (await get(env, env.reader())).json()
    assert body["client"]["status"] == "connecting"
    assert body["client"]["error_code"] is None
    assert body["bot_user"] is None


async def test_no_shared_application_is_503(env: Env) -> None:
    env.deps.shared = None
    r = await get(env, env.reader())
    assert (r.status_code, r.json()["error"]["code"]) == (503, "discord_not_configured")


async def test_an_own_application_shows_which_credentials_are_set_never_their_values(
    env: Env,
) -> None:
    box = env.deps.secrets
    token = box.seal("own-token-value", f"bot:token:ev-a:{OWN}")
    secret = box.seal("own-secret-value", f"bot:secret:ev-a:{OWN}")
    await env.sql(
        "ev-a",
        "INSERT INTO bot_connections (mode, application_id, bot_token, client_secret,"
        " key_version, updated_at, updated_by, revision)"
        " VALUES ('own', $1, $2, $3, 1, '2026-11-27T09:00:00Z', 'u_org', 3)",
        OWN,
        token,
        secret,
    )
    failed = {"status": "failed", "error_code": "token_invalid", "since": "2026-11-27T09:30:00Z"}
    await env.deps.board.publish(OWN, failed, None)
    r = await get(env, env.reader())
    body = r.json()
    assert (body["mode"], body["application_id"], body["revision"]) == ("own", OWN, 3)
    assert body["credentials"] == {
        "bot_token_set": True,
        "client_secret_set": True,
        "updated_at": "2026-11-27T09:00:00Z",
        "updated_by": "u_org",
    }
    assert body["client"] == failed
    assert "own-token-value" not in r.text and token not in r.text


async def test_the_bound_guild_is_shown(env: Env) -> None:
    await env.sql(
        "ev-a",
        "INSERT INTO bot_bindings (guild_id, guild_name, application_id, bound_by, bound_at,"
        " commands_status) VALUES ('100000000000000010', 'Demo Community', $1, 'u_org',"
        " '2026-11-27T08:00:00Z', 'registered')",
        SHARED_ID,
    )
    guild = (await get(env, env.reader())).json()["guild"]
    assert guild == {
        "guild_id": "100000000000000010",
        "guild_name": "Demo Community",
        "application_id": SHARED_ID,
        "bound_by": "u_org",
        "bound_at": "2026-11-27T08:00:00Z",
        "commands": {
            "status": "registered",
            "flags_version": None,
            "registered_at": None,
            "error_code": None,
        },
    }


async def test_one_event_never_reads_another_s_connection(env: Env) -> None:
    hosts = {"ev-a": "a.example.test", "ev-b": "b.example.test"}
    headers = env.reader()

    class Probe:
        async def seed(self, tenant: str, marker: str) -> None:
            await env.sql(
                tenant,
                "INSERT INTO bot_bindings (guild_id, guild_name, application_id)"
                " VALUES ($1, $2, $3)",
                "100000000000000011" if tenant == "ev-a" else "100000000000000012",
                marker,
                SHARED_ID,
            )

        async def read(self, tenant: str) -> object:
            return (await get(env, headers, hosts[tenant])).json()

    await assert_tenant_isolation(Probe(), ("ev-a", "ev-b"))
