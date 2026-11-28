"""`/ticker` (0018, D14 of the step 6 plan; mockup 09): the screens' manual ticker and its weekly
windows, through Screen's API with the person's rights. The replies quote the line, which is the
crew's own words but may hold anything: they go through the guard (no pings, no link off the
event's hosts) like every post that carries someone's words."""

from __future__ import annotations

from typing import Any

from . import days as week
from .clock import hhmm, minute_of, next_at
from .components import Component
from .framework import Button, Command, Context, Field, Form, Option, Reply, Subcommand
from .guard import strip_foreign_links
from .texts import language, pick

TICKER = "/api/screen/ticker"
WINDOWS = "/api/screen/ticker/windows"

SAY: dict[str, dict[str, str]] = {
    "set": {
        "en": "The ticker says “{text}” on every screen {until}.",
        "fi": "Tickerissä lukee ”{text}” kaikilla näytöillä {until}.",
    },
    "until": {"en": "until {time}", "fi": "{time} asti"},
    "for_now": {"en": "until someone stops it", "fi": "kunnes joku pysäyttää sen"},
    "stop_now": {"en": "Stop now", "fi": "Pysäytä nyt"},
    "keep": {"en": "Keep until …", "fi": "Pidä kunnes …"},
    "keep_form": {"en": "Keep the ticker until", "fi": "Pidä tickeri kunnes"},
    "keep_field": {"en": "Until (HH:MM)", "fi": "Asti (HH:MM)"},
    "stopped": {
        "en": "The ticker is cleared on every screen.",
        "fi": "Tickeri on tyhjennetty kaikilta näytöiltä.",
    },
    "now": {"en": "The ticker now", "fi": "Tickeri nyt"},
    "empty": {"en": "The ticker is empty.", "fi": "Tickeri on tyhjä."},
    "from_window": {"en": "from a window", "fi": "ikkunasta"},
    "from_food": {"en": "the food line", "fi": "ruokarivi"},
    "windows": {"en": "Windows", "fi": "Ikkunat"},
    "no_windows": {"en": "No ticker windows.", "fi": "Ei tickeri-ikkunoita."},
    "window": {"en": "{days} {span} “{text}”", "fi": "{days} {span} ”{text}”"},
    "added": {
        "en": "Added: {window}.\nIt repeats {repeats}; remove it with /ticker schedule remove.",
        "fi": "Lisätty: {window}.\nSe toistuu {repeats}; poista se komennolla /ticker schedule"
        " remove.",
    },
    "removed": {"en": "Removed: {window}.", "fi": "Poistettu: {window}."},
    "no_number": {
        "en": "There is no window number {n}. See them with /ticker schedule list.",
        "fi": "Ikkunaa numero {n} ei ole. Katso ne komennolla /ticker schedule list.",
    },
    "bad_time": {
        "en": "Write the time as HH:MM, like 21:00.",
        "fi": "Kirjoita aika muodossa HH:MM, esimerkiksi 21:00.",
    },
    "bad_days": {
        "en": "Write the days like “Sat”, “Sat and Sun” or “every day”.",
        "fi": "Kirjoita päivät esimerkiksi ”la”, ”la ja su” tai ”joka päivä”.",
    },
    "end_first": {
        "en": "The end must be after the start.",
        "fi": "Lopun pitää olla alun jälkeen.",
    },
}


def say(c: Context, key: str, **values: Any) -> str:
    return pick(SAY[key], c.caller.locale).format(**values)


def _quoted(c: Context, text: Any) -> str:
    return strip_foreign_links(str(text or ""), c.hosts)


def _set_reply(c: Context, ticker: dict[str, Any]) -> Reply:
    until = ticker.get("until")
    when = say(c, "until", time=hhmm(until, c.time_zone)) if until else say(c, "for_now")
    return Reply(
        say(c, "set", text=_quoted(c, ticker.get("text")), until=when),
        buttons=[
            Button(say(c, "stop_now"), step="stop", style="danger"),
            Button(say(c, "keep"), step="keep", style="secondary"),
        ],
    )


async def _put(c: Context, text: str, until: str) -> Reply:
    at = None
    if until.strip():
        minute = minute_of(until)
        if minute is None:
            return Reply(say(c, "bad_time"))
        at = next_at(minute, c.now(), c.time_zone).isoformat()
    body = {"text": text, "until": at}
    ticker = await c.act("screen", "PUT", TICKER, body) or body
    return _set_reply(c, ticker)


def _window(c: Context, window: dict[str, Any]) -> str:
    def clock(minute: int) -> str:
        return f"{minute // 60:02d}:{minute % 60:02d}"

    return say(
        c,
        "window",
        days=week.said(list(window.get("days") or []), language(c.caller.locale)),
        span=f"{clock(int(window.get('start_minute', 0)))}\N{EN DASH}"
        f"{clock(int(window.get('end_minute', 0)))}",
        text=_quoted(c, window.get("text")),
    )


async def _windows(c: Context) -> list[dict[str, Any]]:
    answer = await c.act("screen", "GET", WINDOWS, None) or {}
    return list(answer.get("windows") or [])


