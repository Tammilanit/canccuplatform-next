# 0004. Nothing is migrated from the old system

- **Status:** Accepted
- **Date:** 2026-11-03

## Context
The old system keeps its data in several places (SQLite, a hosted serverless database, settings tables, bot memory). Importing tournament, pizza or screen history would need a converter per store for data nobody needs at the next event.

## Decision
The new platform starts empty. Old repos and databases are kept as they are, never destroyed and not maintained.

## Consequences
- No import code is written or tested.
- Old data stays readable in the old stores if anyone needs it.
- Exception, decided separately: the legacy bot's own data may be carried into its event's tenant at cutover ([0013](0013-multi-tenant-core.md), Discord).
