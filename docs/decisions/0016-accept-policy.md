# 0016. Maintainer accept policy

- **Status:** Accepted (until the freeze, 2027-03-01)
- **Date:** 2026-11-05

## Context
Everyone codes with AI, so the gates are machines; a person steps in only where real damage is possible. The main ruleset requires 0 approvals, so `gh pr merge --auto` merges as soon as the queue's checks pass.

## Decision
- **Auto-merge** (`gh pr merge --auto`) for fix- and feature-tier PRs that only touch module code, tests or docs, once CI is green and the local review is clean ([0014](0014-local-review.md)).
- **The project owner's accept is needed for:**
  - the plan tier;
  - `contracts/` and migrations;
  - `deploy/`, `setup/` and `.github/` (CI);
  - sign-in, rights, secrets, and tenancy/RLS;
  - `packages/kit-*` (shared by every module and carries tenancy);
  - dependency manifests and lockfiles (supply chain);
  - root files (AGENTS.md, CLAUDE.md, CONTRIBUTING.md) and `docs/decisions/`;
  - anything in a live repo (any repo other than this one).
- Issues whose PR needs the accept carry the `manual-accept` label.
- A daily digest lists the merges.
- **From the freeze, every PR needs the project owner's accept again.**

## Consequences
- Each PR body states `Accept: auto|manual — <reason>`.
- The AGENTS.md merge rules are updated in #39.
- After the freeze this record is superseded by a new one.
