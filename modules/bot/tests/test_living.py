"""The living messages (L1, L2, L9, E1 to E4 of the step 6 plan; D6 of docs/plans/issue-122.md):
the pinned now-and-next board and one message per food order, edited in place by the editor of
the event's client, at most once a minute per channel, checked after a gap and posted again
when deleted or unpinned."""

from __future__ import annotations

import pytest
from conftest import Env
from living_world import HOLDER_DISCORD_ID, World, item, raw, text, world

from canccu_bot.guild import unbind

NINE = "100000000000000999"


@pytest.fixture
async def w(env: Env) -> World:
    return await world(env)


async def test_the_board_is_posted_and_pinned_once_its_purpose_is_bound(w: World) -> None:
    w.agenda.current = [item("Doors open", "2026-11-27T09:00:00Z", "café and hall")]
    w.agenda.next = [item("Match 2", "2026-11-27T10:30:00Z", "on the stage")]
    await w.editor.tick()
    await w.editor.tick()  # nothing changed: nothing more is sent
    [board] = w.board()
    assert text(board) == (
        "Demo Event · Friday\n"
        "Now · Doors open · café and hall\n"
        "Next · 12:30 · Match 2 · on the stage\n"
        "Food · nothing open\n"
        "Edited 12:00 · the run of show, live"
    )
    assert board["embeds"][0]["color"] == 0x3366FF
    assert w.pinned() == [board["id"]]
    assert w.edits(w.board_channel) == 0


