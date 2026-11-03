# AGENTS.md — canccuplatform-next

The shared rules for everyone who works here: maintainers, contributors with write access and fork contributors, whether they use Claude, Cursor, Copilot, Codex or no AI tool at all. This file is the source; tool-specific files (CLAUDE.md and others) only import or point to it.

Monorepo for CanccuPlatform (working name; renamed `canccuplatform` at the switch). It is the system repo of its project: parent issues for cross-module work live here. An event lives in its own repo, which names the platform version it runs; the platform never names an event. Old repos (canccuplatform, canccubot, canccusignage, …) are legacy: each module is ported from them (see Porting).

## Layout
- `modules/<name>` — one module each, each its own container: screen, tournament, pizza, bot, admin, games, moments, voices, cast.
- `packages/kit-ts`, `packages/kit-py` — shared plumbing; `packages/ui` — theme tokens and components.
- `deploy/` Compose (modules + Postgres, Valkey, Caddy) · `setup/` install, wizard, backup, restore, new-event · `contracts/` one file per module · `docs/` general docs · `events/demo/` the demo event profile.

## Rules
- Nothing event-specific: no real event name, venue, IPs, hostnames or Discord ids in code, docs, tests or fixtures. Use `events/demo/`. Event content goes to the event repo. The planned no-event-names check exempts the org name and git remote URLs.
- Modules talk only through their API and events (`contracts/`), never through each other's data.
- Containers keep no state: data and sessions in Postgres, events and caches in Valkey, files in the shared files volume.
- One version for the whole platform; a release is a git tag.
- Porting: each module is PORTED from the proven legacy code. Take the code and tests and adapt them to Postgres, the kit, containers and the contracts. Scrub every event-specific string and all event content to `events/demo/` or the event repo. Never import legacy git history or legacy docs. Code by other authors keeps its licence and attribution; the tournament module (ISC, c22dragoon) is ported only after his OK.
- English throughout. Secrets never in the repo.
- No editing on the VMs: code reaches them only through a merge to main and the deploy that follows.

## Contracts
- A contract change is its own PR and merges first. Make it additive (new fields, endpoints, events); remove old things later in a separate PR.
- Consumers follow in their own PRs, one issue each, after the contract PR is merged.
- Breaking changes (removing or renaming anything a consumer may use) need a person's approval.

## Migrations
- Additive migrations (new tables, columns, indexes) merge automatically once CI is green.
- Destructive migrations (drop, rename, type changes that lose data) need a person's approval.

## Issues
- One issue per module, labelled with its module label: `module:<name>`, plus `module:kit`, `module:ui`, `module:deploy`, `module:setup`, `module:ci`.
- Other labels: `ready`, `idea`, `epic`, `blocked`, `in-progress`.
- Standard body, in this order: `## Goal`, `## Acceptance criteria` (checkboxes), `## Files likely involved`, `## Out of scope`, and `## Plan` (commit-pinned link) when it belongs to a plan. An `idea` may omit criteria until its open question is decided.

## Working on an issue
1. **Pick** an issue labelled `ready` (or ask on an `idea` first).
2. **Claim** it: assign yourself. If you cannot (fork contributors), comment "I'll take this". Open a draft PR early so others see the work.
3. **Branch** `<n>-short-name` (from the title: lowercase, hyphens, max ~4 words), on the repo if you have write access, otherwise on your fork. One issue per PR. Nobody pushes to main.
4. **Build** within the issue's scope. If the issue needs a design first and a maintainer asks for a plan, write it to `docs/plans/issue-<n>.md` and commit it; otherwise no plan file.
5. **Check** before asking for review: run the checks of the modules you touched (see Run and test). For scripts, run them once with `--dry-run` or against an unreachable host and confirm a clear failure.
6. **Commit** with conventional commits, the module as scope: `feat(screen): …`, `fix(bot): …`, `docs(map): …`.
7. **PR**: title = the commit subject; body starts with `Closes #<n>` and ends with a `Next action:` line (what remains, or `none`) and `Verification run: <what> — <result>` (or `none — <reason>`). The PR description is the handoff: anyone picking the work up reads it there. Do not commit handoff or session notes.
8. **Done** = PR ready for review, all acceptance criteria met, and auto-merge enabled (`gh pr merge <pr> --auto`, or the button; the merge queue sets the strategy and rejects `--delete-branch` and strategy flags). Never merge by hand; GitHub merges when the gates pass.

`ready` and `in-progress` are maintainer bookkeeping; contributors do not need to set them.

## Run and test
- **Whole platform:** `docker compose -f deploy/compose.yml up -d` starts Postgres, Valkey, Caddy (IP mode, plain http on port 80) and the modules; `http://<host-ip>/api/hello/health` answers when it is up. Caddy routes machine endpoints under `/api/<module>/` and module pages under `/<module>/`, stripping the prefix. The demo event (`events/demo/`) is loaded once the demo-event issue lands.
- **Per module:** each module's README names its check command (lint, types, unit tests). CI runs the same commands. `modules/hello` (a test module) is the first with checks.
- Local machines: see [CONTRIBUTING.md](CONTRIBUTING.md) for Linux, Windows (WSL2) and macOS.

## Merge rules
Everyone codes with AI, so the gates are machines; a person steps in only where real damage is possible.
- **Automatic:** a PR with auto-merge enabled is squash-merged (through the merge queue once branch rules exist) when CI is green and the Claude review check passes. CI covers lint, types, unit tests, contract API tests, the full demo stack with screenshots, coverage not dropping, the no-event-names check, contract diff (additive vs breaking) and migration lint. After merge the shared test VM updates itself to main.
- **A person approves only:**
  1. a breaking contract change;
  2. a destructive migration;
  3. running CI and the review on a PR from a fork or a first-time contributor.

## Maintainers
Plain GitHub actions; any tool or none.
- **Cross-module work:** create one child issue per module first, then a parent issue here labelled `epic`, with the children linked as sub-issues and one `Order:` line (e.g. `Order: #6 → #7 → #11`). A contract change is its own child, first in the order.
- **Ready chain:** only the first unblocked child is `ready`; the rest are `blocked`. When a child's PR merges, label the next child `ready` and drop its `blocked`; close the parent when all children are closed.
- **Bookkeeping:** move `ready` → `in-progress` when someone claims an issue; remove `in-progress` when its PR merges or the claim is dropped.
- **Promote an idea:** write acceptance criteria that settle its open question, then swap `idea` for `ready`.
- **Groom:** per module, review in-progress, ready and ideas; promote, keep or close each idea; check each open parent names its next child.
