"""The IANA time zones a setting chooses from (#732), from the pinned tzdata package, so every
image offers the same list whatever its system zone files hold."""

from __future__ import annotations

from functools import cache
from importlib.resources import files
from zoneinfo import available_timezones


@cache
def zone_names() -> frozenset[str]:
    """Every name a value may hold: old aliases too ("Asia/Calcutta"), so a profile written with
    one still loads; the dropdown offers only the current names."""
    return frozenset(available_timezones()) | {"UTC"}


def zone_label(zone: str) -> str:
    """A zone in people's words: "Europe / Helsinki"."""
    return zone.replace("_", " ").replace("/", " / ")


@cache
def zone_groups() -> list[tuple[str, list[tuple[str, str]]]]:
    """(region, [(zone, city)]) in name order: zone.tab's zones, one or more per country, so no
    alias ("US/Eastern", "EST") or Etc/ offset is offered; UTC last, in a group of its own."""
    table = (files("tzdata.zoneinfo") / "zone.tab").read_text(encoding="utf-8")
    zones = sorted(
        line.split("\t")[2] for line in table.splitlines() if line and not line.startswith("#")
    )
    regions: dict[str, list[tuple[str, str]]] = {}
    for zone in zones:
        region, _, place = zone.partition("/")
        regions.setdefault(region, []).append((zone, zone_label(place)))
    return [*regions.items(), ("UTC", [("UTC", "UTC")])]
