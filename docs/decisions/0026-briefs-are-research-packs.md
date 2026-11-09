# 0026. A step brief is a research pack for an extensive brainstorming session

- **Status:** Accepted (extends [0023](0023-step-design-briefs.md) and replaces its brainstorming round: the one round, the single revision, the limit of 7 open questions and the exception for parallel tracks; the rest of 0023, Room to design included, holds)
- **Date:** 2026-11-08

## Context
[0023](0023-step-design-briefs.md) opens each step from step 3 on with a design brief: three directions, the key flows with mockups, at most 7 open questions, one brainstorming round with the product owner on the brief's draft PR, and one revision. The product owner wants more (2026-11-08, #175): every step and every parallel track starts with a very heavy, extensive and interactive brainstorming session. Seven questions and one revision cannot carry that. The session needs a pack that puts every open question and every key screen in front of the product owner, and it needs to run until nothing is open, not stop after one round. The brief issues of steps 8–11 and the tracks (#167–#174) are already written this way, and the lead has added the same to the earlier ones (#106, #111, #116, #120, #126).

## Decision
- **Every main step from step 3 on and every parallel track** (Finals, Games, Cast, App, and any track added later) starts with a brief, carried by two issues the lead writes with the step's other issues:
  - the **research pack** issue: `docs(briefs): step <n> (<title>): research pack for the brainstorming session`, or `docs(briefs): <Name> track: research pack for the brainstorming session`; issues opened under 0023 with the old title count the same;
  - the **plan** issue: `docs(briefs): step <n> (<title>): plan`, or `docs(briefs): <Name> track: plan`, blocked by the research pack issue.

  Every other issue of the step or track is blocked by the plan issue, so the tracker's blocked-by links hold the build until the plan PR merges: the pack PR closes only the pack issue. Only fast-lane issues are excepted.
- **The research pack.** Its PR adds `docs/briefs/step-<n>-<name>.md` or `docs/briefs/track-<name>.md` (the full outline is in [`docs/briefs/README.md`](../briefs/README.md)) with:
  - the goal;
  - three creative directions, each described for attendees, organisers and venue staff (and the superadmin where the step touches the shared stack), with its trade-offs and cost; one recommended, argued boldly;
  - mockups of every key screen and flow, as self-contained HTML or SVG files in a folder named like the brief (exempt from the file-size warning, since a self-contained mockup cannot be split);
  - port, drop or invent ([0020](0020-best-of-old-freely-new.md));
  - a full question bank: every open question the author finds, grouped by theme (who uses it and how, look and feel, data and integrations, edge cases and failure, operations and scale), each with its options and a recommendation; there is no limit on the number;
  - proposed issue changes: the step's existing issues are input, not a fixed scope, so the pack proposes which to keep, merge, rewrite or drop and which to add.

  The PR is marked ready when the pack is complete; there is no round on the draft. The reviewer's verdict is `manual — step brief` and a maintainer accepts it, as under 0023.
- **The session.** After the pack merges, the lead runs an interactive session with the product owner, in chat, over as many rounds as it takes until no question is open. The pack is its agenda; the product owner may add questions, and the lead may draw new mockups during it.
- **The plan.** The lead then writes the final plan into the brief in its own PR, which closes the plan issue: the chosen direction, the answer to every question in the bank, mockups the session changed (as new files; the pack's files stay as they are), and the step's final issue set, each issue with its rewritten goal and criteria, or marked kept, merged or dropped. The plan PR is a step brief too: verdict `manual — step brief`, and the product owner, as the maintainer, accepts the plan by accepting it.
- **No build before the accept.** The plan PR's merge closes the plan issue and releases the blocked-by links. The lead then applies the issue set to the tracker as the merged plan lists it (only the lead creates, merges, rewrites or drops issues, as in [0019](0019-work-packages.md)) and only then swaps the issues' `blocked` label for `ready`; the package plan follows. So the tracker never shows an unaccepted issue set, and no worker picks an issue before it is rewritten. A merged plan is not rewritten; a later change to the design goes through a `Roadmap note:` and the checkpoint.
- **The accepted plan bounds the build.** Room to design ([0023](0023-step-design-briefs.md)) and the review measure a design choice against the accepted plan of the step or track (its brief's `## Plan`), not against the pack's recommendation.

## Consequences
- AGENTS.md (How work flows, Step brief) and `docs/briefs/README.md` describe the two issues, the research pack, the session and the plan; the "at most 7 questions" and "revised once" wording goes. AGENTS.md's Room to design, Build and Independent review, and CLAUDE.md's `review` shortcut word, bound design choices by the accepted plan. The roadmap follows.
- "Step brief" in the merge rules and the `manual` verdict covers both the research pack PR and the plan PR, so those texts stay as they are.
- `scripts/file-size-exemptions.txt` exempts HTML mockups under `docs/briefs/`.
- The steps and tracks whose brief issues already exist get a plan issue, and the lead moves their blocked-by links from the pack issue to it.
- A track no longer starts its build when the tenancy foundation lands: it waits for its own accepted plan, like a step.
- Everything else in 0023 and 0019 holds: Room to design, packages, risk classes, no splitting, the health pass and the checkpoint.

## Known limits
- **The start is slower still.** Each step and track waits for a pack, a session of open length and a plan before any code. Steps and tracks whose plans are accepted keep running meanwhile.
- **Two maintainer accepts per step.** The pack and the plan each need one; the pack's accept is light, the plan's is the real decision.
- **The session lives in chat.** Only the plan in the brief and the rewritten issues are the record; what was said and not written into the plan is not.
- **The gate does not know briefs,** as under 0023: the reviewer's `manual` verdict holds both PRs for the maintainer.
