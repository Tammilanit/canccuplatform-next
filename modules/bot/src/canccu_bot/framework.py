"""The command framework's parts (contracts/bot.md, The command framework): what a command declares,
what its handler gets and what it answers. `interactions.py` runs them; #122 and the Finals track
add the commands themselves, each under its feature flag.

A handler never talks to Discord: it returns a `Reply`, and the framework sends it privately,
through the guard, with the event's colour on its embeds. It acts in a module only through
`Context.act`, with the person's acting token, and reaches an outside provider only through
`Context.provider`. What goes wrong is raised as one of the errors below and becomes a short
private sentence; a raw error never reaches the person."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .components import Component
from .notes import Notes
from .texts import LANGUAGES

Texts = dict[str, str]
"""One text by language: `{"en": …, "fi": …}`; English is required."""

# Discord's numbers (application commands, message components, text inputs).
CHAT_INPUT, MESSAGE_MENU = 1, 3
SUB_COMMAND, SUB_COMMAND_GROUP, STRING, INTEGER, BOOLEAN = 1, 2, 3, 4, 5
OPTION_KINDS = {"string": STRING, "integer": INTEGER, "boolean": BOOLEAN}
BUTTON_STYLES = {"primary": 1, "secondary": 2, "success": 3, "danger": 4, "link": 5}


class NeedsSignIn(Exception):
    """The person has no account, or is no member of the event (U6, U7)."""


class NoRight(Exception):
    def __init__(self, right: str) -> None:
        super().__init__(right)
        self.right = right


class Unreachable(Exception):
    """A module or a provider did not answer, or answered with a server error."""


class Refused(Exception):
    """A module's or a provider's error code; the command's `errors` say it in words."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Caller:
    """Who ran the command (What `/finals` needs, item 3)."""

    user_id: str
    nickname: str
    """The server nickname, else the Discord display name, else the username."""
    role_ids: tuple[str, ...]
    guild_id: str | None
    locale: str | None


@dataclass(frozen=True)
class Button:
    label: str
    step: str = ""
    """A component of the same command, routed back to its `on_component`."""
    args: str = ""
    style: str = "primary"
    url: str | None = None
    """A link button: Discord opens it, the bot never sees the click."""


@dataclass(frozen=True)
class Field:
    id: str
    label: str
    value: str = ""
    max_length: int = 100
    required: bool = True
    long: bool = False
    """A paragraph field rather than one line."""


@dataclass(frozen=True)
class Upload:
    """A multipart body for `Context.act`: text fields and one file (Screen's photo API)."""

    fields: dict[str, str]
    file: bytes
    filename: str
    content_type: str


@dataclass(frozen=True)
class Form:
    """Discord's modal: opened at once by a component (it cannot follow a deferral)."""

    step: str
    title: str
    fields: tuple[Field, ...]
    args: str = ""


@dataclass
class Reply:
    content: str = ""
    embeds: list[dict[str, Any]] = field(default_factory=list)
    buttons: list[Button] = field(default_factory=list)
    expires_at: datetime | None = None
    """When the reply's link buttons stop working (a provider's `expires_at`): the message is
    edited then to say "run the command again". None: they stay (the platform's own links)."""


@dataclass(frozen=True)
class Option:
    name: str
    description: Texts
    kind: str = "string"
    required: bool = False


@dataclass(frozen=True)
class Subcommand:
    name: str
    description: Texts
    options: tuple[Option, ...] = ()
    group: str | None = None
    """Its group (`/ticker schedule add`): the handler reads the subcommand as "schedule add"."""


@dataclass
class Context:
    caller: Caller
    tenant: str
    event_name: str
    interaction_id: str
    """The idempotency key of every call this interaction makes (E5)."""
    subcommand: str | None
    options: dict[str, Any]
    act: Callable[[str, str, str, Any], Awaitable[Any]]
    """(module, method, path, json) as the person; raises the errors above."""
    provider: Callable[[str, str, str, Any], Awaitable[Any]]
    """(provider, method, url, json) with the event's bearer secret for it, when it has one."""
    component: Callable[[str, str], str]
    """(step, args) → the custom id of a component of this command."""
    page: Callable[[str], str | None] = lambda path: None
    """A page of the event, on its hostname, for a link button; None without a hostname."""
    hosts: tuple[str, ...] = ()
    """The event's hosts: the only links text built from other people's words keeps."""
    time_zone: str = "UTC"
    target: dict[str, Any] | None = None
    """A message command's message, as Discord resolved it."""
    notes: Notes | None = None
    """What the command keeps between its steps (notes.py)."""
    download: Callable[[dict[str, Any]], Awaitable[bytes]] | None = None
    """A message's attachment from Discord's file host (attachments.py)."""
    now: Callable[[], datetime] = lambda: datetime.now(UTC)


