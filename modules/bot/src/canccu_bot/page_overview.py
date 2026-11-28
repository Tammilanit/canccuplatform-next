"""The Overview tab (mockup 13 of the step 6 brief): six cards on the bot's health in words the
crew understands, and what happened, each line from what the module already keeps (the client's
status, the binding, the commands, the last check). It never names a Discord id, a token, a member
or who set off a rate limit (O6). Above them, an edge state in words with its one next step
(mockup 15)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from canccu_kit import ui
from canccu_kit.ui import esc

from .page_web import BASE, View, button, form, link, time_words

FEATURE_LABELS = {
    "announcements": "Announcements",
    "now_and_next": "Now and next",
    "food": "Food",
    "photos": "Photos to the screen",
    "crew": "Crew posts",
    "tournaments": "Tournaments",
    "presence": "Who plays what",
    "roles": "Crew and attendee roles",
}
STATUS_WORDS = {
    "ready": "Ready",
    "connecting": "Connecting",
    "rate_limited": "Slowed by Discord",
    "paused": "Paused",
    "failed": "Stopped",
}
# A card's icon and badge colour by how it stands: fine, needs a look, or not working.
MARKS = {"ok": ("ok", "check-circle"), "warn": ("degraded", "warn"), "down": ("down", "alert")}


@dataclass
class Overview:
    """What the tab reads: the `Connection`, the last minute counted, the last check kept, the
    commands of the event's flags and how the last binding ended."""

    conn: dict[str, Any]
    counted: Any
    check: dict[str, Any] | None
    commands: tuple[int, int]
    """(slash commands, message menus) the server has for the event's flags."""
    ended: dict[str, Any] | None
    now: datetime


def _card(name: str, state: str, title: str, line: str, href: str = "") -> str:
    kind, ico = MARKS.get(state, ("plain", "info"))
    mark = f'<span class="bot-mark bot-mark--{kind}">{ui.icon(ico)}</span>' if state else ""
    more = f'<a class="bot-card-link" href="{esc(href)}">Open {esc(name)}</a>' if href else ""
    return (
        f'<li class="canccu-card bot-card bot-card--{kind}"><div class="bot-card__head">'
        f'<p class="canccu-overline">{esc(name)}</p>{mark}</div>'
        f'<p class="bot-card__title">{esc(title)}</p>'
        f'<p class="canccu-muted canccu-small">{esc(line)}</p>{more}</li>'
    )


def _bot_card(view: View, o: Overview) -> str:
    client = o.conn["client"]
    who = "The platform's bot" if o.conn["mode"] == "shared" else "Your own application"
    status = STATUS_WORDS.get(client["status"], "Connecting")
    state = {"ready": "ok", "failed": "down", "paused": "down"}.get(client["status"], "warn")
    since = f"Since {time_words(client['since'], view.zone, o.now)}" if client.get("since") else ""
    line = " · ".join(p for p in (since, f"named {view.name} here") if p)
    return _card("Bot", state, f"{who} · {status}", line)


def _server_card(view: View, o: Overview) -> str:
    guild = o.conn["guild"]
    if guild is None:
        return _card("Server", "warn", "Not connected", "No server is bound to the event.")
    bound = guild["bound_at"]
    line = f"Bound {time_words(bound, view.zone, o.now)}" if bound else "Bound"
    return _card("Server", "ok", guild["guild_name"], line)


def commands_words(commands: tuple[int, int]) -> str:
    slash, menus = commands
    return f"{slash} command{'s' if slash != 1 else ''}, {menus} menu{'s' if menus != 1 else ''}"


def _commands_card(view: View, o: Overview) -> str:
    guild = o.conn["guild"]
    state, text = guild["commands"]["status"], commands_words(o.commands)
    href = f"{BASE}/commands"
    if view.archived or state == "removed":
        return _card("Commands", "", "Removed", "An archived event has no commands.", href)
    if state == "failed":
        return _card("Commands", "down", "Not registered", "Sync again on Commands.", href)
    if state == "pending" or guild["commands"]["registered_at"] is None:
        return _card("Commands", "warn", text, "Being registered.", href)
    when = time_words(guild["commands"]["registered_at"], view.zone, o.now)
    return _card("Commands", "ok", text, f"Registered {when} · English and Finnish", href)


