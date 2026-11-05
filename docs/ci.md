# CI

`.github/workflows/ci.yml` runs on every pull request and on push to main. `.github/workflows/review-gate.yml` runs on pull requests, PR comments and merge-queue entries. There is no Claude review in CI (see [Code review](#code-review)).

## Checks (names are stable; branch rules require them)
| Check | What it does |
|---|---|
| `lint-types-test (kit-ts)` | In `packages/kit-ts`: `npm ci`, `npm run lint` (eslint + prettier), `npm run typecheck`, `npm test` (vitest). |
| `lint-types-test (kit-py)` | In `packages/kit-py`: `pip install -e ".[dev]"`, `ruff check .`, `mypy .` (strict), `pytest`. The `dev` extra pins these tools. |
| `lint-types-test (ui)` | In `packages/ui`: `npm ci`, `npm run lint` (eslint + prettier), `npm run typecheck`, `npm test` (vitest). After it first runs on main, a maintainer adds it to the required checks. |
| `integration (kit)` | Starts Valkey from the Compose stack (`deploy/compose.yml` + `deploy/compose.test.yml`) and runs the kit-ts and kit-py Valkey integration tests against it. |
| `compose (deploy)` | Runs the `modules/hello` and `modules/admin` checks, starts the whole stack with `docker compose -f deploy/compose.yml up --build --wait`, and checks that only Caddy publishes a port, that only the three named volumes exist, that hello and admin health through Caddy are `ok`, that health is `503 down` when Valkey stops, and that hello refuses to start without a kit variable. |
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
- In its place every PR gets an independent review outside CI. A separate reviewer that did not write the change runs the review: in Claude Code, a fresh session with `/code-review` at `high` effort, plus `/security-review` for sign-in, rights, secrets or tenancy/RLS. It posts, as the reviewer identity (see review-gate), a PR comment whose last line is `Review verdict: <pass|changes|manual — reason> <head sha>`, and on `pass` it enables auto-merge. A maintainer arranges the review for fork PRs. See AGENTS.md, Working on an issue (step 8) and Merge rules.
- **Required check:** a maintainer removes `claude-review` from the required checks of the main ruleset before the removal merges; otherwise every PR waits for a check that never runs.
- The secret `CLAUDE_CODE_OAUTH_TOKEN` is no longer used; a maintainer may delete it under Settings → Secrets and variables → Actions.

## review-gate
- **Reviewer identity:** the gate trusts verdicts from one account only: the login in the repository variable `REVIEWER_LOGIN`. This is a dedicated reviewer bot account, and author sessions do not hold its token. Independent reviews post their verdict comment as that account; authors never post verdict lines, and comments by anyone else (maintainers included) are ignored. `author_association` is not used: the Actions token reports privately listed org members as `CONTRIBUTOR`.
- **Setup:** a maintainer sets `REVIEWER_LOGIN` under Settings → Secrets and variables → Actions → Variables, and gives the reviewer account write access, so it can comment and enable auto-merge. Its token stays with the reviewer sessions or the maintainer tooling, never with author sessions and never in the repo. While the variable is unset, the gate fails with a message that says so. The variable may not be available to fork runs; there, the gate fails, and the maintainer who approves the run re-runs the check.
- **Rule:** among the reviewer identity's comments, the newest one whose last line starts with `Review verdict:`, or that has been edited, decides. The check passes only when all of these hold:
  - the comment was never edited (`updated_at` equals `created_at`);
  - its last line fully matches `^Review verdict: (pass|changes|manual — .+) ([0-9a-f]{40})$`;
  - the verdict is `pass`;
  - the SHA equals the PR's current head;
  - the base branch has not changed since the comment was posted (no `base_ref_changed` or `base_ref_force_pushed` event after it in the PR timeline).

  Otherwise the check fails and names the reason: no verdict, verdict comment edited, unparseable verdict line, `changes`, `manual`, a verdict for an older head, or a base change after the verdict. A malformed newer verdict line therefore fails the gate instead of letting an older `pass` decide.
- **Edited verdicts do not count:** anyone with write access can edit another user's comment, and the comment keeps its author. So an edited verdict comment fails the gate with "verdict comment was edited; ask for a new review". The same happens when a verdict line is edited away. The reviewer posts a new comment instead of editing an old one.
- **A push voids a review:** the new head has a new SHA, so the old `pass` no longer matches, and the check fails until the reviewer posts a verdict for the new head.
- **Triggers:** `pull_request` (opened, synchronize, reopened, ready_for_review, edited) runs the check. `edited` covers a base-branch change, which keeps the head SHA; title and body edits only re-run the check. The `review-gate (rerun on verdict)` job handles PR comments by the reviewer identity:
  - It fires on created, edited and deleted comments whose body has a `Review verdict:` line, and on edits whose old body had one, so withdrawing a verdict also re-runs the gate.
  - It re-runs that PR's own review-gate run for the current head: same SHA, branch and head repo, and the PR number when GitHub lists one.
  - It skips a run that still waits for a maintainer's approval.
  - The rerun is needed because a comment run belongs to the default branch, so its own check would never appear on the PR.

  On `merge_group` the check passes, because the PR was gated before it was queued. Every other comment on any issue or PR only starts a skipped run, which is noise in the Actions list and nothing more.
- **Why its own workflow file:** the gate re-runs its whole workflow run after each verdict, and GitHub only re-runs a run once it has finished. In `ci.yml` that would mean waiting for the full demo stack; on its own, the run finishes in seconds. Keeping it separate also keeps comment events away from the other CI jobs.
- **Safety:** no secrets and no LLM. The check job's `GITHUB_TOKEN` only reads (`contents`, `issues`, `pull-requests`). The rerun job additionally has `actions: write`, which it uses only to re-run the gate. Comment text is matched with `jq` in `.github/scripts/review-gate` and never executed. The gate runs the PR's own copy of its workflow and script, so a PR could weaken its own gate. This is why changes under `.github/` need a maintainer's accept.
- **Locally:** `.github/scripts/review-gate --self-test`. To evaluate a PR: `gh api --paginate repos/<org>/<repo>/issues/<pr>/comments | jq -s 'add' > /tmp/c.json`, `gh api --paginate repos/<org>/<repo>/issues/<pr>/timeline | jq -s 'add' > /tmp/t.json`, then `REVIEWER_LOGIN=<login> .github/scripts/review-gate /tmp/c.json <head sha> <head sha> /tmp/t.json`.
- **Comment trigger:** GitHub runs comment events only from the workflow file on `main`, so re-runs on a verdict start once this workflow is merged. Before that, re-run the check by hand.
- **Required check:** after the workflow first runs on main, a maintainer adds `review-gate` to the required checks of the main ruleset. Do not rename the job.
- **Known limits.** The maintainer tooling (the dispatcher) treats every `.github/` PR as needing a maintainer's accept, which covers the first limit:
  - **A PR runs its own gate.** The check runs the PR's copy of `review-gate.yml` and `.github/scripts/review-gate`, so a PR that changes them can make its own check green. Possible follow-ups: `pull_request_target` with a checkout of the base ref only, or CODEOWNERS for `.github/` with required code-owner review.
  - **Deleted reviewer comments.** Anyone with write access can delete the reviewer's newer `changes` comment, so an older `pass` on the same head decides again. Deletions show in the organization audit log. Only people with write access can do this; it is a maintainer-only risk.
  - **The merge queue does not re-check.** On `merge_group` the gate passes without looking: a `changes` verdict posted after the PR was queued does not stop the merge. Remove the PR from the queue by hand.
  - **The rerun lookup has edge cases.** For fork PRs GitHub lists no PR number on the run, so two PRs from the same fork branch and SHA cannot be told apart. Runs older than 30 days cannot be re-run, and the rerun job then fails. In both cases, re-run the check by hand or push a new commit.

## Fork and first-time PRs
- Settings → Actions → General → "Fork pull request workflows from outside collaborators" is set to *Require approval for all outside collaborators*. CI does not run on a fork or first-time-contributor PR until a maintainer approves the run; that maintainer also arranges the independent review.
