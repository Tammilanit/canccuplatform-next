""" "Send to the screen" and "Remove from the screen" (U12, U13, D15 of the step 6 plan; mockup 09):
a message's menu for the crew with the photos right, through Screen's photo API as the person.
Nothing reaches the wall by itself. The message id is the photo's `source_ref`, so the same
picture twice is Screen's 409 `photo_exists`; the photo's id waits in `Context.notes` for the
remove. No name goes with it until the bot can tell a Discord account's platform name (link 2b,
docs/plans/issue-122.md): never a Discord name (D15, D9)."""

from __future__ import annotations

import re
from typing import Any

from .attachments import is_picture
from .components import Component
from .framework import Button, Command, Context, Refused, Reply, Unreachable, Upload
from .guard import strip_foreign_links
from .texts import pick

PHOTOS = "/api/screen/photos"
KEEP_S = 30 * 24 * 3600
"""Longer than any event: after it, the crew removes the photo in Screen studio."""
_MARKUP = re.compile(r"<(?:@[!&]?|#)\d+>|<a?:\w+:\d+>")
"""Discord's mentions and custom emoji, which a screen would show as raw ids."""

SAY: dict[str, dict[str, str]] = {
    "on_wall": {
        "en": "On the photo wall: “{caption}”.\nIt pops in for 10 seconds on zones that pop new"
        " photos.",
        "fi": "Kuvaseinällä: ”{caption}”.\nSe nousee esiin 10 sekunniksi alueilla, joilla uudet"
        " kuvat nostetaan esiin.",
    },
    "on_wall_bare": {
        "en": "On the photo wall.\nIt pops in for 10 seconds on zones that pop new photos.",
        "fi": "Kuvaseinällä.\nSe nousee esiin 10 sekunniksi alueilla, joilla uudet kuvat"
        " nostetaan esiin.",
    },
    "remove": {"en": "Remove", "fi": "Poista"},
    "removed": {"en": "Removed from the photo wall.", "fi": "Poistettu kuvaseinältä."},
    "no_picture": {
        "en": "That message has no picture to send.",
        "fi": "Viestissä ei ole lähetettävää kuvaa.",
    },
    "not_on_wall": {
        "en": "That message's picture is not on the photo wall.",
        "fi": "Viestin kuva ei ole kuvaseinällä.",
    },
}
ERRORS = {
    "photo_exists": {
        "en": "That picture is already on the photo wall.",
        "fi": "Kuva on jo kuvaseinällä.",
    },
    "file_too_large": {
        "en": "That picture is too large for the photo wall.",
        "fi": "Kuva on liian suuri kuvaseinälle.",
    },
    "media_unsupported": {
        "en": "The photo wall does not take that kind of picture.",
        "fi": "Kuvaseinä ei ota vastaan tällaista kuvaa.",
    },
}
RIGHTS = {"screen.photos.write": {"en": "Photos", "fi": "Kuvat"}}


def say(c: Context, key: str, **values: Any) -> str:
    return pick(SAY[key], c.caller.locale).format(**values)


def caption(c: Context, content: str) -> str:
    """The message's words for the screen: no raw mention ids, no link off the event's hosts."""
    plain = strip_foreign_links(_MARKUP.sub("", content), c.hosts)
    return " ".join(plain.split())[:200]


async def send(c: Context) -> Reply:
    message = c.target or {}
    picture = next((a for a in message.get("attachments") or [] if is_picture(a)), None)
    if picture is None or c.download is None:
        return Reply(say(c, "no_picture"))
    data = await c.download(picture)
    words = caption(c, str(message.get("content") or ""))
    fields = {"posted_at": str(message.get("timestamp") or c.now().isoformat())}
    fields["source_ref"] = str(message.get("id") or "")
    if words:
        fields["caption"] = words
    upload = Upload(
        fields,
        data,
        str(picture.get("filename") or "photo"),
        str(picture.get("content_type") or "application/octet-stream"),
    )
    photo = await c.act("screen", "POST", PHOTOS, upload) or {}
    if c.notes is not None and photo.get("id"):
        await c.notes.put("photo", fields["source_ref"], photo["id"], KEEP_S)
    said = say(c, "on_wall", caption=words) if words else say(c, "on_wall_bare")
    remove = Button(say(c, "remove"), step="remove", args=fields["source_ref"], style="danger")
    return Reply(said, buttons=[remove])


async def _remove(c: Context, message_id: str) -> Reply:
    photo_id = None if c.notes is None else await c.notes.get("photo", message_id)
    if not photo_id:
        return Reply(say(c, "not_on_wall"))
    try:
        await c.act("screen", "DELETE", f"{PHOTOS}/{photo_id}", None)
    except Refused as refused:
        if refused.code != "not_found":  # removed in Screen studio already: the same outcome
            raise
    if c.notes is not None:
        await c.notes.drop("photo", message_id)
    return Reply(say(c, "removed"))


async def remove(c: Context) -> Reply:
    message_id = str((c.target or {}).get("id") or "")
    if not message_id:
        raise Unreachable()
    return await _remove(c, message_id)


async def on_component(c: Context, component: Component, values: dict[str, str]) -> Reply:
    return await _remove(c, component.args)


SEND = Command(
    name="Send to the screen",
    flag="screen.photos",
    description={},
    names={"fi": "Lähetä näytölle"},
    run=send,
    menu=True,
    key="screen-send",
    on_component=on_component,
    right_names=RIGHTS,
    errors=ERRORS,
)
REMOVE = Command(
    name="Remove from the screen",
    flag="screen.photos",
    description={},
    names={"fi": "Poista näytöltä"},
    run=remove,
    menu=True,
    key="screen-remove",
    right_names=RIGHTS,
    errors=ERRORS,
)
