"""HTML form fields for declared settings, and the parsing of a posted form back."""

from __future__ import annotations

import html
import re
from typing import Any

from . import controls
from .declarations import Setting
from .service import BadSettings
from .zones import zone_label

_UNIT = re.compile(r"^(.*\S)\s*\(([^()]+)\)$")


_LANGUAGES = {"en": "English", "fi": "Finnish"}


def _words(value: str) -> str:
    """A choice's value as words: `high_contrast` reads "High contrast", `en` "English"."""
    return _LANGUAGES.get(value) or value.replace("_", " ").capitalize()


_SAME = object()


def label_parts(s: Setting) -> tuple[str, str]:
    """The label's words and its unit: a trailing "(seconds)" is the unit, and a declared `short`
    stands in for the words (sheet 4: "Heartbeat", not "Screen heartbeat")."""
    words, unit = s.label, ""
    if match := _UNIT.match(s.label):
        words, unit = match.group(1), match.group(2)
    return s.short or words, unit


def required(s: Setting) -> bool:
    """An emptied field has no value to save: a number always needs one, and so does text unless
    empty is what it starts as (an asset id left empty means none)."""
    return s.type in ("integer", "number") or (s.type == "string" and s.default not in (None, ""))


def control_value(s: Setting, value: Any) -> str:
    """What the field's control holds for a value, in the words settings.js reads it back: a
    list as "30, 10" however it was typed (chips in the declared order), a box "on" or nothing,
    a colour in the lower case a swatch gives."""
    if s.type == "boolean":
        return "on" if value else ""
    if s.type == "list" and s.choices and isinstance(value, list):
        value = _in_order(s, [str(v) for v in value])
    if isinstance(value, list):
        return ", ".join(map(str, value))
    if s.type == "list" and isinstance(value, str):
        return ", ".join(p.strip() for p in value.split(",") if p.strip())
    if s.format == "color" and isinstance(value, str):
        return value.lower()
    return "" if value is None else str(value)


def _in_order(s: Setting, got: list[str]) -> list[str]:
    """Chips post in page order; anything not a choice stays, for check_values to refuse."""
    return [c for c in s.choices if c in got] + [v for v in got if v not in s.choices]


def shown_words(s: Setting, value: Any) -> str:
    """A value as the form says it: "on", "English", "Europe / Helsinki", "30, 10"."""
    if s.type == "boolean":
        return "on" if value else "off"
    shown = control_value(s, value)
    if s.choices_from == "timezones":
        return zone_label(shown)
    if s.choices and s.type == "string" and shown:
        return _words(shown)
    if s.choices and s.type == "list" and isinstance(value, list):
        return ", ".join(_words(v) for v in _in_order(s, [str(v) for v in value]))
    return shown


def _was(s: Setting, was: Any) -> str:
    return f"Was {shown_words(s, was) or 'empty'}."


def _default(s: Setting) -> str:
    """The default in the form's words; a setting with none, or none to show, says nothing."""
    if s.default is None or s.default == "" or s.default == []:
        return ""
    return f"Default: {shown_words(s, s.default)}."


def _error(s: Setting) -> str:
    """What settings.js says under a field the browser finds out of bounds; an emptied one it
    tells "Needs a value." instead."""
    if s.type == "string":
        return "Needs a value."
    if s.type == "number":
        return "Use a number."
    if s.min is not None and s.max is not None:
        return f"Use a whole number from {s.min} to {s.max}."
    if s.min is not None:
        return f"Use a whole number of {s.min} or more."
    if s.max is not None:
        return f"Use a whole number up to {s.max}."
    return "Use a whole number."


