"""The Channels and Check tabs (mockups 03 and 04 of the step 6 brief), drawn from the contract's
own reads (contracts/bot.md, Purposes and The setup check): each purpose bound to a channel or a
role of the server, missing, or not on; and per feature what the bot needs there, whether it has
it, and the whole sentence that fixes it."""

from __future__ import annotations

from typing import Any

from canccu_kit import ui
from canccu_kit.ui import esc

from . import server as live
from .page_overview import FEATURE_LABELS
from .page_web import BASE, View, button, form, here, link, time_words
from .purposes import BY_NAME, TYPES

ABOUT = {
    "announcements": "Announcements and the run of show",
    "now_and_next": "The living board, pinned",
    "food": "Orders, edited in place",
    "photos": "Pictures here can go to the screen",
    "crew": "Crew-only posts and alerts",
    "tournaments": "Match posts, once tournaments are on",
    "match_voice": "A category for match channels",
    "crew_role": "The crew, who see the crew channel",
    "attendee_role": "Everyone at the event",
}
TITLES = {
    "announcements": "Announcements",
    "now_and_next": "Now and next",
    "food": "Food",
    "photos": "Photos",
    "crew": "Crew",
    "tournaments": "Tournaments",
    "match_voice": "Match voice",
    "crew_role": "Crew",
    "attendee_role": "Attendees",
}
# What turns a purpose on, as the organiser knows it: its feature, not its flag.
FEATURE_OF = {
    "pizza.enabled": "Food",
    "screen.photos": "the photo wall",
    "tournament.enabled": "Tournaments",
}
CHIPS = {
    "bound": ("ok", "Bound", "The bot uses this one."),
    "missing": ("degraded", "Missing", "Nothing is picked, or the one picked was deleted."),
    "not_on": ("plain", "Not on", "Its feature is off at this event."),
}


def _shown(kind: str, name: Any) -> str:
    return f"# {name}" if kind == "channel" else (f"@{name}" if kind == "role" else str(name))


def _options(server: live.Server, kind: str) -> list[tuple[str, str]]:
    """The pick list, read live: channels of the purpose's type, or the roles the bot may
    use (neither @everyone nor an integration's own)."""
    if kind == "role":
        roles = [
            r for r in server.roles.values() if r["id"] != server.guild_id and not r.get("managed")
        ]
        roles.sort(key=lambda r: -(r.get("position") or 0))
        return [(str(r["id"]), _shown("role", r.get("name"))) for r in roles]
    found = [c for c in server.channels.values() if c.get("type") in TYPES[kind]]
    found.sort(key=lambda c: (c.get("position") or 0, c["id"]))
    return [(str(c["id"]), _shown(kind, c.get("name"))) for c in found]


def _pick(view: View, p: dict[str, Any], server: live.Server) -> str:
    title = TITLES[p["purpose"]]
    current = p["target_id"] if p["state"] == "bound" else None
    options = '<option value="">None picked</option>' + "".join(
        f'<option value="{esc(v)}"{" selected" if v == current else ""}>{esc(label)}</option>'
        for v, label in _options(server, p["kind"])
    )
    body = (
        '<div class="canccu-inputgroup">'
        f'<select class="canccu-input" name="target_id" data-bot-null aria-label="{esc(title)}">'
        f"{options}</select>{button('Use')}</div>"
    )
    api = f"/api/bot/guild/purposes/{p['purpose']}"
    return form(api, "PUT", f"{BASE}/channels?done=picked", body)


def _card(view: View, p: dict[str, Any], server: live.Server) -> str:
    kind, label, words = CHIPS[p["state"]]
    head = (
        f'<div class="bot-card__head"><h3 class="canccu-card__title">{esc(TITLES[p["purpose"]])}'
        f"</h3>{ui.status_chip(kind, label, words)}</div>"
        f'<p class="canccu-muted canccu-small">{esc(ABOUT[p["purpose"]])}</p>'
    )
    if p["state"] == "not_on":
        feature = FEATURE_OF.get(p["flag"] or "", "its feature")
        control = f'<p class="bot-dashed">Turn on {esc(feature)} first</p>'
    elif view.writes:
        control = _pick(view, p, server)
    elif p["state"] == "bound":
        control = f'<p class="bot-target">{esc(_shown(p["kind"], p["target_name"]))}</p>'
    else:
        control = '<p class="bot-target canccu-muted">None picked</p>'
    gone = ""
    if p["state"] == "missing" and p["target_id"] is not None:
        gone = '<p class="canccu-small canccu-muted">The one picked was deleted in Discord.</p>'
    return f'<li class="canccu-card bot-purpose">{head}{gone}{control}</li>'


