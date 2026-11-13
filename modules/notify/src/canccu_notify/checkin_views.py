"""What each step of checking in says (docs/design/mockups.html, sheet 7; #441): one card with an
icon, a title, one or two sentences and the next step, under the event's poster. HTML only; the
routes in checkin_page pick the step."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from canccu_kit import ui

OPTIONAL = '<p class="canccu-small canccu-muted">Checking in is optional.</p>'
BUTTON = "canccu-button canccu-button--primary canccu-button--lg canccu-button--block"
SCRIPT = '<script src="/notify/static/check-in.js" defer></script>'


def card(ico: str, title: str, text: str, action: str = "", foot: str = OPTIONAL) -> str:
    return (
        f'<span class="canccu-task__icon">{ui.icon(ico)}</span><h1>{ui.esc(title)}</h1>'
        f"<p>{ui.esc(text)}</p>{action}{foot}"
    )


def discord_form(back: str, label: str) -> str:
    """Straight to Discord through admin's sign-in, which comes back to `back` (a path here)."""
    return (
        '<form method="post" action="/admin/sign-in">'
        f'<input type="hidden" name="next" value="{ui.esc(back)}">'
        f'<button class="{BUTTON}">{label}</button></form>'
    )


def sign_in(back: str, cancelled: bool) -> str:
    if cancelled:
        return card(
            "alert",
            "Discord sign-in was cancelled",
            "You closed Discord before it finished. You are not checked in yet.",
            discord_form(back, "Try again with Discord"),
        )
    return card(
        "pin",
        "Check in",
        "Tell the crew you have arrived. You sign in with Discord once; after that it is one tap.",
        discord_form(back, "Continue with Discord"),
    )


def ready(user_name: str, purpose: str, code: str) -> str:
    form = (
        '<form method="post" action="/notify/check-in">'
        f'<input type="hidden" name="p" value="{ui.esc(purpose)}">'
        f'<input type="hidden" name="c" value="{ui.esc(code)}">'
        f'<button class="{BUTTON}">{ui.icon("check")}Check in</button></form>'
    )
    text = f"You're signed in as {user_name}. One tap and the crew knows you're here."
    return card("pin", "Check in", text, form) + unreachable()


def unreachable(retry: str = "") -> str:
    """The card check-in.js shows when the tap never reaches the event (the phone is offline)."""
    again = f'<a class="{BUTTON}" href="{ui.esc(retry)}">{ui.icon("refresh")}Try again</a>'
    inner = card(
        "alert",
        "Couldn't check you in",
        "Your phone didn't reach the event. You may have just lost signal.",
        again,
    )
    return f"<template data-canccu-unreachable>{inner}</template>{SCRIPT}"


def failed(retry: str) -> str:
    """The event answered, but could not check anyone in."""
    again = f'<a class="{BUTTON}" href="{ui.esc(retry)}">{ui.icon("refresh")}Try again</a>'
    return card(
        "alert",
        "Couldn't check you in",
        "Checking in didn't work this time. Try again in a moment.",
        again,
    )


def not_open(starts: datetime, time_zone: str) -> str:
    local = starts.astimezone(ZoneInfo(time_zone))
    text = (
        f"Doors open on {ui.day_label(local, time_zone)} at {local:%H:%M}."
        " Scan the code on a screen when you arrive."
    )
    return card("clock", f"Check-in opens on {local:%A}", text, foot="")


def closed() -> str:
    return card(
        "archive", "Check-in has closed", "The event has ended. Thanks for coming.", foot=""
    )


def off_venue(ssid: str | None, retry: str) -> str:
    join = f"Join {ssid}" if ssid else "Join the venue's Wi-Fi"
    again = f'<a class="{BUTTON}" href="{ui.esc(retry)}">{ui.icon("refresh")}Try again</a>'
    text = f"Checking in works on the venue's Wi-Fi. {join}, then scan the code on a screen again."
    return card("pin", "Check in at the venue", text, again)


def expired(rotation_seconds: int) -> str:
    """ "Scan again" opens the camera where the browser can read a QR code (check-in.js); the
    info desk is the way on when that fails."""
    scan = (
        f'<button type="button" class="{BUTTON}" data-canccu-scan>Scan again</button>'
        '<p class="canccu-small canccu-muted" data-canccu-scan-hint hidden>Open your phone\'s'
        " camera and point it at the screen.</p>"
    )
    text = (
        f"The code on the screen changes every {rotation_seconds} seconds."
        " Point your camera at the screen again."
    )
    foot = '<p class="canccu-small canccu-muted">No luck? The info desk can check you in.</p>'
    return card("clock", "This code has expired", text, scan, foot) + SCRIPT


def done(
    title: str, text: str, wifi: list[dict[str, Any]], now: dict[str, Any] | None, zone: str
) -> str:
    """The confirmation, then what is useful right now: the Wi-Fi and what is on."""
    rows = []
    for network in wifi[:2]:
        password = network.get("password")
        reveal = (
            '<details class="canccu-checkin__reveal"><summary>Show password</summary>'
            f"<code>{ui.esc(password)}</code></details>"
            if password
            else ""
        )
        rows.append(
            f'<div class="canccu-checkin__row">{ui.icon("info")}<div>'
            f"<b>Wi-Fi: {ui.esc(network.get('ssid'))}</b>{reveal}</div></div>"
        )
    current = (now or {}).get("current") or []
    if current:
        item = current[0]
        late = item.get("delay_minutes") or 0
        badge = (
            f' <span class="canccu-badge canccu-badge--late">+{late} min</span>' if late > 0 else ""
        )
        where = [str(item["location"])] if item.get("location") else []
        if item.get("ends_at"):
            where.append(f"until {ui.time_label(item['ends_at'], zone)}")
        rows.append(
            f'<div class="canccu-checkin__row">{ui.icon("calendar")}<div>'
            f"<b>Now: {ui.esc(item.get('title'))}</b>{badge}"
            f'<p class="canccu-muted">{ui.esc(" · ".join(where))}</p></div></div>'
        )
    extra = f'<div class="canccu-checkin__rows">{"".join(rows)}</div>' if rows else ""
    return card("check-circle", title, text, extra, foot="")
