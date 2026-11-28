"""The legacy bot import (#125, D9 to D11) on a scrubbed copy of the legacy files against the fake
Discord: the dry run's report, the import, a second run that changes nothing, and the refusal
while the legacy bot still holds its gateway session."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from canccu_kit.testing.discord import FakeApplication, Intents
from conftest import SHARED_ID, Env
from fakes import connector
from test_legacy_files import scrubbed

from canccu_bot import store
from canccu_bot.legacy_files import read
from canccu_bot.legacy_import import LegacyImportError, Report, run_import
from canccu_bot.legacy_report import render

TENANT = "ev-a"


@dataclass
class World:
    app: FakeApplication
    guild_id: str
    ids: dict[str, str]
    env_path: Path
    state: Path


def world(env: Env, tmp_path: Path, **app_options: Any) -> World:
    fake = env.discord
    app = fake.add_application("Legacy Bot", **app_options)
    guild = fake.add_guild("Demo Community", bots=[app.id])
    ids = {
        "token": app.token,
        "guild_id": guild.id,
        "tournaments": fake.add_channel(guild.id, "tournaments"),
        "finals": fake.add_channel(guild.id, "finals"),
        "finals_test": fake.add_channel(guild.id, "finals-test"),
        "alerts": fake.add_channel(guild.id, "alerts"),
        "role": fake.add_role(guild.id, "Demo Admin"),
    }
    env_path, state = scrubbed(tmp_path, **{k: v for k, v in ids.items() if k != "role"})
    return World(app, guild.id, ids, env_path, state)


async def run(env: Env, w: World, *, dry_run: bool) -> tuple[Report, str]:
    legacy = read(w.env_path, w.state)
    report = await run_import(env.deps, TENANT, legacy, connector(env.discord), dry_run=dry_run)
    return report, render(report)


async def legacy_running(env: Env, app: FakeApplication) -> Any:
    """The legacy bot's own gateway session, as discord.py holds it: online, not invisible."""
    ws = await env.discord.gateway.connect(env.discord.gateway_url)
    await ws.recv()
    await ws.send({"op": 2, "d": {"token": app.token, "intents": Intents.GUILDS, "properties": {}}})
    assert (await ws.recv())["t"] == "READY"
    return ws


