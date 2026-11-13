"""Check-in as v8 sheet 7 (#441): the attendee's own sign-in step, the cancelled card, not open
yet or closed, off the venue's network, expired, couldn't check in, and the done page's rows."""

from __future__ import annotations

import html
from datetime import timedelta

import httpx
from conftest import NOW, Env
from test_checkin import code, recorded
from test_checkin_page import page, submit

from canccu_notify.hub import HubReader

HOST = "a.example.test"


def _text(r: httpx.Response) -> str:
    return html.unescape(r.text)


async def test_attendees_get_their_own_sign_in_step(env: Env) -> None:
    shown = (await code(env))["code"]
    r = await page(env, f"p=arrival&c={shown}")
    text = _text(r)
    assert "Tell the crew you have arrived. You sign in with Discord once;" in text
    assert "Organisers and crew" not in text
    # Straight to Discord: the organisers' sign-in card is never in between.
    assert '<form method="post" action="/admin/sign-in">' in text
    assert f'name="next" value="/notify/check-in?p=arrival&c={shown}"' in text
    assert "Continue with Discord" in text and "Checking in is optional." in text
    assert '<a class="canccu-privacy-link" href="/notify/privacy">Privacy</a></body>' in text


async def test_a_cancelled_discord_sign_in_has_its_own_card(env: Env) -> None:
    shown = (await code(env))["code"]
    text = _text(await page(env, f"p=arrival&c={shown}&signin=cancelled"))
    assert "Discord sign-in was cancelled" in text
    assert "You closed Discord before it finished. You are not checked in yet." in text
    assert "Try again with Discord" in text and 'action="/admin/sign-in"' in text


async def test_before_the_event_check_in_is_not_open(env: Env) -> None:
    env.events[HOST] = {"starts_at": (NOW + timedelta(days=3)).isoformat(), "time_zone": "UTC"}
    form = {"p": "arrival", "c": (await code(env))["code"]}
    text = _text(await page(env, f"p=arrival&c={form['c']}", "u_a"))
    assert "Check-in opens on Monday" in text
    assert "Doors open on Mon 23 Nov at 17:00. Scan the code on a screen when you arrive." in text
    assert 'action="/notify/check-in"' not in text
    refused = await submit(env, form, "u_a")
    assert "Check-in opens on Monday" in _text(refused) and recorded(env) == []


async def test_after_the_event_check_in_has_closed(env: Env) -> None:
    env.events[HOST] = {"ends_at": (NOW - timedelta(hours=1)).isoformat()}
    shown = (await code(env))["code"]
    text = _text(await page(env, f"p=arrival&c={shown}", "u_a"))
    assert "Check-in has closed" in text and "The event has ended." in text
    env.events[HOST] = {}
    env.contexts["ev-a"]["status"] = "archived"
    assert "Check-in has closed" in _text(await page(env, f"p=arrival&c={shown}"))


async def test_off_the_venue_network_it_says_which_network(env: Env) -> None:
    env.contexts["ev-a"]["venue"] = {"id": "v", "name": "Hall", "addresses": ["10.9.0.0/16"]}
    env.hub.wifi = [{"ssid": "demo-guest", "password": None, "visibility": "public"}]
    form = {"p": "arrival", "c": (await code(env))["code"]}
    text = _text(await page(env, f"p=arrival&c={form['c']}", "u_a"))
    assert "Check in at the venue" in text
    assert "Checking in works on the venue's Wi-Fi. Join demo-guest, then scan" in text
    assert "Try again" in text
    refused = await submit(env, form, "u_a")
    assert "Check in at the venue" in _text(refused) and recorded(env) == []
    # The venue's emergency switch (its address changed mid-event) lets check-in through.
    until = (NOW + timedelta(hours=2)).isoformat()
    env.contexts["ev-a"]["venue_ip_check"] = {
        "enabled": False,
        "disabled_until": until,
        "reason": "moved",
    }
    assert (await submit(env, form, "u_a")).status_code == 201


