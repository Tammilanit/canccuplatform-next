"""The Event page's Venue section (#782 part B, plan D7): the venue's name and network addresses
read only (the platform admin's), and the event's own copy to edit: address, Wi-Fi, house rules and
the floor plan, through the tenants API's venue info (contracts/tenants.md, Venue profile)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from canccu_kit.rights import Session
from canccu_kit.ui import esc, notice

from .event_widgets import EventData, Retry, card, save_form, status, text_area, text_input, typed
from .pages import BASE

EVENT = f"{BASE}/event"
PLAN = "/api/tenants/current/venue-info/floor-plan"
VISIBILITY = (
    ("public", "Everyone who opens the info page"),
    ("attendees", "Members only, so guests never see the password"),
)
MAX_WIFI = 10


def wifi_rows(form: Mapping[str, str]) -> list[dict[str, Any]]:
    """The networks a submitted form keeps, in order: a row without a name or marked to remove is
    left out, an empty password or note is none."""
    networks = []
    for i in range(MAX_WIFI + 1):
        ssid = form.get(f"wifi_{i}_ssid", "").strip()
        if not ssid or form.get(f"wifi_{i}_remove"):
            continue
        networks.append(
            {
                "ssid": ssid,
                "password": form.get(f"wifi_{i}_password") or None,
                "note": form.get(f"wifi_{i}_note") or None,
                "visibility": form.get(f"wifi_{i}_visibility", "attendees"),
            }
        )
    return networks


def _wifi_row(i: int, net: Mapping[str, Any], *, new: bool) -> str:
    def val(key: str) -> str:
        return esc(net.get(key) or "")

    options = "".join(
        f'<option value="{v}"{" selected" if v == net.get("visibility", "attendees") else ""}>'
        f"{esc(words)}</option>"
        for v, words in VISIBILITY
    )
    remove = (
        ""
        if new
        else f'<label class="canccu-small"><input type=checkbox name="wifi_{i}_remove" value="1">'
        " Remove this network</label>"
    )
    title = "Add a network" if new else f"Network {i + 1}"
    return (
        '<fieldset class="canccu-form canccu-fieldset">'
        f'<legend class="canccu-field__label">{title}</legend>'
        f'<label class="canccu-small" for="ev-wifi-{i}-ssid">Name (SSID)</label>'
        f'<input class="canccu-input" id="ev-wifi-{i}-ssid" name="wifi_{i}_ssid" '
        f'value="{val("ssid")}" maxlength=32>'
        f'<label class="canccu-small" for="ev-wifi-{i}-password">Password</label>'
        f'<input class="canccu-input" id="ev-wifi-{i}-password" name="wifi_{i}_password" '
        f'value="{val("password")}" maxlength=64 autocomplete="off">'
        f'<label class="canccu-small" for="ev-wifi-{i}-visibility">Who sees it</label>'
        f'<select class="canccu-input" id="ev-wifi-{i}-visibility" name="wifi_{i}_visibility">'
        f"{options}</select>"
        f'<label class="canccu-small" for="ev-wifi-{i}-note">Note</label>'
        f'<input class="canccu-input" id="ev-wifi-{i}-note" name="wifi_{i}_note" '
        f'value="{val("note")}" maxlength=500>{remove}</fieldset>'
    )


def _venue_ref(venue: Mapping[str, Any] | None) -> str:
    if venue is None:
        return "<p>No venue: an online event, or the platform admin has not chosen one yet.</p>"
    addresses = ", ".join(str(a) for a in venue.get("addresses", [])) or "none"
    return (
        f"<p><strong>{esc(venue.get('name'))}</strong>. The platform admin keeps the venue. Its "
        f"network addresses, used only by the venue-only options: <code>{esc(addresses)}</code>."
        "</p>"
    )


def _plan(info: Mapping[str, Any], can: bool) -> str:
    has = info.get("floor_plan") is not None
    now = (
        f'<p>A floor plan is set. <a href="{PLAN}" target="_blank" rel="noopener">Open it</a>.</p>'
        if has
        else "<p>No floor plan yet.</p>"
    )
    if not can:
        return now
    upload = (
        '<div class="canccu-field"><label class="canccu-field__label" for="ev-floor-plan">'
        'Floor plan</label><input class="canccu-input" id="ev-floor-plan" type="file" '
        'name="floor_plan" accept="image/png,image/jpeg,image/webp" required>'
        '<p class="canccu-field__hint">PNG, JPEG or WebP, at most 10 MB.</p></div>'
    )
    form = save_form(f"{EVENT}/floor-plan", "kind", "floor_plan", upload).replace(
        'class="canccu-form"', 'class="canccu-form" enctype="multipart/form-data"', 1
    )
    return now + form


def venue_section(session: Session, data: EventData, retry: Retry | None) -> str:
    head = status(data, "venue", retry) + _venue_ref(data.venue)
    info = data.venue_info
    if info is None:
        return card("venue", "Venue", head + notice("warn", "The venue info didn't answer."))
    can = session.has("tenants.venue_info.write")
    form = typed("venue", retry)
    nets: Sequence[Mapping[str, Any]] = (
        wifi_rows(form) if form else [dict(w) for w in info.get("wifi", [])]
    )
    if not can:
        listed = ", ".join(str(w.get("ssid")) for w in nets) or "none"
        body = (
            f"<p>Address: {esc(info.get('address') or 'not set')}</p><p>Wi-Fi: {esc(listed)}</p>"
            f"<p>House rules: {esc(info.get('house_rules') or 'none')}</p>"
        )
        return card("venue", "Venue", head + body + _plan(info, False))
    rows = "".join(_wifi_row(i, n, new=False) for i, n in enumerate(nets))
    if len(nets) < MAX_WIFI:
        rows += _wifi_row(len(nets), {}, new=True)
    fields = (
        text_input(
            "address",
            "Address",
            str(form.get("address", info.get("address") or "")),
            hint="The street address people come to.",
        )
        + f'<div class="canccu-field"><p class="canccu-field__label">Wi-Fi</p>{rows}</div>'
        + text_area(
            "house_rules",
            "House rules",
            str(form.get("house_rules", info.get("house_rules") or "")),
            maxlength=20000,
            hint="Shown on the event's info page.",
        )
    )
    body = head + save_form(f"{EVENT}/venue", "revision", info.get("revision", 0), fields)
    return card("venue", "Venue", body + _plan(info, True))
