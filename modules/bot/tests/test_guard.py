"""The guard on every send (port of the legacy `tourney_guard`; L3): no mention pings unless an
urgent announcement picked a role for that one send, and text built from other people's words
keeps only links to the event's own hosts."""

from __future__ import annotations

import pytest

from canccu_bot.guard import guarded, is_event_url, strip_foreign_links

HOSTS = ["demo.example.test"]


def test_every_send_pings_nobody_whatever_its_text_says() -> None:
    body = guarded({"content": "Hi @everyone and @here, <@123> and <@&456>"})
    assert body["allowed_mentions"] == {"parse": []}
    assert body["content"] == "Hi @everyone and @here, <@123> and <@&456>"  # shown, never pinged


def test_a_body_cannot_open_its_own_mentions() -> None:
    body = guarded({"content": "x", "allowed_mentions": {"parse": ["everyone", "roles"]}})
    assert body["allowed_mentions"] == {"parse": []}


def test_an_urgent_announcement_pings_its_one_picked_role_for_that_send() -> None:
    body = guarded({"content": "<@&456> doors close"}, role="456")
    assert body["allowed_mentions"] == {"parse": [], "roles": ["456"]}
    assert guarded({"content": "again"})["allowed_mentions"] == {"parse": []}


def test_a_name_holding_everyone_stays_text_in_an_embed_too() -> None:
    embed = {"title": "@everyone wins", "description": "by @here"}
    assert guarded({"embeds": [embed]})["allowed_mentions"] == {"parse": []}


@pytest.mark.parametrize(
    ("url", "ours"),
    [
        ("https://demo.example.test", True),
        ("https://demo.example.test/finals?x=1", True),
        ("http://DEMO.example.test:8080/a", True),
        ("https://demo.example.test.evil.test/", False),
        ("https://evil.test/?demo.example.test", False),
        ("https://user@evil.test/", False),
        ("discord://anything", False),
        ("javascript:alert(1)", False),
    ],
)
def test_an_event_url_is_on_one_of_its_hosts(url: str, ours: bool) -> None:
    assert is_event_url(url, HOSTS) is ours


def test_foreign_links_are_stripped_from_other_peoples_words() -> None:
    text = (
        "Team https://evil.test/x and www.evil.test wins, see https://demo.example.test/t/1 or"
        " discord://evil"
    )
    assert (
        strip_foreign_links(text, HOSTS) == "Team  and  wins, see https://demo.example.test/t/1 or "
    )


def test_with_no_event_host_every_link_goes() -> None:
    assert strip_foreign_links("go https://demo.example.test now", []) == "go  now"
