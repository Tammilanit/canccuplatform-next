"""Registering a guild's commands (contracts/bot.md, Slash commands per guild; O4 of the step 6
plan): exactly the commands whose flags are on, in one bulk overwrite, written only when the set
changed, by a hash per server, so a deploy across many servers stays within Discord's daily limit
on command writes."""

from __future__ import annotations

from dataclasses import replace

from conftest import SHARED_ID, Env
from test_guild import bound
from trial import FLAG, TRIAL

from canccu_bot import commands


def writes(env: Env, guild_id: str) -> int:
    path = f"/applications/{SHARED_ID}/guilds/{guild_id}/commands"
    return sum(1 for r in env.discord.requests if r.method == "PUT" and r.path == path)


async def state(env: Env) -> tuple[object, ...]:
    [row] = await env.fetch(
        "ev-a",
        "SELECT commands_status, commands_flags_version, commands_hash IS NOT NULL"
        " FROM bot_bindings",
    )
    return tuple(row)


async def test_only_the_commands_of_flags_that_are_on_are_written(env: Env) -> None:
    guild = await bound(env)
    d = replace(env.deps, commands=(TRIAL,))
    await commands.register(d, env.contexts["ev-a"])
    assert guild.commands[SHARED_ID] == []
    env.contexts["ev-a"]["flags"] = {FLAG: True}
    env.contexts["ev-a"]["flags_version"] = 2
    await commands.register(d, env.contexts["ev-a"])
    assert [c["name"] for c in guild.commands[SHARED_ID]] == ["trial"]
    assert guild.commands[SHARED_ID][0]["options"] == TRIAL.payload()["options"]
    assert await state(env) == ("registered", 2, True)


async def test_an_unchanged_set_is_not_written_again(env: Env) -> None:
    guild = await bound(env)
    d = replace(env.deps, commands=(TRIAL,))
    env.contexts["ev-a"]["flags"] = {FLAG: True}
    await commands.register(d, env.contexts["ev-a"])
    env.contexts["ev-a"]["flags"] = {FLAG: True, "pizza.orders": False}  # another flag moved
    env.contexts["ev-a"]["flags_version"] = 3
    await commands.register(d, env.contexts["ev-a"])
    assert writes(env, guild.id) == 1
    assert await state(env) == ("registered", 3, True)


async def test_a_failed_write_is_written_again_next_time(env: Env) -> None:
    guild = await bound(env)
    d = replace(env.deps, commands=(TRIAL,))
    env.contexts["ev-a"]["flags"] = {FLAG: True}
    env.discord.fail_next(429, path=f"/applications/{SHARED_ID}/guilds/{guild.id}/commands")
    await commands.register(d, env.contexts["ev-a"])
    [row] = await env.fetch("ev-a", "SELECT commands_status, commands_error_code FROM bot_bindings")
    assert tuple(row) == ("failed", "rate_limited")
    await commands.register(d, env.contexts["ev-a"])
    assert writes(env, guild.id) == 2
    assert [c["name"] for c in guild.commands[SHARED_ID]] == ["trial"]


async def test_an_archived_events_commands_go_whatever_the_flags_say(env: Env) -> None:
    guild = await bound(env)
    d = replace(env.deps, commands=(TRIAL,))
    env.contexts["ev-a"]["flags"] = {FLAG: True}
    await commands.register(d, env.contexts["ev-a"])
    env.contexts["ev-a"]["status"] = "archived"
    await commands.register(d, env.contexts["ev-a"])
    assert guild.commands[SHARED_ID] == []
    assert (await state(env))[0] == "removed"


async def test_an_admins_sync_writes_even_an_unchanged_set(env: Env) -> None:
    """For a guild whose commands someone removed by hand: the hash cannot see that."""
    guild = await bound(env)
    d = replace(env.deps, commands=(TRIAL,))
    env.contexts["ev-a"]["flags"] = {FLAG: True}
    await commands.register(d, env.contexts["ev-a"])
    guild.commands[SHARED_ID] = []
    await commands.register(d, env.contexts["ev-a"], force=True)
    assert writes(env, guild.id) == 2
    assert [c["name"] for c in guild.commands[SHARED_ID]] == ["trial"]
