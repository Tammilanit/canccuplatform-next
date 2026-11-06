# 0016. Merge policy

- **Status:** Accepted (implemented by #40: `.github/workflows/review-gate.yml`, `.github/scripts/review-gate`, AGENTS.md Merge rules). The accept list is superseded by [0019](0019-work-packages.md): the maintainer accepts by risk class (high), and the review flow is per package; the rest stands.
- **Date:** 2026-11-05

## Context
Everyone codes with AI, so the gates are machines plus an independent review; a maintainer steps in only where real damage is possible. The main ruleset requires 0 approvals, so `gh pr merge --auto` merges as soon as the required checks pass.

## Decision
- **Automatic merge** when CI is green and the independent review's verdict is `pass` on the current head ([0014](0014-independent-review.md)).
- **Enforcement:** the required check `review-gate`, a job in its own workflow (`docs/ci.md`, review-gate). It trusts only verdict comments by the reviewer identity (`REVIEWER_LOGIN`) and passes only on `Review verdict: pass <head sha>` for the PR's current head and base. A push or a base-branch change voids a pass; an edited or malformed verdict fails the gate. A reviewer comment that is created, edited or deleted re-runs the gate. On `merge_group` the check passes, because the PR was gated before it was queued.
- **Who enables auto-merge:** only the dispatcher (the maintainer tooling), after `review-gate` passes and only for a PR that needs no maintainer's accept, or a maintainer. Authors and the reviewer never do.
- **A maintainer accepts only, until the freeze:**
  - plan-tier plans (`docs/plans/issue-<n>.md`);
  - breaking contract changes;
  - destructive migrations;
  - changes to `.github/` (the gates themselves);
  - changes to `setup/` (privileged host scripts);
  - a record that supersedes 0014 or 0016;
  - anything in other repos.

  The reviewer gives these `manual — <reason>`; a maintainer never accepts over `changes`. The maintainer accepts by labelling the PR `accepted`, having `Review verdict: pass <head sha>` posted for the same head as the reviewer identity, and enabling auto-merge.
- **Review flow:** one full review, then one narrow fix-check ([0014](0014-independent-review.md)). A missing or broken fix goes to the maintainer; there is no new review loop.
- **From the freeze on 2027-03-01, every PR needs a maintainer's accept;** the reviewer's best verdict is `manual`. From then on fixes only, the dress rehearsal and the switch ([roadmap](../roadmap.md#order-and-dates)).

## Consequences
- Most PRs merge with no person involved, so CI and the review carry the weight: lints, leak tests and the security review ([0013](0013-multi-tenant-core.md), [0014](0014-independent-review.md)).
- AGENTS.md Merge rules list the first five accept cases; the last two (a record superseding 0014 or 0016, other repos) need a follow-up there.

## Known limits
- **A PR runs its own gate.** The check runs the PR's own copy of `review-gate.yml` and `.github/scripts/review-gate`, so a PR that changes them can make its own check green. Mitigation: `.github/` PRs always need a maintainer's accept, and the dispatcher never enables auto-merge on them. Possible follow-ups: `pull_request_target` with a checkout of the base ref only, or CODEOWNERS for `.github/` with required code-owner review.
- **GitHub does not enforce the accept cases.** With 0 required approvals, the maintainer-accept cases (and every PR after the freeze) are enforced by the dispatcher and the `manual` verdict, not by GitHub.
- **A required check without a pinned source** can be satisfied by a commit status of the same name, which any token with write access can set. Mitigation: a maintainer pins `review-gate` to its GitHub Actions source in the ruleset; until then this gap is open.
- **Deleted reviewer comments.** Anyone with write access can delete the reviewer's newer `changes` comment, so an older `pass` on the same head decides again. Deletions show in the organization audit log.
- **The merge queue does not re-check.** A `changes` verdict posted after the PR was queued does not stop the merge; remove the PR from the queue by hand.
- **Same OS user for authors and the reviewer.** See [0014](0014-independent-review.md), Known limits.
