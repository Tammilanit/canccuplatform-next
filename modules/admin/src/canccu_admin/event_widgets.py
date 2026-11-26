"""The Event page's shared parts (#782 part B): what the owners answered, a section answered
again, and the card, fields and words every section draws with packages/ui's classes."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from canccu_kit import TenantContext
from canccu_kit.ui import esc, notice, status_chip

SAVED = "Saved. The change applies now."


@dataclass
class Retry:
    """A section answered again: what was typed, and why it was not saved."""

    section: str
    typed: Mapping[str, str]
    title: str
    text: str
    kind: str = "warn"
    read_only: bool = False
    """The owner refused the person's right: the section says its values in words."""


@dataclass
class EventData:
    """What each owner answered for the page; None where it refused or did not answer."""

    tenant: Mapping[str, Any] | None = None
    venue_info: Mapping[str, Any] | None = None
    venue: Mapping[str, Any] | None = None
    hostnames: Sequence[Mapping[str, Any]] | None = None
    flags: Mapping[str, Any] | None = None
    storage: Mapping[str, Any] | None = None
    series: Mapping[str, Any] | None = None
    people: Sequence[tuple[str, str]] = ()
    settings_links: Mapping[str, str] = field(default_factory=dict)
    ctx: TenantContext | None = None
    saved: str | None = None


def status(data: EventData, key: str, retry: Retry | None) -> str:
    """The section's notice: why it was not saved, or that it was."""
    if retry is not None and retry.section == key:
        return notice(retry.kind, retry.title, retry.text)
    return notice("ok", SAVED) if data.saved == key else ""


def typed(key: str, retry: Retry | None) -> Mapping[str, str]:
    return retry.typed if retry is not None and retry.section == key else {}


def save_form(action: str, version_name: str, version: Any, fields: str, extra: str = "") -> str:
    return (
        f'<form method=post action="{esc(action)}" class="canccu-form"{extra}>{fields}'
        f'<input type=hidden name="{version_name}" value="{esc(version)}">'
        '<div class="canccu-cluster"><button class="canccu-button canccu-button--primary" '
        "type=submit>Save</button></div></form>"
    )


def card(
    key: str,
    title: str,
    body: str,
    *,
    form: tuple[str, Any, str] | None = None,
    version: str = "revision",
) -> str:
    """A section with its anchor; `form` is (action, the owner's version, the fields)."""
    if form is not None:
        body += save_form(form[0], version, form[1], form[2])
    return (
        f'<section class="canccu-card" id="{key}" aria-labelledby="{key}-title">'
        f'<h2 class="canccu-card__title" id="{key}-title">{esc(title)}</h2>{body}</section>'
    )


def _field(key: str, label: str, control: str, hint: str) -> str:
    help_ = f'<p class="canccu-field__hint">{esc(hint)}</p>' if hint else ""
    return (
        f'<div class="canccu-field"><label class="canccu-field__label" for="ev-{key}">'
        f"{esc(label)}</label>{control}{help_}</div>"
    )


def text_input(
    key: str, label: str, value: str, *, maxlength: int = 300, hint: str = "", extra: str = ""
) -> str:
    control = (
        f'<input class="canccu-input" id="ev-{key}" name="{key}" value="{esc(value)}" '
        f"maxlength={maxlength}{extra}>"
    )
    return _field(key, label, control, hint)


def local_input(key: str, label: str, value: str) -> str:
    control = (
        f'<input class="canccu-input" id="ev-{key}" name="{key}" value="{esc(value)}" '
        "type=datetime-local>"
    )
    return _field(key, label, control, "In the event's time zone, chosen below.")


def text_area(key: str, label: str, value: str, *, maxlength: int, hint: str = "") -> str:
    control = (
        f'<textarea class="canccu-input" id="ev-{key}" name="{key}" rows=3 '
        f"maxlength={maxlength}>{esc(value)}</textarea>"
    )
    return _field(key, label, control, hint)


DEFAULT_CHIP = status_chip("plain", "Default", "A new event starts with this choice.")


def choice(
    key: str, title: str, options: Sequence[tuple[str, str, str]], current: str, default: str
) -> str:
    """Radios in words, each with its line of help; the default named beside its choice."""
    rows = "".join(
        f'<div class="canccu-field canccu-field--check"><input class="canccu-check" '
        f'type=radio name={key} value="{esc(v)}"{" checked" if v == current else ""} '
        f'id="ev-{key}-{esc(v)}"><label class="canccu-field__label" for="ev-{key}-{esc(v)}">'
        f"{esc(label)}</label>{' ' + DEFAULT_CHIP if v == default else ''}"
        f'<p class="canccu-field__hint">{esc(text)}</p></div>'
        for v, label, text in options
    )
    return (
        '<fieldset class="canccu-form canccu-fieldset">'
        f'<legend class="canccu-field__label">{esc(title)}'
        f"</legend>{rows}</fieldset>"
    )


def words(rows: Sequence[tuple[str, Any]]) -> str:
    """Values a person may read but not change."""
    items = "".join(f"<dt>{esc(k)}</dt><dd>{esc(v)}</dd>" for k, v in rows)
    return f'<dl class="canccu-dl">{items}</dl>'
