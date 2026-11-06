# 0021. No freeze and no target dates

- **Status:** Accepted (supersedes the freeze of [0016](0016-merge-policy.md) and the "revisit before the freeze" trigger of [0012](0012-development-on-the-vm.md))
- **Date:** 2026-11-06

## Context
The roadmap had two fixed dates: a freeze from 2027-03-01, from which every PR needed the maintainer's accept ([0016](0016-merge-policy.md)), and an event as the target. The product owner's direction of 2026-11-06 ([0020](0020-best-of-old-freely-new.md)) is a bigger platform, built as well as it can be, and a date would push that back towards a quick port.

## Decision
- **There are no freeze dates and no target dates.** Work goes as fast as it goes, and the steps are ordered by their dependencies only.
- **The freeze rules end:** no date from which every PR needs the maintainer's accept ([0016](0016-merge-policy.md)); 0019 is written without one. The maintainer accepts by risk class ([0019](0019-work-packages.md)).
- **[0012](0012-development-on-the-vm.md)'s trigger** "revisit before the freeze" becomes "revisit before real event data comes to the VM".
- **A release freeze,** if ever wanted before an event, is decided then, in its own record.

## Consequences
- AGENTS.md, CLAUDE.md, CONTRIBUTING.md, `docs/contributing.md` and `docs/roadmap.md` name no freeze and no target date.
- Roadmap step 11 becomes "Dress rehearsal and switch", with no date; an event that runs on the platform pins a tested release, as before.
- Work that waited for "before the freeze" (the reviewer's own OS user, [0014](0014-independent-review.md) Known limits; the dev VM question of 0012) is tied to its roadmap step or to real event data instead.

## Known limits
- **Nothing forces the end.** Without a date, scope can keep growing; the checkpoint at the end of each step ([0019](0019-work-packages.md)) is where the maintainer weighs scope against time.
