# CI

`.github/workflows/ci.yml` runs on every pull request and on push to main. `.github/workflows/review-gate.yml` runs on pull requests, PR comments and merge-queue entries. There is no Claude review in CI (see [Code review](#code-review)).

## Checks (names are stable; branch rules require them)
| Check | What it does |
|---|---|
| `lint-types-test (kit-ts)` | In `packages/kit-ts`: `npm ci`, `npm run lint` (eslint + prettier), `npm run typecheck`, `npm test` (vitest). |
| `lint-types-test (kit-py)` | In `packages/kit-py`: `pip install -e ".[dev]"`, `ruff check .`, `mypy .` (strict), `pytest`. The `dev` extra pins these tools. |
| `lint-types-test (ui)` | In `packages/ui`: `npm ci`, `npm run lint` (eslint + prettier), `npm run typecheck`, `npm test` (vitest). After it first runs on main, a maintainer adds it to the required checks. |
| `no-event-names` | Fails if the lines a PR adds contain a forbidden term. |
| `review-gate` | From `.github/workflows/review-gate.yml`: passes only on an independent review's `Review verdict: pass <head sha>` for the PR's current head (see below). |
| `contracts` | `scripts/check-contracts`: validates every `events/*/profile.yaml` against `contracts/profile.schema.json`, checks its asset paths exist, and lints `contracts/*.openapi.yaml` with Redocly (`contracts/redocly.yaml`). |

Do not rename these jobs; renaming breaks the required checks.

## contracts
- `scripts/check-contracts [--dry-run]`; tools come through `npx` with pinned versions (ajv-cli, ajv-formats, @redocly/cli), so it needs Node 22 and no `package.json`.
- Fails (exit 1) on an invalid profile, a missing asset or an OpenAPI lint error; exit 2 on wrong usage or missing files.
- **Required check:** after this job first runs on main, a maintainer adds `contracts` to the required checks of the main ruleset. Do not rename the job.

## no-event-names
- `scripts/check-event-names [--dry-run] [BASE]` scans added lines of `BASE...HEAD`, case-insensitively.
- The term list (event name, venue, IPs, hostnames, Discord ids) is **not in the repo**. A maintainer stores it in the Actions secret `EVENT_NAME_TERMS`, one term per line or comma-separated.
- Exempt: `github.com` git remote URLs (https, ssh, `git@`) and `<org>/<repo>` slugs of this org. Nothing else: the bare org name in prose, or its domain in a hostname or URL, still fails when it is on the term list.
- The log shows only `file:line`, never the matched term.
- Locally: `EVENT_NAME_TERMS=$'term1\nterm2' scripts/check-event-names origin/main`. Self-test: `scripts/check-event-names --self-test`.
- Without the secret the check fails (exit 2), except on fork PRs, where secrets are unavailable and it is skipped with a warning; a maintainer reviews those when approving the run.

## Code review
- There is no `claude-review` check any more. It ran Claude in CI on a subscription token that can no longer be renewed, so `.github/workflows/claude-review.yml` and its prompt `.github/claude-review.md` were removed.
- In its place every PR gets an independent review outside CI. A separate reviewer that did not write the change runs the review: in Claude Code, a fresh session with `/code-review` at `high` effort, plus `/security-review` for sign-in, rights, secrets or tenancy/RLS. It posts a PR comment whose last line is `Review verdict: <pass|changes|manual — reason> <head sha>`, and on `pass` it enables auto-merge. A maintainer arranges the review for fork PRs. See AGENTS.md, Working on an issue (step 8) and Merge rules.
- **Required check:** a maintainer removes `claude-review` from the required checks of the main ruleset before the removal merges; otherwise every PR waits for a check that never runs.
- The secret `CLAUDE_CODE_OAUTH_TOKEN` is no longer used; a maintainer may delete it under Settings → Secrets and variables → Actions.

## review-gate
- **Rule:** among the PR's comments by authors with write access (`author_association` OWNER, MEMBER or COLLABORATOR), the newest one whose last line matches `^Review verdict: (pass|changes|manual — .+) ([0-9a-f]{40})$` decides. The check passes only when that verdict is `pass` and its SHA equals the PR's current head. Otherwise it fails and names the reason: no verdict, `changes`, `manual`, or a verdict for an older head. Comments by other authors are ignored, so they can neither pass nor block a PR.
- **A push voids a review:** the new head has a new SHA, so the old `pass` no longer matches and the check fails until a reviewer posts a verdict for the new head.
- **Triggers:** `pull_request` (opened, synchronize, reopened, ready_for_review) runs the check. A PR comment (created, edited, deleted) that contains `Review verdict:` and comes from an author with write access starts the `review-gate (rerun on verdict)` job, which re-runs the review-gate run of the PR's current head. A comment run belongs to the default branch, so its own check would never appear on the PR. On `merge_group` the check passes, because the PR was gated before it was queued.
- **Why its own workflow file:** the gate re-runs its whole workflow run after each verdict, and GitHub only re-runs a run once it has finished. In `ci.yml` that would mean waiting for the full demo stack; on its own, the run finishes in seconds. Keeping it separate also keeps comment events away from the other CI jobs.
- **Safety:** no secrets and no LLM. The check job's `GITHUB_TOKEN` only reads (`contents`, `issues`, `pull-requests`). The rerun job additionally has `actions: write`, which it uses only to re-run the gate. Comment text is matched with `jq` in `.github/scripts/review-gate` and never executed. The logic lives under `.github/`, so changing it needs a maintainer's accept.
- **Locally:** `.github/scripts/review-gate --self-test`. To evaluate a PR: `gh api --paginate repos/<org>/<repo>/issues/<pr>/comments | jq -s 'add' > /tmp/c.json && .github/scripts/review-gate /tmp/c.json <head sha>`.
- **Comment trigger:** GitHub runs comment events only from the workflow file on `main`, so re-runs on a verdict start once this workflow is merged. Before that, re-run the check by hand.
- **Required check:** after the workflow first runs on main, a maintainer adds `review-gate` to the required checks of the main ruleset. Do not rename the job.

## Fork and first-time PRs
- Settings → Actions → General → "Fork pull request workflows from outside collaborators" is set to *Require approval for all outside collaborators*. CI does not run on a fork or first-time-contributor PR until a maintainer approves the run; that maintainer also arranges the independent review.
