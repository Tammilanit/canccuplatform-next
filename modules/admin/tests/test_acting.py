"""The acting token (contracts/admin.md, The acting token; D2 of the step 6 plan): admin mints a
minute-long token for one person, one event and one module, for the bot alone, and answers that
person's session to that module only, cut to that module's rights."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from conftest import BOT_ADMIN_KEY, START, World, owner_and_member
from test_internal_settings import signed

from canccu_admin.acting import BOT_ADMIN_HEADER

MINT = "/internal/admin/acting-tokens"
SESSION = "/internal/admin/acting-session"
OLLI, AINO = "1001", "2002"  # the owner and a member without a role (owner_and_member)


def bot(key: str = BOT_ADMIN_KEY) -> dict[str, str]:
    return {**signed("bot"), BOT_ADMIN_HEADER: key}


async def mint(
    world: World, discord_id: str = OLLI, module: str = "pizza", tenant: str = "demo"
) -> str:
    r = await world.internal.post(
        MINT,
        params={"tenant_id": tenant},
        json={"discord_user_id": discord_id, "module": module},
        headers=bot(),
    )
    assert r.status_code == 201, r.text
    return str(r.json()["token"])


async def redeem(
    world: World, token: str, caller: str = "pizza", tenant: str = "demo"
) -> tuple[int, Any]:
    r = await world.internal.get(
        SESSION, params={"tenant_id": tenant}, headers={**signed(caller), "x-canccu-acting": token}
    )
    return r.status_code, r.json()


@pytest.fixture
async def people(world: World, caplog: pytest.LogCaptureFixture) -> World:
    await owner_and_member(world, caplog)
    return world


async def test_the_person_acts_in_one_module_with_that_modules_rights(people: World) -> None:
    r = await people.internal.post(
        MINT,
        params={"tenant_id": "demo"},
        json={"discord_user_id": OLLI, "module": "pizza"},
        headers=bot(),
    )
    assert r.status_code == 201
    expires = (START + timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
    assert r.json()["expires_at"] == expires
    status, body = await redeem(people, r.json()["token"])
    assert status == 200
    assert body == {
        "user": {"id": body["user"]["id"], "name": "Olli"},
        "rights": [
            "pizza.menu.write",
            "pizza.order.manage",
            "pizza.order.open",
            "pizza.record.read",
        ],
        "expires_at": expires,
        "superadmin": False,
    }


async def test_a_token_never_carries_rights_write_or_a_role_only_right(people: World) -> None:
    _, admin = await redeem(people, await mint(people, module="admin"), caller="admin")
    _, tenants = await redeem(people, await mint(people, module="tenants"), caller="tenants")
    assert "admin.settings.write" in admin["rights"]
    assert "admin.rights.write" not in admin["rights"]
    role_only = {"tenants.admins.write", "tenants.lifecycle.write", "tenants.access.write"}
    assert "tenants.event.write" in tenants["rights"]
    assert role_only.isdisjoint(tenants["rights"])


async def test_a_member_without_a_role_acts_with_no_right(people: World) -> None:
    status, body = await redeem(people, await mint(people, discord_id=AINO))
    assert (status, body["rights"]) == (200, [])


@pytest.mark.parametrize(
    ("headers", "status", "code"),
    [
        ({**signed("screen"), BOT_ADMIN_HEADER: BOT_ADMIN_KEY}, 403, "service_forbidden"),
        (signed("bot"), 403, "service_forbidden"),
        ({**signed("bot"), BOT_ADMIN_HEADER: "x" * 40}, 403, "service_forbidden"),
        ({BOT_ADMIN_HEADER: BOT_ADMIN_KEY}, 401, "service_unauthenticated"),
    ],
)
async def test_only_the_bot_with_the_bot_admin_key_mints(
    people: World, headers: dict[str, str], status: int, code: str
) -> None:
    body = {"discord_user_id": OLLI, "module": "pizza"}
    r = await people.internal.post(MINT, params={"tenant_id": "demo"}, json=body, headers=headers)
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)


async def test_without_a_bot_admin_key_nothing_is_minted(people: World) -> None:
    people.acting.bot_admin_key = None
    body = {"discord_user_id": OLLI, "module": "pizza"}
    r = await people.internal.post(MINT, params={"tenant_id": "demo"}, json=body, headers=bot())
    assert (r.status_code, r.json()["error"]["code"]) == (403, "service_forbidden")


async def test_no_account_and_no_member_say_so(people: World) -> None:
    unknown = {"discord_user_id": "3003", "module": "pizza"}
    r = await people.internal.post(MINT, params={"tenant_id": "demo"}, json=unknown, headers=bot())
    assert (r.status_code, r.json()["error"]["code"]) == (404, "no_account")
    aino = next(u for u, _ in await people.store.list_users() if u.name == "Aino")
    await people.store.remove_user(aino.id, START)
    removed = {"discord_user_id": AINO, "module": "pizza"}
    r = await people.internal.post(MINT, params={"tenant_id": "demo"}, json=removed, headers=bot())
    assert (r.status_code, r.json()["error"]["code"]) == (403, "not_a_member")


@pytest.mark.parametrize(
    ("tenant", "body", "status"),
    [
        ("demo", {"discord_user_id": OLLI, "module": "nope"}, 400),
        ("demo", {"discord_user_id": "12ab", "module": "pizza"}, 400),
        ("demo", {"discord_user_id": OLLI}, 400),
        ("", {"discord_user_id": OLLI, "module": "pizza"}, 400),
        ("unknown", {"discord_user_id": OLLI, "module": "pizza"}, 404),
    ],
)
async def test_a_bad_request_mints_nothing(
    people: World, tenant: str, body: dict[str, str], status: int
) -> None:
    r = await people.internal.post(MINT, params={"tenant_id": tenant}, json=body, headers=bot())
    assert r.status_code == status


async def test_a_token_opens_only_its_module_its_event_and_its_minute(people: World) -> None:
    token = await mint(people)
    assert (await redeem(people, token, caller="moments"))[0] == 401
    assert (await redeem(people, token, tenant="other"))[0] == 401
    assert (await redeem(people, "not-a-token"))[0] == 401
    assert (await redeem(people, token))[0] == 200
    people.clock[0] = START + timedelta(seconds=61)
    assert (await redeem(people, token))[0] == 401


async def test_a_person_removed_after_the_mint_acts_no_more(people: World) -> None:
    token = await mint(people, discord_id=AINO)
    aino = next(u for u, _ in await people.store.list_users() if u.name == "Aino")
    await people.store.remove_user(aino.id, START)
    assert (await redeem(people, token))[0] == 401


async def test_an_unsigned_session_read_is_refused(people: World) -> None:
    token = await mint(people)
    r = await people.internal.get(
        SESSION, params={"tenant_id": "demo"}, headers={"x-canccu-acting": token}
    )
    assert r.status_code == 401


async def test_the_token_is_kept_only_as_its_hash(people: World) -> None:
    token = await mint(people)
    tokens = people.acting.store.tokens  # type: ignore[attr-defined]
    assert token not in repr(tokens)
    assert len(tokens) == 1
