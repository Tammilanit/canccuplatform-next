"""HTML form fields for declared settings, and the parsing of a posted form back."""

from __future__ import annotations

import html
from typing import Any

from .declarations import Setting
from .service import BadSettings


def field_html(s: Setting, value: Any) -> str:
    name, label = html.escape(s.key), html.escape(s.label)
    value = s.default if value is None else value
    if s.type == "boolean":
        checked = " checked" if value else ""
        return f"<p><label><input type=checkbox name={name}{checked}> {label}</label></p>"
    if s.choices and s.type == "string":
        opts = "".join(
            f"<option{' selected' if c == value else ''}>{html.escape(c)}</option>"
            for c in s.choices
        )
        return f"<p><label>{label} <select name={name}>{opts}</select></label></p>"
    text = (
        ", ".join(map(str, value)) if isinstance(value, list) else ("" if value is None else value)
    )
    attrs = "type=text"
    if s.type == "number":
        attrs = "type=number step=any"
    elif s.type == "integer":
        attrs = "type=number step=1"
        # Browser-side hints only; the server check in check_values is the rule.
        attrs += "".join(f" {k}={v}" for k, v in (("min", s.min), ("max", s.max)) if v is not None)
    hint = f" ({', '.join(s.choices)})" if s.type == "list" and s.choices else ""
    return (
        f"<p><label>{label}{html.escape(hint)} <input {attrs} name={name} "
        f"value='{html.escape(str(text))}'></label></p>"
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
