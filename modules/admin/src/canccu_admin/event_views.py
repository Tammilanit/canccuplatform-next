"""The Event page's sections (#782 part B, plan D7, D8, D10, D11; the admin control room pack, sheet
07): one card per owner, each its own form and Save, so a refusal or a conflict names one section
and nothing saves half. Without the owner's right a section says its values in words."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from canccu_kit.rights import Session
from canccu_kit.ui import day_label, esc, local_time, notice, status_chip

from .access_pages import ACCESS, ACCESS_SETTINGS, DEFAULTS, READ_ONLY
from .event_venue import venue_section
from .event_widgets import (
    EventData,
    Retry,
    card,
    choice,
    local_input,
    text_area,
    text_input,
    words,
)
from .event_widgets import status as _status
from .event_widgets import typed as _typed
from .pages import BASE, part_name
from .zones import zone_groups, zone_label

EVENT = f"{BASE}/event"
# Always on (U4): the event cannot run without them, so they have no switch.
ALWAYS_ON = (
    ("agenda", "Run of show"),
    ("admin", "Admin"),
    ("tenants", "Sign-in"),
    ("theming", "Look"),
)
OTHERS = ("screen", "notify", "moments", "pizza")
GB = 1024**3


def _zones(current: str) -> str:
    names = [current, *(z for _, zones in zone_groups() for z, _ in zones if z != current)]
    return "".join(f'<option value="{esc(z)}">' for z in names)


def basics(session: Session, data: EventData, retry: Retry | None) -> str:
    tenant = data.tenant
    head = _status(data, "basics", retry)
    if tenant is None:
        return card("basics", "Basics", notice("warn", "The event's details didn't answer."))
    zone = str(tenant.get("time_zone") or "UTC")
    typed = _typed("basics", retry)
    if not (session.has("tenants.event.write") and "revision" in tenant):
        rows = [
            ("Name", tenant.get("name")),
            ("Short name", tenant.get("short_name") or "None"),
            ("Starts", _when(tenant.get("starts_at"), zone)),
            ("Ends", _when(tenant.get("ends_at"), zone)),
            ("Time zone", zone_label(zone)),
            ("Poster text", tenant.get("description") or "None"),
        ]
        return card("basics", "Basics", head + words(rows))

    def value(key: str, now: Any) -> str:
        return str(typed.get(key, "" if now is None else now))

    fields = (
        text_input("name", "Name", value("name", tenant.get("name")), maxlength=120)
        + text_input(
            "short_name",
            "Short name",
            value("short_name", tenant.get("short_name")),
            maxlength=24,
            hint="For narrow screens, such as a phone's header. Leave empty to use the name.",
        )
        + local_input(
            "starts_at", "Starts", value("starts_at", _local(tenant.get("starts_at"), zone))
        )
        + local_input("ends_at", "Ends", value("ends_at", _local(tenant.get("ends_at"), zone)))
        + text_input(
            "time_zone",
            "Time zone",
            value("time_zone", zone),
            hint="Type to search, for example Helsinki. Every time of the event is in this zone.",
            extra=' list="event-zones" autocomplete="off"',
        )
        + f'<datalist id="event-zones">{_zones(zone)}</datalist>'
        + text_area(
            "description",
            "Poster text",
            value("description", tenant.get("description")),
            maxlength=500,
            hint="A sentence or two for the event's front page.",
        )
    )
    return card(
        "basics",
        "Basics",
        head,
        form=(f"{EVENT}/basics", tenant["revision"], fields),
    )


def _local(iso: Any, zone: str) -> str:
    return local_time(str(iso), zone).strftime("%Y-%m-%dT%H:%M") if iso else ""


def _when(iso: Any, zone: str) -> str:
    if not iso:
        return "Not set"
    return f"{day_label(str(iso), zone)} {_local(iso, zone)[11:]}"


def web(data: EventData) -> str:
    if data.hostnames is None:
        return card("web", "Web addresses", notice("warn", "The web addresses didn't answer."))
    rows = []
    for h in data.hostnames:
        chip = (
            " " + status_chip("ok", "Primary", "Links, QR codes and screens use this address.")
            if h.get("primary")
            else ""
        )
        rows.append(f"<li><code>{esc(h.get('hostname'))}</code>{chip}</li>")
    body = (
        f'<ul class="canccu-plain-list">{"".join(rows)}</ul>'
        '<p class="canccu-card__desc">The platform admin adds and changes these.</p>'
    )
    return card("web", "Web addresses", body)


def access(session: Session, data: EventData, retry: Retry | None) -> str:
    tenant = data.tenant or {}
    source: Mapping[str, Any] = tenant if "admin_access" in tenant else (data.ctx or {})
    typed = _typed("access", retry)
    values = {
        key: str(typed.get(key, source.get(key, DEFAULTS[key]))) for key, *_ in ACCESS_SETTINGS
    }
    head = _status(data, "access", retry)
    read_only = retry is not None and retry.section == "access" and retry.read_only
    if read_only or not (session.has("tenants.access.write") and "revision" in tenant):
        rows = [
            (title, dict((v, w) for v, w, _ in opts).get(values[key], values[key]))
            for key, title, opts in ACCESS_SETTINGS
        ]
        return card(
            "access",
            "Access",
            head + words(rows) + f"<p>{esc(READ_ONLY)}</p>",
        )
    fields = "".join(
        choice(key, title, opts, values[key], DEFAULTS[key]) for key, title, opts in ACCESS_SETTINGS
    )
    return card("access", "Access", head, form=(ACCESS, tenant["revision"], fields))


def modules(session: Session, data: EventData, retry: Retry | None) -> str:
    links = data.settings_links
    head = _status(data, "modules", retry)
    flags = data.flags
    switches = dict(flags.get("flags", {})) if flags else {}
    can = session.has("tenants.flags.write") and flags is not None
    rows = []

    def link(module: str) -> str:
        href = links.get(module)
        return f' · <a href="{esc(href)}">Settings</a>' if href else ""

    for module, name in ALWAYS_ON:
        rows.append(f"<li><strong>{esc(name)}</strong> · Always on{link(module)}</li>")
    for module in OTHERS:
        name, key = part_name(module), f"{module}.enabled"
        if key not in switches:
            rows.append(f"<li><strong>{esc(name)}</strong> · On{link(module)}</li>")
        elif can:
            checked = " checked" if switches[key] else ""
            rows.append(
                f'<li><input class="canccu-switch" type=checkbox role=switch id="mod-{module}" '
                f'name="{esc(key)}" value="1"{checked}> <label for="mod-{module}">'
                f"<strong>{esc(name)}</strong></label>{link(module)}</li>"
            )
        else:
            state = "On" if switches[key] else "Off"
            rows.append(f"<li><strong>{esc(name)}</strong> · {state}{link(module)}</li>")
    listing = f'<ul class="canccu-plain-list">{"".join(rows)}</ul>'
    if flags is None:
        head += notice("warn", "The module switches didn't answer.")
    if not can:
        return card("modules", "Modules", head + listing)
    version = flags["flags_version"] if flags else 0
    return card(
        "modules",
        "Modules",
        head,
        form=(f"{EVENT}/modules", version, listing),
        version="flags_version",
    )


def organisers(session: Session, data: EventData, retry: Retry | None) -> str:
    tenant = data.tenant or {}
    head = _status(data, "organisers", retry)
    people = f'<p>Roles are given on <a href="{BASE}/people">People</a>.</p>'
    contact = str(
        _typed("organisers", retry).get("contact_user_id", tenant.get("contact_user_id") or "")
    )
    names = dict(data.people)
    if not (session.has("tenants.event.write") and "revision" in tenant):
        shown = names.get(contact, "Nobody yet") if contact else "Nobody yet"
        return card("organisers", "Organisers", head + people + words([("Contact person", shown)]))
    options = '<option value="">Nobody yet</option>' + "".join(
        f'<option value="{esc(uid)}"{" selected" if uid == contact else ""}>{esc(name)}</option>'
        for uid, name in data.people
    )
    field_ = (
        f'{people}<div class="canccu-field"><label class="canccu-field__label" for="ev-contact">'
        "Contact person</label>"
        f'<select class="canccu-input" id="ev-contact" name="contact_user_id">'
        f'{options}</select><p class="canccu-field__hint">Who people ask about the event. '
        "Organisers see the name; guests never do.</p></div>"
    )
    return card(
        "organisers", "Organisers", head, form=(f"{EVENT}/contact", tenant["revision"], field_)
    )


def _size(n: int) -> str:
    gb = n / GB
    return f"{gb:.0f} GB" if gb == int(gb) else f"{gb:.1f} GB"


def privacy(data: EventData) -> str:
    tenant = data.tenant or {}
    zone = str(tenant.get("time_zone") or "UTC")
    text = (
        "Presence data is deleted 30 days after the event is archived; other personal data is "
        "made anonymous 12 months after."
    )
    if tenant.get("presence_delete_at"):
        text += f" Presence data goes on {day_label(str(tenant['presence_delete_at']), zone)}."
    storage = data.storage
    used = (
        f"{_size(int(storage['used_bytes']))} of {_size(int(storage['quota_bytes']))} used"
        if storage
        else "Storage use didn't answer."
    )
    return card("privacy", "Privacy", f"<p>{esc(text)}</p><p>Files: {esc(used)}.</p>")


def series(data: EventData) -> str:
    if data.series and data.series.get("name"):
        body = f"<p>Part of the series {esc(data.series['name'])}.</p>"
    else:
        body = "<p>Not part of a series. The platform admin adds events to a series.</p>"
    return card("series", "Series", body)


def event_view(session: Session, data: EventData, retry: Retry | None = None) -> str:
    return "".join(
        (
            basics(session, data, retry),
            venue_section(session, data, retry),
            web(data),
            access(session, data, retry),
            modules(session, data, retry),
            organisers(session, data, retry),
            privacy(data),
            series(data),
        )
    )