def channels(view: View, purposes: list[dict[str, Any]], server: live.Server, setup: bool) -> str:
    """Channels (mockup 03): one auto-fill grid of cards per kind; features that are off grey."""
    count = {s: sum(1 for p in purposes if p["state"] == s) for s in CHIPS}
    summary = (
        f"{len(purposes)} purposes · {count['bound']} bound · {count['missing']} missing · "
        f"{count['not_on']} not on at this event"
    )
    actions = ""
    if view.writes and count["missing"]:
        actions += form(
            "/api/bot/guild/purposes/create-missing",
            "POST",
            f"{BASE}/channels?done=created",
            button("Create what is missing"),
        )
    actions += link(here("/check", setup), "Next: run the check", "primary")
    head = (
        f'<div class="bot-bar"><p class="canccu-muted">{esc(summary)}</p>'
        f'<div class="canccu-cluster">{actions}</div></div>'
    )
    places = [p for p in purposes if BY_NAME[p["purpose"]].kind != "role"]
    roles = [p for p in purposes if BY_NAME[p["purpose"]].kind == "role"]

    def grid(items: list[dict[str, Any]]) -> str:
        return f'<ul class="canccu-grid">{"".join(_card(view, p, server) for p in items)}</ul>'

    return f'{head}{grid(places)}<h2 class="bot-h2">Roles</h2>{grid(roles)}'


def _where(row: dict[str, Any]) -> str:
    where = row["where"]
    return _shown(where.get("type") or "", where.get("name") or "it")


def row_words(row: dict[str, Any]) -> str:
    """What one row of the check found, in words; its fix is the contract's own sentence."""
    need, ok = row["need"], row["ok"]
    if need == "purpose":
        return f"No {row['where']['type']} picked"
    if need == "permission":
        if ok:
            return f"Has what it needs in {_where(row)}"
        missing = " and ".join(f"“{m}”" for m in row["missing"])
        return f"Lacks {missing} in {_where(row)}"
    if need == "intent":
        return f"The {row['where']['name']} is {'on' if ok else 'off'}"
    role = row["where"].get("name")
    return f"The bot's role is {'above' if ok else 'not above'} {role}"


def _fix_action(view: View, feature: dict[str, Any]) -> str:
    """The one fix the bot makes itself for this feature, if any (contracts/bot.md, Fixes the
    bot makes itself)."""
    if not view.writes:
        return ""
    actions = {r["fix_action"] for r in feature["rows"] if r["fix_action"]}
    if "allow_in_channel" in actions:
        field = f'<input type="hidden" name="feature" value="{esc(feature["feature"])}">'
        return form(
            "/api/bot/guild/check/fix",
            "POST",
            f"{BASE}/check?done=fixed",
            field + button("Fix it"),
        )
    if "create_missing" in actions:
        return form(
            "/api/bot/guild/purposes/create-missing",
            "POST",
            f"{BASE}/check?done=created",
            button("Create it"),
        )
    return ""


def _feature(view: View, feature: dict[str, Any]) -> str:
    name, state = feature["feature"], feature["state"]
    label = FEATURE_LABELS.get(name, name)
    if state == "not_on":
        text = '<p class="canccu-muted">Not on at this event</p>'
        mark = '<span class="bot-mark bot-mark--plain" aria-hidden="true"></span>'
    elif state == "ok":
        found = " · ".join(row_words(r) for r in feature["rows"]) or "Ready"
        text = f"<p>{esc(found)}</p>"
        mark = f'<span class="bot-mark bot-mark--ok">{ui.icon("check-circle")}</span>'
    else:
        gaps = [r for r in feature["rows"] if not r["ok"]]
        text = "".join(
            f'<p>{esc(row_words(r))}</p><p class="bot-fix">Fix: {esc(r["fix"])}</p>' for r in gaps
        )
        mark = f'<span class="bot-mark bot-mark--degraded">{ui.icon("warn")}</span>'
    return (
        f'<li class="bot-check bot-check--{state}" data-feature="{esc(name)}">{mark}'
        f'<p class="bot-check__name">{esc(label)}</p><div class="bot-check__what">{text}</div>'
        f"{_fix_action(view, feature) if state == 'gaps' else ''}</li>"
    )


def check(view: View, result: dict[str, Any], setup: bool) -> str:
    """Check (mockup 04): a row per feature, only the gaps coloured; on a phone the gaps first
    and the ready ones in one line."""
    gaps = result["gaps"]
    when = time_words(result["checked_at"], view.zone, result["checked_at"])
    title = f"{gaps} thing{'s' if gaps != 1 else ''} to fix" if gaps else "Everything ready"
    ico = "warn" if gaps else "check-circle"
    again = form(
        "/api/bot/guild/check",
        "POST",
        f"{here('/check', setup)}{'&' if setup else '?'}done=checked",
        button("Check again"),
    )
    head = (
        f'<div class="bot-bar"><p class="bot-check-head">{ui.icon(ico)}{esc(title)} · '
        f"checked {esc(when)}</p>{again}</div>"
    )
    ready = [
        FEATURE_LABELS.get(f["feature"], f["feature"])
        for f in result["features"]
        if f["state"] == "ok"
    ]
    summary = ""
    if ready and gaps:
        summary = (
            f'<li class="bot-check bot-check--summary"><p class="bot-check__name">'
            f'{len(ready)} more are ready</p><p class="canccu-muted canccu-small">'
            f"{esc(' · '.join(ready))}</p></li>"
        )
    rows = "".join(_feature(view, f) for f in result["features"])
    return f'{head}<ul class="bot-checks">{rows}{summary}</ul>'
