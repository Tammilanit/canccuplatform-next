"""The fake Discord's guild setup routes (#764): channels and roles read and created, the bot's own
member with its roles, a channel's permission overwrite, and the application's intent flags."""

from __future__ import annotations

from canccu_kit.testing.discord import FakeDiscord, Intents

API = "https://discord.test/api/v10"


def bot(token: str) -> dict[str, str]:
    return {"Authorization": f"Bot {token}"}


async def test_channels_and_roles_are_listed_as_the_guild_holds_them() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    crew = fake.add_role(guild.id, "Crew", permissions=1 << 10)
    everyone_deny = [{"id": guild.id, "type": 0, "allow": "0", "deny": str(1 << 11)}]
    food = fake.add_channel(guild.id, "food", overwrites=everyone_deny)
    async with fake.http_client() as http:
        channels = await http.get(f"{API}/guilds/{guild.id}/channels", headers=bot(app.token))
        roles = await http.get(f"{API}/guilds/{guild.id}/roles", headers=bot(app.token))
    [channel] = channels.json()
    assert (channel["id"], channel["name"], channel["type"]) == (food, "food", 0)
    assert channel["permission_overwrites"] == everyone_deny
    assert {r["id"]: (r["name"], r["position"]) for r in roles.json()} == {
        guild.id: ("@everyone", 0),
        crew: ("Crew", 1),
    }


async def test_a_bot_outside_the_guild_reads_nothing() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community")
    async with fake.http_client() as http:
        r = await http.get(f"{API}/guilds/{guild.id}/channels", headers=bot(app.token))
    assert r.status_code == 403


async def test_a_created_role_sits_lowest_and_a_created_channel_keeps_its_overwrites() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    top = fake.add_role(guild.id, "Demo Bot")
    overwrites = [{"id": guild.id, "type": 0, "allow": "0", "deny": str(1 << 10)}]
    async with fake.http_client() as http:
        role = await http.post(
            f"{API}/guilds/{guild.id}/roles", json={"name": "Crew"}, headers=bot(app.token)
        )
        channel = await http.post(
            f"{API}/guilds/{guild.id}/channels",
            json={"name": "crew", "type": 0, "permission_overwrites": overwrites},
            headers=bot(app.token),
        )
    assert role.status_code == 200
    assert guild.roles[role.json()["id"]]["position"] == 1
    assert guild.roles[top]["position"] == 2
    assert channel.status_code == 201
    assert guild.channels[channel.json()["id"]]["permission_overwrites"] == overwrites


async def test_the_bot_member_carries_its_roles_and_an_overwrite_can_be_set() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    role = fake.add_role(guild.id, "Demo Bot", permissions=1 << 28)
    fake.give_bot_role(guild.id, app.id, role)
    food = fake.add_channel(guild.id, "food")
    allow = {"type": 1, "allow": str(1 << 51), "deny": "0"}
    async with fake.http_client() as http:
        member = await http.get(
            f"{API}/guilds/{guild.id}/members/{app.bot_user_id}", headers=bot(app.token)
        )
        put = await http.put(
            f"{API}/channels/{food}/permissions/{app.bot_user_id}",
            json=allow,
            headers=bot(app.token),
        )
    assert member.json()["roles"] == [role]
    assert member.json()["user"]["id"] == app.bot_user_id
    assert put.status_code == 204
    assert guild.channels[food]["permission_overwrites"] == [{"id": app.bot_user_id, **allow}]


async def test_the_application_shows_its_privileged_intents_as_flags() -> None:
    fake = FakeDiscord()
    full = fake.add_application("Full")
    bare = fake.add_application("Bare", privileged=Intents.NONE)
    async with fake.http_client() as http:
        on = (await http.get(f"{API}/applications/@me", headers=bot(full.token))).json()
        off = (await http.get(f"{API}/applications/@me", headers=bot(bare.token))).json()
    assert on["flags"] & (1 << 12) and on["flags"] & (1 << 14)
    assert off["flags"] == 0


async def test_a_scripted_failure_can_name_its_method() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    fake.fail_next(403, path=f"/guilds/{guild.id}/roles", method="POST")
    async with fake.http_client() as http:
        read = await http.get(f"{API}/guilds/{guild.id}/roles", headers=bot(app.token))
        made = await http.post(
            f"{API}/guilds/{guild.id}/roles", json={"name": "Crew"}, headers=bot(app.token)
        )
    assert (read.status_code, made.status_code) == (200, 403)
