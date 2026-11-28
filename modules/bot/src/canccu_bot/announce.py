"""`/announce` (U3 of the step 6 plan; mockup 08): the one announce action from Discord. A form
(title and text), then a private preview with the level and where it goes, then Send, all
through Moments' composer API as the person: the screens, the ticker, the event's Discord post
and push come from Moments' own `moments.announcement.sent`, never from this command. Zones, a
schedule, a run-of-show item and templates are the composer's: "Open the composer".

The draft waits in `Context.notes` between the steps, for the person who wrote it only: a
button's custom id carries no text."""

from __future__ import annotations

import secrets
from typing import Any

from .components import Component
from .framework import Button, Command, Context, Field, Form, Reply
from .texts import pick

DRAFT_TTL_S = 15 * 60
"""As long as Discord lets the bot edit the preview: after that its buttons are old anyway."""
LEVELS = ("info", "important", "urgent")
CHANNELS = {"screen": True, "ticker": True, "discord": True, "push": True}
"""Every channel, as mockup 08 previews it; fewer is the composer's."""

SAY: dict[str, dict[str, str]] = {
    "form_title": {"en": "Announce to {event}", "fi": "Tiedota: {event}"},
    "title": {"en": "Title", "fi": "Otsikko"},
    "body": {"en": "Text", "fi": "Teksti"},
    "ready": {
        "en": "Ready to send. This is what goes out:",
        "fi": "Valmis lähetettäväksi. Tämä lähtee:",
    },
    "screens_all": {"en": "Screens: all zones, {level}", "fi": "Näytöt: kaikki alueet, {level}"},
    "screens_some": {"en": "Screens: {n} zones, {level}", "fi": "Näytöt: {n} aluetta, {level}"},
    "ticker": {"en": "Ticker", "fi": "Tickeri"},
    "discord": {"en": "Discord", "fi": "Discord"},
    "push": {"en": "Push", "fi": "Push"},
    "level": {"en": "Level: {level}", "fi": "Taso: {level}"},
    "info": {"en": "Info", "fi": "Tiedote"},
    "important": {"en": "Important", "fi": "Tärkeä"},
    "urgent": {"en": "Urgent", "fi": "Kiireellinen"},
    "send": {"en": "Send now", "fi": "Lähetä nyt"},
    "back": {"en": "Back", "fi": "Takaisin"},
    "composer": {"en": "Open the composer", "fi": "Avaa editori"},
    "sent": {
        "en": "Sent to {event}: “{title}”. Edit or withdraw it in the composer.",
        "fi": "Lähetetty: {event}: ”{title}”. Muokkaa tai peru se editorissa.",
    },
    "gone": {
        "en": "This draft is old. Run /announce again.",
        "fi": "Tämä luonnos on vanha. Suorita /announce uudelleen.",
    },
}


def say(c: Context, key: str, **values: Any) -> str:
    return pick(SAY[key], c.caller.locale).format(**values)


def _composer(c: Context) -> list[Button]:
    url = c.page("/moments/announce")
    return [] if url is None else [Button(say(c, "composer"), url=url, style="link")]


def _form(c: Context, draft: dict[str, Any] | None) -> Form:
    draft = draft or {}
    fields = (
        Field("title", say(c, "title"), value=draft.get("title", ""), max_length=60),
        Field(
            "body",
            say(c, "body"),
            value=draft.get("body", ""),
            max_length=140,
            required=False,
            long=True,
        ),
    )
    # Discord cuts a form's title at 45 characters.
    return Form("draft", say(c, "form_title", event=c.event_name)[:45], fields)


def open_form(c: Context, component: Component | None) -> Form:
    return _form(c, None)


async def back_form(c: Context, component: Component | None) -> Form:
    return _form(c, None if component is None else await _draft(c, component.args.split("~")[0]))


