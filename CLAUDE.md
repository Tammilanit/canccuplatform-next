@AGENTS.md

## Optional shortcut words (Claude Code)
Shortcuts for the steps in AGENTS.md. The rules never depend on them; without them, follow AGENTS.md directly. `<n>` is the issue number.
- `issues` — list `ready` and `in-progress` issues grouped by module label, then `idea` issues under "Ideas"; nothing else.
- `<n>` — claim the issue (assign yourself, or comment if you cannot; `gh issue develop <n> --checkout --name <n>-<slug>`), show it, propose a tier with a one-line reason and wait. Tiers: fix = implement, check, report · feature = short plan in chat, wait for OK, implement · plan = write `docs/plans/issue-<n>.md`, commit, stop.
- `execute` — run `docs/plans/issue-<n>.md` for this branch step by step, checking each.
- `finish` — re-read the acceptance criteria against the work; if any is unmet, stop and list them. Otherwise commit, push, open or update the PR per AGENTS.md (draft → ready), enable auto-merge, then `gh pr checks --watch` ("no checks" is never green: wait 30 s and check again). If CI fails: `gh run view <id> --log-failed`, fix, push, watch again — at most two rounds, then stop and show the failure. Report the PR URL, a file-by-file diff summary and the `Verification run` line.
- `ship` — make sure auto-merge is enabled and wait until GitHub merges the PR (never `gh pr merge` without `--auto`). If a person must approve (AGENTS.md, Merge rules), say which and stop. After merge: checkout main and pull; maintainers do the ready-chain bookkeeping.
- `pause` — update the PR description's `Next action:` line with where the work stands, push, stop.
- `resume` — checkout the issue's branch, read its PR description and continue from `Next action:`.
- `promote <n>` / `groom` (maintainers) — as in AGENTS.md, Maintainers; show proposals and change nothing until answered.
