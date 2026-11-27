"""The REST client: per-event queues served in turn, Discord's buckets, 429s, and the stops that
keep a failing token from getting the VM's address blocked (contracts/bot.md)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest
from canccu_kit.testing.discord import FakeDiscord

from canccu_bot.rest import RestClient, RestError, route_key

API = "https://discord.test/api/v10"


@pytest.fixture
async def fake() -> FakeDiscord:
    return FakeDiscord()


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def make(fake: FakeDiscord, **options: object) -> AsyncIterator[RestClient]:
    app = fake.add_application("Demo Bot")
    http = fake.http_client()
    client = RestClient(app.token, http=http, api_url=API, **options)  # type: ignore[arg-type]
    try:
        yield client
    finally:
        await client.close()
        await http.aclose()


@pytest.fixture
async def rest(fake: FakeDiscord) -> AsyncIterator[RestClient]:
    async for client in make(fake, workers=1):
        yield client


def channel_of(fake: FakeDiscord) -> str:
    app = next(iter(fake.applications.values()))
    return fake.add_channel(fake.add_guild("G", bots=[app.id]).id, "general")


async def test_a_request_answers_discord_s_json(fake: FakeDiscord, rest: RestClient) -> None:
    me = await rest.request("GET", "/users/@me")
    assert me["username"] == "Demo Bot"
    assert fake.requests[0].application_id is not None


async def test_events_are_served_in_turn(fake: FakeDiscord, rest: RestClient) -> None:
    channel = channel_of(fake)
    path = f"/channels/{channel}/messages"
    burst = [rest.request("POST", path, tenant="a", json={"content": f"a{i}"}) for i in range(5)]
    other = rest.request("POST", path, tenant="b", json={"content": "b"})
    await asyncio.gather(*burst, other)
    sent = [r.body["content"] for r in fake.requests]
    assert sent.index("b") <= 1, sent


async def test_a_burst_waiting_on_its_bucket_never_holds_every_worker() -> None:
    fake = FakeDiscord(bucket_limit=1, bucket_window_s=0.3)
    async for rest in make(fake, workers=3):
        app = next(iter(fake.applications.values()))
        guild = fake.add_guild("G", bots=[app.id])
        busy, quiet = fake.add_channel(guild.id, "busy"), fake.add_channel(guild.id, "quiet")
        burst = [
            asyncio.create_task(
                rest.request("POST", f"/channels/{busy}/messages", tenant="a", json={})
            )
            for _ in range(4)
        ]
        await asyncio.sleep(0.05)
        started = asyncio.get_running_loop().time()
        await rest.request("POST", f"/channels/{quiet}/messages", tenant="b", json={})
        assert asyncio.get_running_loop().time() - started < 0.1
        await asyncio.gather(*burst)


async def test_a_full_queue_refuses_only_that_event(fake: FakeDiscord) -> None:
    async for rest in make(fake, workers=1, queue_cap=2):
        results = await asyncio.gather(
            *[rest.request("GET", "/users/@me", tenant="a") for _ in range(3)],
            rest.request("GET", "/users/@me", tenant="b"),
            return_exceptions=True,
        )
        refused = [r for r in results if isinstance(r, RestError)]
        assert [(e.code, e.status) for e in refused] == [("rate_limited", 429)]
        assert not isinstance(results[3], Exception)


async def test_a_bucket_is_waited_for_instead_of_answered_429() -> None:
    fake = FakeDiscord(bucket_limit=2, bucket_window_s=0.2)
    async for rest in make(fake, workers=2):
        path = f"/channels/{channel_of(fake)}/messages"
        await asyncio.gather(*[rest.request("POST", path, json={"content": "x"}) for _ in range(5)])
    assert [r.status for r in fake.requests] == [200] * 5


async def test_a_429_is_waited_out_and_sent_again(fake: FakeDiscord, rest: RestClient) -> None:
    fake.fail_next(429, retry_after=0.05)
    me = await rest.request("GET", "/users/@me")
    assert me["username"] == "Demo Bot"
    assert [r.status for r in fake.requests] == [429, 200]


async def test_a_global_429_shows_as_rate_limited_while_it_lasts(fake: FakeDiscord) -> None:
    seen: list[bool] = []
    async for rest in make(fake, workers=1):
        rest.on_change = lambda r=rest: seen.append(r.rate_limited)  # type: ignore[misc]
        fake.fail_next(429, global_=True, retry_after=0.05)
        await rest.request("GET", "/users/@me")
    assert seen == [True, False]


async def test_a_429_that_keeps_coming_fails_the_request(
    fake: FakeDiscord, rest: RestClient
) -> None:
    fake.fail_next(429, retry_after=0.01, times=10)
    with pytest.raises(RestError) as refused:
        await rest.request("GET", "/users/@me")
    assert refused.value.code == "rate_limited"
    assert len(fake.requests) == 3


async def test_a_token_that_stops_working_stops_the_client(fake: FakeDiscord) -> None:
    changes: list[str | None] = []
    async for rest in make(fake, workers=1):
        rest.on_change = lambda r=rest: changes.append(r.stopped)  # type: ignore[misc]
        fake.applications.clear()  # the token was reset in the developer portal
        with pytest.raises(RestError) as first:
            await rest.request("GET", "/users/@me")
        with pytest.raises(RestError) as second:
            await rest.request("GET", "/users/@me")
    assert first.value.code == second.value.code == "token_invalid"
    assert len(fake.requests) == 1, "nothing is sent once the token failed"
    assert changes == ["token_invalid"]


async def test_too_many_invalid_answers_pause_the_client(fake: FakeDiscord) -> None:
    clock = Clock()
    async for rest in make(fake, workers=1, breaker_threshold=3, clock=clock):
        fake.fail_next(403, times=3)
        for _ in range(3):
            with pytest.raises(RestError):
                await rest.request("GET", "/users/@me")
        assert rest.stopped == "invalid_requests"
        with pytest.raises(RestError) as paused:
            await rest.request("GET", "/users/@me")
        assert paused.value.code == "invalid_requests"
        assert len(fake.requests) == 3
        clock.now += 601
        assert (await rest.request("GET", "/users/@me"))["bot"] is True
        assert rest.stopped is None


async def test_invalid_answers_age_out_of_the_window(fake: FakeDiscord) -> None:
    clock = Clock()
    async for rest in make(fake, workers=1, breaker_threshold=2, clock=clock):
        fake.fail_next(403, times=2)
        with pytest.raises(RestError):
            await rest.request("GET", "/users/@me")
        clock.now += 601
        with pytest.raises(RestError):
            await rest.request("GET", "/users/@me")
        assert rest.stopped is None


async def test_discord_s_own_errors_are_not_retried(fake: FakeDiscord, rest: RestClient) -> None:
    fake.fail_next(502)
    with pytest.raises(RestError) as failed:
        await rest.request("GET", "/users/@me")
    assert (failed.value.status, failed.value.code) == (502, "discord_unavailable")
    assert len(fake.requests) == 1


async def test_a_client_error_names_discord_s_code(fake: FakeDiscord, rest: RestClient) -> None:
    with pytest.raises(RestError) as failed:
        await rest.request("GET", "/guilds/100000000000099999")
    assert (failed.value.status, failed.value.discord_code) == (403, 50001)


def test_a_route_key_keeps_only_the_major_parameter() -> None:
    key = route_key("PATCH", "/channels/100000000000000001/messages/100000000000000002")
    assert key == "PATCH /channels/100000000000000001/messages/{id}"
    assert route_key("GET", "/guilds/100000000000000003/members/100000000000000004") == (
        "GET /guilds/100000000000000003/members/{id}"
    )
    assert route_key("POST", "/interactions/100000000000000005/tok/callback") == (
        "POST /interactions/{id}/{token}/callback"
    )
