"""The Settings form of one part (docs/design/mockups.html, sheet 4): its declared settings in
their groups, a card each, and the save bar. settings.js keeps the bar's count and each "Was 45."
in step with the form and saves without leaving the page, so a save that fails keeps the change;
without the script the form posts as usual and the server answers the same states."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from canccu_kit import KitError, VersionConflict
from canccu_kit.ui import esc, notice

from .declarations import Group, Setting
from .forms import control_value, field_html
from .pages import BASE

UNANSWERED = "The platform didn't answer. Your change is still in the form."


def _shown(s: Setting, values: Mapping[str, Any]) -> str:
    value = values.get(s.key)
    return control_value(s, s.default if value is None else value)


def kept_after_conflict(
    settings: list[Setting], form: Any, typed: Mapping[str, Any], stored: Mapping[str, Any]
) -> dict[str, Any]:
    """After a conflict, only the fields the user changed keep what they typed; the rest show
    what is saved now, so saving again never puts back a value someone else just changed. A
    field changed if it differs from the value the form was built from (its `was.<key>`); a post
    without one (an older page) keeps what was typed."""
    out = dict(typed)
    for s in settings:
        was = form.get(f"was.{s.key}")
        if was is not None and control_value(s, typed.get(s.key)) == was:
            out[s.key] = stored.get(s.key)
    return out


def changes(settings: list[Setting], values: Mapping[str, Any], stored: Mapping[str, Any]) -> int:
    return sum(_shown(s, values) != _shown(s, stored) for s in settings)


def _fields(settings: list[Setting], values: Mapping[str, Any], stored: Mapping[str, Any]) -> str:
    """The group's fields in order; two numbers in a row share it, as the sheet pairs them."""
    out: list[str] = []
    pair: list[str] = []
    for s in settings:
        field = field_html(s, values.get(s.key), stored.get(s.key))
        if s.type in ("integer", "number"):
            pair.append(field)
            if len(pair) == 2:
                out.append(f'<div class="canccu-form__row">{"".join(pair)}</div>')
                pair = []
            continue
        out.extend(pair)
        pair = []
        out.append(field)
    return "".join(out + pair)


def failure(settings: list[Setting], exc: KitError) -> str:
    """Why a save failed, in words: a setting by its label, never its key (UX audit A2)."""
    if isinstance(exc, VersionConflict):
        return (
            "Someone else saved these settings while you were editing. Your changes are still "
            "in the form: check them and save again."
        )
    message = exc.message
    for s in settings:
        if message.startswith(f"{s.key} "):
            message = s.label + message.removeprefix(s.key)
            break
    return f"{message[:1].upper()}{message[1:]}. Your change is still in the form."


def settings_form(
    settings: list[Setting],
    groups: list[Group],
    values: Mapping[str, Any],
    stored: Mapping[str, Any],
    version: int,
    href: str,
    *,
    saved: bool = False,
    failed: str = "",
) -> str:
    """`values` are what the fields hold (the saved values, or a failed save's), `stored` what
    is saved; `href` is the form's own page, where Undo goes without the script."""
    by_key = {s.key: s for s in settings}
    cards = "".join(
        f'<section class="canccu-card"><h2 class="canccu-card__title">{esc(g.label)}</h2>'
        + (f'<p class="canccu-card__desc">{esc(g.description)}</p>' if g.description else "")
        + f'<div class="canccu-form">{_fields([by_key[k] for k in g.keys], values, stored)}'
        "</div></section>"
        for g in groups
    )
    # Saved and a change are never shown together (sheet 4): the script hides Saved at the first
    # edit, and keeps the unanswered notice for a save that never reached the platform.
    notices = (
        f"<div data-canccu-saved>{notice('ok', 'Saved', 'The change applies now.')}</div>"
        if saved
        else ""
    )
    if failed:
        notices += f"<div data-canccu-failed>{notice('down', "Couldn't save", failed)}</div>"
    notices += (
        f"<div data-canccu-unanswered hidden>{notice('down', "Couldn't save", UNANSWERED)}</div>"
    )
    # The values the form is built from, posted back so a conflict can tell what the user changed
    # (kept_after_conflict); the controls' data-canccu-was hold the same words for settings.js.
    bases = "".join(
        f'<input type=hidden name="was.{esc(s.key)}" value="{esc(_shown(s, stored))}">'
        for s in settings
    )
    n = changes(settings, values, stored)
    words = f"{n} {'change' if n == 1 else 'changes'} not saved" if n else "Not saved yet"
    bar = (
        '<div class="canccu-savebar" data-canccu-savebar>'
        f'<span class="canccu-savebar__text" data-canccu-count>{words}</span>'
        f'<a class="canccu-button canccu-button--ghost" href="{esc(href)}" data-canccu-undo>'
        "Undo</a>"
        '<button class="canccu-button canccu-button--primary" data-canccu-save>'
        f"{'Save again' if failed else 'Save'}</button></div>"
    )
    return (
        '<form method=post class="canccu-settings" data-canccu-settings>'
        f"<input type=hidden name=settings_version value={version}>{bases}{notices}{cards}{bar}"
        "</form>"
        f'<script src="{BASE}/static/settings.js" defer></script>'
    )
