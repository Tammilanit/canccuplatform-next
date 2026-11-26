"""The custom-kind form's conditions (#782 part C, plan D13): a field, a test and a value per
row, each a list to pick from where the choices are known, read back into the `where` that
`PUT /api/notify/topic-types/{custom_…}` takes, so custom.validate stays the only rule."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from . import engine
from .registry import bad
from .web import esc, field, select, text_input

OPS = {
    "eq": "is",
    "ne": "is not",
    "in": "is one of",
    "not_in": "is none of",
    "exists": "is set",
    "within_minutes": "is at most this many minutes ahead",
}
"""The conditions the form writes. `nearest_in` and conditions against a parameter are set
through the API; the form keeps them as they are."""
EMPTY_ROWS = 2


def _literal(text: str) -> Any:
    # Numbers and true/false compare as such in the event; anything else is text.
    try:
        value = json.loads(text)
    except ValueError:
        return text
    return value if isinstance(value, bool | int | float) else text


def _display(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(_display(v) for v in value)
    return json.dumps(value) if isinstance(value, bool) else str(value)


def _value(op: str, raw: str, where: str) -> Any:
    if op in ("in", "not_in"):
        return [_literal(part.strip()) for part in raw.split(",") if part.strip()]
    if op == "within_minutes":
        try:
            return int(raw)
        except ValueError:
            raise bad(f"{where}: minutes, a whole number") from None
    return _literal(raw.strip())


def _row_indexes(form: Mapping[str, Any]) -> list[int]:
    found = {k.removeprefix("where_field_") for k in form if k.startswith("where_field_")}
    return sorted(int(i) for i in found if i.isdigit())


def conditions_from(form: Mapping[str, Any]) -> list[Any]:
    out: list[Any] = []
    for i in _row_indexes(form):
        path = str(form.get(f"where_field_{i}") or "").strip()
        if not path:
            continue
        op = str(form.get(f"where_op_{i}") or "")
        cond: dict[str, Any] = {"field": path, "op": op}
        if op != "exists":
            cond["value"] = _value(op, str(form.get(f"where_value_{i}") or ""), f"where[{i}]")
        out.append(cond)
    try:
        kept = json.loads(str(form.get("keep") or "[]"))
    except ValueError:
        raise bad("keep: the conditions as JSON") from None
    return out + (kept if isinstance(kept, list) else [])


def defaults_from(form: Mapping[str, Any], base: dict[str, Any]) -> dict[str, dict[str, bool]]:
    """Only the base's channels that default to on can be switched off; the rest stay off."""
    out: dict[str, dict[str, bool]] = {}
    for name, part in base["parts"].items():
        for channel in part["channels"]:
            if part["defaults"].get(channel) is True:
                on = form.get(f"default_{name}_{channel}") is not None
                out.setdefault(name, {})[channel] = on
    return out


# Fields in the words of the people who set them; any other by its last part.
PATH_LABELS = {
    "data.item.kind": "Item kind",
    "data.item.title": "Item title",
    "data.item.visibility": "Who sees the item",
    "data.item.starts_at": "Item start",
    "data.lead_minutes": "Minutes before the start",
    "data.minutes": "Minutes moved",
    "data.order.pizzeria.name": "Pizzeria",
    "data.order.pickup": "Pickup place",
}
KINDS = "data.item.kind"
"""The one field whose values the event knows: the run of show's item kinds."""


def path_label(path: str) -> str:
    return PATH_LABELS.get(path) or path.rsplit(".", 1)[-1].replace("_", " ").capitalize()


def paths_of(base: dict[str, Any]) -> list[str]:
    """Paths the base's triggers already use: the fields a condition may look at."""
    found: set[str] = set()
    for t in base["triggers"]:
        found.update(c["field"] for c in t.get("where") or [])
        for name in ("title", "body", "url"):
            found.update(
                m.group(1)
                for m in engine.TEMPLATE_RE.finditer(t.get(name) or "")
                if not m.group(1).startswith("param.")
            )
    return sorted(found)


def _value_control(i: int, path: str, op: str, value: str, kinds: Sequence[Any] | None) -> str:
    name = f"where_value_{i}"
    if kinds and path == KINDS and op in ("eq", "ne"):
        options = [(str(k["key"]), str(k.get("name") or k["key"])) for k in kinds]
        if value and value not in {v for v, _ in options}:
            options.append((value, value))  # a kind removed since: kept as it was set
        return select(name, options, value)
    if kinds and (not path or path == KINDS):
        return text_input(name, value, list="canccu-notify-kinds")
    return text_input(name, value)


def rows_html(
    rows: list[tuple[str, str, str]], paths: Sequence[str], kinds: Sequence[Any] | None
) -> str:
    """Each condition as three lists (or a text value where no values are known), plus empty
    rows to add one; `kinds` None when the agenda did not answer."""
    out = []
    for i, (path, op, value) in enumerate([*rows, *[("", "eq", "")] * EMPTY_ROWS]):
        choices = [("", "Choose a field"), *((p, path_label(p)) for p in paths)]
        if path and path not in paths:
            choices.append((path, path_label(path)))
        out.append(
            '<div class="canccu-notify-condition">'
            + field("Field", select(f"where_field_{i}", choices, path))
            + field("Test", select(f"where_op_{i}", list(OPS.items()), op))
            + field("Value", _value_control(i, path, op, value, kinds))
            + "</div>"
        )
    if kinds:
        options = "".join(
            f'<option value="{esc(k["key"])}">{esc(k.get("name") or k["key"])}</option>'
            for k in kinds
        )
        out.append(f'<datalist id="canccu-notify-kinds">{options}</datalist>')
    return "".join(out)


def split(conditions: list[Any]) -> tuple[list[tuple[str, str, str]], list[Any]]:
    """The conditions the form shows as rows, and those it keeps as set through the API."""
    rows, kept = [], []
    for c in conditions:
        if c.get("op") in OPS and "param" not in c:
            rows.append((c["field"], c["op"], _display(c.get("value", ""))))
        else:
            kept.append(c)
    return rows, kept


def form_rows(form: Mapping[str, Any]) -> list[tuple[str, str, str]]:
    return [
        (
            str(form.get(f"where_field_{i}") or ""),
            str(form.get(f"where_op_{i}") or "eq"),
            str(form.get(f"where_value_{i}") or ""),
        )
        for i in _row_indexes(form)
        if str(form.get(f"where_field_{i}") or "").strip()
    ]