async def test_on_the_venue_network_it_checks_in(env: Env) -> None:
    env.contexts["ev-a"]["venue"] = {"id": "v", "name": "Hall", "addresses": ["198.51.100.0/24"]}
    form = {"p": "arrival", "c": (await code(env))["code"]}
    assert (await submit(env, form, "u_a")).status_code == 201


async def test_an_expired_code_offers_scan_again_and_the_info_desk(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    env.clock[0] = NOW + timedelta(minutes=2)
    text = _text(await submit(env, form, "u_a"))
    assert "This code has expired" in text
    assert "The code on the screen changes every 30 seconds." in text
    assert "data-canccu-scan" in text and "Scan again" in text
    assert "No luck? The info desk can check you in." in text
    assert 'src="/notify/static/check-in.js"' in text


async def test_done_shows_the_wifi_and_what_is_on_now(env: Env) -> None:
    env.hub.wifi = [{"ssid": "demo-guest", "password": "hunter22", "visibility": "attendees"}]
    ends = (NOW + timedelta(hours=2, minutes=15)).isoformat()
    item = {"title": "Dinner", "location": "Café", "ends_at": ends, "delay_minutes": 15}
    env.hub.now = {"current": [item], "next": []}
    form = {"p": "arrival", "c": (await code(env))["code"]}
    r = await submit(env, form, "u_a")
    text = _text(r)
    assert r.status_code == 201 and "Welcome! Checked in at 17:00." in text
    assert "Wi-Fi: demo-guest" in text and "<details" in text and "hunter22" in text
    assert "Now: Dinner" in text and "+15 min" in text and "Café · until 19:15" in text
    # Read as the person, on the event's hostname.
    assert env.hub.asked[-1] == (HOST, "canccu_session=u_a")
    again = _text(await submit(env, form, "u_a"))
    assert "Since 17:00 today. Nothing more to do." in again and "Now: Dinner" in again


async def test_couldnt_check_in_is_said_plainly(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    env.settings.down = True
    text = _text(await submit(env, form, "u_a"))
    assert "Couldn't check you in" in text and "Try again" in text
    # Try again comes back to the scanned code, not to a bare page that says "Code not valid".
    assert f'href="/notify/check-in?p=arrival&c={form["c"]}"' in text
    # The page also carries the card for a phone that never reaches the event (check-in.js).
    env.settings.down = False
    ready = _text(await page(env, f"p=arrival&c={form['c']}", "u_a"))
    assert "data-canccu-unreachable" in ready
    assert "Your phone didn't reach the event. You may have just lost signal." in ready


async def test_the_privacy_page(env: Env) -> None:
    async with env.client() as c:
        r = await c.get("/privacy")
    text = _text(r)
    assert r.status_code == 200 and "<h1>Privacy</h1>" in text
    assert "30 days after the event is archived" in text


async def test_the_hub_reader_reads_as_the_person_and_never_fails_the_page() -> None:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/tenants/current/venue-info":
            return httpx.Response(200, json={"wifi": [{"ssid": "x", "visibility": "public"}]})
        return httpx.Response(500)

    reader = HubReader(
        "http://tenants:8080",
        "http://agenda:8080",
        httpx.AsyncClient(transport=httpx.MockTransport(answer)),
    )
    assert await reader.venue_wifi(HOST, "canccu_session=s") == [
        {"ssid": "x", "visibility": "public"}
    ]
    assert await reader.agenda_now(HOST, "canccu_session=s") is None
    assert [r.headers["host"] for r in seen] == [HOST, HOST]
    assert seen[0].headers["cookie"] == "canccu_session=s"


async def test_already_checked_in_on_an_earlier_day_names_the_day(env: Env) -> None:
    form = {"p": "arrival", "c": (await code(env))["code"]}
    assert (await submit(env, form, "u_a")).status_code == 201
    env.clock[0] = NOW + timedelta(days=1)
    form = {"p": "arrival", "c": (await code(env))["code"]}
    text = _text(await submit(env, form, "u_a"))
    assert "Since Fri 20 Nov, 17:00. Nothing more to do." in text
