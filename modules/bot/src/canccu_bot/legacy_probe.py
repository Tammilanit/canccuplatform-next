"""Whether the legacy bot still holds a gateway session on its token, asked without disturbing it.

Discord has no call that lists a token's sessions, and a second session does not close the first.
What it does show is the bot user's presence, folded from all of its sessions as any user's is:
online while one of them is online. So the probe opens its own session as `invisible`, asks for
the bot user's presence in the legacy server (op 8 with `presences`), and closes again. Offline
then means no other session is live, which is the switch's check that the bot user shows offline
in the server (docs/briefs/step-6-bot.md, The switch), done by the import itself."""

from __future__ import annotations

import asyncio
from typing import Any

from .gateway import PRESENCES_INTENT, Connector, GatewayClosed

GUILDS_INTENT = 1 << 0
TIMEOUT = 15.0
"""Seconds for the whole probe; well inside the first heartbeat (about 41 s), so none is sent."""


class ProbeFailed(Exception):
    """The check could not be made; the message says what the operator can do."""


def _identify(token: str) -> dict[str, Any]:
    return {
        "op": 2,
        "d": {
            "token": token,
            "intents": GUILDS_INTENT | PRESENCES_INTENT,
            "properties": {"os": "linux", "browser": "canccu", "device": "canccu"},
            "presence": {"status": "invisible", "since": None, "activities": [], "afk": False},
        },
    }


async def _until(ws: Any, event: str, guild_id: str | None = None) -> dict[str, Any]:
    while True:
        message = await ws.recv()
        if message.get("op") != 0 or message.get("t") != event:
            continue
        data: dict[str, Any] = message.get("d") or {}
        if guild_id is None or str(data.get("guild_id", data.get("id"))) == guild_id:
            return data


async def _online(ws: Any, token: str, guild_id: str) -> bool:
    hello = await ws.recv()
    if hello.get("op") != 10:
        raise ProbeFailed("Discord's gateway did not greet the probe")
    await ws.send(_identify(token))
    me = str(((await _until(ws, "READY")).get("user") or {}).get("id"))
    await _until(ws, "GUILD_CREATE", guild_id)  # op 8 waits for the guild to be available
    request = {"guild_id": guild_id, "user_ids": [me], "presences": True}
    await ws.send({"op": 8, "d": request})
    chunk = await _until(ws, "GUILD_MEMBERS_CHUNK", guild_id)
    for presence in chunk.get("presences") or []:
        user = presence.get("user") or {}
        if str(user.get("id")) == me and presence.get("status") not in (None, "offline"):
            return True
    return False


async def legacy_online(connect: Connector, gateway_url: str, token: str, guild_id: str) -> bool:
    """True while another session shows the bot user online in the server."""
    ws = await connect(f"{gateway_url}?v=10&encoding=json")
    try:
        async with asyncio.timeout(TIMEOUT):
            return await _online(ws, token, guild_id)
    except TimeoutError:
        raise ProbeFailed("Discord's gateway did not answer the probe in time") from None
    except GatewayClosed as closed:
        if closed.code == 4014:
            raise ProbeFailed(
                "enable the Presence intent for the application (Developer Portal → Bot →"
                " Privileged Gateway Intents): the check reads the bot user's presence, and the"
                " platform's counts need it too"
            ) from None
        if closed.code == 4004:
            raise ProbeFailed("the gateway refused the token") from None
        raise ProbeFailed(f"the gateway closed the probe ({closed.code})") from None
    finally:
        await ws.close(1000)  # a normal close ends the probe's session, so it leaves nothing on