async def _status(c: Context) -> Reply:
    ticker = await c.act("screen", "GET", TICKER, None) or {}
    lines = [f"**{say(c, 'now')}**"]
    if ticker.get("text"):
        lines.append(f"“{_quoted(c, ticker['text'])}”")
        source = {"window": "from_window", "pizza": "from_food"}.get(ticker.get("source") or "")
        until = ticker.get("until")
        facts = [say(c, source)] if source else []
        facts += [say(c, "until", time=hhmm(until, c.time_zone))] if until else []
        if facts:
            lines.append(" · ".join(facts))
    else:
        lines.append(say(c, "empty"))
    windows = await _windows(c)
    if windows:
        lines.append(f"{say(c, 'windows')}: " + "; ".join(_window(c, w) for w in windows))
    return Reply("\n".join(lines))


async def _schedule_add(c: Context) -> Reply:
    days = week.parse(str(c.options.get("days") or ""))
    if days is None:
        return Reply(say(c, "bad_days"))
    start, end = minute_of(str(c.options.get("start"))), minute_of(str(c.options.get("end")))
    if start is None or end is None or start >= 1440:
        return Reply(say(c, "bad_time"))
    if end <= start:
        return Reply(say(c, "end_first"))
    body = {"text": c.options["text"], "days": days, "start_minute": start, "end_minute": end}
    window = await c.act("screen", "POST", WINDOWS, body) or body
    repeats = week.repeats(days, language(c.caller.locale))
    return Reply(say(c, "added", window=_window(c, window), repeats=repeats))


async def _schedule_list(c: Context) -> Reply:
    windows = await _windows(c)
    if not windows:
        return Reply(say(c, "no_windows"))
    return Reply("\n".join(f"{i}. {_window(c, w)}" for i, w in enumerate(windows, 1)))


async def _schedule_remove(c: Context) -> Reply:
    number = int(c.options.get("number") or 0)
    windows = await _windows(c)
    if not 1 <= number <= len(windows):
        return Reply(say(c, "no_number", n=number))
    window = windows[number - 1]
    await c.act("screen", "DELETE", f"{WINDOWS}/{window['id']}", None)
    return Reply(say(c, "removed", window=_window(c, window)))


async def run(c: Context) -> Reply:
    if c.subcommand == "set":
        return await _put(c, str(c.options["text"]), str(c.options.get("until") or ""))
    if c.subcommand == "stop":
        await c.act("screen", "DELETE", TICKER, None)
        return Reply(say(c, "stopped"))
    if c.subcommand == "schedule add":
        return await _schedule_add(c)
    if c.subcommand == "schedule list":
        return await _schedule_list(c)
    if c.subcommand == "schedule remove":
        return await _schedule_remove(c)
    return await _status(c)


async def on_component(c: Context, component: Component, values: dict[str, str]) -> Reply:
    if component.step == "stop":
        await c.act("screen", "DELETE", TICKER, None)
        return Reply(say(c, "stopped"))
    # "Keep until …": the line as it is now, with a new end.
    ticker = await c.act("screen", "GET", TICKER, None) or {}
    if not ticker.get("text"):
        return Reply(say(c, "empty"))
    return await _put(c, str(ticker["text"]), values.get("until", ""))


def keep_form(c: Context, component: Component | None) -> Form:
    field = Field("until", say(c, "keep_field"), max_length=5)
    return Form("kept", say(c, "keep_form"), (field,))


def _text(en: str, fi: str) -> dict[str, str]:
    return {"en": en, "fi": fi}


TEXT = Option("text", _text("The line on the screens", "Rivi näytöillä"), required=True)
TICKER_COMMAND = Command(
    name="ticker",
    flag=None,
    description=_text("The screens' ticker line", "Näyttöjen tickeri-rivi"),
    run=run,
    subcommands=(
        Subcommand(
            "set",
            _text("Set the ticker line", "Aseta tickeri-rivi"),
            (TEXT, Option("until", _text("Until (HH:MM)", "Asti (HH:MM)"))),
        ),
        Subcommand("stop", _text("Clear the ticker", "Tyhjennä tickeri")),
        Subcommand("status", _text("The ticker and its windows", "Tickeri ja sen ikkunat")),
        Subcommand(
            "add",
            _text("Add a weekly window", "Lisää viikoittainen ikkuna"),
            (
                Option(
                    "days", _text("Days, like Sat and Sun", "Päivät, kuten la ja su"), required=True
                ),
                Option("start", _text("Start (HH:MM)", "Alku (HH:MM)"), required=True),
                Option("end", _text("End (HH:MM)", "Loppu (HH:MM)"), required=True),
                TEXT,
            ),
            group="schedule",
        ),
        Subcommand("list", _text("The windows", "Ikkunat"), group="schedule"),
        Subcommand(
            "remove",
            _text("Remove a window", "Poista ikkuna"),
            (Option("number", _text("Its number in the list", "Sen numero"), "integer", True),),
            group="schedule",
        ),
    ),
    groups={"schedule": _text("Weekly ticker windows", "Viikoittaiset tickeri-ikkunat")},
    on_component=on_component,
    forms={"keep": keep_form},
    right_names={"screen.ticker.write": _text("Ticker", "Tickeri")},
)
