"""Transactional outbox: a write stores its bus events in its own transaction, and they are sent
after the commit. A committed write then never loses its events, and a rolled-back one sends none.

Each module that uses it has two tables in its migrations (`<module>` is the bus's module):

    CREATE TABLE <module>_outbox (
      tenant_id text NOT NULL DEFAULT NULLIF(current_setting('canccu.tenant', true), ''),
      seq bigint GENERATED ALWAYS AS IDENTITY,
      event text NOT NULL,
      PRIMARY KEY (tenant_id, seq)
    );  -- plus the kit's RLS (rls_sql)
    CREATE TABLE <module>_outbox_tenants (tenant_id text PRIMARY KEY);  -- a global table
    GRANT SELECT, INSERT, DELETE ON <module>_outbox TO <app role>;
    -- UPDATE only because row locks (FOR KEY SHARE, FOR UPDATE) need it; nothing updates a row.
    GRANT SELECT, INSERT, UPDATE, DELETE ON <module>_outbox_tenants TO <app role>;

The second lists the events with pending rows, so `flush_all` finds them without a tenant set.

Delivery is at least once: an event sent but not yet deleted when a container stops is sent again
with the same id, and subscribers drop a repeated id. Events of one tenant go out in the order
they were added.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import AbstractAsyncContextManager
from typing import Any, Protocol

from .bus import Bus, Event, parse_envelope
from .tenant import require_tenant

log = logging.getLogger("canccu.kit.outbox")


class OutboxDb(Protocol):
    """A module's Db: transactions as its app role, for one tenant or for none."""

    def tenant(self, tenant_id: str | None = None) -> AbstractAsyncContextManager[Any]: ...

    def platform(self) -> AbstractAsyncContextManager[Any]: ...


class Outbox:
    def __init__(self, bus: Bus, db: OutboxDb, *, batch: int = 100) -> None:
        self.bus = bus
        self.db = db
        self.batch = batch
        self._rows = f"{bus.module}_outbox"
        self._tenants = f"{bus.module}_outbox_tenants"

    async def add(
        self,
        conn: Any,
        type: str,
        data: dict[str, Any],
        *,
        version: int,
        correlation_id: str | None = None,
    ) -> Event:
        """Store an event of the tenant in scope, inside the caller's tenant transaction."""
        event = self.bus.envelope(type, data, version=version, correlation_id=correlation_id)
        await conn.execute(f"INSERT INTO {self._rows} (event) VALUES ($1)", event.to_json())
        await self._list(conn, require_tenant())
        return event

    async def _list(self, conn: Any, tenant: str) -> None:
        """List the tenant for `flush_all`, and hold its row until the caller commits.

        The share lock keeps `_forget` from dropping the row while this write's events are not
        yet visible to it. A row a forget deleted meanwhile is gone when the lock is taken: the
        second insert then adds it again (an insert waits for a delete in flight to finish).
        """
        for _ in range(2):
            await conn.execute(
                f"INSERT INTO {self._tenants} (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING",
                tenant,
            )
            if await conn.fetchval(
                f"SELECT 1 FROM {self._tenants} WHERE tenant_id = $1 FOR KEY SHARE", tenant
            ):
                return
        raise RuntimeError("the outbox could not list the event")

    async def flush(self, tenant: str | None = None) -> int:
        """Send the tenant's pending events (by default the tenant in scope); returns how many.

        Never raises: the write has committed, so its caller succeeded; what is left goes out on a
        later flush (`run`).
        """
        tenant = require_tenant() if tenant is None else tenant
        sent = 0
        try:
            # Again after every pass that sent something: a writer that committed while this one
            # held the lock found it taken and left its rows to this one.
            while True:
                count, failure = await self._flush_batch(tenant)
                sent += count or 0
                if failure is not None:
                    raise failure
                if not count:
                    return sent
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning(
                "outbox send failed; retrying later", exc_info=True, extra={"tenant": tenant}
            )
            return sent

    async def _flush_batch(self, tenant: str) -> tuple[int | None, Exception | None]:
        """(how many were sent, or None when another sender holds the event; what failed)."""
        async with self.db.tenant(tenant) as conn:
            # One sender per event at a time keeps the order.
            if not await conn.fetchval(
                "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))",
                f"{self._rows}:{tenant}",
            ):
                return None, None
            rows = await conn.fetch(
                f"SELECT seq, event FROM {self._rows} ORDER BY seq LIMIT $1", self.batch
            )
            done: list[int] = []
            failure: Exception | None = None
            for row in rows:
                try:
                    await self.bus.send(parse_envelope(row["event"]))
                except Exception as exc:
                    failure = exc
                    break
                done.append(row["seq"])
            # What went out is deleted also when a later one failed, so it is not sent twice.
            if done:
                await conn.execute(f"DELETE FROM {self._rows} WHERE seq = ANY($1::bigint[])", done)
            if not rows:
                await self._forget(conn, tenant)
        return len(done), failure

    async def _forget(self, conn: Any, tenant: str) -> None:
        """Drop the tenant from the list once nothing is pending. A writer holding its row (see
        `_list`) keeps it listed until a later flush."""
        held = await conn.fetchval(
            f"SELECT 1 FROM {self._tenants} WHERE tenant_id = $1 FOR UPDATE SKIP LOCKED", tenant
        )
        if held and not await conn.fetchval(f"SELECT EXISTS (SELECT 1 FROM {self._rows})"):
            await conn.execute(f"DELETE FROM {self._tenants} WHERE tenant_id = $1", tenant)

    async def flush_all(self) -> int:
        """Flush every listed tenant; returns how many events went out."""
        async with self.db.platform() as conn:
            rows = await conn.fetch(f"SELECT tenant_id FROM {self._tenants} ORDER BY 1")
        sent = 0
        for row in rows:
            sent += await self.flush(row["tenant_id"])
        return sent

    async def run(self, interval_seconds: float = 2.0) -> None:
        """The loop every container runs until cancelled: it sends what an earlier flush left."""
        while True:
            try:
                await self.flush_all()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("outbox flush failed")
            await asyncio.sleep(interval_seconds)
