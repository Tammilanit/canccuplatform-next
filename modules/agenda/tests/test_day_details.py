"""The run of show's details (#553): the last minute's words, the miniature's size, whole titles
beside the item, the phone panel's scrim, the delay sheet keeping the panel open, a changed
item's row unfolded, and Quick add never following a gap that has ended."""

from __future__ import annotations

import re
from datetime import timedelta
from pathlib import Path

from conftest import NOW, Env, at
from test_items import add

STATIC = Path(__file__).parents[1] / "src/canccu_agenda/static"


def seconds(n: int) -> str:
    return (NOW + timedelta(seconds=n)).isoformat().replace("+00:00", "Z")


def rule(css: str, selector: str) -> str:
    """The declarations of the first rule for `selector`."""
    found = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert found, selector
    return found.group(1)


async def test_the_last_minute_of_a_running_item_is_not_zero(env: Env) -> None:
    async with env.client() as c:
        await add(c, env.writer(), title="Dinner", starts_at=at(-30), ends_at=seconds(30))
        text = (await c.get("/", headers=env.writer())).text
    assert "On now · 1 min left" in text and "0 min" not in text


async def test_the_last_minute_before_the_next_item_is_not_zero(env: Env) -> None:
    async with env.client() as c:
        await add(c, env.writer(), title="Show", starts_at=seconds(30), ends_at=at(60))
        text = (await c.get("/", headers=env.writer())).text
    assert "Up next · in 1 min" in text and "0 min" not in text


def test_the_miniature_is_sized_in_pixels_as_its_scale_assumes() -> None:
    # scale(0.175) is 336 / 1920: a box in rem would crop or gap under another root font size.
    css = (STATIC / "agenda.css").read_text()
    mini = rule(css, ".canccu-agenda-mini")
    assert "width: 336px;" in mini and "rem" not in mini.split("width:")[1].split(";")[0]
    assert "minmax(0, 1fr) 336px" in css


def test_row_titles_wrap_to_two_lines_beside_the_item() -> None:
    css = (STATIC / "agenda.css").read_text()
    wide = css.split("@media (min-width: 1440px)")[1]
    title = rule(wide, ".canccu-agenda-row__title")
    assert "white-space: normal;" in title and "-webkit-line-clamp: 2;" in title


async def test_the_phone_item_panel_closes_from_its_scrim(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        show = await add(c, h, title="Show", starts_at=at(60))
        picked = (await c.get(f"/?item={show['id']}", headers=h)).text
        plain = (await c.get("/", headers=h)).text
    close = f"/agenda/#r-{show['id']}"
    assert f'<a class="canccu-agenda-backdrop" href="{close}" tabindex="-1"' in picked
    assert "canccu-agenda-backdrop" not in plain  # beside the list, nothing to close
    css = (STATIC / "agenda.css").read_text()
    assert ".canccu-agenda-backdrop" in css and "side.is-open)::before" not in css


async def test_the_delay_sheet_keeps_the_picked_item_open(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        show = await add(c, h, title="Show", starts_at=at(60))
        query = {"item": show["id"], "delay": show["id"], "minutes": "10"}
        sheet = (await c.get("/", params=query, headers=h)).text
        form = {"revision": "1", "minutes": "10", "chosen": "1", "announce": "1"}
        form |= {"agenda_version": "1", "item": show["id"]}
        done = await c.post(f"/items/{show['id']}/delay", data=form, headers=h)
    assert f'<input type=hidden name="item" value="{show["id"]}">' in sheet
    assert done.status_code == 303
    assert f"item={show['id']}" in done.headers["location"]
    assert done.headers["location"].endswith(f"#r-{show['id']}")


async def test_a_change_to_a_folded_item_opens_the_earlier_items(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        over = await add(c, h, title="Doors", starts_at=at(-60), ends_at=at(-30))
        ahead = await add(c, h, title="Show", starts_at=at(60))
        folded = await c.post(f"/items/{over['id']}/cancel", data={"revision": "1"}, headers=h)
        shown = await c.post(f"/items/{ahead['id']}/cancel", data={"revision": "1"}, headers=h)
    assert "earlier=1" in folded.headers["location"]
    assert folded.headers["location"].endswith(f"#r-{over['id']}")
    assert "earlier=1" not in shown.headers["location"]


async def test_quick_add_never_follows_a_gap_that_has_ended(env: Env) -> None:
    h = env.writer()
    async with env.client() as c:
        # Both still run, so both are listed; the room between their starts is past.
        await add(c, h, title="Hall open", starts_at=at(-60), ends_at=at(60))
        await add(c, h, title="Quiz", starts_at=at(-30), ends_at=at(30))
        await add(c, h, title="Show", starts_at=at(90))
        text = (await c.get("/", headers=h)).text
    assert text.count('class="canccu-agenda-gap is-ended"') == 1
    assert text.count('class="canccu-agenda-gap"') == 1
    script = (STATIC / "day.js").read_text()
    assert ".canccu-agenda-gap:not(.is-ended) a" in script
