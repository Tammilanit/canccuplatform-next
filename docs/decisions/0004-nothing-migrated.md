# 0004. Nothing is migrated from the old system

- **Status:** Accepted
- **Date:** 2026-11-03

## Context
The old system keeps its data in several places (SQLite, a hosted serverless database, settings tables, bot memory). Importing tournament, pizza or screen history would need a converter per store for data nobody needs at the next event.

## Decision
The new platform starts empty. Old repos and databases are kept as they are, never destroyed and not maintained.

## Consequences
- No general import code is written.
- Old data stays readable in the old stores if anyone needs it.
- One exception, decided later: at cutover the legacy bot's data is migrated into its event's tenant ([0013](0013-multi-tenant-core.md), Consequences). That migration is planned and tested as part of the freeze and switch (roadmap step 11).
