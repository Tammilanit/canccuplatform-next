"""HTML form fields for declared settings, and the parsing of a posted form back."""

from __future__ import annotations

import html
import re
from typing import Any

from .declarations import Setting
from .service import BadSettings

_UNIT = re.compile(r"^(.*\S)\s*\(([^()]+)\)$")


_LANGUAGES = {"en": "English", "fi": "Finnish"}


def _words(value: str) -> str:
    """A choice's value as words: `high_contrast` reads "High contrast", `en` "English"."""
    return _LANGUAGES.get(value) or value.replace("_", " ").capitalize()


def field_html(s: Setting, value: Any) -> str:
    """A declared setting as a packages/ui form field: a label's trailing "(seconds)" becomes
    the field's unit, an integer's bounds its hint (UX audit A4)."""
    fid, name = f"canccu-field-{html.escape(s.key)}", html.escape(s.key)
    value = s.default if value is None else value
    if s.type == "boolean":
        checked = " checked" if value else ""
        return (
            f'<div class="canccu-field canccu-field--check"><input class="canccu-check" '
            f"type=checkbox id={fid} name={name}{checked}>"
            f'<label class="canccu-field__label" for={fid}>{html.escape(s.label)}</label></div>'
        )
    label, unit = s.label, ""
    if match := _UNIT.match(s.label):
        label, unit = match.group(1), match.group(2)
    hint = ""
    if s.choices and s.type == "string":
        opts = "".join(
            f'<option value="{html.escape(c)}"{" selected" if c == value else ""}>'
            f"{html.escape(_words(c))}</option>"
            for c in s.choices
        )
        control = f'<select class="canccu-input" id={fid} name={name}>{opts}</select>'
    else:
        text = (
            ", ".join(map(str, value))
            if isinstance(value, list)
            else ("" if value is None else value)
        )
        attrs = "type=text"
        if s.type == "number":
            attrs = "type=number step=any inputmode=decimal"
        elif s.type == "integer":
            attrs = "type=number step=1 inputmode=numeric"
            # Browser-side hints only; the server check in check_values is the rule.
            attrs += "".join(
                f" {k}={v}" for k, v in (("min", s.min), ("max", s.max)) if v is not None
            )
            if s.min is not None and s.max is not None:
                hint = f"From {s.min} to {s.max}."
        elif s.type == "list":
            hint = "Separate them with commas."
            if s.choices:
                hint = f"Any of {', '.join(s.choices)}, separated with commas."
        control = (
            f'<input class="canccu-input" {attrs} id={fid} name={name} '
            f'value="{html.escape(str(text))}">'
        )
    if unit and s.type in ("integer", "number"):
        control = (
            f'<span class="canccu-inputgroup">{control}'
            f'<span class="canccu-inputgroup__add">{html.escape(unit)}</span></span>'
        )
    elif unit:
        label = s.label
    hint_html = f'<p class="canccu-field__hint">{html.escape(hint)}</p>' if hint else ""
    return (
        f'<div class="canccu-field"><label class="canccu-field__label" for={fid}>'
        f"{html.escape(label)}</label>{control}{hint_html}</div>"
    )


def _integer(key: str, raw: str) -> int:
    try:
        return int(raw.strip())
    except ValueError as exc:
        raise BadSettings(f"{key} must be an integer") from exc


def from_form(declared: list[Setting], form: Any) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for s in declared:
        raw = form.get(s.key)
        if s.type == "boolean":
            values[s.key] = raw is not None
        elif s.type == "list":
            # An emptied list input means "no items", unlike an emptied scalar,
            # which means "leave unset": agenda allows `[]` for no channels.
            parts = [p.strip() for p in str(raw or "").split(",") if p.strip()]
            values[s.key] = [_integer(s.key, p) for p in parts] if s.items == "integer" else parts
        elif raw is None or raw == "":
            continue
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
