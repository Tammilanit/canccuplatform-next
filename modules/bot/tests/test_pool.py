"""The pool: one client per application everywhere, through a lease in Valkey; own clients opened
and closed without a restart; each client's status where every container reads it."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest
from fakes import MemoryKeys

from canccu_bot.pool import Pool
from canccu_bot.status import StatusBoard

SHARED = "100000000000000002"
OWN = "100000000000000003"


@dataclass
class FakeClient:
    application_id: str
    token: str
    started: bool = False
    stopped: bool = False
    status: dict[str, Any] = field(
        default_factory=lambda: {
            "status": "ready",
            "error_code": None,
            "since": "2026-11-27T10:00:00Z",
        }
    )
    bot_user: dict[str, str] | None = None

    async def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True


@dataclass
class World:
    keys: MemoryKeys = field(default_factory=MemoryKeys)
    wanted: dict[str, str] = field(default_factory=lambda: {SHARED: "shared-token"})
    opened: list[FakeClient] = field(default_factory=list)
    broken: set[str] = field(default_factory=set)

    def pool(self, holder: str) -> Pool:
        async def wanted() -> dict[str, str]:
            return dict(self.wanted)

        async def open_client(application_id: str, token: str) -> FakeClient:
            if application_id in self.broken:
                raise RuntimeError("cannot open")
            client = FakeClient(application_id, token)
            self.opened.append(client)
            return client

        return Pool(
            holder=holder,
            keys=self.keys,
            board=StatusBoard(self.keys),
            wanted=wanted,
            open_client=open_client,
        )


@pytest.fixture
def world() -> World:
    return World()


async def test_the_first_container_takes_the_lease_and_opens_the_client(world: World) -> None:
    pool = world.pool("c1")
    await pool.tick()
    assert [(c.application_id, c.started) for c in world.opened] == [(SHARED, True)]
    assert await world.keys.get(f"bot:lease:{SHARED}") == "c1"


async def test_a_second_container_never_opens_the_same_token(world: World) -> None:
    await world.pool("c1").tick()
    await world.pool("c2").tick()
    assert len(world.opened) == 1


async def test_a_closed_pool_hands_its_clients_over(world: World) -> None:
    first, second = world.pool("c1"), world.pool("c2")
    await first.tick()
    await first.close()
    assert world.opened[0].stopped
    await second.tick()
    assert len(world.opened) == 2
    assert await world.keys.get(f"bot:lease:{SHARED}") == "c2"


async def test_a_dead_container_s_lease_runs_out_after_30_seconds(world: World) -> None:
    await world.pool("c1").tick()
    second = world.pool("c2")
    world.keys.now_ms += 29_000
    await second.tick()
    assert len(world.opened) == 1
    world.keys.now_ms += 1_001
    await second.tick()
    assert len(world.opened) == 2


async def test_a_renewal_keeps_the_lease(world: World) -> None:
    first, second = world.pool("c1"), world.pool("c2")
    await first.tick()
    for _ in range(5):
        world.keys.now_ms += 10_000
        await first.tick()
        await second.tick()
    assert len(world.opened) == 1


async def test_a_lost_lease_closes_the_client_at_once(world: World) -> None:
    pool = world.pool("c1")
    await pool.tick()
    world.keys.values[f"bot:lease:{SHARED}"] = ("c2", world.keys.now_ms + 30_000)
    await pool.tick()
    assert world.opened[0].stopped
    assert pool.held() == []


async def test_an_own_application_opens_and_closes_without_a_restart(world: World) -> None:
    pool = world.pool("c1")
    await pool.tick()
    world.wanted[OWN] = "own-token"
    await pool.tick()
    own = world.opened[-1]
    assert (own.application_id, own.started) == (OWN, True)
    del world.wanted[OWN]
    await pool.tick()
    assert own.stopped
    assert await world.keys.get(f"bot:lease:{OWN}") is None
    assert sorted(pool.held()) == [SHARED]


async def test_a_rotated_token_opens_the_client_again(world: World) -> None:
    pool = world.pool("c1")
    world.wanted[OWN] = "own-token"
    await pool.tick()
    world.wanted[OWN] = "rotated-token"
    await pool.tick()
    old, new = [c for c in world.opened if c.application_id == OWN]
    assert old.stopped and new.token == "rotated-token" and new.started


async def test_one_client_failing_to_open_leaves_the_others(world: World) -> None:
    world.wanted[OWN] = "own-token"
    world.broken.add(OWN)
    pool = world.pool("c1")
    await pool.tick()
    assert pool.held() == [SHARED]
    assert await world.keys.get(f"bot:lease:{OWN}") is None, "free for another try"


async def test_each_held_client_s_status_is_on_the_board(world: World) -> None:
    pool = world.pool("c1")
    await pool.tick()
    world.opened[0].bot_user = {"id": "100000000000000004", "name": "Demo Bot"}
    await pool.tick()
    seen = await StatusBoard(world.keys).read(SHARED)
    assert seen == {
        "status": "ready",
        "error_code": None,
        "since": "2026-11-27T10:00:00Z",
        "bot_user": {"id": "100000000000000004", "name": "Demo Bot"},
    }


async def test_a_status_nobody_refreshes_runs_out(world: World) -> None:
    await world.pool("c1").tick()
    world.keys.now_ms += 60_001
    assert await StatusBoard(world.keys).read(SHARED) is None


async def test_leases_are_renewed_even_when_postgres_is_away(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    pool = world.pool("c1")
    await pool.tick()
    renewed: list[str] = []
    real = world.keys.renew

    async def renew(key: str, holder: str, ttl_ms: int) -> bool:
        renewed.append(key)
        return await real(key, holder, ttl_ms)

    async def broken() -> dict[str, str]:
        raise ConnectionError("postgres is away")

    monkeypatch.setattr(world.keys, "renew", renew)
    monkeypatch.setattr(pool, "_wanted", broken)
    with pytest.raises(ConnectionError):
        await pool.tick()
    assert renewed == [f"bot:lease:{SHARED}"]


async def test_a_client_whose_lease_cannot_be_confirmed_for_a_ttl_stops(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    pool = world.pool("c1")
    await pool.tick()

    async def valkey_away(key: str, holder: str, ttl_ms: int) -> bool:
        raise ConnectionError("valkey is away")

    monkeypatch.setattr(world.keys, "renew", valkey_away)
    await pool.tick()
    assert pool.held() == [SHARED]  # inside the TTL: the lease is still ours
    pool._confirmed[SHARED] -= 31
    await pool.tick()
    assert pool.held() == [] and world.opened[0].stopped
