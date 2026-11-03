# Contributing flow

The rules are in [AGENTS.md](../AGENTS.md); machine setup is in [CONTRIBUTING.md](../CONTRIBUTING.md). This page is the path a change takes to `main`.

## The flow
1. **Issue:** pick one labelled `ready` and assign yourself (forks: comment "I'll take this").
2. **Branch:** `<n>-short-name`, one issue per branch. On the repo if you have write access, otherwise on your fork.
3. **Draft PR:** open it early. Title = the commit subject; body starts with `Closes #<n>` and ends with `Next action:` and `Verification run:`.
4. **Ready and auto-merge:** when all acceptance criteria are met, mark the PR ready and enable auto-merge: `gh pr merge --auto --squash --delete-branch`.
5. **Merge queue:** GitHub merges the PR when the required checks are green. Never merge by hand.

## What protects `main`
- No direct pushes and no force pushes, for admins too.
- Squash merge only; the branch is deleted after merge.
- Required checks: `lint-types-test (kit-ts)`, `lint-types-test (kit-py)` and `no-event-names`. They run on pull requests and on merge-queue entries. Do not rename these jobs in `.github/workflows/ci.yml`.
- Workflows from forks and first-time contributors wait for a maintainer to approve the run.
- A person approves only a breaking contract change or a destructive migration.

See [ci.md](ci.md) for what each check does.
