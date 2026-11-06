# 0022. The product vision

- **Status:** Accepted
- **Date:** 2026-11-06

## Context
[0020](0020-best-of-old-freely-new.md) set the ambition (a commercial-scale platform that takes the best of the legacy and is free to build anew) and [0021](0021-no-fixed-dates.md) removed the dates, but neither says who the platform is for, what it is at its heart, or what it will not do. The legacy inventory summary listed many opportunities beyond the old system ([Beyond the old system](../legacy-inventory/README.md#beyond-the-old-system)); without a vision each step would weigh them again. The product owner settled the vision on 2026-11-06 (#102).

## Decision
- **Who it is for:** organisers of recurring LAN events at one venue (several events a year), the venue's staff, and attendees. It must scale to a large event of about 1,000–2,000 attendees. It is free and self-hosted (AGPL); it takes no payments.
- **Its surfaces:**
  1. the venue screen;
  2. Discord;
  3. a phone hub (a PWA with notifications), as its own track, planned separately.
- **The screen is the heart:** a "Pulse" screen that is very visual, lively, coherent and always current. It is push-driven and composed of widgets, with Moments at the peaks and a QR handoff to phones.
- **Core features:**
  - the Pulse screen and Moments;
  - one announce action that reaches the screen, Discord and the ticker at once (it grows from today's announce command);
  - a run-of-show that can be edited live;
  - a brand kit with a simple mode and an advanced (CSS) mode;
  - event series, with clone-the-last-event;
  - a venue profile;
  - the tournament system ported and polished: check-in, no-shows, result corrections with an audit trail, seeding;
  - easy Discord guild setup;
  - an install kit, pre-flight checks and release channels.
- **The phone hub (the App track):**
  - a PWA only, no store app;
  - guests get event-wide notifications without signing in;
  - event admin is reachable from the internet with sign-in, behind a "venue or Tailscale only" switch that is on by default; the superadmin is reachable over Tailscale only;
  - no CDN proxy at the start;
  - raw presence data is deleted 30 days after an event is archived; memories are opt-in;
  - it opens to the public only after a go-public checklist.
- **Later, or in the backlog:** a director desk, game-aware voice lobbies, quests, a dry run, one standings table, LFG and casual sessions inside Games; sponsors and a load harness for the large event.
- **Not planned:** an auto recap reel, an offline-first player, a game-server registry, a service-order engine (the pizza flow is ported as it is), a help desk, a cheer meter, a venue edge box.

## Consequences
- The [roadmap](../roadmap.md) follows: Pulse and push in step 3, Moments at the peaks in step 4, the core features in the steps that own them, and an "App" parallel track for the phone hub (hub shell, Notify, signed-in hub, Play, a privacy center before the dress rehearsal, memories). The later items are listed under "Not scheduled yet".
- A "not planned" item comes back only through a new issue the product owner agrees, with a new record.
- The opportunities of the legacy inventory summary are weighed against this record: those it names are planned or in the backlog, the "not planned" ones are dropped, and the rest wait for the checkpoint of the step they would land in ([0019](0019-work-packages.md)).

## Known limits
- **The App track is planned separately:** this record sets its rules, not its order or contracts.
- **The large event is a target, not a tested fact:** the load harness that would prove 1,000–2,000 attendees is in the backlog.
