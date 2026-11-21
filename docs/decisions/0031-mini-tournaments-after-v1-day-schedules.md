# 0031. Mini tournaments for any game wait until after version 1; things planned in time are shown as a day schedule

- **Status:** Accepted (narrows point 4 of [0030](0030-finals-integrated-one-tourney-core.md), and the part of point 5 about each game's competition rules, without superseding it; adds amendment 4 to [the design guideline](../design/README.md#amendments-accepted-by-the-po-binding-for-the-build))
- **Date:** 2026-11-21

## Context
[0030](0030-finals-integrated-one-tourney-core.md) point 4 gave the `tournament` module both the event's official tournament and mini tournaments for any game in the catalogue, run by the players like Finals, and the roadmap put both into step 7, with "a mini tournament for a catalogue game runs on the core" in its exit criteria. The Games track gained each game's competition rules, which only those mini tournaments read. Version 1 already carries the official tournament, the core's generalisation and the Finals integration.

Separately, several mockups of the research packs draw things planned in time (sessions, matches, rounds, screen windows, orders) as a grid of cards. A grid shows neither what comes first nor what overlaps; the agenda's run of the show ([`modules/agenda/src/canccu_agenda/day_view.py`](../../modules/agenda/src/canccu_agenda/day_view.py), sheet 5 of [`mockups.html`](../design/mockups.html)) shows a day as times down the side and items in order, and reads at a glance.

On 2026-11-21 the product owner decided both points below. In their words: "we probably should leave out the general mini tournaments from version 1", choosing to "still use the THE FINALS mini from day 1, not just generalize in the first version"; and "I don't like the grid based view in some of the mockups. In some a day based schedule (like the schedule view in basic run of the show) is better", made a design rule for all.

## Decision
1. **Mini tournaments for any game wait until after version 1.**
   - **THE FINALS mini tourney is integrated from day 1**, as 0030 says. The Finals track does not change.
   - **the tourney core 2.0.0 (today's finals-core) is still built as the fully general engine in step 7** (team size, teams per match, formats and scoring tables as parameters, THE FINALS as one preset), so mini tournaments are cheap to add later. Tournament's official cup runs on it.
   - **Mini tournaments for catalogue games move to "Not scheduled yet"** in the roadmap. Step 7's exit loses "a mini tournament for a catalogue game runs on the core".
   - **Each game's competition rules wait with them**, because only mini tournaments read those rules: the Games track drops them for now. They come back earlier only if step 7's research pack shows the official cup needs them.
2. **Things planned in time are shown as a day schedule, not a card grid.** This is amendment 4 of [the design guideline](../design/README.md#4--things-planned-in-time-are-a-day-schedule-2026-11-21), binding for every page and screen.
   - It covers anything planned in time: tournament sessions, a session's matches by time, rounds, screen windows, pizza orders by call time, the agenda.
   - Each is shown one day at a time, with the times down the side and the items in time order, like the agenda's run of the show. Days switch with a day picker.
   - At phone width it is the same list, one day at a time.
   - Amendment 3's auto-fill grid stays for collections of like items with no time order: the sound library, devices, storyboards, photos.

## Consequences
- **0030** keeps its body ([decisions README](README.md)); its Status line names the narrowing of points 4 and 5 and links here. Its other points stand: Finals is integrated as it is, one tourney core, Tournament holds the official tournament, Games holds the games, and Finals and Tournament stay apart.
- **The roadmap:** step 7 keeps the official tournament and the core, and its exit is a test tournament run end to end; the Games track loses each game's competition rules; "Not scheduled yet" gains mini tournaments for catalogue games and their competition rules ([roadmap](../roadmap.md)).
- **The design guideline** gains amendment 4 ([docs/design/README.md](../design/README.md)).
- **Built pages** that show timed items as a card grid are not changed by this record; the PR that adds it lists them as a follow-up.
- **Research packs** follow the rule in their next revision; the step 7 pack does it in #682.
- **The lead updates the step 7 epic (#61) and the Games epic (#66)** after this record merges.

## Known limits
- **The core's plan still describes mini tournaments.** [The tourney core's plan](../plans/tourney-core.md) names a mini tournament as one of the core's users; the core is still built fully general, so the plan's parameters stand, and its mini-tournament row describes a later user, not step 7's work.
- **Rosters and rounds for casual play** (0030 point 5) are not part of this decision; they stay where the roadmap puts them.
