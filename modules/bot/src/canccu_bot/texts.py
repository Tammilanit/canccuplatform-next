"""The framework's own answers, in the event's languages (U5 of the step 6 plan): each person reads
them in their Discord client's language when the platform speaks it, otherwise in English. A
command's own answers come with the command. The wording of the kind "no" answers is mockup 07's;
"not connected" is the product owner's final one: what to do, and who can do it."""

from __future__ import annotations

LANGUAGES = ("en", "fi")

TEXTS: dict[str, dict[str, str]] = {
    "not_connected": {
        "en": "This server is not connected to an event yet. Ask an event admin to connect it on"
        " the event's Discord page.",
        "fi": "Tätä palvelinta ei ole vielä yhdistetty tapahtumaan. Pyydä tapahtuman ylläpitäjää"
        " yhdistämään se tapahtuman Discord-sivulla.",
    },
    "outside": {
        "en": "Use the bot's commands in your event's Discord server.",
        "fi": "Käytä botin komentoja tapahtumasi Discord-palvelimella.",
    },
    "ended": {
        "en": "This event has ended; the bot does nothing more here.",
        "fi": "Tämä tapahtuma on päättynyt; botti ei tee täällä enää mitään.",
    },
    "feature_off": {
        "en": "/{command} is not on at {event}. Ask the crew; the command goes away within a"
        " minute.",
        "fi": "/{command} ei ole käytössä tapahtumassa {event}. Kysy crew'lta; komento poistuu"
        " minuutin kuluessa.",
    },
    "sign_in": {
        "en": "Sign in to {event} once to use /{command}. Then your roles bring the rights.",
        "fi": "Kirjaudu kerran tapahtumaan {event} käyttääksesi komentoa /{command}. Sen jälkeen"
        " roolisi tuovat oikeudet.",
    },
    "sign_in_button": {"en": "Sign in", "fi": "Kirjaudu"},
    "no_right": {
        "en": "You need the {right} right for /{command}. Ask an event admin.",
        "fi": "Tarvitset {right}-oikeuden komentoon /{command}. Kysy tapahtuman ylläpitäjältä.",
    },
    "no_right_unnamed": {
        "en": "/{command} needs a right you do not have yet. Ask an event admin.",
        "fi": "/{command} vaatii oikeuden, jota sinulla ei vielä ole. Kysy tapahtuman"
        " ylläpitäjältä.",
    },
    "too_slow": {
        "en": "{event} did not answer in time. Nothing was sent. Try again in a moment.",
        "fi": "{event} ei vastannut ajoissa. Mitään ei lähetetty. Yritä hetken päästä uudelleen.",
    },
    "unreachable": {
        "en": "{event} is not reachable right now. Try again in a moment.",
        "fi": "{event} ei ole juuri nyt tavoitettavissa. Yritä hetken päästä uudelleen.",
    },
    "failed": {
        "en": "That did not work. Try again later.",
        "fi": "Se ei onnistunut. Yritä myöhemmin uudelleen.",
    },
    "old_component": {
        "en": "This button is old. Run the command again.",
        "fi": "Tämä painike on vanha. Suorita komento uudelleen.",
    },
    "link_expired": {
        "en": "This link has expired. Run /{command} again.",
        "fi": "Tämä linkki on vanhentunut. Suorita /{command} uudelleen.",
    },
    "this_event": {"en": "this event", "fi": "tämä tapahtuma"},
}


def language(locale: str | None) -> str:
    """Discord's locale (`fi`, `en-US`, `en-GB` …) to one of the platform's languages."""
    base = (locale or "").split("-")[0].lower()
    return base if base in LANGUAGES else "en"


def text(key: str, locale: str | None, **values: str) -> str:
    by_language = TEXTS[key]
    return by_language[language(locale)].format(**values)


def pick(by_language: dict[str, str], locale: str | None) -> str:
    """A command's own text in the person's language, English when it has no other."""
    return by_language.get(language(locale)) or by_language["en"]
