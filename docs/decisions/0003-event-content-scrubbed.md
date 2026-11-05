# 0003. Event content is scrubbed from the platform

- **Status:** Accepted
- **Date:** 2026-11-02

## Context
The platform is general and public; it runs any event. The legacy code mixes one event's names, venue, hosts, Discord ids, media and menus into the code.

## Decision
Nothing event-specific enters this repo: no real event name, venue, IPs, hostnames, Discord ids or personal names in code, docs, tests, fixtures, commits or PRs. While porting, every event-specific string and all event content is moved to `events/demo/` (made general) or to the event's own repo. Media and pizzeria menus belong to the event repo. People are named by role ("the hoster", "the organizer"); licence attribution of other authors' code stays.

## Consequences
- The `no-event-names` CI check fails a PR that adds a listed term; the list lives in a CI secret, never in the repo (`docs/ci.md`).
- Event notes found during a port go to a follow-up issue in the event repo.
- An event repo names the platform version it runs; the platform never names an event.
