"""The fake's messages beyond posting (#852): reading one back, an edit's time, pins, and direct
messages, which reach only someone who shares a guild with the bot, as Discord's do."""

from __future__ import annotations

import httpx

from canccu_kit.testing.discord import FakeDiscord

API = "https://discord.test/api/v10"


def bot(token: str) -> dict[str, str]:
    return {"Authorization": f"Bot {token}"}


async def posted(http: httpx.AsyncClient, token: str, channel: str) -> str:
    url = f"{API}/channels/{channel}/messages"
    r = await http.post(url, headers=bot(token), json={"content": "x"})
    return str(r.json()["id"])


async def test_a_message_reads_back_and_a_deleted_one_is_unknown() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    channel = fake.add_channel(guild.id, "food")
    async with fake.http_client() as http:
        mid = await posted(http, app.token, channel)
        found = await http.get(f"{API}/channels/{channel}/messages/{mid}", headers=bot(app.token))
        assert found.status_code == 200 and found.json()["content"] == "x"
        assert found.json()["edited_timestamp"] is None
        fake.delete_message(channel, mid)  # someone in the guild deleted it
        gone = await http.get(f"{API}/channels/{channel}/messages/{mid}", headers=bot(app.token))
        assert gone.status_code == 404 and gone.json()["code"] == 10008


async def test_an_edit_carries_its_time() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    channel = fake.add_channel(guild.id, "food")
    async with fake.http_client() as http:
        mid = await posted(http, app.token, channel)
        path = f"{API}/channels/{channel}/messages/{mid}"
        await http.patch(path, headers=bot(app.token), json={"content": "y"})
    assert fake.messages[channel][0]["edited_timestamp"] is not None


async def test_pins_are_kept_per_channel_and_can_be_taken_away() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    channel = fake.add_channel(guild.id, "now-and-next")
    async with fake.http_client() as http:
        mid = await posted(http, app.token, channel)
        pin = await http.put(f"{API}/channels/{channel}/pins/{mid}", headers=bot(app.token))
        assert pin.status_code == 204
        pins = await http.get(f"{API}/channels/{channel}/pins", headers=bot(app.token))
        assert [m["id"] for m in pins.json()] == [mid]
        fake.unpin(channel, mid)  # someone unpinned it
        pins = await http.get(f"{API}/channels/{channel}/pins", headers=bot(app.token))
        assert pins.json() == []
        unknown = await http.put(f"{API}/channels/{channel}/pins/1234", headers=bot(app.token))
        assert unknown.status_code == 404


async def test_a_direct_message_reaches_a_member_of_a_shared_guild() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    member, stranger = fake.add_user("Player One"), fake.add_user("Stranger")
    fake.add_member(guild.id, member.id)
    async with fake.http_client() as http:
        opened = await http.post(
            f"{API}/users/@me/channels", headers=bot(app.token), json={"recipient_id": member.id}
        )
        assert opened.status_code == 200 and opened.json()["type"] == 1
        again = await http.post(
            f"{API}/users/@me/channels", headers=bot(app.token), json={"recipient_id": member.id}
        )
        assert again.json()["id"] == opened.json()["id"]  # one DM channel per person
        await posted(http, app.token, opened.json()["id"])
        other = await http.post(
            f"{API}/users/@me/channels", headers=bot(app.token), json={"recipient_id": stranger.id}
        )
        refused = await http.post(
            f"{API}/channels/{other.json()['id']}/messages",
            headers=bot(app.token),
            json={"content": "x"},
        )
    assert refused.status_code == 403 and refused.json()["code"] == 50007
    assert [m["content"] for m in fake.dms(member.id)] == ["x"]
    assert fake.dms(stranger.id) == []


async def test_a_direct_message_to_nobody_known_is_refused() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    async with fake.http_client() as http:
        r = await http.post(
            f"{API}/users/@me/channels", headers=bot(app.token), json={"recipient_id": "1234"}
        )
    assert r.status_code == 400
