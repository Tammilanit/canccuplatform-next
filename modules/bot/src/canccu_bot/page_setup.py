"""The guided setup's first two steps (mockup 02 of the step 6 brief): which bot speaks for the
event, then adding it to the server through Discord's own install page (contracts/bot.md, Binding
a guild). Steps 3 and 4 are the Channels and Check tabs with the steps above them."""

from __future__ import annotations

from typing import Any

from canccu_kit import ui
from canccu_kit.ui import esc

from .bind_page import WORDS
from .page_web import BASE, View, button, form, link, time_words

# Discord's own help for someone with no server yet: the bot joins a server, it never makes one.
NEW_SERVER = "https://support.discord.com/hc/en-us/articles/204849977-How-do-I-create-a-server"
CONNECTION = "/api/bot/connection"
SHARED_LINES = (
    "Ready now: nothing to create.",
    "Named {name} in your server.",
    "Shares Discord's limits with other events.",
)
OWN_LINES = (
    "Your own name and picture.",
    "Paste its bot token and client secret.",
    "Its own limits; an outage stays yours.",
)
WHAT_IT_DOES = (
    "Posts announcements, the run of show and food updates in the channels you pick, and edits "
    "its own posts. Sends the DMs people chose. Counts who is online, never storing names."
)


def _lines(lines: tuple[str, ...], name: str) -> str:
    return "".join(f"<li>{esc(line.format(name=name))}</li>" for line in lines)


def _field(label: str, name: str, value: str, hint: str, *, secret: bool, required: bool) -> str:
    kind = "password" if secret else "text"
    attrs = ' autocomplete="off"' if secret else ' inputmode="numeric" pattern="[0-9]{17,20}"'
    need = " required" if required else ""
    return (
        f'<label class="canccu-field"><span class="canccu-field__label">{esc(label)}</span>'
        f'<input class="canccu-input" type="{kind}" name="{name}" value="{esc(value)}"'
        f"{attrs}{need}>"
        f'<span class="canccu-field__hint">{esc(hint)}</span></label>'
    )


def _own_form(view: View, conn: dict[str, Any] | None) -> str:
    """The own application's id and credentials; for the one in use only what changes (a new
    token after Discord refused the old one), the other kept as stored."""
    own = conn is not None and conn["mode"] == "own"
    revision = conn["revision"] if conn else 0
    fields = (
        _field(
            "Application ID",
            "application_id",
            conn["application_id"] if own and conn else "",
            "Developer Portal → General Information.",
            secret=False,
            required=True,
        )
        + _field(
            "Bot token",
            "bot_token",
            "",
            "Bot → Reset Token. Never shown again here." if not own else "Only a new one.",
            secret=True,
            required=not own,
        )
        + _field(
            "Client secret",
            "client_secret",
            "",
            "OAuth2 → Client Secret." if not own else "Only a new one.",
            secret=True,
            required=not own,
        )
    )
    hidden = (
        '<input type="hidden" name="mode" value="own">'
        f'<input type="hidden" name="revision" value="{revision}" data-bot-int>'
    )
    label = "Save the new credentials" if own else "Use this application"
    body = f'<div class="canccu-form">{fields}{hidden}<div>{button(label, "primary")}</div></div>'
    return form(CONNECTION, "PUT", f"{BASE}/setup?done=bot#add", body)


def _choice(
    title: str, lines: str, *, current: bool, disabled: bool, extra: str, anchor: str
) -> str:
    state = " bot-choice--current" if current else (" bot-choice--off" if disabled else "")
    mark = (
        ui.status_chip("ok", "In use", "The bot that speaks for the event now.") if current else ""
    )
    return (
        f'<section class="canccu-card bot-choice{state}" id="{anchor}">'
        f'<h3 class="canccu-card__title"><span class="bot-radio" aria-hidden="true"></span>'
        f'{esc(title)} {mark}</h3><ul class="bot-lines">{lines}</ul>{extra}</section>'
    )


