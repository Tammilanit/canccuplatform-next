"""Every Notifications organiser page keeps the page rules (#782): a description under its title,
a tooltip on every status chip, a label and a tooltip on every icon-only button."""

from __future__ import annotations

from canccu_kit.page_check import page_problems
from conftest import Env
from test_custom import COSPLAY, save
from topics import schedule


async def test_every_notify_page_keeps_the_page_rules(env: Env) -> None:
    await env.register(schedule())
    await save(env, "custom_cosplay", COSPLAY)
    async with env.client() as c:
        for path in [
            "/admin/topics",
            "/admin/topics/new",
            "/admin/topics/new?based_on=schedule",
            "/admin/topics/custom_cosplay/edit",
            "/admin/topics/custom_cosplay/remove",
        ]:
            r = await c.get(path, headers=env.admin())
            assert r.status_code == 200, path
            assert page_problems(r.text) == [], path
