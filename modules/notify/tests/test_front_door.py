"""The event's front door at its base address `/` (#750): the poster, now and next, the public
pages that are on and the crew's way in, as the info-page mode and the event's state allow."""

from __future__ import annotations

import html
from datetime import timedelta

import httpx
from conftest import DOWN_HOST, NOW, Env

HOST = "a.example.test"
NOW_ITEM = {
    "title": "Opening show",
    "location": "Main stage",
    "starts_at": (NOW - timedelta(minutes=30)).isoformat(),
    "ends_at": (NOW + timedelta(minutes=45)).isoformat(),
    "delay_minutes": 0,
}
NEXT_ITEM = {
    "title": "Pizza run",
    "location": None,
    "starts_at": (NOW + timedelta(hours=1, minutes=30)).isoformat(),
    "ends_at": None,
    "delay_minutes": 10,
}


async def front(env: Env, user: str | None = None, host: str = HOST) -> httpx.Response:
    headers = env.rights.sign_in(user) if user else {}
    async with env.client(host) as c:
        return await c.get("/", headers=headers)


def text_of(r: httpx.Response) -> str:
    return html.unescape(r.text)


async def test_a_guest_sees_the_poster_now_and_next_the_public_pages_and_the_crew_way_in(
    env: Env,
) -> None:
    env.hub.now = {"current": [NOW_ITEM], "next": [NEXT_ITEM]}
    r = await front(env)
    text = text_of(r)
    assert r.status_code == 200
    # The sign-in front page's poster, in the hub's look.
    assert 'class="canccu-poster__name">Demo Event<' in text
    assert "canccu-surface--hub" in text
    assert "<h1>What's on</h1>" in text
    assert "Opening show" in text and "Main stage · until 17:45" in text
    assert "Pizza run" in text and "18:30" in text and "+10 min" in text
    assert '<a class="canccu-front-door__link" href="/pizza/">' in text and "Food" in text
    assert "Crew & organisers" in text and 'href="/admin/">' in text and "Sign in" in text
    assert '<a class="canccu-privacy-link" href="/notify/privacy">Privacy</a></body>' in text
    # Now and next are read as the guest reads them, on the event's hostname.
    assert env.hub.asked_now == [(HOST, None)]


async def test_its_headers_keep_it_unframed_and_uncached(env: Env) -> None:
    r = await front(env)
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"


async def test_a_signed_in_person_is_offered_admin_and_reads_as_themselves(env: Env) -> None:
    text = text_of(await front(env, "u_a"))
    assert "Open admin" in text and 'href="/admin/">' in text
    assert env.hub.asked_now == [(HOST, "canccu_session=u_a")]


async def test_nothing_on_says_so_and_an_unreachable_agenda_leaves_its_part_out(env: Env) -> None:
    assert "Nothing on the run of show right now." in text_of(await front(env))
    env.hub.now = None
    r = await front(env)
    assert r.status_code == 200
    assert "Nothing on the run of show" not in r.text and "canccu-front-door__now" not in r.text
    assert "Crew & organisers" in text_of(r)


async def test_a_switched_off_module_is_not_linked(env: Env) -> None:
    env.contexts["ev-a"]["flags"] = {"pizza.enabled": False}
    text = text_of(await front(env))
    assert 'href="/pizza/"' not in text and "Crew & organisers" in text


async def test_venue_only_shows_a_guest_away_from_the_venue_only_where_to_open_it(
    env: Env,
) -> None:
    env.contexts["ev-a"]["info_page_mode"] = "venue_only"
    env.contexts["ev-a"]["venue"] = {"id": "v", "name": "Hall", "addresses": ["10.9.0.0/16"]}
    env.hub.now = {"current": [NOW_ITEM], "next": []}
    text = text_of(await front(env))
    assert "Open at the venue" in text and "venue's Wi-Fi" in text
    assert "Opening show" not in text and 'href="/pizza/"' not in text
    assert "Crew & organisers" in text and env.hub.asked_now == []
    # The test client is 198.51.100.7: at the venue, the page opens.
    env.contexts["ev-a"]["venue"] = {"id": "v", "name": "Hall", "addresses": ["198.51.100.0/24"]}
    env.hub.now_ips.clear()
    assert "Opening show" in text_of(await front(env))
    assert env.hub.now_ips == ["198.51.100.7"]


async def test_sign_in_mode_keeps_the_page_for_people_signed_in(env: Env) -> None:
    env.contexts["ev-a"]["info_page_mode"] = "sign_in"
    env.hub.now = {"current": [NOW_ITEM], "next": []}
    text = text_of(await front(env))
    assert "For members" in text and "Opening show" not in text and 'href="/pizza/"' not in text
    signed_in = text_of(await front(env, "u_a"))
    assert "Opening show" in signed_in and 'href="/pizza/"' in signed_in


async def test_a_draft_shows_guests_only_that_it_is_not_open_yet(env: Env) -> None:
    env.contexts["ev-a"]["status"] = "draft"
    # Tenants names a draft only to its members: a guest gets its id and status.
    env.events[HOST] = {"status": "draft", "name": None}
    env.hub.now = {"current": [NOW_ITEM], "next": []}
    text = text_of(await front(env))
    assert "Not open yet" in text and "Opening show" not in text and 'href="/pizza/"' not in text
    # No empty poster: the platform's, as on a front door no event claims (#708).
    assert "canccu-poster--platform" in text and "Crew & organisers" in text
    assert env.hub.asked_now == []


async def test_a_draft_shows_its_members_the_page_and_that_it_is_a_draft(env: Env) -> None:
    env.contexts["ev-a"]["status"] = "draft"
    env.events[HOST] = {"status": "draft"}
    env.hub.now = {"current": [NOW_ITEM], "next": []}
    text = text_of(await front(env, "u_a"))
    assert "Draft" in text and "Only the organisers see this event" in text
    assert "Opening show" in text and 'href="/pizza/"' in text


async def test_an_archived_event_says_it_has_ended_and_keeps_its_pages(env: Env) -> None:
    env.contexts["ev-a"]["status"] = "archived"
    env.events[HOST] = {"status": "archived"}
    env.hub.now = {"current": [NOW_ITEM], "next": []}
    text = text_of(await front(env))
    assert "The event has ended" in text and "Thanks for coming." in text
    assert "Archived" in text  # the poster's badge
    assert "Opening show" not in text and env.hub.asked_now == []
    assert 'href="/pizza/"' in text and "Crew & organisers" in text


async def test_a_host_no_event_claims_answers_a_page_not_json(env: Env) -> None:
    r = await front(env, host="nobody.example.test")
    text = text_of(r)
    assert r.status_code == 404 and r.headers["content-type"].startswith("text/html")
    assert "No event here" in text and "canccu-poster--platform" in text
    assert "Crew & organisers" in text


async def test_a_tenants_module_that_does_not_answer_gives_a_way_to_try_again(env: Env) -> None:
    r = await front(env, host=DOWN_HOST)
    text = text_of(r)
    assert r.status_code == 503 and r.headers["content-type"].startswith("text/html")
    assert "Couldn't load the event" in text and 'href="/">' in text and "Try again" in text
