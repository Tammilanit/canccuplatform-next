"""The front door mirrors an announcement's level (#780, sheet 6; contracts/moments.md, Sending):
an urgent one a banner pinned above everything until it is withdrawn, an Important one a large
card first under "What's on", an Info one a quiet row, read from Moments as the visitor reads it."""

from __future__ import annotations

import html
from datetime import timedelta
from typing import Any

from conftest import NOW, Env
from test_front_door import HOST, NOW_ITEM, front


def live(
    level: str, title: str, body: str = "", icon: str = "info", ago: int = 1
) -> dict[str, Any]:
    return {
        "id": f"an_{title}",
        "level": level,
        "title": title,
        "body": body,
        "icon": icon,
        "art": None,
        "sent_at": (NOW - timedelta(minutes=ago)).isoformat(),
        "expires_at": (NOW + timedelta(minutes=3 - ago)).isoformat(),
        "zones": [],
    }


async def page(env: Env) -> str:
    r = await front(env)
    assert r.status_code == 200
    return html.unescape(r.text)


async def test_an_urgent_one_is_a_banner_above_whats_on_until_the_crew_lifts_it(env: Env) -> None:
    env.hub.live = [live("urgent", "Semis in 15 min", "Players to the stage now")]
    text = await page(env)
    banner = text.index('class="canccu-front-door__urgent" role="alert"')
    assert banner < text.index("<h1>What's on</h1>")
    assert "Semis in 15 min" in text and "Players to the stage now" in text
    assert "Stays here until the crew lifts it" in text
    # Read as the visitor reads it, on the event's hostname.
    assert env.hub.asked_live == [(HOST, None)]


async def test_important_leads_whats_on_as_a_large_card_and_info_is_a_quiet_row(env: Env) -> None:
    env.hub.now = {"current": [NOW_ITEM], "next": []}
    env.hub.live = [
        live("important", "Finals start", "Main stage", icon="trophy", ago=1),
        live("info", "The raffle at 21", "Tickets at the info desk", icon="megaphone", ago=2),
        live("important", "Pizza is here", "Order 7", icon="food", ago=2),
    ]
    text = await page(env)
    whats_on = text.index("<h1>What's on</h1>")
    finals = text.index("Finals start")
    pizza = text.index("Pizza is here")
    raffle = text.index("The raffle at 21")
    # Importants first, newest first as Moments lists them; the Info row after them; now and next
    # after all of them.
    assert whats_on < finals < pizza < raffle < text.index("Opening show")
    assert text.count('class="canccu-front-door__important"') == 2
    assert text.count('class="canccu-front-door__info"') == 1
    assert "canccu-i--flag" in text and "canccu-i--food" in text and "canccu-i--megaphone" in text
    # The time left, in words and as a bar: sent a minute ago, two of three minutes left.
    assert "2 min left" in text and '<progress max="180" value="120"' in text


async def test_none_live_and_moments_down_leave_the_page_as_it_was(env: Env) -> None:
    env.hub.live = []
    text = await page(env)
    assert "canccu-front-door__announcements" not in text and 'role="alert"' not in text
    env.hub.live = None
    text = await page(env)
    assert "canccu-front-door__announcements" not in text and "Crew & organisers" in text


async def test_a_visitor_the_info_page_mode_keeps_out_sees_none(env: Env) -> None:
    env.contexts["ev-a"]["info_page_mode"] = "venue_only"
    env.contexts["ev-a"]["venue"] = {"id": "v", "name": "Hall", "addresses": ["10.9.0.0/16"]}
    env.hub.live = [live("urgent", "Semis in 15 min")]
    text = await page(env)
    assert "Open at the venue" in text and "Semis in 15 min" not in text
    assert env.hub.asked_live == []