Handler = Callable[[Context], Awaitable[Reply]]
ComponentHandler = Callable[[Context, Component, dict[str, str]], Awaitable[Reply]]
FormOpener = Callable[[Context, Component | None], Form | Awaitable[Form]]


@dataclass(frozen=True)
class Command:
    name: str
    flag: str | None
    """The feature flag it belongs to: registered while it is on, refused once it is off. None:
    on wherever the bot is (`/hub`, `/announce`: their features have no flag)."""
    description: Texts
    run: Handler | None = None
    """None for a command that only opens its `form`."""
    names: Texts = field(default_factory=dict)
    """Localised names beside `name` (Discord's `name_localizations`)."""
    options: tuple[Option, ...] = ()
    subcommands: tuple[Subcommand, ...] = ()
    on_component: ComponentHandler | None = None
    """Its buttons and submitted forms, with the form's values by field id."""
    forms: dict[str, FormOpener] = field(default_factory=dict)
    """Steps whose component opens a form at once."""
    right_names: dict[str, Texts] = field(default_factory=dict)
    """The rights it needs, in words ("Announce"): a person never reads a right's id."""
    errors: dict[str, Texts] = field(default_factory=dict)
    """A module's or a provider's error code in words; any other is "That did not work"."""
    menu: bool = False
    """A message command ("Send to the screen" in a message's Apps menu): no description, no
    options; the handler gets the message as `Context.target`."""
    key: str = ""
    """Its components' name when `name` is not one (a menu's name has spaces)."""
    form: FormOpener | None = None
    """A command that opens a form at once: Discord takes no form after a deferral."""
    groups: dict[str, Texts] = field(default_factory=dict)
    """The descriptions of its subcommand groups."""

    @property
    def component_key(self) -> str:
        return self.key or self.name

    @property
    def shown(self) -> str:
        """How a reply names it: `/ticker`, or a menu's name as the person reads it."""
        return f"“{self.name}”" if self.menu else f"/{self.name}"

    def payload(self) -> dict[str, Any]:
        """The command as Discord registers it: a CHAT_INPUT command, or a MESSAGE menu."""
        if self.menu:
            body: dict[str, Any] = {"name": self.name, "type": MESSAGE_MENU}
            if self.names:
                body["name_localizations"] = _localised(self.names)
            return body
        body = {"name": self.name, "type": CHAT_INPUT, **_described(self.description)}
        if self.names:
            body["name_localizations"] = _localised(self.names)
        options = [_option(o) for o in self.options]
        groups: dict[str, list[dict[str, Any]]] = {}
        for sub in self.subcommands:
            if sub.group is None:
                options.append(_sub(sub))
            else:
                if sub.group not in groups:
                    groups[sub.group] = []
                    group = {"name": sub.group, "type": SUB_COMMAND_GROUP}
                    group |= _described(self.groups[sub.group])
                    options.append({**group, "options": groups[sub.group]})
                groups[sub.group].append(_sub(sub))
        if options:
            body["options"] = options
        return body


def _localised(texts: Texts) -> dict[str, str]:
    return {lang: value for lang, value in texts.items() if lang != "en" and lang in LANGUAGES}


def _described(texts: Texts) -> dict[str, Any]:
    body: dict[str, Any] = {"description": texts["en"]}
    if _localised(texts):
        body["description_localizations"] = _localised(texts)
    return body


def _option(option: Option) -> dict[str, Any]:
    kind = OPTION_KINDS[option.kind]
    return {
        "name": option.name,
        "type": kind,
        "required": option.required,
        **_described(option.description),
    }


def _sub(sub: Subcommand) -> dict[str, Any]:
    body: dict[str, Any] = {"name": sub.name, "type": SUB_COMMAND, **_described(sub.description)}
    if sub.options:
        body["options"] = [_option(o) for o in sub.options]
    return body
