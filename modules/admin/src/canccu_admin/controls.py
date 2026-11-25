"""The control for each kind of declared setting (#732): a choice from a list is a dropdown (time
zones by region), a list from choices a row of chips, a whole number a stepper with its unit and,
for a duration, quick picks, a colour a swatch and a link a URL field with a preview. Free text
stays a text field. settings.js drives the buttons; without it each control still posts."""

from __future__ import annotations

import html
from typing import Any

from canccu_kit.ui import tooltip

from .declarations import URL_RE, Setting
from .zones import zone_groups, zone_label

# Durations people pick most, per unit; a field offers the ones inside its bounds.
_PICKS = {
    "seconds": (5, 10, 15, 30, 45, 60, 90, 120, 300, 600, 1800, 3600),
    "minutes": (1, 5, 10, 15, 30, 60, 90, 120, 240, 480, 720, 1440),
}
_MOST_PICKS = 6


def _option(value: str, words: str, selected: bool = False) -> str:
    mark = " selected" if selected else ""
    return f'<option value="{html.escape(value)}"{mark}>{html.escape(words)}</option>'


def select(s: Setting, value: Any, words: Any, attrs: str) -> str:
    """A dropdown of the declared choices, in `words` (the form's words for a value)."""
    opts = "".join(_option(c, words(c), c == value) for c in s.choices)
    return f'<select class="canccu-input" {attrs}>{opts}</select>'


def zone_select(value: str, attrs: str) -> str:
    """Time zones by region. The event's own zone heads a Suggested group (with UTC, and this
    device's zone, which settings.js adds: the organiser is usually where the event is), so the
    likely answer is first; a saved zone the list leaves out (an old alias) is still there."""
    suggested = [value] + ([] if value == "UTC" else ["UTC"])
    head = "".join(_option(z, zone_label(z), z == value) for z in suggested)
    regions = "".join(
        f'<optgroup label="{html.escape(region)}">'
        + "".join(_option(zone, city) for zone, city in zones)
        + "</optgroup>"
        for region, zones in zone_groups()
    )
    return (
        f'<select class="canccu-input" {attrs}>'
        f'<optgroup label="Suggested">{head}</optgroup>{regions}</select>'
    )


def chips(
    s: Setting, value: list[Any], words: Any, label: str, marks: str, rest: str, tip: str = ""
) -> str:
    """A list from choices: one chip per choice, ticked when listed. The fieldset is the field,
    and settings.js reads it as the ticked values in the declared order."""
    name = html.escape(s.key)
    items = "".join(
        f'<label class="canccu-chip"><input type=checkbox name="{name}" value="{html.escape(c)}"'
        f"{' checked' if c in value else ''}>{html.escape(words(c))}</label>"
        for c in s.choices
    )
    return (
        f'<fieldset class="canccu-field"{marks} data-canccu-chips>'
        f'<legend class="canccu-field__label">{html.escape(label)}</legend>{tip}'
        f'<div class="canccu-chips">{items}</div>{rest}</fieldset>'
    )


def _duration(n: int, unit: str) -> str:
    seconds = n * 60 if unit == "minutes" else n
    if seconds and seconds % 3600 == 0:
        return f"{seconds // 3600} h"
    if seconds % 60 == 0 and seconds >= 60:
        return f"{seconds // 60} min"
    return f"{seconds} s"


def picks(s: Setting, unit: str, fid: str) -> str:
    """Quick picks of a duration inside the bounds, at most six, spread over the range."""
    fits = [
        n
        for n in _PICKS.get(unit, ())
        if (s.min is None or n >= s.min) and (s.max is None or n <= s.max)
    ]
    if len(fits) > _MOST_PICKS:
        last = len(fits) - 1
        fits = [fits[round(i * last / (_MOST_PICKS - 1))] for i in range(_MOST_PICKS)]
    buttons = "".join(
        f'<button type=button class="canccu-chip" data-canccu-for="{fid}" data-canccu-pick={n}>'
        f"{_duration(n, unit)}</button>"
        for n in fits
    )
    return f'<div class="canccu-chips canccu-field__picks">{buttons}</div>' if buttons else ""


def stepper(control: str, fid: str) -> str:
    """Less and More around a whole number: the browser's own steps, inside the bounds."""

    def button(step: int, words: str, sign: str) -> str:
        return tooltip(
            f'<button type=button class="canccu-stepper__button" data-canccu-step={step} '
            f'data-canccu-for="{fid}" aria-label="{words}">{sign}</button>',
            words,
            repeats_label=True,
        )

    less, more = button(-1, "Less", "&minus;"), button(1, "More", "+")
    return f'<span class="canccu-stepper">{less}{control}{more}</span>'


def swatch(fid: str, name: str, value: str, marks: str) -> str:
    return (
        f'<input class="canccu-swatch" type=color id={fid} name={name} '
        f'value="{html.escape(value)}"{marks}>'
    )


def preview(value: str) -> str:
    """The link a URL field holds, to open beside the form; settings.js follows the typing."""
    page = value if URL_RE.fullmatch(value) else ""
    shown = "" if page else " hidden"
    return (
        f'<a class="canccu-field__preview" data-canccu-preview{shown} href="{html.escape(page)}" '
        f'target=_blank rel="noopener noreferrer">{html.escape(f"Open {page}" if page else "")}</a>'
    )
