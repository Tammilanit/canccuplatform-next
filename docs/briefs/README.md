# Step design briefs

One design brief per roadmap step, from step 3 on ([0023](../decisions/0023-step-design-briefs.md)). A brief is the step's agreed design: written before any code, discussed with the product owner in one brainstorming round, revised once and accepted by a maintainer. The step's issues and packages build on it ([AGENTS.md, How work flows](../../AGENTS.md#how-work-flows)).

## How a brief is made
1. The step's first issue, `docs(briefs): step <n> design brief and brainstorming round`, blocks the step's other issues.
2. Its PR adds `step-<n>-<name>.md` here (`<name>` a short slug of the roadmap step's title: lowercase, hyphens, e.g. `step-3-screen-pulse.md`).
3. The lead runs the brainstorming round with the product owner on the PR. The brief is revised once in the same PR, with what was decided and any question still open.
4. The reviewer's verdict is `manual — step brief`; a maintainer accepts it.
5. The lead applies the proposed issue changes and unblocks the step's other issues. A merged brief is not rewritten; a later change to the design goes through a `Roadmap note:` and the checkpoint.

## Outline of a brief
- **Goal:** the step in a few lines, linked to its roadmap section.
- **Three directions:** three creative directions for the step, each with its idea, what it does well and what it costs.
- **Recommended direction:** one of the three (or a mix), and why.
- **Key flows:** the main flows of the recommended direction, for each user who meets them (organiser, attendee, venue crew, superadmin), with mockups. Mockups are text wireframes in the brief or images in `step-<n>-<name>/` next to it, using the demo event only.
- **Port, drop or invent:** what the step takes from the legacy (as is or changed), what it drops, and what is new, each with its reason ([0020](../decisions/0020-best-of-old-freely-new.md)).
- **Proposed issue changes:** changes to the step's issues (scope, criteria, Room to design, order, issues to add or merge). The lead applies them; the brief's author does not create or edit issues.
- **Open questions:** at most 7, each with a recommendation.
- **After the round:** added in the revision: what the product owner decided and what is still open.

## Rules
- Nothing event-specific, as everywhere in this repo: use the demo event (`events/demo/`) in text and mockups.
- A brief sets the floor and the direction, not every detail: within it, each issue's Room to design leaves workers free to make a better design and say why in their PR.