def field_html(s: Setting, value: Any, was: Any = _SAME) -> str:
    """A declared setting as a packages/ui form field with the control for its kind (controls.py):
    its label (a trailing "(seconds)" is the unit), then under it what it is for, an integer's
    bounds and the default (UX audit A4, #732). `was` is the saved value: its words show under
    the field while the control differs from it ("Was 45.", sheet 4)."""
    fid, name = f"canccu-field-{html.escape(s.key)}", html.escape(s.key)
    value = s.default if value is None else value
    was = value if was is _SAME else (s.default if was is None else was)
    saved = control_value(s, was)
    hidden = "" if control_value(s, value) != saved else " hidden"
    was_html = (
        f'<p class="canccu-field__hint" data-canccu-was-hint{hidden}>{html.escape(_was(s, was))}'
        "</p>"
    )
    marks = f' data-canccu-was="{html.escape(saved)}"'
    if s.type == "boolean":
        checked = " checked" if value else ""
        return (
            f'<div class="canccu-field canccu-field--check"><input class="canccu-switch" '
            f"type=checkbox role=switch id={fid} name={name}{checked}{marks}>"
            f'<label class="canccu-field__label" for={fid}>{html.escape(s.short or s.label)}'
            f"</label>{was_html}{_help(s)}</div>"
        )
    label, unit = label_parts(s)
    if s.type == "list" and s.choices:
        listed = value if isinstance(value, list) else []
        if unit:
            label = f"{label} ({unit})"
        return controls.chips(s, listed, _words, label, marks, was_html + _help(s))
    hint, after = "", ""
    attrs = f"id={fid} name={name}{marks}"
    if s.choices_from == "timezones":
        control = controls.zone_select(str(value), f"id={fid} name={name} data-canccu-zones{marks}")
    elif s.choices and s.type == "string":
        control = controls.select(s, value, _words, attrs)
    elif s.format == "color":
        control = controls.swatch(fid, name, control_value(s, value), marks)
    else:
        control, hint = _input(s, value, fid, name, marks)
        if s.format == "url":
            after = controls.preview(control_value(s, value))
    if unit and s.type in ("integer", "number"):
        control = (
            f'<span class="canccu-inputgroup">{control}'
            f'<span class="canccu-inputgroup__add">{html.escape(unit)}</span></span>'
        )
        after = controls.picks(s, unit, fid) if s.type == "integer" else ""
    elif unit:
        label = f"{label} ({unit})"
    if s.type == "integer":
        control = controls.stepper(control, fid)
    error = ""
    if required(s) and not (s.choices or s.choices_from):
        why = html.escape(_error(s))
        error = f'<p class="canccu-field__error" data-canccu-error="{why}" hidden>{why}</p>'
    return (
        f'<div class="canccu-field"><label class="canccu-field__label" for={fid}>'
        f"{html.escape(label)}</label>{control}{after}{error}{was_html}{_help(s, hint)}</div>"
    )


def _input(s: Setting, value: Any, fid: str, name: str, marks: str) -> tuple[str, str]:
    """A typed field: a number in its bounds, a link, or text; and the hint its kind adds."""
    text = (
        ", ".join(map(str, value)) if isinstance(value, list) else ("" if value is None else value)
    )
    attrs, hint = "type=text", ""
    if s.type == "number":
        attrs = "type=number step=any inputmode=decimal"
    elif s.type == "integer":
        attrs = "type=number step=1 inputmode=numeric"
        # Browser-side hints only; the server check in check_values is the rule.
        attrs += "".join(f" {k}={v}" for k, v in (("min", s.min), ("max", s.max)) if v is not None)
        if s.min is not None and s.max is not None:
            hint = f"From {s.min} to {s.max}."
    elif s.type == "list":
        marks += " data-canccu-list"
        hint = "Separate them with commas."
    elif s.format == "url":
        attrs = "type=url"
    if required(s):
        attrs += " required"
    example = f' placeholder="{html.escape(s.example)}"' if s.example else ""
    control = (
        f'<input class="canccu-input" {attrs} id={fid} name={name} '
        f'value="{html.escape(str(text))}"{example}{marks}>'
    )
    return control, hint


def _help(s: Setting, hint: str = "") -> str:
    """One line under the field: what it is for, then its kind's hint, then the default."""
    text = " ".join(filter(None, (s.help, hint, _default(s))))
    return f'<p class="canccu-field__hint">{html.escape(text)}</p>' if text else ""


def _integer(key: str, raw: str) -> int:
    try:
        return int(raw.strip())
    except ValueError as exc:
        raise BadSettings(f"{key} must be an integer") from exc


def typed(declared: list[Setting], form: Any) -> dict[str, Any]:
    """What the form holds for each setting, as typed: a box as a bool (an unticked one is left
    out of the post), the rest as the posted text or None."""
    return {s.key: _posted(s, form) for s in declared}


def _posted(s: Setting, form: Any) -> Any:
    if s.type == "boolean":
        return form.get(s.key) is not None
    if s.type == "list" and s.choices and hasattr(form, "getlist"):
        # Chips: one value per ticked chip; none ticked posts nothing, which is no items.
        return _in_order(s, [str(v) for v in form.getlist(s.key)])
    return form.get(s.key)


def from_form(declared: list[Setting], form: Any) -> dict[str, Any]:
    values: dict[str, Any] = {}
    posted = typed(declared, form)
    for s in declared:
        raw = posted[s.key]
        if s.type == "boolean":
            values[s.key] = raw
        elif isinstance(raw, list):
            values[s.key] = raw
        elif s.type == "list":
            # An emptied list input means "no items": agenda allows `[]` for no channels.
            parts = [p.strip() for p in str(raw or "").split(",") if p.strip()]
            values[s.key] = [_integer(s.key, p) for p in parts] if s.items == "integer" else parts
        elif raw is None:
            # Left out of the post: the setting stays as it is.
            continue
        elif raw == "":
            if required(s):
                raise BadSettings(f"{s.key} needs a value")
            values[s.key] = ""
        elif s.type == "integer":
            values[s.key] = _integer(s.key, str(raw))
        elif s.type == "number":
            try:
                number = float(raw)
            except ValueError as exc:
                raise BadSettings(f"{s.key} must be a number") from exc
            values[s.key] = int(number) if number.is_integer() else number
        else:
            values[s.key] = str(raw)
    return values
