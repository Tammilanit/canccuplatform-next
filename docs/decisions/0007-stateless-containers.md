# 0007. Containers are stateless

- **Status:** Accepted
- **Date:** 2026-11-02

## Context
Restarts and updates must be safe during an event, and recovery must be one restore.

## Decision
A container keeps no state of its own. Data and sessions live in Postgres; events and caches in Valkey (on disk, but losing them costs nothing that matters); files in one shared files volume.

## Consequences
- Any module can be deleted and restarted without loss.
- A whole backup is Postgres plus the files volume, plus the secrets key and `deploy/.env` ([0013](0013-multi-tenant-core.md), item 29). Those two are backed up separately from the database dump, never next to it, and kept with the fallback laptop; without them a restore cannot decrypt tenant secrets.
- Backups do not cover Valkey, so events not yet consumed are lost with it. A module never keeps the only copy of its data on the bus: what must survive is written to Postgres.
- With tenancy, keys and file paths carry the tenant ([0013](0013-multi-tenant-core.md)).
