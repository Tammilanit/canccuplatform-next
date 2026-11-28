"""The Discord page (#765; mockups 02, 13 and 15 of the step 6 brief): the guided setup while no
server is bound, the Overview's six cards and what happened once one is, the edge states in words,
the tabs (a tab bar on a desktop, one tab menu on a phone) and who sees which action. Caddy serves
the page under /bot/ and strips the prefix, so the paths here are the module's own."""

from __future__ import annotations

import json
from typing import Any

from canccu_kit.page_check import page_problems
from conftest import SHARED_ID, Env
from test_guild import bound

from canccu_bot.guild import unbind

OWN = "100000000000000077"


async def page(env: Env, path: str, headers: dict[str, str] | None = None) -> Any:
    async with env.client() as c:
        return await c.get(path, headers=headers or env.admin())


async def ready(env: Env, app_id: str = SHARED_ID, **status: Any) -> None:
    value = {"status": "ready", "error_code": None, "since": "2026-11-27T09:00:00Z", **status}
    await env.deps.board.publish(app_id, value, {"id": "100000000000000004", "name": "Demo Bot"})


async def test_a_page_needs_a_session_and_sends_the_browser_to_sign_in(env: Env) -> None:
    async with env.client() as c:
        r = await c.get("/channels?setup=1")
    assert r.status_code == 303
    assert r.headers["location"] == "/admin/sign-in?next=%2Fbot%2Fchannels%3Fsetup%3D1"


async def test_a_page_needs_the_read_right_and_says_so_in_words(env: Env) -> None:
    r = await page(env, "/", env.rights.sign_in("u_x", "agenda.items.write"))
    assert r.status_code == 403
    assert "<main" in r.text and "missing_right" not in r.text


async def test_the_api_keeps_its_json_errors(env: Env) -> None:
    async with env.client() as c:
        r = await c.get("/api/bot/connection")
    assert (r.status_code, r.json()["error"]["code"]) == (401, "not_signed_in")


async def test_an_unbound_event_shows_the_guided_setup(env: Env) -> None:
    r = await page(env, "/")
    assert r.status_code == 200
    assert r.headers["content-security-policy"].startswith("default-src")
    assert page_problems(r.text) == []
    text = r.text
    for step in ("Choose the bot", "Add it to your server", "Channels and roles", "Check"):
        assert step in text
    assert "The platform's bot" in text and "Your own Discord application" in text
    # Each write goes through the contract's API, the one place its rights and audit live.
    assert 'data-bot-api="/api/bot/guild/bind"' in text
    assert 'data-bot-api="/api/bot/connection"' in text
    assert 'href="/bot/static/discord.js"' not in text and 'src="/bot/static/discord.js"' in text
    assert "Roles and rights" not in text and "rights" not in text.split("<main", 1)[1].lower()


async def test_a_reader_sees_the_state_but_no_action(env: Env) -> None:
    r = await page(env, "/", env.reader())
    assert r.status_code == 200
    assert "Ask an event admin to connect it" in r.text
    assert "data-bot-api" not in r.text


async def test_a_refused_bind_says_why_in_words(env: Env) -> None:
    r = await page(env, "/?bind=manage_server_required")
    assert "You need Manage Server there" in r.text
    r = await page(env, "/?bind=%3Cscript%3E")
    assert "<script>" not in r.text and "Discord said no" in r.text


async def test_a_bind_that_worked_leads_on_to_channels(env: Env) -> None:
    await bound(env)
    r = await page(env, "/?bind=ok")
    assert "Added to Demo Community" in r.text
    assert 'href="/bot/channels?setup=1"' in r.text


async def test_the_shared_bot_missing_leaves_only_an_own_application(env: Env) -> None:
    env.deps.shared = None
    r = await page(env, "/")
    assert r.status_code == 200
    assert "This platform has no bot of its own" in r.text
    assert 'name="application_id"' in r.text


async def test_a_bound_event_shows_six_cards_and_four_tabs(env: Env) -> None:
    await bound(env)
    await ready(env)
    r = await page(env, "/")
    assert r.status_code == 200
    assert page_problems(r.text) == []
    for card in ("Bot", "Server", "Commands", "Activity", "Posts and DMs", "Check"):
        assert f'<p class="canccu-overline">{card}</p>' in r.text
    assert "The platform's bot · Ready" in r.text and "Demo Community" in r.text
    tabs = r.text.split('class="canccu-tabs"', 1)[1].split("</nav>", 1)[0]
    assert [t in tabs for t in ("Overview", "Channels", "Commands", "Check")] == [True] * 4
    assert "Roles" not in tabs  # rights from roles wait for #763
    assert 'class="bot-tabmenu' in r.text and "1 of 4" in r.text
    assert "What happened" in r.text


