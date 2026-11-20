# 0030. Finals is integrated as it is; one tourney core for Tournament and Games

- **Status:** Accepted (supersedes parts of [0025](0025-finals-and-games-modules.md) and settles the finals item of [0027](0027-product-decisions-2026-11-07-08.md))
- **Date:** 2026-11-20

## Context
[0025](0025-finals-and-games-modules.md) planned a `finals` module on the platform: the mini tourney rebuilt on the kit, with storage, API and frontend new, sharing only its pure core with the standalone off-LAN app, and the tournament module of step 7 kept apart from that core. [0027](0027-product-decisions-2026-11-07-08.md) left open whether the finals tourney becomes the Apps track's first app (#193). Since then the core was extracted as finals-core, a small public library, and step 7's research pack noted that a bracket-shaped tournament would rebuild what the core already does ([step 7 brief](../briefs/step-7-tournament.md#b--brackets-everywhere)). A `finals` module would rebuild an app the group already runs, and a second engine in the tournament module would duplicate the core. On 2026-11-20 the product owner decided the points below.

## Decision
1. **Finals is integrated as it is.** The Finals mini tourney is made for one game, THE FINALS: teams of three, 3 or 4 teams per match, placements. The group uses it at its own LAN events and between them. Its look, its feel and most of its features stay as they are. It is an optional add-on to the platform, not rebuilt as a platform module. It is unlikely to be used at other LAN parties.
2. **Where it runs: the host's choice, one connection per event.** Whoever runs an event that wants Finals hosts the app where they like: on its own server elsewhere, as we do off-LAN, or on the same host as the platform, as a container beside it. We host it only for our own events, never for other events. For our events it is our own deployed instance.
   - **The platform connects per event.** An event admin sets the Finals app's address and its secret (the provider contract's bearer secret, held like the bot's other secrets: encrypted, write-only, never in a reply or a log). No Finals app set means Finals is off for that event.
   - The same connection works whether the app is elsewhere (level 3 of the Apps track and its pilot, #193) or beside the platform on the same host (level 4, an installed container), from the same codebase.
   - What the platform gives it: Discord sign-in through the platform; `/finals` in the new bot, through the provider contract ([contracts/finals.md](../../contracts/finals.md)); its bracket and champions as screen cards and Moments; a link or a tile in the hub.

3. **One tourney core.** finals-core becomes the platform's single engine for brackets, team forming (balanced draws from ratings) and scoring (placements to points, rankings and their clamp).
   - It is generalised: team size, teams per match, formats and scoring tables become parameters. THE FINALS is one preset, and its behaviour does not change; equivalence tests prove it.
   - It stays a small public library: no storage and no UI, its licence (ISC) and its author's attribution.
   - A neutral name can come with the general major version. The Finals app moves to that version only when it chooses.
4. **Tournament holds every competition.** The `tournament` module runs the event's official tournament (sessions across games, season points, the final) and mini tournaments for any game in the catalogue, run by the players like Finals. Both run on the core.
5. **Games holds the games, not competitions.** The `games` module keeps the catalogue, activity matching, surges, favourites and, later, LFG. Each game carries its competition rules as data (team size, teams per match, a default format), and Tournament reads them. Rosters and rounds for casual play (the product owner's decision of 2026-11-07) move from Games to Tournament.
6. **Finals and Tournament stay apart.** A Finals champion shows on the screen and in Moments, but adds no Tournament points.

## Consequences
- **0025, superseded in part:** the `finals` platform module (its paths, events and rights, its storage, API and frontend built on the kit), the core shared only between that module and the off-LAN app, and the tournament module kept off the core no longer hold. Still standing: the off-LAN app keeps its own data with no data sync, the provider contract is the bot's interface to `/finals`, a dependency on the core is pinned to a release and bumped deliberately, and the licence and attribution travel with it. 0025's Status line points here.
- **0027:** its finals item is settled: the finals tourney is the Apps track's first app, as an external app that each event connects to. Its Status line points here.
- **The roadmap:** the Finals track becomes the integration of the deployed app (sign-in, `/finals`, screen cards, Moments, a hub link); step 7 gains mini tournaments for any game and the core; the Games track drops rosters and rounds and gains each game's competition rules; the reuse table and the parallel tracks follow ([roadmap](../roadmap.md)).
- **Kept for their own issues:** the core's design (its parameters, formats and the preset's equivalence tests), the Finals track's research pack (#172), step 7's research pack, and every contract change (the `games` catalogue's competition rules, the tournament's mini tournaments, the external-app interface).

## Known limits
- **The external-app interface is not designed yet.** The per-event connection (address and secret), sign-in, scopes, webhook delivery and the screen and hub hooks come from the Apps track (#193); until then the integration's shape is a sketch, and the bot's `/finals` keeps the provider contract as it is.
- **Two users of one core.** The Finals app and the platform can sit on different major versions of the core for a while; the preset's equivalence tests are what keeps THE FINALS the same in both.
