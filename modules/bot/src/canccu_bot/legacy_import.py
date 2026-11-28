"""The legacy bot import (#125; D9 to D11 and O5 of the step 6 plan): the one-time move of the
legacy bot into one event at the switch. Its token becomes the event's own application, its
channels the event's purposes, and its two settings and finals state rows of the bot's own
`bot_legacy`. It does not bind the server: the admin does that in setup, proving Manage Server
(D11).

Everything is read and checked first, Discord included, then written in one transaction, so a
refusal or a dry run writes nothing. Each row is keyed by its legacy value and written only when
it differs, so a second run changes nothing; the legacy files are only read."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from canccu_kit import SecretUndecryptable

from . import store
from .deps import Deps
from .discord_api import DiscordRefused
from .gateway import Connector
from .guild import audit
from .legacy_files import Legacy
from .legacy_plan import Event, Plan, plan_rows
from .legacy_probe import ProbeFailed, legacy_online

STOPPED = "the legacy bot is stopped (no gateway session on the token)"
FREE = "the event has no other own application and no server yet"
HELD = (
    "the legacy bot still holds its gateway session on this token. Stop it, check that its bot"
    " user shows offline in the server, and run again."
)


class LegacyImportError(Exception):
    """The import cannot start: a token Discord refuses, a server the bot is not in, no such
    event. Nothing was written."""


@dataclass
class Line:
    kind: str
    changes: int
    text: str


@dataclass
class Report:
    dry_run: bool
    lines: list[Line] = field(default_factory=list)
    skipped: list[tuple[str, list[str]]] = field(default_factory=list)
    checks: list[tuple[str, bool]] = field(default_factory=list)
    refused: str | None = None
    written: bool = False

    @property
    def changes(self) -> int:
        return sum(line.changes for line in self.lines)


async def _get(d: Deps, token: str, path: str) -> Any:
    try:
        response = await d.discord.as_bot(token, "GET", path)
    except DiscordRefused:
        raise LegacyImportError("Discord did not answer; nothing was written") from None
    if response.status_code >= 500:
        raise LegacyImportError("Discord did not answer; nothing was written")
    return response


async def _discord(d: Deps, legacy: Legacy) -> dict[str, Any]:
    """What Discord says of the token and its server, read with the legacy token itself."""
    me = await _get(d, legacy.token, "/oauth2/applications/@me")
    if me.status_code == 401:
        raise LegacyImportError("Discord refused the token (was it reset?); nothing was written")
    guild = await _get(d, legacy.token, f"/guilds/{legacy.guild_id}")
    if guild.status_code != 200:
        raise LegacyImportError(f"the legacy bot is not in the server {legacy.guild_id}")
    channels = await _get(d, legacy.token, f"/guilds/{legacy.guild_id}/channels")
    roles = await _get(d, legacy.token, f"/guilds/{legacy.guild_id}/roles")
    gateway = await _get(d, legacy.token, "/gateway/bot")
    if any(r.status_code != 200 for r in (me, channels, roles, gateway)):
        raise LegacyImportError("Discord did not answer as expected; nothing was written")
    return {
        "application_id": str(me.json()["id"]),
        "guild_name": str(guild.json().get("name") or legacy.guild_id),
        "channels": {str(c["id"]): c for c in channels.json()},
        "roles": list(roles.json()),
        "gateway_url": str(gateway.json()["url"]),
    }


async def _event(d: Deps, tenant: str, app_id: str, token: str) -> Event:
    async with d.db.tenant(tenant) as conn:
        row = await conn.fetchrow(
            "SELECT mode, application_id, bot_token, revision FROM bot_connections"
        )
        bound = await store.binding(conn)
        holder = await conn.fetchval(
            "SELECT tenant_id FROM bot_application_routes WHERE application_id = $1", app_id
        )
        purposes = {
            r["purpose"]: r["target_id"]
            for r in await conn.fetch("SELECT purpose, target_id FROM bot_purposes")
        }
        legacy = {
            (r["kind"], r["key"]): json.loads(r["value"])
            for r in await conn.fetch("SELECT kind, key, value::text AS value FROM bot_legacy")
        }
    same_app = row is not None and row["mode"] == "own" and row["application_id"] == app_id
    token_kept = False
    if same_app and row["bot_token"] is not None:
        try:
            opened = d.secrets.open_text(row["bot_token"], store.token_aad(tenant, app_id))
            token_kept = opened == token
        except SecretUndecryptable:
            token_kept = False
    return Event(
        mode=None if row is None else row["mode"],
        same_app=same_app,
        token_kept=token_kept,
        revision=0 if row is None else row["revision"],
        bound_app=None if bound is None else bound["application_id"],
        holder=holder,
        purposes=purposes,
        legacy=legacy,
    )


def _free(d: Deps, tenant: str, app_id: str, event: Event) -> str | None:
    """Why the event cannot take the application, as the connection's own rules say
    (contracts/bot.md, The event's connection), or None."""
    if d.shared is not None and app_id == d.shared.application_id:
        return "this is the platform's shared bot, not a legacy one."
    if event.holder is not None and event.holder != tenant:
        return "another event holds this application."
    if event.mode == "own" and not event.same_app:
        return (
            "the event has its own application already: go back to the shared bot on the"
            " Discord page first."
        )
    if event.bound_app is not None and not event.same_app:
        return "the event has a server on the shared bot: unbind it on the Discord page first."
    return None


async def _stopped(connect: Connector, legacy: Legacy, gateway_url: str) -> str | None:
    try:
        online = await legacy_online(connect, gateway_url, legacy.token, legacy.guild_id)
    except ProbeFailed as failed:
        return f"the check cannot run: {failed}."
    return HELD if online else None


async def run_import(
    d: Deps, tenant: str, legacy: Legacy, connect: Connector, *, dry_run: bool
) -> Report:
    context = await d.tenants.by_id(tenant)
    if context is None:
        raise LegacyImportError(f"no event {tenant}")
    if context.get("status") == "archived":
        raise LegacyImportError(f"the event {tenant} is archived")
    found = await _discord(d, legacy)
    app_id = found["application_id"]
    event = await _event(d, tenant, app_id, legacy.token)
    plan = plan_rows(legacy, found, event)
    report = Report(dry_run=dry_run, skipped=[*legacy.skipped, *plan.skipped])
    report.lines = [Line(kind, n, text) for kind, n, text in plan.lines]
    held = await _stopped(connect, legacy, found["gateway_url"])
    taken = _free(d, tenant, app_id, event)
    report.checks = [(STOPPED, held is None), (FREE, taken is None)]
    report.refused = held or taken
    if dry_run or report.refused is not None or report.changes == 0:
        return report
    await _write(d, tenant, legacy, app_id, event, plan)
    report.written = True
    await d.outbox.flush(tenant)
    counts = {_AUDITED[line.kind]: line.changes for line in report.lines if line.kind in _AUDITED}
    await audit(
        d, tenant, None, "bot.legacy.imported", counts, "connection", reason="the legacy bot import"
    )
    return report


_AUDITED = {
    "Bot application": "bot_application",
    "Channels": "channels",
    "Settings": "settings",
    "Finals state": "finals_state",
}


async def _write(
    d: Deps, tenant: str, legacy: Legacy, app_id: str, event: Event, plan: Plan
) -> None:
    async with d.db.tenant(tenant) as conn:
        revision = await conn.fetchval("SELECT revision FROM bot_connections FOR UPDATE")
        if (revision or 0) != event.revision:
            raise LegacyImportError("the event's connection changed meanwhile; run again")
        if plan.connection:
            await _connection(d, conn, tenant, legacy.token, app_id, event, plan.connection)
        for purpose, target in plan.purposes.items():
            # DO NOTHING: an admin's pick made since the plan wins over the legacy channel.
            await conn.execute(
                "INSERT INTO bot_purposes (purpose, target_id, updated_at) VALUES ($1, $2, $3)"
                " ON CONFLICT (tenant_id, purpose) DO NOTHING",
                purpose,
                target,
                d.now(),
            )
        if plan.purposes:
            data = {"purposes": plan.purposes, "actor_user_id": None}
            await d.outbox.add(conn, "bot.purposes.changed", data, version=1)
        for (kind, key), value in plan.legacy.items():
            await conn.execute(
                "INSERT INTO bot_legacy (kind, key, value, imported_at)"
                " VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (tenant_id, kind, key)"
                " DO UPDATE SET value = $3::jsonb, imported_at = $4",
                kind,
                key,
                json.dumps(value),
                d.now(),
            )


async def _connection(
    d: Deps, conn: Any, tenant: str, token: str, app_id: str, event: Event, changed: list[str]
) -> None:
    """The token as an own application's, sealed as the connection API seals it. The legacy bot
    never had a client secret: a new row has none, and the bind asks for it (connection_incomplete)
    until the admin adds it on the Discord page."""
    sealed = d.secrets.seal(token, store.token_aad(tenant, app_id))
    revision = event.revision + 1
    await conn.execute(
        "INSERT INTO bot_connections (mode, application_id, bot_token, key_version, updated_at,"
        " revision) VALUES ('own', $1, $2, $3, $4, $5) ON CONFLICT (tenant_id) DO UPDATE"
        " SET mode = 'own', application_id = $1, bot_token = $2, key_version = $3,"
        " updated_at = $4, updated_by = NULL, revision = $5",
        app_id,
        sealed,
        d.secrets.key_version(sealed),
        d.now(),
        revision,
    )
    # The route is the global guard that keeps an application to one event; checked again here
    # since another event may have taken it after the plan read it.
    await conn.execute(
        "INSERT INTO bot_application_routes (application_id, tenant_id) VALUES ($1, $2)"
        " ON CONFLICT (application_id) DO NOTHING",
        app_id,
        tenant,
    )
    holder = await conn.fetchval(
        "SELECT tenant_id FROM bot_application_routes WHERE application_id = $1", app_id
    )
    if holder != tenant:
        raise LegacyImportError("another event took this application meanwhile; nothing written")
    data = {
        "mode": "own",
        "application_id": app_id,
        "changed": changed,
        "revision": revision,
        "actor_user_id": None,
    }
    await d.outbox.add(conn, "bot.connection.changed", data, version=1)
