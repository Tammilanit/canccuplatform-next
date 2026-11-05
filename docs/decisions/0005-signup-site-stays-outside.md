# 0005. The event signup site stays outside the platform

- **Status:** Accepted
- **Date:** 2026-11-02

## Context
The legacy signup site does event registration and also hosts the tournament, pizza, LAN display and polls. Registration is under a fifth of its code and works.

## Decision
Event registration stays on its own site, outside the platform, and is not touched. The other parts move into platform modules (Tournament, Pizza, Screen); polls are dropped. There is no sync between the site and the platform; tournament registration moves into the Tournament module.

## Consequences
- The platform has no attendee-registration feature.
- Ported code from that repo takes only the pizza and tournament parts.
- Old issues that only concern registration go to the event repo.