def _activity_card(view: View, o: Overview) -> str:
    if view.ctx["flags"].get("bot.presence") is not True:
        return _card("Activity", "", "Who plays what is off", "Nothing is counted.")
    if o.counted is None:
        return _card("Activity", "", "Waiting for a count", "The first comes within a minute.")
    when = time_words(o.counted["minute"], view.zone, o.now)
    return _card("Activity", "ok", f"Counting · {o.counted['online']} online", f"Last count {when}")


def _posts_card(o: Overview) -> str:
    """How the event's sends fare, from its client: one event's trouble stays its own."""
    status = o.conn["client"]["status"]
    if status == "rate_limited":
        return _card("Posts and DMs", "warn", "Slowed by Discord", "Waiting posts go out in order.")
    if status in ("failed", "paused"):
        return _card("Posts and DMs", "down", "Not sent", "They wait until the bot is back.")
    if status == "connecting":
        return _card("Posts and DMs", "warn", "Waiting", "Sent once the bot is connected.")
    return _card("Posts and DMs", "ok", "Sent as they come", "Nothing is waiting.")


def _check_card(view: View, o: Overview) -> str:
    href = f"{BASE}/check"
    if o.check is None:
        return _card("Check", "warn", "Not run yet", "It lists what the bot lacks.", href)
    gaps = [f for f in o.check["features"] if f["state"] == "gaps"]
    when = time_words(o.check["checked_at"], view.zone, o.now)
    if not gaps:
        return _card("Check", "ok", "Everything ready", f"Checked {when}", href)
    count = o.check["gaps"]
    title = f"{count} thing{'s' if count != 1 else ''} to fix"
    names = " · ".join(FEATURE_LABELS.get(f["feature"], f["feature"]) for f in gaps)
    return _card("Check", "warn", title, names, href)


def cards(view: View, o: Overview) -> str:
    """The six cards, in the auto-fill grid (design amendment 3)."""
    parts = (
        _bot_card(view, o),
        _server_card(view, o),
        _commands_card(view, o),
        _activity_card(view, o),
        _posts_card(o),
        _check_card(view, o),
    )
    return f'<ul class="canccu-grid bot-cards">{"".join(parts)}</ul>'


def _client_line(client: dict[str, Any]) -> tuple[str, str]:
    code, status = client.get("error_code"), client["status"]
    if code == "token_invalid":
        return "down", "The bot stopped: Discord refused its token."
    if code == "intents_missing":
        return "warn", "The bot connected without the Presence intent."
    if code == "discord_unavailable":
        return "warn", "Discord stopped answering; the bot keeps trying."
    if status == "rate_limited":
        return "warn", "Discord slowed the bot's posts; they go out in order."
    if status == "paused":
        return "down", "The bot paused after too many refused requests."
    return ("ok", "The bot connected.") if status == "ready" else ("warn", "The bot is connecting.")


def history(view: View, o: Overview) -> str:
    """What happened, newest first: the last of each kind of change the module keeps."""
    lines: list[tuple[str, str, str]] = []
    client = o.conn["client"]
    if client.get("since"):
        lines.append((client["since"], *_client_line(client)))
    guild = o.conn["guild"]
    if guild is not None:
        registered = guild["commands"]["registered_at"]
        if registered:
            words = f"Commands registered: {commands_words(o.commands)}."
            lines.append((registered, "ok", words))
        if guild["bound_at"]:
            lines.append((guild["bound_at"], "ok", f"{guild['guild_name']} bound."))
    credentials = o.conn["credentials"]
    if credentials and credentials["updated_at"]:
        lines.append(
            (credentials["updated_at"], "ok", "The own application's credentials changed.")
        )
    if o.check is not None:
        gaps = o.check["gaps"]
        words = (
            f"Checked: {gaps} thing{'s' if gaps != 1 else ''} to fix."
            if gaps
            else "Checked: everything ready."
        )
        lines.append((o.check["checked_at"], "warn" if gaps else "ok", words))
    if o.ended is not None and guild is None:
        lines.append((o.ended["at"], "warn", _ended_words(o.ended)))
    lines.sort(key=lambda line: str(line[0]), reverse=True)
    items = "".join(
        f'<li><span class="canccu-muted">{esc(time_words(at, view.zone, o.now))}</span>'
        f'<span><span class="bot-dot bot-dot--{kind}" aria-hidden="true"></span>'
        f"{esc(text)}</span></li>"
        for at, kind, text in lines
    )
    return (
        '<section><h2 class="bot-h2">What happened</h2>'
        f'<ul class="canccu-history bot-history">{items}</ul>'
        '<p class="canccu-muted canccu-small">Never shown: tokens, Discord ids, who set off a '
        "rate limit, or anyone who hid their activity.</p></section>"
    )


