# 0014. Every PR gets an independent review

- **Status:** Accepted (rollout in #39)
- **Date:** 2026-11-05

## Context
The `claude-review` CI check ran on a personal account's usage limits, so it cannot gate every PR. A review by the session that wrote the change tends to confirm its own reading of the change.

## Decision
- Every PR gets an **independent review by a separate reviewer session that did not write it**: Claude Code `/code-review` at `high` effort on the PR, plus `/security-review` when sign-in, rights, sessions, secrets, tenancy/RLS or `deploy/` change.
- The reviewer posts its findings on the PR, ending with one line: `Review verdict: pass|changes|manual — <reason>`.
  - `pass`: nothing left to fix;
  - `changes`: the author fixes the findings and the PR is reviewed again;
  - `manual`: a maintainer decides.
- Authors no longer review their own PRs.
- The CI `claude-review` check is removed.

## Consequences
- The verdict is the review gate of the merge policy ([0016](0016-merge-policy.md)); review-fix rounds are capped there.
- Dropping `claude-review` from the main ruleset's required checks needs a maintainer's OK when its PR is ready.
- The AGENTS.md merge-rule text and `docs/ci.md` change in #39.
- PRs from forks and first-time contributors get the review once a maintainer lets them run.