def choose_bot(view: View, conn: dict[str, Any] | None, no_shared: bool) -> str:
    """Step 1: the platform's bot or the event's own application (mockup 02, A)."""
    shared_now = conn is not None and conn["mode"] == "shared"
    own_now = conn is not None and conn["mode"] == "own"
    shared_extra = ""
    if no_shared:
        shared_extra = '<p class="canccu-muted">This platform has no bot of its own.</p>'
    elif own_now and view.admin:
        revision = conn["revision"] if conn else 0
        back = (
            '<input type="hidden" name="mode" value="shared">'
            f'<input type="hidden" name="revision" value="{revision}" data-bot-int>'
            + button("Use the platform's bot")
        )
        ask = "Your own application's token and secret are erased. Use the platform's bot?"
        shared_extra = form(CONNECTION, "PUT", f"{BASE}/setup?done=bot", back, confirm=ask)
    own_extra = ""
    if own_now and conn is not None and conn["credentials"]:
        changed = conn["credentials"]["updated_at"]
        when = f", changed {time_words(changed, view.zone, view.now)}" if changed else ""
        own_extra = f'<p class="canccu-muted">Token and secret are set{esc(when)}.</p>'
    if view.writes:
        own_extra += _own_form(view, conn)
    shared = _choice(
        "The platform's bot (recommended)",
        _lines(SHARED_LINES, view.name),
        current=shared_now,
        disabled=no_shared,
        extra=shared_extra,
        anchor="shared",
    )
    own = _choice(
        "Your own Discord application",
        _lines(OWN_LINES, view.name),
        current=own_now,
        disabled=False,
        extra=own_extra,
        anchor="own",
    )
    question = f"Which bot speaks for {view.name}?"
    return (
        f'<section><h2 class="bot-h2">{esc(question)}</h2>'
        f'<div class="canccu-grid">{shared}{own}</div></section>'
    )


def add_to_server(view: View, conn: dict[str, Any] | None) -> str:
    """Step 2: Discord's install page, where the person picks a server they hold Manage Server
    on; Discord sends them back to this page with the result."""
    guild = conn["guild"] if conn else None
    head = '<h2 class="bot-h2" id="add">Step 2 · Add it to your server</h2>'
    if guild is not None:
        text = f"Added to {guild['guild_name']}. Next: channels and roles."
        go = link(f"{BASE}/channels?setup=1", "Continue", "primary")
        return f"<section>{head}{ui.notice('ok', text, '', go)}</section>"
    lead = (
        '<p class="bot-lead">Discord opens and asks which server. You need Manage Server there; '
        "the bot gets only the permissions your features need (step 4 lists them). You come back "
        "here when it is done.</p>"
    )
    actions = ""
    if view.writes and conn is not None:
        actions = form(
            "/api/bot/guild/bind", "POST", f"{BASE}/", button("Add to Discord", "primary")
        )
    elif not view.admin:
        actions = '<p class="canccu-muted">Ask an event admin to connect it.</p>'
    none_yet = link(NEW_SERVER, "I have no server yet")
    about = (
        '<section class="canccu-card bot-about"><h3 class="canccu-card__title">'
        f"What the bot will do in your server</h3><p>{esc(WHAT_IT_DOES)}</p></section>"
    )
    step = f'{head}{lead}<div class="canccu-cluster">{actions}{none_yet}</div>'
    return f"<section>{step}</section>{about}"


def bind_result(outcome: str | None, conn: dict[str, Any] | None) -> str:
    """What Discord's install page came back with (`bind=`), in the words of bind_page.WORDS."""
    if outcome is None:
        return ""
    guild = conn["guild"] if conn else None
    if outcome == "ok" and guild is not None:
        return ui.notice(
            "ok",
            f"Added to {guild['guild_name']}",
            "The commands are registered. Next: channels and roles.",
            link(f"{BASE}/channels?setup=1", "Continue", "primary"),
        )
    kind, title, text = WORDS.get(outcome, ("down", "Discord said no", "Try again in a moment."))
    return ui.notice(kind if outcome != "ok" else "down", f"Not bound: {title}", text)


def body(view: View, conn: dict[str, Any] | None, no_shared: bool, lead: str) -> str:
    """The setup's page: the steps, then step 1 and step 2 on one page (mockup 02, A)."""
    return f"{lead}{choose_bot(view, conn, no_shared)}{add_to_server(view, conn)}"