def files_of(root: Path) -> dict[Path, bytes]:
    return {p: p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


async def rows(env: Env) -> dict[str, list[dict[str, Any]]]:
    queries = {
        "connections": "SELECT * FROM bot_connections",
        "purposes": "SELECT purpose, target_id, updated_at FROM bot_purposes ORDER BY 1",
        "legacy": "SELECT kind, key, value, imported_at FROM bot_legacy ORDER BY 1, 2",
        "bindings": "SELECT * FROM bot_bindings",
    }
    out = {name: [dict(r) for r in await env.fetch(TENANT, q)] for name, q in queries.items()}
    for row in out["legacy"]:
        row["value"] = json.loads(row["value"])
    routes = await env.fetch(None, "SELECT * FROM bot_application_routes")
    out["routes"] = [dict(r) for r in routes]
    return out


async def test_the_dry_run_reports_every_kind_and_writes_nothing(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    report, text = await run(env, w, dry_run=True)
    assert report.refused is None and report.changes == 9 and not report.written
    lines = text.splitlines()
    assert lines[0] == "Legacy bot import · DRY RUN · nothing is written"
    expected = [
        f"own application {w.app.id}, token checked with Discord",
        f"Demo Community ({w.guild_id}) → binding: finish it in the Discord page's setup (D11)",
        "tournaments → Tournaments · alerts → Crew",
        f'"Demo Admin" → role {w.ids["role"]}: waits for #763 (Discord roles to platform rights)',
        "game threshold 4 → Games surge_threshold (its default: nothing to set)",
        "ticker TTL 1800 → default (the new /ticker sets each line's end)",
        "watcher: 3 announced, 2 started, 1 champion · finals card · 2 finals channels",
        "polls (dropped, 0010): MAX_POLL_OPTIONS, MIN_POLL_DURATION, POLL_RESULT_DISPLAY_SECONDS",
        "the finals provider's bearer (the operator sets it in Finals, D10): FINALS_PROVIDER_TOKEN",
        "the legacy bot is stopped (no gateway session on the token) ✓",
        "the event has no other own application and no server yet ✓",
    ]
    for part in expected:
        assert part in text, part
    assert lines[-1] == "Would change 9 rows. Run without --dry-run to import."
    assert [line.split()[0:3] for line in lines if line.startswith("Settings")] == [
        ["Settings", "2", "game"]
    ]
    assert w.app.token not in text and "placeholder" not in text
    assert all(not v for v in (await rows(env)).values())
    assert env.events(TENANT) == [] and env.audit.entries == []


async def test_the_import_stores_the_token_sealed_and_routed(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    report, text = await run(env, w, dry_run=False)
    assert report.written and report.changes == 9
    assert text.splitlines()[0] == "Legacy bot import"
    assert text.splitlines()[-1] == (
        "Imported 9 rows. Next: the client secret and the bind in the Discord page's setup."
    )
    got = await rows(env)
    [conn] = got["connections"]
    assert (conn["mode"], conn["application_id"], conn["revision"]) == ("own", w.app.id, 1)
    assert conn["client_secret"] is None and conn["updated_by"] is None
    box = env.deps.secrets
    assert box.open_text(conn["bot_token"], store.token_aad(TENANT, w.app.id)) == w.app.token
    assert got["routes"] == [{"application_id": w.app.id, "tenant_id": TENANT}]
    assert await store.own_applications(env.db, box) == {w.app.id: w.app.token}
    assert [(p["purpose"], p["target_id"]) for p in got["purposes"]] == [
        ("crew", w.ids["alerts"]),
        ("tournaments", w.ids["tournaments"]),
    ]
    legacy = {(r["kind"], r["key"]): r["value"] for r in got["legacy"]}
    assert legacy[("setting", "GAME_THRESHOLD")] == 4
    assert legacy[("setting", "BOT_TICKER_TTL_SECONDS")] == 1800
    assert legacy[("finals", "FINALS_CHANNEL_ID")] == w.ids["finals"]
    assert legacy[("finals", "finals_cards.json")]["phase"] == "registration"
    assert legacy[("finals", "tourney_watcher.json")]["started"] == [
        "demo-season-1",
        "demo-season-2",
    ]
    assert len(legacy) == 6
    assert got["bindings"] == []  # the admin binds in setup, with Manage Server (D11)


async def test_the_import_is_emitted_and_audited_without_a_value(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    await run(env, w, dry_run=False)
    connection, purposes = env.events(TENANT)
    assert connection == {
        "type": "bot.connection.changed",
        "data": {
            "mode": "own",
            "application_id": w.app.id,
            "changed": ["mode", "application_id", "bot_token"],
            "revision": 1,
            "actor_user_id": None,
        },
    }
    assert purposes == {
        "type": "bot.purposes.changed",
        "data": {
            "purposes": {"tournaments": w.ids["tournaments"], "crew": w.ids["alerts"]},
            "actor_user_id": None,
        },
    }
    actions = [(e["action"], e["actor_user_id"], e["reason"]) for e in env.audit.entries]
    assert actions == [("bot.legacy.imported", None, "the legacy bot import")]
    assert env.audit.entries[0]["changes"] == {
        "bot_application": 1,
        "channels": 2,
        "settings": 2,
        "finals_state": 4,
    }
    assert w.app.token not in str(env.audit.entries) + str(env.streams.streams)


async def test_a_second_run_changes_nothing(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    await run(env, w, dry_run=False)
    before, events = await rows(env), len(env.events(TENANT))
    for dry_run in (True, False):
        report, text = await run(env, w, dry_run=dry_run)
        assert report.changes == 0 and not report.written and report.refused is None
        assert text.splitlines()[-1] == "Nothing to change: everything is already imported."
        assert "already imported" in text
    assert await rows(env) == before
    assert len(env.events(TENANT)) == events and len(env.audit.entries) == 1


async def test_the_legacy_files_are_left_as_they_were(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    before = files_of(tmp_path)
    await run(env, w, dry_run=False)
    assert files_of(tmp_path) == before


async def test_a_changed_legacy_value_changes_only_its_row(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    await run(env, w, dry_run=False)
    (w.state / "finals_cards.json").write_text('{"seasonId": "demo-season-3", "phase": "started"}')
    report, text = await run(env, w, dry_run=False)
    assert report.changes == 1
    assert "Imported 1 row." in text
    [card] = await env.fetch(TENANT, "SELECT value FROM bot_legacy WHERE key = 'finals_cards.json'")
    assert json.loads(card["value"])["phase"] == "started"


async def test_the_import_refuses_while_the_legacy_bot_runs(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    legacy = await legacy_running(env, w.app)
    report, text = await run(env, w, dry_run=True)
    assert report.refused is not None
    assert "the legacy bot is stopped (no gateway session on the token) ✗" in text
    report, text = await run(env, w, dry_run=False)
    assert not report.written
    assert text.splitlines()[-1] == (
        "Refused: the legacy bot still holds its gateway session on this token. Stop it, check"
        " that its bot user shows offline in the server, and run again. Nothing was written."
    )
    assert all(not v for v in (await rows(env)).values())
    await legacy.close(1000)
    report, _ = await run(env, w, dry_run=False)
    assert report.written and report.changes == 9


async def test_without_the_presence_intent_the_check_cannot_run(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path, privileged=Intents.GUILD_MEMBERS)
    report, text = await run(env, w, dry_run=False)
    assert not report.written
    assert "enable the Presence intent" in text
    assert all(not v for v in (await rows(env)).values())


async def test_a_token_discord_refuses_stores_nothing(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    w.env_path.write_text(w.env_path.read_text().replace(w.app.token, "fake.wrong.token-value"))
    with pytest.raises(LegacyImportError, match="Discord refused the token"):
        await run(env, w, dry_run=False)
    assert all(not v for v in (await rows(env)).values())


async def test_a_server_the_legacy_bot_is_not_in_stops_it(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    env.discord.guilds[w.guild_id].bots.discard(w.app.id)
    with pytest.raises(LegacyImportError, match=f"not in the server {w.guild_id}"):
        await run(env, w, dry_run=True)


async def test_an_unknown_event_stops_it(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    legacy = read(w.env_path, w.state)
    with pytest.raises(LegacyImportError, match="no event ev-none"):
        await run_import(env.deps, "ev-none", legacy, connector(env.discord), dry_run=True)


async def test_an_event_with_another_application_is_refused(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    other = env.discord.add_application("Other Bot")
    async with env.db.tenant(TENANT) as conn:
        await conn.execute(
            "INSERT INTO bot_connections (mode, application_id, bot_token, revision)"
            " VALUES ('own', $1, 'sealed', 1)",
            other.id,
        )
    report, text = await run(env, w, dry_run=False)
    assert not report.written
    assert "the event has no other own application and no server yet ✗" in text
    assert "the event has its own application already" in text


async def test_an_event_with_a_server_on_the_shared_bot_is_refused(
    env: Env, tmp_path: Path
) -> None:
    w = world(env, tmp_path)
    async with env.db.tenant(TENANT) as conn:
        await conn.execute(
            "INSERT INTO bot_bindings (guild_id, guild_name, application_id)"
            " VALUES ('100000000000000099', 'Demo Community', $1)",
            SHARED_ID,
        )
    report, text = await run(env, w, dry_run=False)
    assert not report.written
    assert "unbind it on the Discord page first" in text


async def test_an_application_another_event_holds_is_refused(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    async with env.db.platform() as conn:
        await conn.execute(
            "INSERT INTO bot_application_routes (application_id, tenant_id) VALUES ($1, 'ev-b')",
            w.app.id,
        )
    report, text = await run(env, w, dry_run=False)
    assert not report.written
    assert "another event holds this application" in text


async def test_the_shared_bot_cannot_be_imported(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    shared = env.discord.applications[SHARED_ID]
    env.discord.guilds[w.guild_id].bots.add(SHARED_ID)
    w.env_path.write_text(w.env_path.read_text().replace(w.app.token, shared.token))
    report, text = await run(env, w, dry_run=False)
    assert not report.written
    assert "this is the platform's shared bot" in text


async def test_a_purpose_the_event_set_is_kept(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    chosen = env.discord.add_channel(w.guild_id, "crew")
    async with env.db.tenant(TENANT) as conn:
        await conn.execute(
            "INSERT INTO bot_purposes (purpose, target_id, updated_at) VALUES ('crew', $1, now())",
            chosen,
        )
    report, text = await run(env, w, dry_run=False)
    assert report.changes == 8
    assert "alerts → Crew: kept, the event already uses another channel" in text
    [crew] = await env.fetch(TENANT, "SELECT target_id FROM bot_purposes WHERE purpose = 'crew'")
    assert crew["target_id"] == chosen


async def test_a_channel_gone_from_the_server_is_skipped(env: Env, tmp_path: Path) -> None:
    w = world(env, tmp_path)
    del env.discord.guilds[w.guild_id].channels[w.ids["tournaments"]]
    del env.discord.guilds[w.guild_id].roles[w.ids["role"]]
    report, text = await run(env, w, dry_run=True)
    assert report.changes == 8
    assert "tournaments: not a text channel of the server any more" in text
    assert '"Demo Admin": no role of that name in the server' in text
