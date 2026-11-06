# 0001. Port, don't rewrite

- **Status:** Superseded by [0020](0020-best-of-old-freely-new.md) (it superseded the earlier "fresh start, harvested" rule)
- **Date:** 2026-11-03

## Context
The legacy system ran a whole event without crashing, and its modules have tests. A first plan rewrote every module fresh and carried over only behaviour and test cases. About five months remain until the next event, and a rewrite would throw away proven code and the bugs already fixed in it.

## Decision
Each module is **ported** from the proven legacy code. Its code and tests are taken and adapted to Postgres, the kit, containers and the contracts. Parts that do not fit (old persistence, auth, ops scripts) are rewritten; the per-repo split is the porting plan in [the roadmap](../roadmap.md#porting-plan). Code by other authors keeps its licence and attribution, and ISC-licensed code from another author is ported only after that author's OK.

## Consequences
- Every port starts by reading the legacy repo, not by designing from nothing.
- Legacy shapes that assume one event (single guild, singleton tables, in-process schedulers) are scoped to a tenant while porting ([0013](0013-multi-tenant-core.md)).
- The legacy repos stay readable until the switch; they get no more maintenance.
- AGENTS.md "Porting" is the working rule.
