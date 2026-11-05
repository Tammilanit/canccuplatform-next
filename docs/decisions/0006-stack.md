# 0006. The stack

- **Status:** Accepted
- **Date:** 2026-11-02

## Context
Modules are ported from TypeScript and Python code. One maintainer directs AI workers, so the stack must be small, common and well known.

## Decision
- **Modules:** Node 22 ESM in TypeScript with Fastify 5, `pg`, vitest and `@cp/kit` (`packages/kit-ts`). Admin uses `packages/kit-py` (Python 3.12, Starlette). The bot is likely Python, as a port of canccubot.
- **Infrastructure:** Postgres 17; Valkey 8.1 with Streams as the event bus (NATS was the alternative; it pays off only with many services or hosts); Caddy as the web front; Docker Compose with one container per module.
- **Shared look:** `packages/ui` (theme tokens and components).

## Consequences
- Two kits to keep in step; a third language needs a strong reason ([0009](0009-rust-rejected.md)).
- Streams keep events, so a restarted module can catch up instead of missing them. That needs persisted consumer positions (consumer groups), a kit requirement for kit tenancy (#49): today's kit subscribes from the newest entry and keeps positions in memory, so a restarted module still misses events.