async def _draft(c: Context, draft_id: str) -> dict[str, Any] | None:
    if c.notes is None or not draft_id:
        return None
    draft = await c.notes.get("draft", draft_id)
    # Another person's draft is not theirs to send, even with the button's id in hand.
    return draft if isinstance(draft, dict) and draft.get("by") == c.caller.user_id else None


def _input(draft: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": draft["title"],
        "body": draft.get("body", ""),
        "level": draft.get("level", "info"),
        "channels": CHANNELS,
        "zones": [],
        "when": {"mode": "now"},
    }


def _where(c: Context, preview: dict[str, Any], level: str) -> str:
    named = say(c, level).lower()
    zones = preview.get("zones") or []
    parts = []
    if preview.get("regions"):
        parts.append(
            say(c, "screens_some", n=len(zones), level=named)
            if zones
            else say(c, "screens_all", level=named)
        )
    parts += [say(c, k) for k in ("ticker", "discord", "push") if preview.get(_KEY[k])]
    return " · ".join(parts)


_KEY = {"ticker": "line", "discord": "discord", "push": "push"}


async def _preview(c: Context, draft_id: str, draft: dict[str, Any]) -> Reply:
    preview = (
        await c.act("moments", "POST", "/api/moments/announcements/preview", _input(draft)) or {}
    )
    level = draft.get("level", "info")
    embed = {
        "title": str(preview.get("title") or draft["title"]),
        "description": str(preview.get("body") or ""),
        "footer": {"text": _where(c, preview, level)},
    }
    levels = [
        Button(
            say(c, name),
            step="level",
            args=f"{draft_id}~{name}",
            style="primary" if name == level else "secondary",
        )
        for name in LEVELS
    ]
    actions = [
        Button(say(c, "send"), step="send", args=draft_id, style="success"),
        Button(say(c, "back"), step="back", args=draft_id, style="secondary"),
    ]
    return Reply(
        f"{say(c, 'ready')}\n{say(c, 'level', level=say(c, level))}",
        embeds=[embed],
        buttons=levels + actions + _composer(c),
    )


async def on_component(c: Context, component: Component, values: dict[str, str]) -> Reply:
    if component.step == "draft":  # the form was sent
        draft = {
            "title": values.get("title", "").strip(),
            "body": values.get("body", "").strip(),
            "level": "info",
            "by": c.caller.user_id,
        }
        draft_id = secrets.token_urlsafe(9)
        if c.notes is not None:
            await c.notes.put("draft", draft_id, draft, DRAFT_TTL_S)
        return await _preview(c, draft_id, draft)
    draft_id, _, level = component.args.partition("~")
    kept = await _draft(c, draft_id)
    if kept is None:
        return Reply(say(c, "gone"))
    if component.step == "level" and level in LEVELS:
        kept["level"] = level
        if c.notes is not None:
            await c.notes.put("draft", draft_id, kept, DRAFT_TTL_S)
        return await _preview(c, draft_id, kept)
    sent = await c.act("moments", "POST", "/api/moments/announcements", _input(kept)) or {}
    if c.notes is not None:
        await c.notes.drop("draft", draft_id)
    title = str(sent.get("title") or kept["title"])
    return Reply(say(c, "sent", event=c.event_name, title=title), buttons=_composer(c))


ANNOUNCE = Command(
    name="announce",
    flag=None,
    description={
        "en": "Announce on the screens, the ticker, Discord and phones",
        "fi": "Tiedota näytöillä, tickerissä, Discordissa ja puhelimissa",
    },
    form=open_form,
    forms={"back": back_form},
    on_component=on_component,
    right_names={"moments.announce": {"en": "Announce", "fi": "Tiedotus"}},
    errors={
        "invalid_request": {
            "en": "Moments did not take that text: a { or } must open a placeholder, and the"
            " title may be at most 60 characters once filled. Fix it with Back.",
            "fi": "Moments ei hyväksynyt tekstiä: { tai } aloittaa paikkamerkin, ja otsikossa"
            " saa olla enintään 60 merkkiä. Korjaa se Takaisin-painikkeella.",
        },
    },
)
