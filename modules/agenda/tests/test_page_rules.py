"""Every run-of-show organiser page keeps the page rules (#782): a description under its title, a
tooltip on every status chip, a label and a tooltip on every icon-only button."""

from __future__ import annotations

from canccu_kit.page_check import page_problems
from conftest import Env, at
from test_items import add


async def test_every_agenda_page_keeps_the_page_rules(env: Env) -> None:
    h = env.writer("agenda.crew.read")
    async with env.client() as c:
        item = await add(c, h, ends_at=at(120))
        await add(c, h, title="Show", starts_at=at(180))
        one = f"/items/{item['id']}"
        for path in [
            "/",
            "/add",
            "/items/new",
            one,
            f"{one}/edit",
            f"{one}/delay",
            f"{one}/delay?minutes=15",
            f"{one}/cancel",
            f"{one}/show-now",
            "/templates",
            "/templates/new",
        ]:
            r = await c.get(path, headers=h)
            assert r.status_code == 200, path
            assert page_problems(r.text) == [], path
