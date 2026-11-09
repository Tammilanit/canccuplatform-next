# Step and track briefs

One brief per roadmap step from step 3 on, and one per parallel track ([0023](../decisions/0023-step-design-briefs.md), [0026](../decisions/0026-briefs-are-research-packs.md)). A brief starts as a **research pack** for a very heavy, extensive and interactive brainstorming session between the lead and the product owner, and ends as the step's **plan**, accepted by the product owner before any code. The step's issues and packages build on it ([AGENTS.md, How work flows](../../AGENTS.md#how-work-flows)).

## How a brief is made
1. **Two issues** open the step or track:
   - the research pack: `docs(briefs): step <n> (<title>): research pack for the brainstorming session`, or `docs(briefs): <Name> track: research pack for the brainstorming session` (issues opened under 0023 with the old title count the same);
   - the plan: `docs(briefs): step <n> (<title>): plan`, or `docs(briefs): <Name> track: plan`, blocked by the research pack.

   The other issues of the step or track are blocked by the plan issue (fast-lane issues excepted), so the pack PR, which closes only the pack issue, releases nothing.
2. **The research pack.** Its PR adds `step-<n>-<name>.md` or `track-<name>.md` here (`<name>` a short slug of the step's or track's title: lowercase, hyphens, e.g. `step-3-screen.md`, `track-cast.md`), and its mockups in a folder of the same name next to it. The PR is marked ready when the pack is complete; the reviewer's verdict is `manual — step brief` and a maintainer accepts it.
3. **The session.** After the pack merges, the lead runs the session with the product owner in chat, over as many rounds as it takes, until no question is open. The pack is the agenda; the product owner may add questions and the lead may draw new mockups.
4. **The plan.** The lead writes the final plan into the brief in its own PR, which closes the plan issue (verdict `manual — step brief`). The product owner accepts the plan by accepting that PR.
5. After the merge the lead applies the plan's issue set to the tracker (keeps, merges, rewrites, drops and adds issues as the plan lists them) and only then swaps their `blocked` label for `ready`; the package plan follows. A merged plan is not rewritten; a later change to the design goes through a `Roadmap note:` and the checkpoint.

## Outline of a research pack
- **Goal:** the step or track in a few lines, linked to its roadmap section.
- **Sources:** what the pack is built from: decision 0022 and the other decisions, the roadmap's text, the legacy inventories for the area, the contracts it builds on, the epic and its issues, and how polished products solve the same problem.
- **Three directions:** three creative directions, each described for attendees, organisers and venue staff (and the superadmin where the step touches the shared stack), with its idea, its trade-offs and its cost.
- **Recommended direction:** one of the three (or a mix), argued boldly.
- **Mockups:** every key screen and flow of the recommended direction, for each user who meets them (organiser, attendee, venue crew, superadmin), as HTML or SVG files in `step-<n>-<name>/` or `track-<name>/`, each listed in the brief with what it shows. Text wireframes may add detail but do not replace them.
- **Port, drop or invent:** what the step takes from the legacy (as is or changed), what it drops, and what is new, each with its reason ([0020](../decisions/0020-best-of-old-freely-new.md)).
- **Question bank:** every open question found, with no limit on the number, grouped by theme:
  - who uses it and how;
  - look and feel;
  - data and integrations;
  - edge cases and failure;
  - operations and scale.

  Each question has its options and a recommendation, and a number (for example `Q3.2`) so the session can refer to it.
- **Proposed issue changes:** the step's existing issues are input, not a fixed scope: which to keep, merge, rewrite or drop, and which to add, each with its reason. The lead applies them after the session; the pack's author does not create or edit issues.

## The plan
Added by the lead after the session, under `## Plan`, without rewriting the research above it:
- the chosen direction and how it differs from the pack's recommendation;
- the answer to every question in the bank, by its number, and to any question added in the session;
- mockups the session changed or added, as new files in the same folder (for example `plan-<screen>.html`), listed here; the pack's own files stay as they are;
- the step's final issue set, in its order: each issue linked, marked kept, merged into another, dropped or new, with its rewritten goal and criteria where they change. The lead applies it to the tracker after the merge.

## Rules
- Nothing event-specific, as everywhere in this repo: use the demo event (`events/demo/`) in text and mockups.
- Mockups are drawn new: legacy screenshots are never used as mockups. HTML mockups are self-contained (no external scripts, fonts, styles or images) and open straight from the file; so they cannot be split, `scripts/file-size-exemptions.txt` exempts them from the file-size warning. The no-event-names check reads HTML and SVG text but not raster images, so the reviewer inspects every image in a mockup for real event names, venues, hostnames, IPs, Discord ids and personal names.
- A plan sets the floor and the direction, not every detail: within it, each issue's Room to design leaves workers free to make a better design and say why in their PR.