def _ended_words(ended: dict[str, Any]) -> str:
    guild = ended.get("guild_name") or "The server"
    if ended.get("reason") == "bot_removed":
        return f"{guild} removed the bot."
    if ended.get("reason") == "superadmin":
        return f"{guild} was unbound by the platform's support."
    return f"{guild} was unbound."


def edge(view: View, o: Overview | None, conn: dict[str, Any] | None) -> str:
    """The one state that needs a look first, in words with its next step (mockup 15)."""
    if view.archived:
        text = "The bot reads nothing more for it, and an ended event takes no new server."
        if conn is not None and conn["guild"] is not None:
            text = (
                "The bot reads nothing more; its commands are gone. The server stays for the "
                "next event of the series, which takes it over when it is cloned."
            )
        return ui.notice("info", f"{view.name} is archived", text)
    if conn is None:
        return ""
    client = conn["client"]
    fix = view.admin
    if client.get("error_code") == "token_invalid" and conn["mode"] == "own":
        text = (
            "It was reset in the Developer Portal. Paste the new token; nothing is retried "
            "until then."
        )
        action = link(f"{BASE}/setup#own", "Paste a new token", "primary") if fix else ""
        return ui.notice("down", "The bot stopped: Discord refused its token", text, action)
    if o is not None and o.ended is not None and conn["guild"] is None:
        return _ended_notice(view, o)
    if client.get("error_code") == "discord_unavailable":
        since = time_words(client["since"], view.zone, o.now if o else client["since"])
        text = (
            "Posts are not kept for later; the screens and the hub work as usual. The bot "
            "reconnects by itself."
        )
        return ui.notice("warn", f"Discord has not answered since {since}", text)
    if client.get("error_code") == "intents_missing" and view.ctx["flags"].get("bot.presence"):
        who = "your application" if conn["mode"] == "own" else "the platform's bot"
        text = (
            f"Discord gives {who} no Presence intent. Turn it on under Bot in the Developer "
            "Portal; the bot takes it up when it next connects."
        )
        if conn["mode"] == "shared":
            text = "The platform's bot has no Presence intent. Ask the platform's operator."
        return ui.notice("warn", "Who plays what is off", text)
    return ""


def _ended_notice(view: View, o: Overview) -> str:
    assert o.ended is not None
    guild = o.ended.get("guild_name") or "The server"
    at = time_words(o.ended["at"], view.zone, o.now)
    action = link(f"{BASE}/setup#add", "Add it again", "primary") if view.writes else ""
    if o.ended.get("reason") == "bot_removed":
        text = (
            "Someone with Manage Server removed it, which unbinds the server. Add it again to "
            "reconnect."
        )
        return ui.notice("warn", f"{guild} removed the bot at {at}", text, action)
    if o.ended.get("reason") == "superadmin":
        text = "The platform's support unbound it. Add it again to reconnect."
        return ui.notice("warn", f"{guild} was unbound at {at}", text, action)
    return ""


def unbind_form(view: View, conn: dict[str, Any]) -> str:
    """Unbinding, the event admin's way to end the binding; it also works on an archived event,
    since it deletes data (contracts/bot.md, Archived events)."""
    guild = conn["guild"]
    if guild is None or not view.admin:
        return ""
    ask = f"Unbind {guild['guild_name']}? The bot stops serving it and its commands go."
    return form(
        "/api/bot/guild",
        "DELETE",
        f"{BASE}/?done=unbound",
        button(f"Unbind {guild['guild_name']}", "danger-ghost"),
        cls="bot-unbind",
        confirm=ask,
    )
