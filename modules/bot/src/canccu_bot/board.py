"""The pinned now-and-next board in the guild's `now_and_next` channel (L2 of the step 6 plan;
mockup 10 A; contracts/bot.md, Living messages): the run of show's now and next, as the agenda
answers them for the screens, plus a food line from the orders the bot shows (food.py). The
editor (living.py) posts, pins and edits it.

Now and next come from `GET /internal/agenda/now`, the guest's answer (`public` items only, in
every info-page mode), so Discord, the hub and the screens never disagree (contracts/agenda.md,
Reading); a guild's members are not the event's members."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import httpx
from canccu_kit import ServiceIdentity
from canccu_kit.access import TenantContext

from .clock import hhmm, zone
from .guard import guarded, strip_foreign_links

log = logging.getLogger("canccu_bot.board")

KIND = "board"
KEY = "board"
NOW_AT_MOST, NEXT_AT_MOST = 3, 2
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
ON_ITS_WAY = {"closed": "closed", "placed": "on the way", "arrived": "is here"}


class AgendaNow:
    """The agenda's now and next for an event, read as a module with the service identity."""

    def __init__(self, agenda_url: str, identity: ServiceIdentity, http: httpx.AsyncClient) -> None:
        self._url = agenda_url.rstrip("/")
        self._identity = identity
        self._http = http

    async def now(self, tenant: str) -> dict[str, Any] | None:
        """None when the agenda does not answer now: the board then waits for the next try."""
        try:
            response = await self._http.get(
                f"{self._url}/internal/agenda/now",
                params={"tenant_id": tenant},
                headers=self._identity.headers("agenda"),
            )
            body = response.json() if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            log.warning("reading now and next of %s failed", tenant, exc_info=True)
            return None
        return body if isinstance(body, dict) else None


def _now_line(item: dict[str, Any], tz: str) -> str:
    facts = [str(item.get("title") or "")]
    if item.get("location"):
        facts.append(str(item["location"]))
    line = " · ".join(facts)
    if item.get("kind") == "quiet_hours" and item.get("ends_at"):
        line = f"{line} until {hhmm(item['ends_at'], tz)}"
    return f"Now · {line}"


def _next_line(item: dict[str, Any], tz: str) -> str:
    facts = [hhmm(item.get("starts_at"), tz), str(item.get("title") or "")]
    if item.get("location"):
        facts.append(str(item["location"]))
    return "Next · " + " · ".join(f for f in facts if f)


def _food_line(orders: list[dict[str, Any]], tz: str) -> str:
    said = []
    for state in sorted(orders, key=lambda s: -int(s.get("seq") or 0)):
        step = state["state"]
        if step == "open":
            said.append(f"order {state['seq']} open until {hhmm(state['closes_at'], tz)}")
        elif step in ON_ITS_WAY:
            said.append(f"order {state['seq']} {ON_ITS_WAY[step]}")
    return "Food · " + (" · ".join(said) if said else "nothing open")


def message(
    ctx: TenantContext,
    agenda: dict[str, Any],
    orders: list[dict[str, Any]] | None,
    name: str | None,
    color: int | None,
    at: datetime,
) -> dict[str, Any]:
    """The board; `orders` is None when the event has no food (its pizza flag is off)."""
    tz = ctx["time_zone"]
    hosts = [] if ctx["primary_hostname"] is None else [ctx["primary_hostname"]]
    current = list(agenda.get("current") or [])[:NOW_AT_MOST]
    coming = list(agenda.get("next") or [])[:NEXT_AT_MOST]
    lines = [_now_line(i, tz) for i in current] or ["Now · nothing on the run of show"]
    lines += [_next_line(i, tz) for i in coming] or ["Next · nothing planned"]
    if orders is not None:
        lines.append(_food_line(orders, tz))
    day = DAYS[at.astimezone(zone(tz)).weekday()]
    embed: dict[str, Any] = {
        "title": strip_foreign_links(f"{name or 'Run of show'} · {day}", hosts)[:256],
        "description": strip_foreign_links("\n".join(lines), hosts),
        "footer": {"text": f"Edited {hhmm(at, tz)} · the run of show, live"},
    }
    if color is not None:
        embed["color"] = color
    return guarded({"content": "", "embeds": [embed]})
