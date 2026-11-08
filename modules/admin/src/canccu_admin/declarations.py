"""Declared settings: one YAML file per module in the declarations directory.

```yaml
settings:
  - key: rotation_seconds     # lowercase snake_case, as in a profile
    type: number              # string | number | integer | boolean | list
    label: Rotation (seconds)
    default: 15
    choices: [a, b]           # optional, string settings only
  - key: hourly_cap
    type: integer             # whole numbers only; a bool or float is refused
    min: 1                    # optional bounds, integer settings only
    max: 60
    default: 6
  - key: reminder_leads_minutes
    type: list
    items: integer            # string (default) | integer
    min: 1                    # bounds of each item, integer items only
    max: 1440
    default: [30, 10]
  - key: notify_channels
    type: list
    choices: [screen, push]   # allowed items, string items only
    default: [screen]
```

A bad declaration fails at load, so a typo in a YAML file stops the module at
start instead of surfacing as a confusing 400 on some later save.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
TYPES = ("string", "number", "integer", "boolean", "list")
ITEM_TYPES = ("string", "integer")


class DeclarationError(Exception):
    pass


@dataclass(frozen=True)
class Setting:
    key: str
    type: str
    label: str
    default: Any = None
    choices: tuple[str, ...] = ()
    min: int | None = None
    max: int | None = None
    items: str = "string"


def _is_int(v: Any) -> bool:
    # bool is an int subclass in Python; "true" must not pass as 1.
    return isinstance(v, int) and not isinstance(v, bool)


def _bound(where: str, item: dict[str, Any], name: str) -> int | None:
    v = item.get(name)
    if v is not None and not _is_int(v):
        raise DeclarationError(f"{where}: {name} must be an integer")
    return v


def _build(module: str, item: dict[str, Any]) -> Setting:
    where = f"{module}.{item['key']}"
    kind = item["type"]
    items = item.get("items", "string")
    if kind != "list" and "items" in item:
        raise DeclarationError(f"{where}: items only applies to a list")
    if items not in ITEM_TYPES:
        raise DeclarationError(f"{where}: items must be one of {ITEM_TYPES}")
    numeric = kind == "integer" or (kind == "list" and items == "integer")
    text = kind == "string" or (kind == "list" and items == "string")
    lo, hi = _bound(where, item, "min"), _bound(where, item, "max")
    choices = tuple(str(c) for c in item.get("choices", ()))
    if (lo is not None or hi is not None) and not numeric:
        raise DeclarationError(f"{where}: min/max only apply to integer settings")
    if choices and not text:
        raise DeclarationError(f"{where}: choices only apply to string settings")
    if lo is not None and hi is not None and lo > hi:
        raise DeclarationError(f"{where}: min {lo} is above max {hi}")
    setting = Setting(
        key=item["key"],
        type=kind,
        label=str(item.get("label") or item["key"].replace("_", " ").capitalize()),
        default=item.get("default"),
        choices=choices,
        min=lo,
        max=hi,
        items=items,
    )
    if setting.default is not None:
        problem = check_values([setting], {setting.key: setting.default})
        if problem:
            raise DeclarationError(f"{where}: default invalid: {problem}")
    return setting


def _parse(module: str, raw: Any) -> list[Setting]:
    items = raw.get("settings") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        raise DeclarationError(f"{module}: expected a 'settings' list")
    out: list[Setting] = []
    for item in items:
        if not isinstance(item, dict) or not KEY_RE.match(str(item.get("key", ""))):
            raise DeclarationError(f"{module}: bad setting {item!r}")
        if item.get("type") not in TYPES:
            raise DeclarationError(f"{module}.{item['key']}: type must be one of {TYPES}")
        out.append(_build(module, item))
    return out


def load_declarations(directory: Path) -> dict[str, list[Setting]]:
    result: dict[str, list[Setting]] = {}
    if not directory.is_dir():
        return result
    for path in sorted(directory.glob("*.yaml")):
        result[path.stem] = _parse(path.stem, yaml.safe_load(path.read_text()))
    return result


def _check_one(s: Setting, value: Any) -> str | None:
    key = s.key
    if s.type == "list":
        if not isinstance(value, list):
            return f"{key} must be a list"
        for item in value:
            problem = _check_item(s, item)
            if problem:
                return problem
        return None
    return _check_item(s, value, scalar=True)


def _check_item(s: Setting, value: Any, scalar: bool = False) -> str | None:
    key = s.key
    kind = s.type if scalar else s.items
    if kind == "string":
        if not isinstance(value, str):
            return f"{key} must be a string" if scalar else f"{key} must list strings"
        if s.choices and value not in s.choices:
            return f"{key} must be one of {', '.join(s.choices)}"
    elif kind == "integer":
        if not _is_int(value):
            return f"{key} must be an integer" if scalar else f"{key} must list integers"
        if (s.min is not None and value < s.min) or (s.max is not None and value > s.max):
            lo = "" if s.min is None else f" from {s.min}"
            hi = "" if s.max is None else f" up to {s.max}"
            return f"{key} must be{lo}{hi}"
    elif kind == "number":
        if not isinstance(value, int | float) or isinstance(value, bool):
            return f"{key} must be a number"
    elif kind == "boolean" and not isinstance(value, bool):
        return f"{key} must be a boolean"
    return None


def check_values(declared: list[Setting], values: dict[str, Any]) -> str | None:
    """Return a problem description if a declared key has the wrong type or range, else None."""
    by_key = {s.key: s for s in declared}
    for key, value in values.items():
        setting = by_key.get(key)
        if setting is None:
            continue
        problem = _check_one(setting, value)
        if problem:
            return problem
    return None
