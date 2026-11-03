# CI

`.github/workflows/ci.yml` runs on every pull request and on push to main; `.github/workflows/claude-review.yml` runs on every pull request.

## Checks (names are stable; branch rules require them)
| Check | What it does |
|---|---|
| `lint-types-test (kit-ts)` | In `packages/kit-ts`: `npm run lint`, `npm run typecheck`, `npm test`. Passes with "empty package" while there is no `package.json`. |
| `lint-types-test (kit-py)` | In `packages/kit-py`: `ruff check .`, `mypy .`, `pytest`. Passes while there is no `pyproject.toml`; the package must offer a `dev` extra with these tools. |
| `no-event-names` | Fails if the lines a PR adds contain a forbidden term. |
| `claude-review` | From `.github/workflows/claude-review.yml`: Claude reviews the PR against its linked issue (see below). |

Do not rename these jobs; renaming breaks the required checks.

## no-event-names
- `scripts/check-event-names [--dry-run] [BASE]` scans added lines of `BASE...HEAD`, case-insensitively.
- The term list (event name, venue, IPs, hostnames, Discord ids) is **not in the repo**. A maintainer stores it in the Actions secret `EVENT_NAME_TERMS`, one term per line or comma-separated.
- Exempt: `github.com` git remote URLs (https, ssh, `git@`) and `<org>/<repo>` slugs of this org. Nothing else: the bare org name in prose, or its domain in a hostname or URL, still fails when it is on the term list.
- The log shows only `file:line`, never the matched term.
- Locally: `EVENT_NAME_TERMS=$'term1\nterm2' scripts/check-event-names origin/main`. Self-test: `scripts/check-event-names --self-test`.
- Without the secret the check fails (exit 2), except on fork PRs, where secrets are unavailable and it is skipped with a warning; a maintainer reviews those when approving the run.

## claude-review
- Runs on every PR (opened, new commits, reopened, ready for review, description edited). The prompt lives in `.github/claude-review.md`.
- Claude reads `AGENTS.md`, `contracts/`, the diff and the issue linked with `Closes #<n>`, then judges: matches the issue and its acceptance criteria, stays in scope, follows contracts and rules, has real tests. No linked issue fails.
- Result: one PR comment (updated on each run) and the check: pass on `PASS`, fail on `FAIL` or when no verdict comes back.
- **Token:** runs on the organizer's Claude subscription via the Actions secret `CLAUDE_CODE_OAUTH_TOKEN`, created with `claude setup-token` and set by a person under Settings → Secrets and variables → Actions. Never put it in the repo.
- **Fork PRs:** the workflow uses `pull_request`, never `pull_request_target`, so fork PRs get no secrets. The job skips with a notice; the maintainer who approves the run reviews the PR by hand. A skipped job counts as passed for required checks, so that approval is the gate.
- **Approval for outside contributors:** Settings → Actions → General → "Fork pull request workflows from outside collaborators" set to *Require approval for all outside collaborators*. Then neither CI nor the review runs on a fork or first-time-contributor PR until a maintainer approves.
- **Merge queue:** on `merge_group` the job skips with a notice (the PR was already reviewed), so the queue is not blocked.
- **Required check:** GitHub offers a check for the ruleset only after it has run. After the workflow is merged, a maintainer adds `claude-review` to the required checks of the main ruleset. Do not rename the job.