async def test_a_food_order_is_one_message_with_counts_and_the_holder_only(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    [message] = w.food()
    assert text(message) == (
        "Order 2 · Demo Trattoria\n"
        "Open until 12:30 · 3 pizzas · held by Player Two\n"
        "● open  ○ closed  ○ called in  ○ here"
    )
    assert message["components"] == [
        {
            "type": 1,
            "components": [
                {
                    "type": 2,
                    "style": 5,
                    "label": "Add a pizza",
                    "url": "https://a.example.test/pizza/orders/po_2/add",
                }
            ],
        }
    ]
    assert message["allowed_mentions"] == {"parse": []}
    assert HOLDER_DISCORD_ID not in raw(message) and "u_2" not in raw(message)
    assert "Food · order 2 open until 12:30" in text(w.board()[0])


async def test_edits_coalesce_to_one_a_minute_per_channel_and_the_last_state_wins(
    w: World,
) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    await w.order_event("closed", state="closed", revision=2)
    await w.order_event("placed", state="placed", revision=3, estimate_at="2026-11-27T10:50:00Z")
    await w.editor.tick()
    assert w.edits(w.food_channel) == 1
    called_in = "Called in · about 12:50 · 3 pizzas · held by Player Two"
    assert text(w.food()[0]).splitlines()[1] == called_in
    await w.order_event("arrived", state="arrived", revision=4, pickup="the café counter")
    w.clock.move(59)
    await w.editor.tick()
    assert w.edits(w.food_channel) == 1  # not yet: the channel had its edit this minute
    w.clock.move(1)
    await w.editor.tick()
    assert w.edits(w.food_channel) == 2
    assert text(w.food()[0]).splitlines()[1] == "It's here · pick up at the café counter"


async def test_each_channel_keeps_its_own_minute(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    await w.order_event("closed", state="closed", revision=2)
    await w.editor.tick()
    assert (w.edits(w.food_channel), w.edits(w.board_channel)) == (1, 1)


async def test_a_change_that_shows_nothing_new_is_no_edit(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    await w.order_event("changed", revision=2, changed=["note"])
    await w.editor.tick()
    assert w.edits(w.food_channel) == 0 and w.edits(w.board_channel) == 0


async def test_an_older_revision_never_overwrites_a_newer_one(w: World) -> None:
    await w.order_event("closed", state="closed", revision=3)
    await w.order_event("reopened", state="open", revision=2)  # delivered late
    await w.editor.tick()
    assert text(w.food()[0]).splitlines()[1].startswith("Closed")


async def test_pizzas_added_move_the_count_without_naming_anyone(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    added = {
        "order_id": "po_2",
        "order_revision": 2,
        "item_id": "pi_9",
        "user_id": "u_9",
        "person": {"user_id": "u_9", "discord_user_id": NINE, "name": "Player Nine"},
        "pizza_count": 4,
        "people_count": 4,
        "actor_user_id": "u_9",
    }
    await w.pizza("item.added", added)
    await w.pizza("item.added", {**added, "order_revision": 1, "pizza_count": 1})  # stale
    await w.editor.tick()
    message = w.food()[0]
    assert "4 pizzas" in text(message)
    assert "Player Nine" not in raw(message) and NINE not in raw(message)


async def test_a_privacy_delete_takes_the_holders_name_away(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    await w.order_event("changed", revision=2, holder=None, changed=["holder"])
    await w.editor.tick()
    assert "Player Two" not in raw(w.food()[0])
    rows = await w.env.fetch("ev-a", "SELECT state::text FROM bot_posts")
    assert all("Player Two" not in str(r[0]) for r in rows)


async def test_the_holders_name_goes_through_the_guard(w: World) -> None:
    holder = {"user_id": "u_2", "discord_user_id": HOLDER_DISCORD_ID,
              "name": "@everyone https://evil.example.net/x"}  # fmt: skip
    await w.order_event("opened", holder=holder)
    await w.editor.tick()
    message = w.food()[0]
    assert "evil.example.net" not in raw(message)
    assert message["allowed_mentions"] == {"parse": []}


async def test_an_order_first_seen_finished_is_never_posted(w: World) -> None:
    await w.order_event("cancelled", state="cancelled", revision=4, reason="cancelled")
    await w.editor.tick()
    assert w.food() == []


async def test_a_deleted_order_message_is_posted_again_at_its_next_change(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    w.env.discord.delete_message(w.food_channel, w.food()[0]["id"])
    await w.order_event("closed", state="closed", revision=2)
    await w.editor.tick()
    [again] = w.food()
    assert text(again).splitlines()[1].startswith("Closed")
    [row] = await w.env.fetch("ev-a", "SELECT message_id FROM bot_posts WHERE kind = 'food_order'")
    assert row["message_id"] == again["id"]


async def test_after_a_gap_a_deleted_board_is_posted_and_pinned_again(w: World) -> None:
    await w.editor.tick()
    w.env.discord.delete_message(w.board_channel, w.board()[0]["id"])
    await w.editor.on_gateway("GUILD_CREATE", {"id": w.guild_id})
    await w.editor.tick()
    [board] = w.board()
    assert w.pinned() == [board["id"]]


async def test_an_unpinned_board_is_pinned_again_not_posted_again(w: World) -> None:
    await w.editor.tick()
    [board] = w.board()
    w.env.discord.unpin(w.board_channel, board["id"])
    pins = {"guild_id": w.guild_id, "channel_id": w.board_channel}
    await w.editor.on_gateway("CHANNEL_PINS_UPDATE", pins)
    await w.editor.tick()
    assert [m["id"] for m in w.board()] == [board["id"]]
    assert w.pinned() == [board["id"]]


async def test_a_resume_checks_every_message_and_a_deleted_one_comes_back(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    w.env.discord.delete_message(w.food_channel, w.food()[0]["id"])
    await w.editor.on_gateway("RESUMED", {})
    await w.editor.tick()
    assert len(w.food()) == 1


async def test_a_message_deleted_in_the_guild_comes_back_at_once(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    gone = w.food()[0]["id"]
    w.env.discord.delete_message(w.food_channel, gone)
    deleted = {"id": gone, "channel_id": w.food_channel, "guild_id": w.guild_id}
    await w.editor.on_gateway("MESSAGE_DELETE", deleted)
    await w.editor.tick()
    assert len(w.food()) == 1 and w.food()[0]["id"] != gone


async def test_nothing_is_sent_while_the_client_is_not_ready_and_it_catches_up(w: World) -> None:
    w.editor.ready = lambda: False
    await w.order_event("opened")
    await w.order_event("closed", state="closed", revision=2)
    await w.editor.tick()
    assert w.food() == [] and w.board() == []
    w.editor.ready = lambda: True
    await w.editor.tick()
    [message] = w.food()
    assert text(message).splitlines()[1].startswith("Closed")


async def test_a_purpose_that_is_missing_posts_nowhere(w: World) -> None:
    await w.env.sql("ev-a", "DELETE FROM bot_purposes")
    await w.order_event("opened")
    await w.editor.tick()
    assert w.env.discord.messages == {}


async def test_a_channel_deleted_in_discord_drops_the_post_without_a_loop(w: World) -> None:
    w.env.discord.guilds[w.guild_id].channels.pop(w.food_channel)
    await w.order_event("opened")
    await w.editor.tick()
    await w.editor.tick()
    posts = [r for r in w.env.discord.requests if r.path == f"/channels/{w.food_channel}/messages"]
    assert len(posts) == 1


async def test_without_the_pizza_flag_the_board_has_no_food_line(w: World) -> None:
    w.env.contexts["ev-a"]["flags"] = {}
    await w.editor.tick()
    assert "Food" not in text(w.board()[0])


async def test_an_archived_event_is_left_as_it_is(w: World) -> None:
    w.env.contexts["ev-a"]["status"] = "archived"
    await w.order_event("opened")
    await w.editor.tick()
    assert w.env.discord.messages == {}


async def test_the_living_messages_go_with_the_binding(w: World) -> None:
    await w.order_event("opened")
    await w.editor.tick()
    await unbind(w.d, "ev-a", "unbound", "u_org")
    assert await w.env.fetch("ev-a", "SELECT 1 FROM bot_posts") == []
