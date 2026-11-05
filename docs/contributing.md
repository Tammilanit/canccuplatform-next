# Contributing flow

The rules are in [AGENTS.md](../AGENTS.md); machine setup is in [CONTRIBUTING.md](../CONTRIBUTING.md). This page is the path a change takes to `main`.

## The flow
1. **Issue:** pick one labelled `ready` and assign yourself (forks: comment "I'll take this").
2. **Branch:** `<n>-short-name`, one issue per branch. On the repo if you have write access, otherwise on your fork.
3. **Draft PR:** open it early. Title = the commit subject; body starts with `Closes #<n>` and ends with `Tier: fix|feature|plan`, `Next action:` and `Verification run:`.
4. **Ready:** when the checks pass and all acceptance criteria are met, mark the PR ready. Do not enable auto-merge yourself.
5. **Independent review:** a separate reviewer that did not write the change reviews the PR (Claude Code: a fresh session running `/code-review` at `high` effort, plus `/security-review` for sign-in, rights, secrets or tenancy/RLS). It posts a PR comment ending with `Review verdict: pass` or `Review verdict: changes`. On `changes`, fix and ask again. On `pass`, the reviewer enables auto-merge: `gh pr merge <pr> --auto` (the merge queue sets the strategy and rejects `--delete-branch` and strategy flags). For fork PRs a maintainer arranges the review.
6. **Merge queue:** GitHub merges the PR when the required checks are green. Never merge by hand.

## Who accepts
Until the freeze (2027-03-01), a maintainer accepts only plan-tier plans, breaking contract changes, destructive migrations, and changes to `.github/` or `setup/`; the maintainer labels the PR `accepted` and enables auto-merge. Everything else merges on green CI and `Review verdict: pass`. From the freeze, every PR needs a maintainer's accept. See [AGENTS.md, Merge rules](../AGENTS.md#merge-rules).

## What protects `main`
- No direct pushes and no force pushes, for admins too.
- Squash merge only; the branch is deleted after merge.
- Required checks: `lint-types-test (kit-ts)`, `lint-types-test (kit-py)` and `no-event-names`. They run on pull requests and on merge-queue entries. Do not rename these jobs in `.github/workflows/ci.yml`.
- Workflows from forks and first-time contributors wait for a maintainer to approve the run.
- A maintainer accepts the PRs listed under Who accepts.

See [ci.md](ci.md) for what each check does.