async def test_what_happened_names_no_discord_id_and_no_token(env: Env) -> None:
    guild = await bound(env)
    await ready(env)
    r = await page(env, "/")
    history = r.text.split("What happened", 1)[1]
    assert "Demo Community bound" in history
    assert guild.id not in r.text and SHARED_ID not in r.text
    assert env.discord.applications[SHARED_ID].token not in r.text


async def test_the_activity_card_shows_the_last_count(env: Env) -> None:
    await bound(env)
    env.contexts["ev-a"]["flags"] = {"bot.presence": True}
    await env.sql(
        "ev-a",
        "INSERT INTO bot_counts_minute (minute, members, online, idle, dnd, in_voice)"
        " VALUES ('2026-11-27T09:58:00Z', 40, 18, 2, 1, 3)",
    )
    r = await page(env, "/")
    assert "Counting · 18 online" in r.text and "Last count 09:58" in r.text
    env.contexts["ev-a"]["flags"] = {"bot.presence": False}
    assert "Who plays what is off" in (await page(env, "/")).text


async def test_a_refused_token_says_what_to_do(env: Env) -> None:
    box = env.deps.secrets
    await env.sql(
        "ev-a",
        "INSERT INTO bot_connections (mode, application_id, bot_token, client_secret,"
        " key_version, updated_at, updated_by, revision)"
        " VALUES ('own', $1, $2, $3, 1, '2026-11-27T09:00:00Z', 'u_org', 3)",
        OWN,
        box.seal("t", f"bot:token:ev-a:{OWN}"),
        box.seal("s", f"bot:secret:ev-a:{OWN}"),
    )
    await env.deps.board.publish(
        OWN, {"status": "failed", "error_code": "token_invalid", "since": "x"}, None
    )
    r = await page(env, "/")
    assert "The bot stopped: Discord refused its token" in r.text
    assert 'href="/bot/setup#own"' in r.text


async def test_a_server_that_removed_the_bot_says_so(env: Env) -> None:
    await bound(env)
    assert await unbind(env.deps, "ev-a", "bot_removed", None)
    r = await page(env, "/")
    assert "Demo Community removed the bot at 10:00" in r.text
    assert "Add it again" in r.text
    assert json.loads(await env.keys.get("bot:ended:ev-a") or "{}")["reason"] == "bot_removed"


async def test_an_archived_event_says_the_bot_reads_nothing_more(env: Env) -> None:
    await bound(env)
    env.contexts["ev-a"]["status"] = "archived"
    r = await page(env, "/")
    assert "is archived" in r.text and "The bot reads nothing more" in r.text
    # Unbinding still works on an archived event (contracts/bot.md, Archived events).
    assert 'data-bot-method="DELETE"' in r.text
    assert "/api/bot/guild/commands/sync" not in r.text


async def test_discord_down_and_a_missing_intent_are_named(env: Env) -> None:
    await bound(env)
    await ready(env, status="connecting", error_code="discord_unavailable")
    assert "Discord has not answered since" in (await page(env, "/")).text
    await ready(env, error_code="intents_missing")
    assert "Who plays what is off" in (await page(env, "/")).text


async def test_the_words_after_a_change_come_from_the_page_never_the_query(env: Env) -> None:
    r = await page(env, "/?error=token_invalid")
    assert "Discord refused that token" in r.text
    r = await page(env, "/?error=%3Cb%3Ehi")
    assert "<b>hi" not in r.text and "The platform refused the change" in r.text


async def test_the_static_files_are_served_and_nothing_else(env: Env) -> None:
    async with env.client() as c:
        css = await c.get("/static/bot.css")
        js = await c.get("/static/discord.js")
        other = await c.get("/static/../app.py")
    assert css.status_code == 200 and css.headers["content-type"].startswith("text/css")
    assert js.status_code == 200 and "text/javascript" in js.headers["content-type"]
    assert other.status_code == 404
