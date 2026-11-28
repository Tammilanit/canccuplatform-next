"""What Discord sends with an interaction, read for the framework: who ran it, a command's
subcommand and options, a form's values and a message command's message."""

from __future__ import annotations

from typing import Any

from .framework import Caller


def caller_of(data: dict[str, Any]) -> Caller:
    member = data.get("member") or {}
    user = member.get("user") or data.get("user") or {}
    name = member.get("nick") or user.get("global_name") or user.get("username") or ""
    return Caller(
        user_id=str(user.get("id", "")),
        nickname=str(name),
        role_ids=tuple(str(r) for r in member.get("roles") or ()),
        guild_id=data.get("guild_id"),
        locale=data.get("locale"),
    )


def command_options(data: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    options = (data.get("data") or {}).get("options") or []
    prefix = ""
    if options and options[0].get("type") == 2:  # a group holds its subcommand
        prefix = f"{options[0]['name']} "
        options = options[0].get("options") or []
    if options and options[0].get("type") == 1:  # a subcommand holds the real options
        return prefix + str(options[0]["name"]), {
            o["name"]: o.get("value") for o in options[0].get("options") or []
        }
    return None, {o["name"]: o.get("value") for o in options}


def target_of(data: dict[str, Any]) -> dict[str, Any] | None:
    """A message command's message, from what Discord resolved for it."""
    body = data.get("data") or {}
    messages = (body.get("resolved") or {}).get("messages") or {}
    found = messages.get(str(body.get("target_id") or ""))
    return found if isinstance(found, dict) else None


def form_values(data: dict[str, Any]) -> dict[str, str]:
    rows = (data.get("data") or {}).get("components") or []
    return {
        str(c["custom_id"]): str(c.get("value") or "")
        for row in rows
        for c in row.get("components") or []
    }
