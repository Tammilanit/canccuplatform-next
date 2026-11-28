"""The days of a ticker window as people type and read them (D14 of the step 6 plan): "Sat",
"Sat and Sun", "sat-sun", "every day", and the Finnish "la, su"; ISO weekdays, 1 is Monday, as
Screen keeps them."""

from __future__ import annotations

import re

_NAMES = {
    1: ("mon", "monday", "mondays", "ma", "maanantai", "maanantaisin"),
    2: ("tue", "tues", "tuesday", "tuesdays", "ti", "tiistai", "tiistaisin"),
    3: ("wed", "wednesday", "wednesdays", "ke", "keskiviikko", "keskiviikkoisin"),
    4: ("thu", "thur", "thurs", "thursday", "thursdays", "to", "torstai", "torstaisin"),
    5: ("fri", "friday", "fridays", "pe", "perjantai", "perjantaisin"),
    6: ("sat", "saturday", "saturdays", "la", "lauantai", "lauantaisin"),
    7: ("sun", "sunday", "sundays", "su", "sunnuntai", "sunnuntaisin"),
}
_DAY = {name: day for day, names in _NAMES.items() for name in names}
_EVERY = ("every day", "everyday", "daily", "all", "joka päivä", "päivittäin", "kaikki")
SHORT = {
    "en": ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"),
    "fi": ("ma", "ti", "ke", "to", "pe", "la", "su"),
}
LONG = {
    "en": ("Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"),
    "fi": (
        "maanantaisin",
        "tiistaisin",
        "keskiviikkoisin",
        "torstaisin",
        "perjantaisin",
        "lauantaisin",
        "sunnuntaisin",
    ),
}
AND = {"en": "and", "fi": "ja"}
EVERY = {"en": "Every day", "fi": "Joka päivä"}


def parse(text: str) -> list[int] | None:
    """The days, sorted, or None when a word is no day."""
    said = text.strip().lower()
    if said in _EVERY:
        return list(range(1, 8))
    days: set[int] = set()
    for word in re.split(r"\s*(?:,|\band\b|\bja\b|\s)\s*", said):
        if not word:
            continue
        first, dash, last = word.partition("-")
        if first not in _DAY or (dash and last not in _DAY):
            return None
        start, end = _DAY[first], _DAY[last] if dash else _DAY[first]
        # A range runs on over the week's end: "fri-sun", "sat-mon".
        span = (end - start) % 7
        days.update((start - 1 + i) % 7 + 1 for i in range(span + 1))
    return sorted(days) or None


def said(days: list[int], language: str) -> str:
    """ "Sat and Sun", "Mon, Wed and Fri", "Every day"."""
    if sorted(days) == list(range(1, 8)):
        return EVERY[language]
    names = [SHORT[language][d - 1] for d in sorted(days)]
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} {AND[language]} {names[-1]}"


def repeats(days: list[int], language: str) -> str:
    """ "Sundays", "Saturdays and Sundays": when a window comes round again."""
    if sorted(days) == list(range(1, 8)):
        return EVERY[language].lower()
    names = [LONG[language][d - 1] for d in sorted(days)]
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} {AND[language]} {names[-1]}"
