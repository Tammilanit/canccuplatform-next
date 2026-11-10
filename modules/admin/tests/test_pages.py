"""The page frame's navigation: a link the session cannot follow is not shown."""

from __future__ import annotations

from datetime import UTC, datetime

from canccu_kit.rights import Session

from canccu_admin.pages import page


def nav(*rights: str) -> str:
    session = Session("u1", "Organiser", frozenset(rights), datetime(2030, 1, 1, tzinfo=UTC))
    return bytes(page("Settings", "", session=session).body).decode().split("</nav>")[0]


def test_the_event_menu_links_the_run_of_show_for_its_rights() -> None:
    assert 'Event: <a href="/agenda/">Run of show</a>' in nav("agenda.items.write")
    assert 'href="/agenda/"' in nav("agenda.crew.read")
    assert "Event:" not in nav("admin.settings.read")


def test_the_event_menu_links_the_notification_pages_for_their_rights() -> None:
    link = '<a href="/notify/admin/topics">Notifications</a>'
    assert f"Event: {link}" in nav("notify.topics.write")
    assert link in nav("notify.stats.read")
    both = nav("agenda.items.write", "notify.topics.write")
    assert 'Run of show</a> · <a href="/notify/admin/topics">' in both
    assert "Notifications" not in nav("agenda.items.write")
