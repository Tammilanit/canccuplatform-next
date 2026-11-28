"""The Commands tab (mockup 06 of the step 6 brief): the commands the server has for the event,
one row per feature, from the framework's own declarations (commands.COMMANDS), so a new command
shows here as it is registered. A feature's switch is the event's feature flag, written through
the tenants contract (`PUT /api/tenants/current/flags`, right `tenants.flags.write`); turning it
off removes its commands from the server (contracts/bot.md, Slash commands per guild).

The "Always on" row answers the product owner's remark on mockup 06: it names the commands with
no feature switch and says why they are always there."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from canccu_kit import ui
from canccu_kit.ui import esc

from .framework import Command
from .page_overview import commands_words
from .page_web import BASE, View, button, form, time_words

FLAGS_API = "/api/tenants/current/flags"
FLAGS_RIGHT = "tenants.flags.write"
LABELS = {"pizza.enabled": "Food", "screen.photos": "Photo wall", "bot.presence": "Who plays what"}
# A feature the bot serves with no command of its own: its switch is still the event's flag.
NO_COMMAND = {"bot.presence": "No command: counts for the screens, live names for the hub"}
ALWAYS_WHY = (
    "These belong to no feature switch, so they are on wherever the server is connected. "
    "Crew commands show to everyone; the right is checked when one is used."
)
FAILED = {
    "rate_limited": "Discord's daily limit on command writes was reached; it retries by itself.",
    "missing_access": "The bot lacks the commands scope there. Add it to the server again.",
    "discord_unavailable": "Discord did not answer; it retries by itself.",
}


def shown(command: Command) -> str:
    """`/ticker set · stop · schedule add`, or a message menu as Discord's Apps menu names it."""
    if command.menu:
        return f"Menu: {command.name}"
    if not command.subcommands:
        return f"/{command.name}"
    subs = [f"{s.group} {s.name}" if s.group else s.name for s in command.subcommands]
    return f"/{command.name} " + " · ".join(subs)


def who(commands: Iterable[Command]) -> str:
    rights = sorted({t.get("en", "") for c in commands for t in c.right_names.values()})
    return " · ".join(f"{r} right" for r in rights if r) or "Everyone"


def _switch(view: View, flag: str, on: bool, label: str) -> str:
    if not (view.writes and view.session.has(FLAGS_RIGHT)):
        state = (
            ("ok", "On", "The feature is on.") if on else ("plain", "Off", "The feature is off.")
        )
        return ui.status_chip(*state)
    version = view.ctx["flags_version"]
    body = (
        f'<input type="hidden" name="flags_version" value="{version}" data-bot-int>'
        f'<input class="canccu-switch" type="checkbox" data-bot-flag="{esc(flag)}"'
        f' data-bot-autosubmit aria-label="{esc(label)}"{" checked" if on else ""}>'
    )
    return form(FLAGS_API, "PUT", f"{BASE}/commands?done=switched", body)


def _row(lead: str, label: str, what: str, by: str, flag: str = "") -> str:
    """One feature's row; `lead` and `what` are HTML."""
    data = f' data-flag="{esc(flag)}"' if flag else ""
    return (
        f'<li class="bot-command"{data}><div class="bot-command__lead">{lead}</div>'
        f'<p class="bot-command__name">{esc(label)}</p>'
        f'<p class="bot-command__what">{what}</p>'
        f'<p class="bot-command__who canccu-muted canccu-small">{esc(by)}</p></li>'
    )


def rows(view: View, commands: tuple[Command, ...]) -> str:
    always = [c for c in commands if c.flag is None]
    by_flag: dict[str, list[Command]] = {}
    for c in commands:
        if c.flag is not None:
            by_flag.setdefault(c.flag, []).append(c)
    for flag in NO_COMMAND:
        by_flag.setdefault(flag, [])
    chip = ui.status_chip("plain", "Always", "No switch: on wherever the server is connected.")
    names = " · ".join(shown(c) for c in always)
    out = [
        f'<li class="bot-command bot-command--always"><div class="bot-command__lead">{chip}</div>'
        f'<p class="bot-command__name">Always on</p><div class="bot-command__what">'
        f"<p><code>{esc(names)}</code></p>"
        f'<p class="canccu-muted canccu-small">{esc(ALWAYS_WHY)}</p></div>'
        f'<p class="bot-command__who canccu-muted canccu-small">{esc(who(always))}</p></li>'
    ]
    for flag, group in by_flag.items():
        label = LABELS.get(flag, flag)
        on = view.ctx["flags"].get(flag) is True
        what = f"<code>{esc(' · '.join(shown(c) for c in group))}</code>"
        if not group:
            what = esc(NO_COMMAND.get(flag, ""))
        by = who(group) if group else "—"
        out.append(_row(_switch(view, flag, on, label), label, what, by, flag))
    return f'<ul class="bot-commands">{"".join(out)}</ul>'


def head(view: View, binding: dict[str, Any], counts: tuple[int, int]) -> str:
    """Where the set stands in the server, and Sync now for a set someone removed by hand."""
    state = binding["commands"]
    sync = ""
    if view.writes:
        sync = form(
            "/api/bot/guild/commands/sync",
            "POST",
            f"{BASE}/commands?done=synced",
            button("Sync now"),
        )
    if state["status"] == "failed":
        text = FAILED.get(state["error_code"] or "", "Discord refused them; sync to try again.")
        status = ui.notice("down", "The commands are not registered", text)
    else:
        words = commands_words(counts)
        if state["registered_at"] and state["status"] == "registered":
            at = time_words(state["registered_at"], view.zone, view.now)
            line = f"Registered in {binding['guild_name']} at {at} · {words}"
        else:
            line = f"Being registered in {binding['guild_name']} · {words}"
        status = f'<p class="bot-check-head">{ui.icon("check-circle")}{esc(line)}</p>'
    about = (
        '<p class="canccu-muted canccu-small">Names and help in English and Finnish. '
        "A feature's switch is the event's own: off, its commands leave the server.</p>"
    )
    return f'<div class="bot-bar"><div>{status}{about}</div>{sync}</div>'


def body(
    view: View, binding: dict[str, Any], commands: tuple[Command, ...], counts: tuple[int, int]
) -> str:
    return head(view, binding, counts) + rows(view, commands)
