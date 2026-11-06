"""Declared settings: one YAML file per module in the declarations directory.

```yaml
settings:
  - key: rotation_seconds     # lowercase snake_case, as in a profile
    type: number              # string | number | boolean | list
    label: Rotation (seconds)
    default: 15
    choices: [a, b]           # optional, string settings only
```
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
TYPES = ("string", "number", "boolean", "list")


class DeclarationError(Exception):
    pass


@dataclass(frozen=True)
class Setting:
    key: str
    type: str
    label: str
    default: Any = None
    choices: tuple[str, ...] = ()


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
        out.append(
            Setting(
                key=item["key"],
                type=item["type"],
                label=str(item.get("label") or item["key"].replace("_", " ").capitalize()),
                default=item.get("default"),
                choices=tuple(str(c) for c in item.get("choices", ())),
            )
        )
    return out


def load_declarations(directory: Path) -> dict[str, list[Setting]]:
    result: dict[str, list[Setting]] = {}
    if not directory.is_dir():
        return result
    for path in sorted(directory.glob("*.yaml")):
        result[path.stem] = _parse(path.stem, yaml.safe_load(path.read_text()))
    return result


def check_values(declared: list[Setting], values: dict[str, Any]) -> str | None:
    """Return a problem description if a declared key has the wrong type, else None."""
    by_key = {s.key: s for s in declared}
    for key, value in values.items():
        setting = by_key.get(key)
        if setting is None:
            continue
        ok = {
            "string": isinstance(value, str),
            "number": isinstance(value, int | float) and not isinstance(value, bool),
            "boolean": isinstance(value, bool),
            "list": isinstance(value, list),
        }[setting.type]
        if not ok:
            return f"{key} must be a {setting.type}"
        if setting.choices and value not in setting.choices:
            return f"{key} must be one of {', '.join(setting.choices)}"
    return None
