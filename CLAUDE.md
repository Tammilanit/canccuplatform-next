# canccuplatform-next — map

Monorepo for CanccuPlatform (working name; renamed `canccuplatform` at the switch). This is the system repo of its project: parent issues live here, and its event repo is `tammilanit-event` (sibling folder in ~/code). Old repos (canccuplatform, canccubot, canccusignage, …) are legacy: read them for the harvest, never copy wholesale.

## Layout
- modules/<name> — one module each: screen, tournament, pizza, bot, admin, games, moments, voices, cast. Each is its own container.
- packages/kit-ts, packages/kit-py — shared plumbing; packages/ui — theme tokens and components.
- deploy/ Compose (modules + Postgres, Valkey, Caddy) · setup/ install, wizard, backup, restore, new-event · contracts/ one file per module · docs/ general docs · events/demo/ demo profile.

## Rules
- Nothing event-specific: no real event name, venue, IPs, hostnames or Discord ids in code, docs, tests or fixtures. Use events/demo/. Event content goes to the event repo.
- Modules talk only through their API and events (contracts/), never through each other's data.
- Containers keep no state: data and sessions in Postgres, events and caches in Valkey, files in the shared files volume.
- A contract change and its consumers land in the same PR. Additive first, remove later; breaking changes and destructive migrations need a person.
- One version for the whole platform; a release is a git tag.
- Fresh start: no code or history is copied from legacy repos; only agreed picks from the harvest are rewritten here.
- English throughout. Secrets never in the repo.
- No editing on the VMs: code reaches them only by deploy.

## Issues
- One issue per module, labelled with its module label (`module:<name>`, plus `module:kit`, `module:ui`, `module:deploy`, `module:setup`), instead of one per repo. Cross-module work: children first, then a parent here with one "Order:" line, children linked as sub-issues, only the first child `ready`. A contract change is its own child, first in the order.
- Labels: `ready`, `idea`, `epic`, `blocked`, `in-progress`, plus module labels.
- Standard body, in this order: `## Goal`, `## Acceptance criteria` (checkboxes), `## Files likely involved`, `## Out of scope`, and `## Plan` (commit-pinned link) when it belongs to a plan. An `idea` may omit criteria until its open question is decided.
- Branches: `<n>-short-name` (from the title: lowercase, hyphens, max ~4 words). One issue per PR. Nobody pushes to main.

## Commands I type
Before reporting done: run the checks of the modules you touched (none exist yet in the skeleton; say so). For scripts, run them once with `--dry-run` or against an unreachable host and confirm a clear failure.
- issues    `gh issue list -l ready` and `gh issue list -l in-progress`, grouped by module label, then `gh issue list -l idea` under "Ideas"; nothing else.
- <number>  claim: `gh issue develop <n> --checkout --name <n>-<slug>`; `gh issue edit <n> --add-label in-progress --remove-label ready`; show the issue; propose a tier with a one-line reason and wait.
            fix = implement, verify, report · feature = short plan in chat, wait for OK, implement · plan = write docs/plans/issue-<n>.md and stop.
- promote <n>  turn an `idea` into `ready`: draft acceptance criteria that settle its open question, show them, wait; on OK update the body and labels.
- resume    checkout the in-progress branch, read the newest docs/handoffs/ file, continue from "next action".
- execute   run docs/plans/issue-<n>.md for this branch step by step, verifying each.
- finish    re-read the issue's acceptance criteria against the work; if any is unmet, stop without committing and list them. Then delete docs/handoffs/issue-<n>-*.md; stage; conventional commit with the module as scope (`feat(screen): …`); push; `gh pr create --title "<subject>" --body "Closes #<n>"`; then `gh pr checks --watch`. "No checks" is never green: wait 30 s and run it again. If CI fails: `gh run view <id> --log-failed`, fix, commit, push, watch again — at most two rounds, then stop and show me. When green: print PR URL + file-by-file diff summary, ending with `Verification run: <what> — <result>` (or `none — <reason>`). Do NOT merge.
- ship      confirm `gh pr checks` is green (if not, say so and stop); `gh pr merge --squash --delete-branch` (becomes auto-merge through the merge queue once branch rules exist); checkout main and pull; remove `in-progress`. If the issue has a parent: label its next unblocked child `ready`; close the parent when all children are closed. Stop if migrations were touched.
- deploy    update the venue VM to main. While the event repo's platform.version is `dev` this happens automatically on every merge: confirm the VM picked it up and its health is ok, nothing more. Until deploy/ and setup/ exist, say there is nothing to deploy and stop.
- pause     run /handoff, save to docs/handoffs/issue-<n>-<date>.md, commit "handoff #<n>", push.
- groom     backlog review grouped by module: list in-progress, ready, ideas; for each idea propose promote / keep / close with draft criteria; for each open parent name the next child. Change nothing until I answer, then apply, create new items with the standard body, and print the `ready` list per module.
