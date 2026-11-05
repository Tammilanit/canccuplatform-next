# 0002. No legacy git history and no legacy docs

- **Status:** Accepted
- **Date:** 2026-11-03

## Context
The legacy repos carry years of history and a sprawl of docs, much of it event-specific or out of date. This repo is public under AGPL-3.0 from day one.

## Decision
Legacy git history and legacy docs are never imported. Ported code arrives as new commits in this repo; documentation is written fresh where it still guides work.

## Consequences
- The public history holds nothing event-specific from the past.
- Authorship of ported code by other authors is kept through its licence and attribution, not through history.
- Anyone needing old context reads the legacy repos, which stay readable (renamed `-legacy` and archived at the switch).
