"""The one tooltip of the organiser pages (#782, docs/design/README.md decision 9), the twin of
packages/ui's tip.ts: the text sits beside its trigger as `role="tooltip"` and the trigger names it
with `aria-describedby`. ui.css shows it on hover and keyboard focus; admin's shell.js opens it on
a tap (an info button, a chip) or a long press (an icon button, whose tap still acts)."""

from __future__ import annotations

import itertools
import re

from .ui_base import esc, icon

# Unique within any page: the count only grows while the process runs.
_SEQ = itertools.count(1)
_FIRST_TAG = re.compile(r"^<([a-zA-Z][a-zA-Z0-9-]*)")


def _id() -> str:
    return f"canccu-tip-{next(_SEQ)}"


def _text(tip_id: str, words: str, hidden: bool = False) -> str:
    aria = ' aria-hidden="true"' if hidden else ""
    return f'<span role="tooltip" id="{tip_id}" class="canccu-tip__text"{aria}>{esc(words)}</span>'


def tooltip(trigger_html: str, words: str, *, repeats_label: bool = False) -> str:
    """Wraps a focusable trigger (its markup starts with its own tag) with a tooltip. A tooltip
    that only repeats the trigger's `aria-label` is hidden from screen readers instead of naming
    the trigger twice."""
    tip_id = _id()
    if repeats_label:
        return f'<span class="canccu-tip">{trigger_html}{_text(tip_id, words, hidden=True)}</span>'
    named = _FIRST_TAG.sub(rf'<\1 aria-describedby="{tip_id}"', trigger_html, count=1)
    return f'<span class="canccu-tip">{named}{_text(tip_id, words)}</span>'


def info_tip(words: str) -> str:
    """A small "i" button that explains the thing beside it."""
    tip_id = _id()
    return (
        '<span class="canccu-tip"><button type="button" class="canccu-tip__info"'
        f' aria-label="More about this" aria-describedby="{tip_id}">{icon("info")}</button>'
        f"{_text(tip_id, words)}</span>"
    )


def icon_button(
    name: str,
    label: str,
    *,
    href: str | None = None,
    type: str = "button",
    attrs: str = "",
) -> str:
    """An icon-only button; the tooltip repeats the label, so screen readers hear it once.
    `attrs` is extra attribute markup the caller escapes (a form's name and value)."""
    cls = "canccu-button canccu-button--ghost canccu-button--icon"
    extra = f" {attrs}" if attrs else ""
    if href is None:
        trigger = (
            f'<button type="{esc(type)}" class="{cls}" aria-label="{esc(label)}"{extra}>'
            f"{icon(name)}</button>"
        )
    else:
        trigger = (
            f'<a class="{cls}" href="{esc(href)}" aria-label="{esc(label)}"{extra}>{icon(name)}</a>'
        )
    return f'<span class="canccu-tip">{trigger}{_text(_id(), label, hidden=True)}</span>'


def status_chip(kind: str, label: str, words: str, *, focusable: bool = True) -> str:
    """A status chip (the shell's badge colours) whose tooltip says what the status means.
    `focusable` False for a chip inside a link: the link is the one tab stop, the chip's label is
    part of its text, and the tooltip still shows on hover."""
    tip_id = _id()
    tab = ' tabindex="0"' if focusable else ""
    return (
        f'<span class="canccu-tip"><span class="canccu-badge canccu-badge--{esc(kind)}"'
        f'{tab} aria-describedby="{tip_id}">{esc(label)}</span>'
        f"{_text(tip_id, words)}</span>"
    )
