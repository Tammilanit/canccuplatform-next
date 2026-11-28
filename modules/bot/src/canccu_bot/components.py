"""Components that keep no state in the container (B5 of the step 6 plan; What `/finals` needs,
item 2). A button, a Yes or No and a form carry what their handler needs in their custom id:
`c1.<command>.<step>.<args>.<issued>.<mac>`, at most Discord's 100 characters. The MAC binds it to
the event, so a button copied into another event's server opens nothing there, and the issued time
gives it an age limit. Any container of the module reads it, after a restart too."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

VERSION = "c1"
MAX_AGE = timedelta(minutes=15)
"""As long as Discord lets the bot edit a private answer: after that its buttons are only old."""
CLOCK_SKEW = timedelta(seconds=30)
_COMMAND = re.compile(r"[a-z0-9_-]{1,32}")
_STEP = re.compile(r"[a-z0-9_]{1,16}")
_ARGS = re.compile(r"[A-Za-z0-9_~-]*")
MAX_LENGTH = 100


@dataclass(frozen=True)
class Component:
    command: str
    step: str
    args: str


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


@dataclass(frozen=True)
class ComponentKeys:
    key: bytes

    @classmethod
    def from_service_key(cls, service_key: bytes) -> ComponentKeys:
        """A key of its own, derived from the stack's service key, so a MAC on a button never
        doubles as a service token and every container derives the same key."""
        return cls(hmac.new(service_key, b"canccu-bot-components-v1", hashlib.sha256).digest())

    def _mac(self, tenant: str, command: str, step: str, args: str, issued: str) -> str:
        message = "|".join((VERSION, tenant, command, step, args, issued)).encode()
        return _b64(hmac.new(self.key, message, hashlib.sha256).digest()[:12])

    def make(self, tenant: str, command: str, step: str, args: str, now: datetime) -> str:
        if not (_COMMAND.fullmatch(command) and _STEP.fullmatch(step) and _ARGS.fullmatch(args)):
            raise ValueError("a component's command, step and args are short plain words")
        issued = format(int(now.timestamp()), "x")
        custom_id = ".".join(
            (VERSION, command, step, args, issued, self._mac(tenant, command, step, args, issued))
        )
        if len(custom_id) > MAX_LENGTH:
            raise ValueError("a component's custom id is longer than Discord takes")
        return custom_id

    def read(self, custom_id: str, tenant: str, now: datetime) -> Component | None:
        """The component, or None for one that is forged, of another event or too old."""
        parts = custom_id.split(".")
        if len(parts) != 6 or parts[0] != VERSION:
            return None
        _, command, step, args, issued, mac = parts
        expected = self._mac(tenant, command, step, args, issued)
        if not hmac.compare_digest(expected.encode(), mac.encode()):
            return None
        try:
            at = datetime.fromtimestamp(int(issued, 16), UTC)
        except (ValueError, OverflowError):
            return None
        # Another container's clock may run a little behind the one that made it.
        if not -CLOCK_SKEW <= now - at <= MAX_AGE:
            return None
        return Component(command, step, args)
