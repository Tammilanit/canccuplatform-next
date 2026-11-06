# 0023. Every step starts with a design brief, and issues leave room to design

- **Status:** Accepted (extends [0019](0019-work-packages.md) without superseding it)
- **Date:** 2026-11-06

## Context
[0019](0019-work-packages.md) runs a step as packages that follow the step's issues. The lead writes those issues at once, before anyone has drawn the screens or walked the flows. A worker then builds to the acceptance criteria and, under "no splitting", has no moment to question the design. For a commercial-scale, polished product ([0020](0020-best-of-old-freely-new.md), [0022](0022-product-vision.md)) this leaves out the creative step: comparing directions, sketching the key flows and agreeing on one with the product owner before code exists. Criteria written as a full spec also leave a worker no room to make something better. The product owner agreed the step design brief below on 2026-11-06 (#130).

## Decision
- **A design brief opens each step, from step 3 on.** The first issue of the step is `docs(briefs): step <n> design brief and brainstorming round`. Every other issue of the step is blocked by it.
- **The brief's PR adds `docs/briefs/step-<n>-<name>.md`** with:
  - three creative directions for the step, and the recommended one with the reason;
  - the key flows of the recommended direction, with mockups;
  - port, drop or invent: what the step takes from the legacy, what it leaves, and what is new ([0020](0020-best-of-old-freely-new.md));
  - proposed changes to the step's issues (scope, criteria, order, new or merged issues) for the lead to apply;
  - at most 7 open questions, each with a recommendation.
- **The brainstorming round.** The lead runs one round with the product owner on the brief's PR. The brief is then revised once, in the same PR. A maintainer accepts it: the reviewer's verdict is `manual — step brief`, as for a plan-tier plan.
- **After the accept** the lead applies the proposed issue changes (only the lead creates, merges or rewrites issues, as in 0019), removes the block from the step's other issues, and the package plan follows. No code for the step is written before the brief is accepted.
- **Room to design.** Every issue has a `## Room to design` section after its acceptance criteria:
  - the criteria are the floor, not the ceiling;
  - a worker may choose a better design than the issue sketches, within the accepted brief and the issue's Out of scope, and says why in the PR;
  - the section names what is fixed (a contract, a flow the product owner chose) and where freedom is wanted. An issue without the section gets the same default.
  - The freedom does not reach contracts, migrations or the risk class: those keep their own rules. A better design that leaves the brief is a `Roadmap note:`, not a change made in the PR.

## Consequences
- AGENTS.md: "How work flows" gains the step brief; "Issues" gains Room to design in the standard body; the `manual` verdict and the maintainer's accept list name step briefs. CLAUDE.md's `review` and `ship` shortcut words, CONTRIBUTING.md and `docs/contributing.md` follow.
- `docs/briefs/README.md` explains the folder and the brief's outline.
- The roadmap records that a step from step 3 on starts with its brief. Steps 0–2 run without one.
- The reviewer checks that a PR's design choices stay within the accepted brief and the issue's Out of scope, and that the PR says why.
- Everything else in 0019 holds: packages, risk classes, no splitting, the health pass and the checkpoint.

## Known limits
- **The step is slower to start.** No code runs while the brief waits for the round and the accept. Parallel tracks and fast-lane issues are not blocked.
- **The gate does not know briefs.** Nothing in CI tells a brief from other docs; the reviewer's `manual` verdict is what holds it for the maintainer, as with plan-tier plans. Because `review-gate` passes only on `pass`, a `manual` verdict keeps the PR from merging until a maintainer accepts it.
- **One revision only.** If the round leaves a question open, the brief records it with its recommendation and the lead settles it in the issues; a second round is the maintainer's call.
- **Room to design is a judgement.** "Better" is the worker's claim and the reviewer's check; disagreements go to the checkpoint as roadmap notes.
