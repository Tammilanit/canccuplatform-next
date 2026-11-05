# 0015. Dependency auditing

- **Status:** Accepted
- **Date:** 2026-11-05

## Context
The platform's security rests on containers, a small attack surface and keeping dependencies clean ([0009](0009-rust-rejected.md)). Nothing checks dependencies yet.

## Decision
In Hardening (roadmap step 10): `npm audit` and `pip-audit` run in CI, and Renovate (or Dependabot) opens update PRs for images and dependencies.

## Consequences
- Update PRs merge like any other PR: CI green and a `pass` verdict from the independent review ([0016](0016-merge-policy.md)). The Renovate or Dependabot config lives in `.github/`, so adding it needs a maintainer's accept.
- A known vulnerability fails CI until it is fixed or explicitly ignored with a reason.
