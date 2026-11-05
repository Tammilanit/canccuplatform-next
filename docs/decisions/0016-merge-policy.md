# 0016. Merge policy

- **Status:** Accepted (the `review-gate` check and the AGENTS.md and CONTRIBUTING.md text follow in #39)
- **Date:** 2026-11-05

## Context
Everyone codes with AI, so the gates are machines; a person steps in only where real damage is possible. The main ruleset requires 0 approvals, so `gh pr merge --auto` merges as soon as the queue's checks pass.

## Decision
- **Auto-merge** (`gh pr merge --auto`) once CI is green and the independent review's verdict is `pass` ([0014](0014-independent-review.md)).
- **Enforcement:** a required CI check `review-gate` (added by #39) trusts only verdicts written by the reviewer identity (`REVIEWER_LOGIN`, [0014](0014-independent-review.md)). It passes only when the newest comment by that login with a verdict line ends with `Review verdict: pass <current head sha>`. Comments by any other login, maintainers included, never count, and later comments without a verdict line do not void a pass. A push changes the head, so it voids a pass.
- **Who enables auto-merge:** only the maintainers' dispatcher, after `review-gate` passes and only when the PR is not a maintainer-accept case, or a maintainer. Author sessions never enable auto-merge.
- **A maintainer accepts only** (enforced by the dispatcher, see Known limits):
  - plan-tier plans;
  - breaking contract changes;
  - destructive migrations;
  - changes to `.github/` or `setup/`;
  - anything in other repos.
- **At most 2 review-fix rounds.** If the verdict is still not `pass` after the second round, or it is `manual`, a maintainer takes over.
- **From the freeze on 2027-03-01, every PR needs a maintainer's accept.** From then on fixes only, the dress rehearsal and the switch ([roadmap](../roadmap.md#order-and-dates)).

## Consequences
- Authors mark the PR ready and stop; they never enable auto-merge. #39 changes AGENTS.md step 8 (Done) and the CLAUDE.md `finish` and `ship` shortcuts to match.
- #39's acceptance criteria include: an author session cannot produce a passing verdict; the required `review-gate` check is pinned to its GitHub Actions source in the ruleset; the dispatcher writes the verdict formats of [0014](0014-independent-review.md) exactly; `review-gate` reports on the PR head (a commit status set through the API) and does not block the merge queue's own commit (skip on `merge_group`, as `claude-review` does today).
- Most PRs merge with no person involved, so CI and the review carry the weight: lints, leak tests and the security review ([0013](0013-multi-tenant-core.md), [0014](0014-independent-review.md)).
- The AGENTS.md merge rules are updated in #39.

## Known limits
- **The gate runs from the PR's own branch.** The workflow and the gate script come from the PR's branch, so a PR that changes `.github/` can change its own gate. Mitigation: `.github/` PRs are always maintainer-accept, and the dispatcher enforces that: it never enables auto-merge on them, and author sessions never enable it at all.
- **GitHub does not enforce the accept cases.** The ruleset requires 0 approvals, so the maintainer-accept cases (and every PR after the freeze) are enforced by the dispatcher, not by GitHub.
- **A status can be set by any write token.** `review-gate` is a commit status; a token with write access can set one directly. Deny rules do not stop an author's own write token from doing this. The mitigation is pinning the required check to its GitHub Actions source in the ruleset, an acceptance criterion of #39; until then this gap is open.
- **Same OS user for authors and the reviewer.** See [0014](0014-independent-review.md), Known limits.
