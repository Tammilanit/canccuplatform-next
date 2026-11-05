# 0014. A local review replaces the CI Claude review

- **Status:** Accepted (rollout in #39)
- **Date:** 2026-11-05

## Context
The `claude-review` CI check ran on a token from an account that development no longer uses, and no CI token can be created for the new one.

## Decision
The CI `claude-review` check is removed. Before a PR is marked ready, a local `/code-review` at `high` effort is mandatory; its findings are fixed and the result is recorded in the PR body as a `Review run:` line.

## Consequences
- Dropping the required check from the main ruleset needs the project owner's OK when its PR is ready.
- The AGENTS.md merge-rule text changes in #39.
- Fork PRs no longer get an automatic AI review; a maintainer's review covers them.
