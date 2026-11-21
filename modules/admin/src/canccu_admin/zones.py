"""The IANA time zones a setting chooses from (#732), read from the image's system zone files
(python:3.12-slim ships /usr/share/zoneinfo), so no extra package is installed."""

from __future__ import annotations

from functools import cache
from zoneinfo import available_timezones

# The Area/City names people pick from; aliases outside these areas ("US/Eastern", "EST", "Etc/")
# stay valid values but are not offered.
_AREAS = (
    "Africa", "America", "Antarctica", "Arctic", "Asia", "Atlantic",
    "Australia", "Europe", "Indian", "Pacific",
)  # fmt: skip


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
    """(region, [(zone, city)]) in name order, Area/City names only; UTC last, in a group of
    its own."""
    regions: dict[str, list[tuple[str, str]]] = {}
    for zone in sorted(available_timezones()):
        region, _, place = zone.partition("/")
        if region in _AREAS and place:
            regions.setdefault(region, []).append((zone, zone_label(place)))
    return [*regions.items(), ("UTC", [("UTC", "UTC")])]
