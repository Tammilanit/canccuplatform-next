# 0016. Merge policy

- **Status:** Accepted (until the freeze, 2027-03-01; the `review-gate` check and the AGENTS.md and CONTRIBUTING.md text follow in #39)
- **Date:** 2026-11-05

## Context
Everyone codes with AI, so the gates are machines; a person steps in only where real damage is possible. The main ruleset requires 0 approvals, so `gh pr merge --auto` merges as soon as the queue's checks pass.

## Decision
- **Auto-merge** (`gh pr merge --auto`) once CI is green and the independent review's verdict is `pass` ([0014](0014-independent-review.md)).
- **Enforcement:** a required CI check `review-gate` (added by #39) passes only when the newest maintainer comment's last line is `Review verdict: pass <current head sha>`. A push changes the head, so it voids a pass. The maintainers' dispatcher enables auto-merge only after `review-gate` passes.
- **A maintainer accepts only:**
  - plan-tier plans;
  - breaking contract changes;
  - destructive migrations;
  - changes to `.github/` or `setup/`;
  - anything in other repos.
- **At most 2 review-fix rounds.** If the verdict is still not `pass` after the second round, or it is `manual`, a maintainer takes over.
- **From the freeze on 2027-03-01, every PR needs a maintainer's accept.** March is fixes only, the dress rehearsal and the switch; all feature work, Hardening included, is done by end of February ([roadmap](../roadmap.md#timeline)).

## Consequences
- Enabling auto-merge early does not bypass the review: the queue waits for `review-gate`.
- Most PRs merge with no person involved, so CI and the review carry the weight: lints, leak tests and the security review ([0013](0013-multi-tenant-core.md), [0014](0014-independent-review.md)).
- The AGENTS.md merge rules are updated in #39.
- After the freeze this record is superseded by a new one.
