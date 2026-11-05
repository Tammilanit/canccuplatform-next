# Contributing flow

The rules are in [AGENTS.md](../AGENTS.md); machine setup is in [CONTRIBUTING.md](../CONTRIBUTING.md). This page is the path a change takes to `main`.

## The flow
1. **Issue:** pick one labelled `ready` and assign yourself (forks: comment "I'll take this").
2. **Branch:** `<n>-short-name`, one issue per branch. On the repo if you have write access, otherwise on your fork.
3. **Draft PR:** open it early. Title = the commit subject; body starts with `Closes #<n>` and ends with `Tier:`, `Accept: auto|manual — <reason>`, `Next action:`, `Verification run:` and `Review run:`.
4. **Local review:** before marking the PR ready, run a code review of the whole diff (Claude Code: `/code-review` at `high` effort; other tools: an equivalent review), fix its findings and fill in `Review run: <tool/effort> — <result>`. Fork contributors do the same; a maintainer reviews fork PRs.
5. **Ready:** when all acceptance criteria are met and the review is clean, mark the PR ready. With `Accept: auto`, enable auto-merge: `gh pr merge <pr> --auto` (the merge queue sets the strategy and rejects `--delete-branch` and strategy flags). With `Accept: manual`, a maintainer accepts the PR first.
6. **Merge queue:** GitHub merges the PR when the required checks are green. Never merge by hand.

## Who accepts
Until the freeze (2027-03-01), fix and feature PRs that touch only module code (`modules/**`, `packages/ui/**`), tests or docs are `Accept: auto`. A maintainer accepts the plan tier and anything touching `contracts/`, migrations, `deploy/`, `setup/`, `.github/`, `packages/kit-*`, `docs/decisions/`, root files, Dockerfiles, dependency manifests or lockfiles, sign-in, rights, secrets or tenancy/RLS. From the freeze, every PR needs a maintainer's accept. The full rules are in AGENTS.md, Merge rules.

## What protects `main`
- No direct pushes and no force pushes, for admins too.
- Squash merge only; the branch is deleted after merge.
- Required checks: `lint-types-test (kit-ts)`, `lint-types-test (kit-py)` and `no-event-names`. They run on pull requests and on merge-queue entries. Do not rename these jobs in `.github/workflows/ci.yml`.
- Workflows from forks and first-time contributors wait for a maintainer to approve the run.
- A maintainer accepts `Accept: manual` PRs (see Who accepts); a person also approves a breaking contract change or a destructive migration.

See [ci.md](ci.md) for what each check does.
