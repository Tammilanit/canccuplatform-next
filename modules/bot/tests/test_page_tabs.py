"""The Discord page's Channels, Check and Commands tabs (#765; mockups 03, 04 and 06 of the step 6
brief), read live from the fake Discord: each purpose bound, missing or not on with its pick list,
each feature's gaps with their whole fix, and the commands per feature with its switch."""

from __future__ import annotations

from typing import Any

from canccu_kit.page_check import page_problems
from conftest import SHARED_ID, Env
from test_purposes import EVERYDAY, MANAGER, put, server

from canccu_bot.commands import COMMANDS
from canccu_bot.perms import PIN_MESSAGES


async def page(env: Env, path: str, headers: dict[str, str] | None = None) -> Any:
    async with env.client() as c:
        return await c.get(path, headers=headers or env.admin())


async def test_an_unbound_event_has_no_tabs_to_open(env: Env) -> None:
    for path in ("/channels", "/check", "/commands"):
        r = await page(env, path)
        assert (r.status_code, r.headers["location"]) == (303, "/bot/")


async def test_channels_shows_bound_missing_and_not_on(env: Env) -> None:
    guild = await server(env)
    env.contexts["ev-a"]["flags"] = {"pizza.enabled": True}
    news = env.discord.add_channel(guild.id, "announcements")
    assert (await put(env, "announcements", news)).status_code == 200
    r = await page(env, "/channels")
    assert r.status_code == 200
    assert page_problems(r.text) == []
    cards = {c.split("</h3>", 1)[0]: c for c in r.text.split('<h3 class="canccu-card__title">')[1:]}
    assert ">Bound<" in cards["Announcements"] and "# announcements" in cards["Announcements"]
    assert ">Missing<" in cards["Food"]
    assert (
        ">Not on<" in cards["Tournaments"] and "Turn on Tournaments first" in cards["Tournaments"]
    )
    assert 'data-bot-api="/api/bot/guild/purposes/food"' in cards["Food"]
    assert 'data-bot-api="/api/bot/guild/purposes/create-missing"' in r.text
    assert "Crew" in cards and "Attendees" in cards
    assert "Event admins" not in r.text  # role-to-rights copy waits for #763


async def test_a_reader_sees_channels_without_the_pick_lists(env: Env) -> None:
    await server(env)
    r = await page(env, "/channels", env.reader())
    assert r.status_code == 200 and "data-bot-api" not in r.text


async def test_setup_shows_the_step_bar_instead_of_the_tabs(env: Env) -> None:
    await server(env)
    r = await page(env, "/channels?setup=1")
    assert "3 Channels and roles" in r.text and 'class="canccu-tabs"' not in r.text
    assert 'href="/bot/check?setup=1"' in r.text


async def test_check_names_each_gap_with_its_whole_fix(env: Env) -> None:
    guild = await server(env, permissions=MANAGER & ~PIN_MESSAGES)
    env.contexts["ev-a"]["flags"] = {"pizza.enabled": True}
    food = env.discord.add_channel(guild.id, "food")
    assert (await put(env, "food", food)).status_code == 200
    r = await page(env, "/check")
    assert r.status_code == 200
    assert page_problems(r.text) == []
    assert "things to fix" in r.text and "checked 10:00" in r.text
    row = r.text.split('data-feature="food"', 1)[1].split("</li>", 1)[0]
    assert "Pin messages" in row and "Server settings → Roles" in row
    assert 'data-feature="tournaments"' in r.text and "Not on at this event" in r.text
    assert 'data-bot-api="/api/bot/guild/check"' in r.text  # Check again


async def test_a_gap_the_bot_fixes_itself_has_fix_it(env: Env) -> None:
    guild = await server(env)
    env.contexts["ev-a"]["flags"] = {"pizza.enabled": True}
    no_pin = [
        {"id": guild.bot_roles[SHARED_ID][0], "type": 0, "allow": "0", "deny": str(PIN_MESSAGES)}
    ]
    food = env.discord.add_channel(guild.id, "food", overwrites=no_pin)
    assert (await put(env, "food", food)).status_code == 200
    r = await page(env, "/check")
    row = r.text.split('data-feature="food"', 1)[1].split("</li>", 1)[0]
    assert 'data-bot-api="/api/bot/guild/check/fix"' in row and 'value="food"' in row


async def test_commands_lists_what_is_always_on_and_why(env: Env) -> None:
    env.deps.commands = COMMANDS
    await server(env, permissions=EVERYDAY)
    env.contexts["ev-a"]["flags"] = {"pizza.enabled": True, "screen.photos": False}
    headers = env.rights.sign_in(
        "u_org", "admin.rights.write", "bot.connection.read", "tenants.flags.write"
    )
    r = await page(env, "/commands", headers)
    assert r.status_code == 200
    assert page_problems(r.text) == []
    always = r.text.split("Always on", 2)[2].split("</li>", 1)[0]
    for name in ("/now", "/hub", "/privacy", "/announce", "/ticker"):
        assert name in always
    assert "no feature switch" in always
    food = r.text.split('data-flag="pizza.enabled"', 1)[1].split("</li>", 1)[0]
    assert "/food" in food and " checked" in food
    photos = r.text.split('data-flag="screen.photos"', 1)[1].split("</li>", 1)[0]
    assert "Send to the screen" in photos and " checked" not in photos
    assert 'data-bot-api="/api/tenants/current/flags"' in r.text
    assert 'data-bot-api="/api/bot/guild/commands/sync"' in r.text


async def test_without_the_flags_right_the_switch_is_a_word(env: Env) -> None:
    env.deps.commands = COMMANDS
    await server(env, permissions=EVERYDAY)
    env.contexts["ev-a"]["flags"] = {"pizza.enabled": True}
    r = await page(env, "/commands")
    assert "/api/tenants/current/flags" not in r.text
    food = r.text.split('data-flag="pizza.enabled"', 1)[1].split("</li>", 1)[0]
    assert ">On<" in food


async def test_discord_down_shows_in_the_tab_not_as_an_error_page(env: Env) -> None:
    guild = await server(env)
    env.discord.fail_next(502, path=f"/guilds/{guild.id}/channels")
    r = await page(env, "/channels")
    assert r.status_code == 200 and "Discord did not answer" in r.text
