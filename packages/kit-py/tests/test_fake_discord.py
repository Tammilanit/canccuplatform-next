"""The fake Discord: its REST answers, rate limits and transcript, and its gateway sessions."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from canccu_kit.testing.discord import FakeDiscord, GatewayClosed, Intents

API = "https://discord.test/api/v10"


def bot(token: str) -> dict[str, str]:
    return {"Authorization": f"Bot {token}"}


async def test_rest_answers_the_bot_user_and_records_the_call() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    async with fake.http_client() as http:
        r = await http.get(f"{API}/users/@me", headers=bot(app.token))
    assert r.status_code == 200
    assert r.json() == {"id": app.bot_user_id, "username": "Demo Bot", "bot": True}
    assert [(q.application_id, q.method, q.path, q.status) for q in fake.requests] == [
        (app.id, "GET", "/users/@me", 200)
    ]


async def test_a_wrong_token_is_401_and_recorded_without_an_application() -> None:
    fake = FakeDiscord()
    async with fake.http_client() as http:
        r = await http.get(f"{API}/users/@me", headers=bot("not-a-token"))
    assert r.status_code == 401
    assert r.json()["code"] == 0
    assert fake.requests[0].application_id is None


async def test_gateway_bot_names_the_fake_gateway_and_one_shard() -> None:
    fake = FakeDiscord(gateway_url="ws://fake-discord:8080/gateway")
    app = fake.add_application("Demo Bot")
    async with fake.http_client() as http:
        body = (await http.get(f"{API}/gateway/bot", headers=bot(app.token))).json()
    assert body["url"] == "ws://fake-discord:8080/gateway"
    assert body["shards"] == 1
    assert body["session_start_limit"]["max_concurrency"] == 1


async def test_a_message_is_kept_on_its_channel() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    channel = fake.add_channel(guild.id, "general")
    async with fake.http_client() as http:
        r = await http.post(
            f"{API}/channels/{channel}/messages", headers=bot(app.token), json={"content": "hi"}
        )
    assert r.status_code == 200
    assert fake.messages[channel][0]["content"] == "hi"
    assert fake.requests[0].body == {"content": "hi"}


async def test_a_bot_edits_only_its_own_message() -> None:
    fake = FakeDiscord()
    app, other = fake.add_application("Demo Bot"), fake.add_application("Other Bot")
    channel = fake.add_channel(fake.add_guild("G", bots=[app.id, other.id]).id, "general")
    url = f"{API}/channels/{channel}/messages"
    async with fake.http_client() as http:
        posted = (await http.post(url, headers=bot(app.token), json={"content": "a"})).json()
        mine = await http.patch(
            f"{url}/{posted['id']}", headers=bot(app.token), json={"content": "b"}
        )
        theirs = await http.patch(
            f"{url}/{posted['id']}", headers=bot(other.token), json={"content": "c"}
        )
        unknown = await http.patch(f"{url}/1", headers=bot(app.token), json={"content": "d"})
    assert (mine.status_code, theirs.status_code, unknown.status_code) == (200, 404, 404)
    assert fake.messages[channel][0]["content"] == "b"


async def test_a_bucket_answers_its_headers_and_429_when_spent() -> None:
    fake = FakeDiscord(bucket_limit=2, bucket_window_s=60)
    app = fake.add_application("Demo Bot")
    channel = fake.add_channel(fake.add_guild("G", bots=[app.id]).id, "general")
    url = f"{API}/channels/{channel}/messages"
    async with fake.http_client() as http:
        answers = [
            await http.post(url, headers=bot(app.token), json={"content": "x"}) for _ in "abc"
        ]
    assert [a.status_code for a in answers] == [200, 200, 429]
    first = answers[0].headers
    assert first["x-ratelimit-limit"] == "2" and first["x-ratelimit-remaining"] == "1"
    assert first["x-ratelimit-bucket"] == answers[1].headers["x-ratelimit-bucket"]
    assert answers[2].json()["global"] is False
    assert answers[2].headers["x-ratelimit-scope"] == "user"
    assert float(answers[2].json()["retry_after"]) > 0


async def test_a_bucket_is_per_channel_and_per_token() -> None:
    fake = FakeDiscord(bucket_limit=1, bucket_window_s=60)
    one, two = fake.add_application("One"), fake.add_application("Two")
    guild = fake.add_guild("G", bots=[one.id, two.id])
    a, b = fake.add_channel(guild.id, "a"), fake.add_channel(guild.id, "b")
    async with fake.http_client() as http:
        codes = [
            (await http.post(f"{API}/channels/{c}/messages", headers=bot(t), json={})).status_code
            for c, t in ((a, one.token), (b, one.token), (a, two.token))
        ]
    assert codes == [200, 200, 200]


async def test_a_scripted_failure_answers_once() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    fake.fail_next(429, global_=True, retry_after=0.5)
    async with fake.http_client() as http:
        first = await http.get(f"{API}/users/@me", headers=bot(app.token))
        second = await http.get(f"{API}/users/@me", headers=bot(app.token))
    assert first.status_code == 429 and first.json()["global"] is True
    assert first.headers["x-ratelimit-global"] == "true"
    assert second.status_code == 200


async def test_leaving_a_guild_takes_the_bot_out() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("G", bots=[app.id])
    async with fake.http_client() as http:
        r = await http.delete(f"{API}/users/@me/guilds/{guild.id}", headers=bot(app.token))
    assert r.status_code == 204
    assert app.id not in fake.guilds[guild.id].bots


async def test_an_unknown_route_is_404_and_recorded() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    async with fake.http_client() as http:
        r = await http.get(f"{API}/nothing/here", headers=bot(app.token))
    assert r.status_code == 404
    assert fake.requests[-1].status == 404


# The gateway -------------------------------------------------------------------------------


async def identify(
    fake: FakeDiscord, token: str, intents: int = Intents.GUILDS
) -> tuple[Any, list[dict[str, Any]]]:
    ws = await fake.gateway.connect(fake.gateway_url)
    hello = await ws.recv()
    assert hello["op"] == 10
    await ws.send({"op": 2, "d": {"token": token, "intents": intents, "properties": {}}})
    ready = await ws.recv()
    return ws, [hello, ready]


async def test_identify_answers_ready_then_each_guild() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("Demo Community", bots=[app.id])
    fake.add_guild("Not ours")
    ws, (hello, ready) = await identify(fake, app.token)
    assert hello["d"]["heartbeat_interval"] == fake.gateway.heartbeat_interval_ms
    assert ready["op"] == 0 and ready["t"] == "READY" and ready["s"] == 1
    assert ready["d"]["user"]["id"] == app.bot_user_id
    assert ready["d"]["guilds"] == [{"id": guild.id, "unavailable": True}]
    created = await ws.recv()
    assert (created["t"], created["d"]["id"], created["s"]) == ("GUILD_CREATE", guild.id, 2)
    assert fake.gateway.sessions_of(app.id) == 1


async def test_a_heartbeat_is_acknowledged() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    ws, _ = await identify(fake, app.token)
    await ws.send({"op": 1, "d": 1})
    assert (await ws.recv())["op"] == 11


async def test_a_bad_token_closes_4004() -> None:
    fake = FakeDiscord()
    ws = await fake.gateway.connect(fake.gateway_url)
    await ws.recv()
    await ws.send({"op": 2, "d": {"token": "nope", "intents": 1, "properties": {}}})
    with pytest.raises(GatewayClosed) as closed:
        await ws.recv()
    assert closed.value.code == 4004


async def test_privileged_intents_the_application_lacks_close_4014() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Own Bot", privileged=Intents.NONE)
    ws = await fake.gateway.connect(fake.gateway_url)
    await ws.recv()
    intents = Intents.GUILDS | Intents.GUILD_PRESENCES
    await ws.send({"op": 2, "d": {"token": app.token, "intents": intents, "properties": {}}})
    with pytest.raises(GatewayClosed) as closed:
        await ws.recv()
    assert closed.value.code == 4014


async def test_a_dispatch_reaches_only_sessions_with_its_intent() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("G", bots=[app.id])
    plain, _ = await identify(fake, app.token, Intents.GUILDS)
    await plain.recv()  # GUILD_CREATE
    with_presence, _ = await identify(fake, app.token, Intents.GUILDS | Intents.GUILD_PRESENCES)
    await with_presence.recv()
    sent = await fake.gateway.dispatch(app.id, "PRESENCE_UPDATE", {"guild_id": guild.id})
    assert sent == 1
    assert (await with_presence.recv())["t"] == "PRESENCE_UPDATE"
    await fake.gateway.dispatch(app.id, "GUILD_UPDATE", {"id": guild.id})
    assert (await plain.recv())["t"] == "GUILD_UPDATE"


async def test_a_resume_replays_what_was_missed() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    guild = fake.add_guild("G", bots=[app.id])
    ws, (_, ready) = await identify(fake, app.token)
    created = await ws.recv()
    session_id = ready["d"]["session_id"]
    assert ready["d"]["resume_gateway_url"] == fake.gateway_url
    await fake.gateway.disconnect(app.id, code=4000)
    with pytest.raises(GatewayClosed) as closed:
        await ws.recv()
    assert closed.value.code == 4000
    await fake.gateway.dispatch(app.id, "GUILD_UPDATE", {"id": guild.id})
    again = await fake.gateway.connect(fake.gateway_url)
    await again.recv()
    await again.send(
        {"op": 6, "d": {"token": app.token, "session_id": session_id, "seq": created["s"]}}
    )
    missed, resumed = await again.recv(), await again.recv()
    assert (missed["t"], missed["s"]) == ("GUILD_UPDATE", created["s"] + 1)
    assert resumed["t"] == "RESUMED"


async def test_an_unknown_session_cannot_resume() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    ws = await fake.gateway.connect(fake.gateway_url)
    await ws.recv()
    await ws.send({"op": 6, "d": {"token": app.token, "session_id": "gone", "seq": 3}})
    assert await ws.recv() == {"op": 9, "d": False, "s": None, "t": None}


async def test_reconnect_and_invalid_session_are_sent_on_request() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    ws, _ = await identify(fake, app.token)
    await fake.gateway.request_reconnect(app.id)
    assert (await ws.recv())["op"] == 7
    await fake.gateway.invalidate(app.id, resumable=True)
    assert await ws.recv() == {"op": 9, "d": True, "s": None, "t": None}


async def test_a_closed_client_connection_ends_its_session_for_dispatch() -> None:
    fake = FakeDiscord()
    app = fake.add_application("Demo Bot")
    ws, _ = await identify(fake, app.token)
    await ws.close(1000)
    await asyncio.sleep(0)
    assert fake.gateway.sessions_of(app.id) == 0


async def test_heartbeats_go_unanswered_when_told() -> None:
    fake = FakeDiscord()
    fake.gateway.ack_heartbeats = False
    app = fake.add_application("Demo Bot")
    ws, _ = await identify(fake, app.token)
    await ws.send({"op": 1, "d": 1})
    await asyncio.sleep(0.01)  # the gateway has read the heartbeat
    await fake.gateway.dispatch(app.id, "GUILD_UPDATE", {"id": "1"})
    assert (await ws.recv())["t"] == "GUILD_UPDATE"
