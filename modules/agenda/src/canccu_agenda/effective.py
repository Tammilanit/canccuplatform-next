"""The event's settings in effect (contracts/agenda.md, Settings), read through the kit's
SettingsClient for the tenant in scope."""

from __future__ import annotations

from canccu_kit import AdminUnavailable

from . import model
from .deps import Deps


async def event_channels(d: Deps) -> list[str]:
    await d.settings.ensure()
    value = d.settings.get("notify_channels", list(model.DEFAULT_CHANNELS))
    return list(value) if isinstance(value, list) else list(model.DEFAULT_CHANNELS)


async def read_channels(d: Deps) -> list[str]:
    """For reads: screens and phones keep their now and next while admin is down; only the
    event's channel setting falls back to its declared default."""
    try:
        return await event_channels(d)
    except AdminUnavailable:
        return list(model.DEFAULT_CHANNELS)


async def event_leads(d: Deps) -> list[int]:
    await d.settings.ensure()
    value = d.settings.get("reminder_leads_minutes", list(model.DEFAULT_LEADS))
    if isinstance(value, list) and all(type(v) is int for v in value):
        return list(value)
    return list(model.DEFAULT_LEADS)


async def event_settings(d: Deps) -> tuple[list[str], list[int]]:
    """Channels and lead times; called before the event's write lock, since it may call admin."""
    return await event_channels(d), await event_leads(d)
